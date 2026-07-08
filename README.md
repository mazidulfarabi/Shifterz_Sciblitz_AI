# Spatial Vision Assistant

**Spatial Vision Assistant** is a browser-based assistive system that turns a live camera feed into spoken English descriptions of what is around the user — objects, people, facial expressions, and hand gestures — with spatial context (left, center, right; near or far).

It is built for people who cannot rely on sight alone: those who are **blind**, **partially sighted**, living with **blurred vision**, **myopia** (nearsightedness), **hyperopia** (farsightedness), **macular degeneration**, **cataracts**, **glaucoma**, or other conditions that make navigating everyday spaces harder without audio support.

The goal is not to replace a cane, guide dog, or human assistant — but to give an **independent layer of awareness** in familiar environments: a room, a desk, a hallway, or a conversation where someone is gesturing or reacting in ways that would normally require vision to notice.

> *"Can computer vision bridge the gap for people who cannot see clearly by interpreting the world around them in real time?"*
>
> This project follows the same spirit as accessibility-focused computer vision work where machine learning is applied not as a demo, but as a practical tool for communities that need it.

---

## Why This Exists

For people who are fully blind, have blurred vision or are partially blind (Glaucoma, Retinitis Pigmentosa (RP), Leber Hereditary Optic Neuropathy (LHON), Choroideremia, Cataracts, Diabetic Retinopathy, Age-Related Macular Degeneration (AMD), Stargardt Disease) simple tasks carry friction that sighted users rarely think about:

- **Locating objects** — *Where is the bottle? Is the phone on my left or in front of me?*
- **Understanding people nearby** — *Is someone facing me? Are they trying to get my attention?*
- **Reading body language** — *Are they smiling, yawning, or showing a thumbs up?*
- **Navigating space** — *What furniture or obstacles are close versus farther away?*

Spatial Vision Assistant addresses these by running **multiple vision models in parallel** on each video frame, fusing the results into **one natural spoken sentence** — for example:

> *"There's a person in front of you, yawning and showing a thumbs up. There's also a cell phone and a bottle in front of you."*

**The user hears this through speakers or headphones.** They do not need to read the screen. Someone just has to open this website for them in a camera-phone. The interface is deliberately minimal: large buttons, a status line, and an optional on-screen transcript for caregivers or low-vision users who can still read.

---

## What It Detects

### Object Detection (MediaPipe EfficientDet Lite0, COCO-trained)

Each frame is passed through an object detector trained on the **COCO dataset** — a large, labeled image corpus where every photo is tagged with bounding boxes and class names. The model returns a label and confidence score for each detection.

**Supported object categories include:**

| Category | Examples |
|----------|----------|
| **People** | person |
| **Vehicles** | bicycle, car, motorcycle, bus, train, truck, boat |
| **Animals** | bird, cat, dog, horse |
| **Bags & accessories** | backpack, umbrella, handbag, tie, suitcase |
| **Food & drink** | bottle, cup, fork, knife, spoon, bowl, banana, apple, sandwich, orange, pizza, donut, cake |
| **Furniture** | chair, couch, bed, dining table, potted plant |
| **Electronics** | tv, laptop, mouse, remote, keyboard, cell phone, microwave, oven, refrigerator |
| **Household items** | toilet, book, clock, vase, scissors, teddy bear |

Objects the model was never trained on will not be recognized. Unknown items are silently ignored rather than guessed.

Each detected object is assigned a **spatial position** relative to the camera:

- **Horizontal:** on your left · in front of you · on your right
- **Depth (estimated from bounding-box size):** very close · close · medium distance · far

Up to **8 objects** per frame are processed, filtered by a confidence threshold of **45%**.

---

### Face Analysis & Facial Expressions (MediaPipe Face Landmarker + Blendshapes)

Face detection alone is not enough for accessibility — *what is the person doing?* The app uses **Face Landmarker**, which outputs **478 3D facial landmarks** and **52 blendshape coefficients** (numerical scores for muscle movements used in animation and expression analysis).

From those blendshapes, the system infers:

| Expression | How it is inferred |
|------------|-------------------|
| **Yawning** | High `jawOpen` coefficient |
| **Smiling** | Elevated `mouthSmileLeft` / `mouthSmileRight` |
| **Frowning** | Elevated `mouthFrownLeft` / `mouthFrownRight` |
| **Eyes closed** | High `eyeBlinkLeft` and `eyeBlinkRight` together |
| **Looking surprised** | Raised inner brow + widened eyes |
| **Puffing cheeks** | High `cheekPuff` coefficient |

Expressions are **merged into the person description** — the app never says *"face detected"* out loud. Visually, the current expression (e.g. "Yawning") appears on the bounding box overlay and in the top-left HUD.

---

### Hand Gesture Recognition (MediaPipe Gesture Recognizer)

When a person (or tracked face) is present, a **Gesture Recognizer** model analyzes hand landmarks and classifies the pose. Supported gestures:

| Gesture | Spoken as |
|---------|-----------|
| **Thumb Up** | showing a thumbs up |
| **Thumb Down** | showing a thumbs down |
| **Open Palm** | showing an open palm |
| **Closed Fist** | making a fist |
| **Victory** | showing a peace sign |
| **Pointing Up** | pointing up |
| **I Love You** | showing an I love you sign |

Gestures are **combined with the person sentence**, not announced separately. Example: *"There's a person in front of you, smiling and showing a peace sign."*

A **live text overlay** in the top-left corner of the video shows detected gestures and expressions for users who have some remaining vision.

---

### Spatial Audio Descriptions (Text-to-Speech)

Generated sentences are spoken in **English** via the browser **Web Speech API**, with optional Google TTS fallback. The user can:

- **Mute / unmute** audio at any time
- Press **Scan Now** or the **Space** key to force an immediate re-announcement
- Adjust announcement interval via `config.js` (default: every 4 seconds when the scene changes)

Duplicate announcements are suppressed: person + face detections are deduplicated, and the scene signature only changes when objects, expressions, or gestures meaningfully change.

---

## How It Works — The Engineering Pipeline

Computer vision systems are not magic. They are the product of a disciplined machine learning workflow. Spatial Vision Assistant deploys **production-grade models from Google MediaPipe**, which were themselves produced through the same fundamental stages used in research and industry pipelines — including workflows documented by platforms like [Roboflow for sign-language accessibility projects](https://blog.roboflow.com/computer-vision-american-sign-language/).

### Stage 1 — Image Acquisition & Dataset Curation

Every vision model begins with **raw images or video frames**. In a training pipeline, these are captured under varied conditions — different lighting, angles, backgrounds, and subjects — so the model generalizes beyond a single environment. Images are collected, reviewed, and organized into a structured dataset.

### Stage 2 — Labeling & Class Definition

Each image is **annotated** with bounding boxes (for objects) or landmark points (for faces and hands). Every region is assigned a **class name** — e.g. `person`, `bottle`, `Thumbs_Up`, `Open_palm`, `Victory_sign`, `yawning`, `eyes_closed`. This supervised labeling step is what teaches the model *what* to look for. Tools like **Roboflow** and **Teachable Machine** exist precisely to streamline this: upload images, draw boxes, name classes, and export a training-ready dataset. [How Labeling is Done](https://youtu.be/a3SBRtILjPI?si=ItP6YIck2pg4oKR3/)

### Stage 3 — Data Augmentation

Real-world datasets are rarely large enough on their own. Before training, images undergo **augmentation** — synthetic variations that simulate conditions the camera will see in deployment:

- Horizontal and vertical **flips**
- **Rotation** and slight **perspective** shifts
- **Brightness**, **contrast**, and **blur** adjustments
- **Crop** and **scale** changes

A few hundred original photos can expand to **tens of thousands** of training samples through controlled warping and oversampling — dramatically improving model robustness without collecting new data in the field.

### Stage 4 — Model Training (Supervised Machine Learning)

The augmented, labeled dataset is fed into a **neural network** — for objects, architectures like **EfficientDet**; for hands and faces, specialized **landmark and gesture classifiers**. The network learns weights through **supervised training**: compare predictions to ground-truth labels, compute loss, backpropagate, repeat for hundreds of **epochs** until mean average precision (mAP) stabilizes.

Teachable Machine and similar platforms expose this step through a UI; production systems run the same math on GPU clusters. The output is a **`.tflite` or `.task` model file** — a frozen set of weights ready for inference.

### Stage 5 — Real-Time Inference (This Application)

Spatial Vision Assistant loads three MediaPipe Tasks Vision models at runtime via **WebAssembly (WASM)** on the user's device:

| Model | File | Role |
|-------|------|------|
| **Object Detector** | `efficientdet_lite0.tflite` | COCO object detection |
| **Face Landmarker** | `face_landmarker.task` | Face mesh + 52 blendshapes |
| **Gesture Recognizer** | `gesture_recognizer.task` | Hand pose classification |

Each video frame flows through this pipeline:

```
Camera frame
    → Object Detector (objects + bounding boxes)
    → Face Landmarker (landmarks + blendshapes → expressions)
    → Gesture Recognizer (if person/face present → hand gestures)
    → Spatial reasoning layer (position, depth, deduplication)
    → Natural language sentence builder
    → Web Speech API (spoken output)
```

All inference runs **server-less with Netlify**. No images are uploaded to a server. Which makes this super-fast. No account creation is required. Privacy is preserved by design.

The spatial reasoning layer is custom engineering: it converts normalized bounding-box coordinates into human-readable location phrases, merges person detections with face analyses to avoid redundancy, groups co-located objects into single clauses, and rate-limits announcements so the user is not flooded with repetition.

---

## Technology Stack

| Layer | Technology |
|-------|------------|
| UI | HTML5, CSS3, vanilla JavaScript (ES modules) |
| Vision inference | [MediaPipe Tasks Vision](https://developers.google.com/mediapipe/solutions/vision) `@0.10.8` (WASM) |
| Speech | Web Speech API (`en-US`), optional Google TTS fallback |
| Camera | `getUserMedia` with front (`user`) and rear (`environment`) facing modes; switchable at runtime on mobile |
| Hosting | Netlify (static deploy) |

---

## Limitations

No assistive vision system is perfect. Users and caregivers should understand these constraints:

| Limitation | Detail |
|------------|--------|
| **Lighting & distance** | Poor lighting, extreme distance, or heavy occlusion reduce accuracy — the same limitations documented in [real-world ASL detection research](https://blog.roboflow.com/computer-vision-american-sign-language/). |
| **Gesture visibility** | Hands must be visible in frame. Gestures are only analyzed when a person or face is detected. |
| **Expression heuristics** | Yawning, smiling, etc. are inferred from blendshape thresholds — not clinical-grade emotion recognition. A wide open mouth may be misread as yawning during speech or laughter. |
| **Single-camera depth** | Depth (near/far) is estimated from object size in the frame, not from stereo or LiDAR. A small nearby object and a large distant one can be confused. |
| **Not a safety-critical system** | This tool supports awareness. It must not be relied upon alone for navigation in traffic, stairs, or hazardous environments. |

---

## How to Run Locally

Camera and speech APIs require a secure context. Do not open `index.html` directly from the filesystem.

```bash
npx serve .
```

Open `http://localhost:3000` in Chrome, Edge, or Brave.

Optional configuration:

```bash
cp config.example.js config.js
```

Edit `MIN_INTERVAL_SEC` in `config.js` to change how often the scene is re-announced.

---

## How to Use

1. Open the page over **HTTPS** or **localhost**
2. Click **Start Camera** and grant camera permission
3. Wait for models to load (first run only)
4. Point the camera at your surroundings
5. Listen to spoken descriptions; read the Detection panel if helpful
6. On phones, tap **Use Back Camera** or **Use Front Camera** to switch between rear and selfie cameras
7. Press **Scan Now** or **Space** to announce immediately
8. Click **Mute Audio** to silence speech

---

## Project Structure

| File | Purpose |
|------|---------|
| `index.html` | UI layout, video preview, controls, detection panel |
| `app.js` | Camera, MediaPipe inference, spatial logic, TTS, overlays |
| `config.example.js` | Example timing configuration |
| `netlify.toml` | Deploy settings and security headers |

---

## Deployment (Netlify)

1. Push the repository to GitHub or GitLab
2. In Netlify: **Add new site** → import the repo
3. Leave build command empty; set publish directory to project root
4. Deploy — settings are preconfigured in `netlify.toml`

---

## Troubleshooting

**Camera not working**
- Grant camera permission in browser settings
- Use HTTPS or localhost, not `file://`
- Close other apps using the camera

**Text appears but no speech**
- Click anywhere on the page once, then start the camera
- Check system and in-app mute settings
- Try Chrome or Edge on desktop

**Slow or missing detections**
- Ensure stable internet for first model download
- Improve lighting; move objects closer to the camera
- Reload the page and wait for models to finish loading

---

## Acknowledgments and References

Spatial Vision Assistant is built on open tools, published models, and documented research. The following resources are used directly or inform the design of this project.

### Core Vision & Machine Learning

| Tool / Resource | Role in this project | Reference |
|-----------------|----------------------|-----------|
| **Google MediaPipe Tasks Vision** (`@0.10.8`) | Runtime inference for object detection, face landmarks, blendshapes, and hand gestures via WebAssembly | [MediaPipe Vision Solutions](https://developers.google.com/mediapipe/solutions/vision) |
| **MediaPipe Object Detector** (EfficientDet Lite0) | COCO-trained object detection in live video | [Object Detector Web Guide](https://developers.google.com/edge/mediapipe/solutions/vision/object_detector/web_js) |
| **MediaPipe Face Landmarker** | 478-point face mesh and 52 blendshape coefficients for expression inference | [Face Landmarker Web Guide](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/web_js) |
| **MediaPipe Gesture Recognizer** | Real-time hand pose and gesture classification | [Gesture Recognizer Web Guide](https://developers.google.com/edge/mediapipe/solutions/vision/gesture_recognizer/web_js) |
| **COCO Dataset** | Object class vocabulary used by the EfficientDet model (people, vehicles, furniture, etc.) | [COCO: Common Objects in Context](https://cocodataset.org/) |

### Data Pipeline & Training Methodology (Referenced)

The models above were produced through standard supervised ML workflows. This project documents and aligns with that pipeline; the following tools represent the class of systems used in industry and accessibility research:

| Tool / Resource | Role | Reference |
|-----------------|------|-----------|
| **Roboflow** | Image labeling, class assignment, and augmentation (rotation, flip, brightness, oversampling) in training pipelines | [Roboflow Documentation](https://docs.roboflow.com/) |
| **Google Teachable Machine** | Accessible supervised model training from labeled image datasets | [Teachable Machine](https://teachablemachine.withgoogle.com/) |
| **Roboflow — ASL Computer Vision Research** | Accessibility-focused CV methodology; inspiration for applying detection to assistive communication | [Using Computer Vision to Help Deaf and Hard of Hearing Communities](https://blog.roboflow.com/computer-vision-american-sign-language/) |

### Speech, Browser & Deployment

| Tool / Resource | Role in this project | Reference |
|-----------------|----------------------|-----------|
| **Web Speech API** | Primary English text-to-speech output in the browser | [MDN: Web Speech API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API) |
| **Google Translate TTS** (optional fallback) | Secondary spoken output when browser voices are unavailable | Used via public TTS endpoints when configured |
| **jsDelivr CDN** | Delivery of MediaPipe WASM binaries and JavaScript bundles | [jsDelivr — @mediapipe/tasks-vision](https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.8/) |
| **Google Cloud Storage** | Hosting of pre-trained MediaPipe `.tflite` and `.task` model files | `storage.googleapis.com/mediapipe-models/` |
| **Netlify** | Static site hosting and HTTPS deployment | [Netlify Docs](https://docs.netlify.com/) |

### License & Attribution Notes

- **MediaPipe** is provided by Google under the [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0).
- **COCO** dataset and annotations are used under the [Creative Commons Attribution 4.0 License](https://creativecommons.org/licenses/by/4.0/).

If this work is useful to you, share it with organizations serving blind, low-vision, and deaf-blind communities — and contribute improvements via the repository.
