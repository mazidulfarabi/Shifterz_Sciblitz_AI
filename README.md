# Spatial Vision Assistant

A browser-based assistive application that uses your camera to detect nearby objects, faces, and hand gestures, then provides spoken English descriptions aloud. Everything runs in the browser — no backend or install required.

## Purpose

The app helps users understand their surroundings through real-time audio feedback about:

- what objects are present around the user
- where those objects are located (left, center, right, near, or far)
- whether faces are detected and where they appear
- whether a person is present and what hand gesture they are making

## Key Features

### Object Detection
- Live webcam feed analyzed by MediaPipe Object Detector
- Recognizes people, vehicles, furniture, animals, and household items
- Each detection includes a label and confidence score

### Face Detection
- MediaPipe Face Detector locates faces in the video frame
- Face bounding boxes are drawn in gold on the overlay
- Face positions are included in spoken announcements

### Spatial Description
- Describes horizontal position (left / center / right) and depth (very close / close / medium / far)
- Helps users understand not only what is present, but where it is

### Hand Gesture Recognition
- When a person or face is detected, MediaPipe Gesture Recognizer analyzes hand movements
- Supported gestures: Open Palm, Closed Fist, Thumb Up, Victory, Pointing Up, I Love You, and more
- Detected gestures appear as text in the top-left corner of the video feed

### Text-to-Speech
- Descriptions are spoken using the browser Web Speech API (English)
- Google TTS is available as a fallback when configured
- Click **Mute Audio** to silence speech

## Technology Stack

- HTML5, CSS3, JavaScript ES modules
- MediaPipe Tasks Vision (object detection, face detection, gesture recognition)
- Web Speech API for audio output
- Netlify for static hosting

## How to Run Locally

Because camera access and speech APIs work more reliably over HTTP, run from a local server:

```bash
npx serve .
```

Then open `http://localhost:3000`.

Optionally copy the config file:

```bash
cp config.example.js config.js
```

## How to Use

1. Open the page in a browser (HTTPS or localhost recommended)
2. Click **Start Camera** and allow camera access
3. Point the camera at your surroundings
4. Descriptions appear in the Detection panel and are spoken aloud
5. Press **Scan Now** or the Space key to force an immediate announcement
6. Click **Mute Audio** to toggle speech

## Deployment

Push to GitHub/GitLab and deploy to Netlify. The publish directory is the project root. See [netlify.toml](netlify.toml) for settings.

## Troubleshooting

### Camera not working
- Allow camera permission in browser settings
- Use HTTPS or localhost instead of opening the file directly
- Ensure no other app is using the camera

### Description appears but no speech
- Click anywhere on the page once before starting (browsers require user interaction for audio)
- Check that audio is not muted in the app or system
- Try a different browser (Chrome or Edge recommended on desktop)

### Models take a long time to load
- First load downloads AI models from the network (30–60 seconds is normal)
- Ensure a stable internet connection
