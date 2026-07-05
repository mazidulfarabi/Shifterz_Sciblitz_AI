# দৃশ্য সহায়ক (Spatial Vision Assistant)

**অন্ধ ও দৃষ্টিপ্রতিবন্ধী** ব্যবহারকারীদের জন্য AI-চালিত বস্তু ও হাতের ইশারা শনাক্তকরণ। ক্যামেরা [MediaPipe Object Detector](https://developers.google.com/mediapipe/solutions/vision/object_detector) দিয়ে বস্তু চেনে, **স্থানিক প্রসঙ্গ** (বাম / সামনে / ডান, কাছে / দূরে) যোগ করে, ব্যক্তি থাকলে [Gesture Recognizer](https://developers.google.com/mediapipe/solutions/vision/gesture_recognizer) দিয়ে হাতের ইশারা চেনে, এবং **বাংলায়** বর্ণনা পড়ে।

## Stack

- Static HTML + ES modules (no build step)
- MediaPipe Tasks Vision: `ObjectDetector` + `GestureRecognizer`
- Web Speech API (`bn-BD`) for Bengali text-to-speech
- Netlify hosting

## Deploy to Netlify

1. Push this folder to GitHub/GitLab.
2. Netlify → **Add new site** → import repo.
3. Build command: *(leave empty)* — `netlify.toml` handles publish directory `.`
4. Deploy.

## Local config

```bash
cp config.example.js config.js
# Edit MIN_INTERVAL_SEC if needed
```

Or change settings in the in-app **সেটিংস** panel (saved to browser localStorage).

## Run locally

Serve over HTTP (not `file://`):

```bash
npx serve .
```

Camera policies work best on HTTPS (Netlify provides this automatically).

## Hand gestures

When a **person** is detected, the app runs MediaPipe Gesture Recognizer and announces gestures such as:

| Gesture | Bengali |
|---------|---------|
| Open_Palm | খোলা হাত |
| Closed_Fist | মুষ্ঠি |
| Thumb_Up | সম্মতি |
| Victory |বিজয় ইশারা |
| Pointing_Up | উপরের দিকে আঙুল |
| ILoveYou | আই লাভ ইউ ইশারা |

## Bengali TTS note

The browser picks a Bengali voice when available (`bn-BD`). Quality varies by OS/browser — Chrome on Windows may have limited Bengali voices. For production-quality TTS, consider Google Cloud or Azure Bengali voices via a small backend.
