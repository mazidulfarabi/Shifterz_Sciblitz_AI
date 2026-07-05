# Spatial Vision Assistant

AI-powered object recognition for **blind and low-vision users**. The camera detects objects with [MediaPipe Object Detector](https://developers.google.com/mediapipe/solutions/vision/object_detector), adds **spatial context** (left / center / right, near / far), sends data to **n8n** for a natural sentence, and reads it aloud in the browser.

## Stack

- Static HTML + ES modules (no build step)
- MediaPipe Tasks Vision `ObjectDetector` (EfficientDet Lite2)
- Web Speech API for text-to-speech
- n8n webhook for spatial sentence generation
- Netlify hosting

## Deploy to Netlify

1. Push this folder to GitHub/GitLab.
2. Netlify → **Add new site** → import repo.
3. Build command: *(leave empty)* — `netlify.toml` handles publish directory `.`
4. Deploy.

## Configure n8n

See **[N8N_SETUP.md](./N8N_SETUP.md)** for:

- Webhook payload format
- Expected JSON response
- Importable workflow (`n8n-workflow-template.json`)
- CORS headers
- Optional LLM upgrade path

## Local config

```bash
cp config.example.js config.js
# Edit config.js with your n8n webhook URL
```

Or set the webhook in the in-app **Settings** panel (saved to browser localStorage).

## Run locally

Serve over HTTP (not `file://`):

```bash
npx serve .
```

Camera + mic policies work best on HTTPS (Netlify provides this automatically).
