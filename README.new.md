# দৃষ্টি সহায়ক (Dristi Sohayok)

দৃষ্টি সহায়ক is an AI-powered, browser-based assistive application designed for blind and visually impaired users. It uses a camera to detect nearby objects, understand their spatial position, recognize hand gestures when a person is present, and speak a simple Bengali description aloud. The app runs entirely in the browser, so there is no need to install a desktop application or backend service.

## Purpose

The main goal of this project is to help users understand their surroundings more independently. Instead of relying on sight alone, the app provides real-time audio feedback about:

- what objects are present around the user
- where those objects are located, such as left, center, right, near, or far
- whether a person is detected and what hand gesture they are making
- a clear Bengali spoken description that can be heard through the device speakers or headphones

This makes the experience more accessible for users who need assistive technology in daily life, education, travel, or navigation.

## Key Features

### 1. Object Detection
- The webcam captures live video frames
- MediaPipe Object Detector analyzes the scene in real time
- Common objects such as people, vehicles, furniture, animals, and household items can be recognized
- Each detected object receives a label and a confidence score

### 2. Spatial Description
- The app describes where each object is located in relation to the user
- It uses terms such as:
  - left / center / right
  - very near / near / medium / far
- This helps users understand not only what is present, but also where it is

### 3. Hand Gesture Recognition
- If a person is detected, the app can analyze hand movements using MediaPipe Gesture Recognizer
- Supported gestures include:
  - খোলা হাত (Open Palm)
  - মুষ্ঠি (Closed Fist)
  - থাম্বস আপ (Thumb Up)
  - ভি (বিজয়) ইশারা (Victory)
  - উপরের দিকে আঙুল (Pointing Up)
  - আই লাভ ইউ ইশারা (I Love You)
- These gestures are described in Bengali so the user can hear them clearly

### 4. Bengali Text-to-Speech
- The app turns its generated description into spoken Bengali audio
- It uses browser-based speech playback and, when available, Google TTS-style audio playback
- The quality of speech output depends on the browser, operating system, available voices, and internet connection

### 5. Simple and Accessible User Interface
- Large buttons and simple controls
- Clear announcement area for current descriptions
- Minimal visual clutter
- Designed to be usable even by people who rely heavily on audio feedback

## Technology Stack

This project is built as a static web application with no backend dependency. The main technologies are:

- HTML5 for page structure
- CSS3 for styling and responsive layout
- JavaScript ES modules for app behavior
- MediaPipe Tasks Vision for object and gesture recognition
- Web Speech API and browser audio playback for speech output
- Netlify for static hosting

## How the App Works

The app follows a simple real-time workflow:

1. The user presses the camera button to start the webcam
2. The browser requests camera permission and begins streaming video
3. Each video frame is analyzed by MediaPipe object detection models
4. Detected objects are filtered by confidence and converted into structured data
5. The app computes spatial information such as horizontal position and depth
6. If a person is detected, hand gestures are recognized and included in the description
7. A Bengali sentence is built from the detected objects and gestures
8. That sentence is displayed on screen and spoken aloud using TTS

## Project File Structure

- [index.html](index.html): Main user interface, camera preview area, announcement panel, and buttons
- [app.js](app.js): Core application logic, camera management, object detection, gesture recognition, speech output, and UI updates
- [config.example.js](config.example.js): Example configuration file for adjusting app timing behavior
- [netlify.toml](netlify.toml): Netlify deployment settings
- [README.md](README.md): Project documentation

## How to Run Locally

### Option 1: Use a simple local server

Because camera access and some browser APIs work more reliably over HTTP, it is recommended to run the app from a local server rather than directly from the filesystem.

From the project folder, run:

```bash
npx serve .
```

Then open:

```text
http://localhost:3000
```

> Using localhost or HTTPS is strongly recommended for camera permission and speech-related browser APIs.

### Option 2: Create a config file

If you want to use a configuration file, copy the example file:

```bash
cp config.example.js config.js
```

Then edit it as needed.

## How to Use the App

1. Open the page in a browser
2. Click the “ক্যামেরা চালু করুন” button
3. Allow camera access when prompted
4. The app will begin detecting objects and gestures in front of the camera
5. The current description will appear on screen and be spoken aloud
6. You can press the “এখনই বর্ণনা করুন” button or the Space key to force another announcement
7. You can mute speech by clicking “কথা বন্ধ করুন”

## Supported Hand Gestures

When a person is detected, the app can recognize these gestures:

| Gesture | Bengali Label |
|---------|---------------|
| Open_Palm | খোলা হাত |
| Closed_Fist | মুষ্ঠি |
| Thumb_Up | থাম্বস আপ |
| Victory | ভি (বিজয়) ইশারা |
| Pointing_Up | উপরের দিকে আঙুল |
| ILoveYou | আই লাভ ইউ ইশারা |

## Text-to-Speech Notes

The app uses browser speech capabilities and, where available, Google TTS-style audio playback for spoken Bengali descriptions. However, speech behavior can vary depending on the device, browser, operating system, and installed language voices.

### Practical Notes

- Chrome, Edge, and Brave may behave differently from one another
- Android phones often require an initial user interaction before speech playback begins
- Some systems may have limited Bengali voices, causing speech to sound different or not play at all
- A stable internet connection helps when using remote audio playback methods

## Deployment

### Deploying to Netlify

1. Push the repository to GitHub or GitLab
2. Open Netlify and choose “Add new site”
3. Import the repository
4. Leave the build command empty if not required
5. Set the publish directory to the project root

The project already includes deployment settings in [netlify.toml](netlify.toml).

## Security and Privacy Notes

- The app requests camera access only when the user starts it
- It does not request microphone permission
- Since the app is static and browser-based, there is no backend server required for the core experience
- No login, authentication, or user account system is required for normal use

## Troubleshooting

### Camera is not working
- Make sure the browser has permission to use the camera
- Use HTTPS or localhost instead of opening the page directly from the filesystem
- Try another browser if needed
- Check whether another app is already using the camera

### The description appears but no speech is heard
- Click or tap the page once before starting speech
- Refresh the browser and try again
- Try switching speech mode if available
- Check browser policies or OS restrictions that may block audio playback

### The app shows an error
- Open the browser developer console to inspect the error message
- Confirm that your internet connection is working
- Reload the app and try again

## Future Improvements

Possible future enhancements include:

- support for more languages
- improved object recognition accuracy
- offline speech synthesis support
- more customizable voice selection
- a better multilingual interface
- richer and more natural gesture descriptions
- higher-quality Bengali TTS via a dedicated backend service

## Acknowledgment

This project brings together accessibility, computer vision, browser-based AI, and assistive technology into a simple tool that can help users better understand their surroundings.
