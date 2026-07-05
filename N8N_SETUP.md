# n8n Setup — Spatial Vision Assistant

This document tells you exactly how to wire n8n so the Netlify app sends object detections and gets back a **spatial sentence** read aloud to the user.

---

## Quick start

1. Import `n8n-workflow-template.json` into n8n (Workflows → Import from file).
2. Activate the workflow.
3. Copy the **Production Webhook URL** from the Webhook node (path: `spatial-vision`).
4. Paste that URL into the app **Settings → n8n webhook URL**, or put it in `config.js` (copy from `config.example.js`).
5. Deploy to Netlify and test on HTTPS (camera requires secure context).

---

## What the app sends (POST JSON)

Every time the scene changes (or the user presses **Describe now** / Space), the browser POSTs:

```json
{
  "source": "spatial-vision-assistant",
  "version": "1.0",
  "timestamp": "2026-07-06T12:00:00.000Z",
  "frame": { "width": 640, "height": 480 },
  "object_count": 2,
  "objects": [
    {
      "label": "cup",
      "display_name": "cup",
      "confidence": 0.87,
      "position": {
        "horizontal": "left",
        "vertical": "middle",
        "depth": "near",
        "center_x": 0.21,
        "center_y": 0.52,
        "area": 0.074
      },
      "bbox": { "x": 0.08, "y": 0.35, "width": 0.26, "height": 0.28 }
    },
    {
      "label": "chair",
      "display_name": "chair",
      "confidence": 0.72,
      "position": {
        "horizontal": "center",
        "vertical": "lower",
        "depth": "medium",
        "center_x": 0.51,
        "center_y": 0.71,
        "area": 0.031
      },
      "bbox": { "x": 0.32, "y": 0.48, "width": 0.38, "height": 0.42 }
    }
  ],
  "hints": {
    "horizontal_axis": "left is camera-left (user's left when facing same direction as camera)",
    "depth_proxy": "bbox area — larger means closer",
    "purpose": "Convert detections into one concise spatial sentence for a blind user"
  }
}
```

### Spatial fields (computed in the browser)

| Field | Values | Meaning |
|-------|--------|---------|
| `position.horizontal` | `left`, `center`, `right` | Where in the frame (approx thirds) |
| `position.vertical` | `upper`, `middle`, `lower` | Height in frame |
| `position.depth` | `very_near`, `near`, `medium`, `far` | Proximity proxy from bounding-box size |
| `confidence` | 0–1 | MediaPipe score |

---

## What n8n must return

The app expects **JSON** with at least:

```json
{
  "spatial_sentence": "There is a cup close on your left, and a chair in front of you at medium distance."
}
```

Alternative key also supported: `"message"`.

If n8n is down or CORS fails, the app **falls back** to a local template sentence and still speaks via the browser.

---

## CORS (required)

Because the app runs on Netlify and calls n8n cross-origin, the **Respond to Webhook** node must include:

| Header | Value |
|--------|-------|
| `Access-Control-Allow-Origin` | `*` (or your Netlify domain, e.g. `https://your-site.netlify.app`) |
| `Access-Control-Allow-Methods` | `POST, OPTIONS` |
| `Access-Control-Allow-Headers` | `Content-Type` |

The included template workflow already sets these on the response node.

---

## Template workflow (no AI)

File: **`n8n-workflow-template.json`**

```
Webhook (POST /spatial-vision)
    → Code: Build Spatial Sentence
    → Respond to Webhook (JSON + CORS)
```

The Code node turns `objects[]` into one sentence, e.g.:

> I see cup, close to you, on your left; and chair, at a medium distance, directly in front of you.

No API keys needed. Good for hackathon/demo.

---

## Optional: LLM-enhanced spatial sentences

For more natural phrasing, insert an **OpenAI** (or **Anthropic**) node between Webhook and Respond:

### Suggested system prompt

```
You convert object detections into ONE short spoken sentence for a blind person.
Use plain English. Mention position (left, right, in front) and distance (close, far).
Do not use bullet points. Max 25 words unless many objects are present.
Do not invent objects not in the input.
```

### User prompt (expression)

```
Objects detected:
{{ JSON.stringify($json.body.objects, null, 2) }}

Write one spatial sentence.
```

### Map LLM output to response

In **Respond to Webhook**, set body to:

```json
{
  "spatial_sentence": "{{ $json.message.content }}"
}
```

(Adjust field name for your LLM node output.)

---

## Webhook URL format

After activation, n8n gives URLs like:

```
https://YOUR-SUBDOMAIN.app.n8n.cloud/webhook/spatial-vision
```

or self-hosted:

```
https://n8n.yourdomain.com/webhook/spatial-vision
```

Use the **Production** URL, not Test, once the workflow is active.

---

## Test with curl

```bash
curl -X POST "https://YOUR-N8N-URL/webhook/spatial-vision" \
  -H "Content-Type: application/json" \
  -d '{
    "source": "spatial-vision-assistant",
    "object_count": 1,
    "objects": [{
      "label": "bottle",
      "display_name": "bottle",
      "confidence": 0.9,
      "position": { "horizontal": "right", "depth": "near" }
    }]
  }'
```

Expected:

```json
{
  "spatial_sentence": "I see bottle, close to you, on your right.",
  "object_count": 1
}
```

---

## Netlify checklist

| Step | Action |
|------|--------|
| Deploy | Connect repo → publish directory `.` → no build command |
| HTTPS | Enabled by default (required for camera) |
| Config | Optional: add `config.js` with webhook URL before deploy |
| Test | Open site on phone/laptop, allow camera, verify speech |

---

## App behavior summary

| Control | Behavior |
|---------|----------|
| **Start camera** | Opens rear/environment camera, loads MediaPipe EfficientDet Lite2 |
| **Describe now / Space** | Forces immediate n8n call + speech |
| **Auto describe** | When scene changes, at most once every N seconds (default 4) |
| **Mute speech** | Stops TTS only; detection continues |
| **Settings** | Webhook URL stored in `localStorage` |

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| CORS error in browser console | Add CORS headers on n8n Respond node |
| 404 on webhook | Activate workflow; use Production URL |
| Empty response | Ensure Respond node returns `spatial_sentence` |
| No speech | Unmute; check browser allows autoplay after user gesture (Start camera) |
| Wrong camera | App requests `facingMode: environment` (rear on phones) |
| n8n slow | Increase **interval** in Settings; rely on local fallback |

---

## Files in this repo

| File | Purpose |
|------|---------|
| `app.js` | MediaPipe ObjectDetector + spatial logic + n8n + Web Speech API |
| `config.example.js` | Default webhook URL template |
| `n8n-workflow-template.json` | Importable n8n workflow |
| `netlify.toml` | Netlify static deploy + security headers |
