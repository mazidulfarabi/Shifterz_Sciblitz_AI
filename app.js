import { ObjectDetector, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.8/vision_bundle.mjs";

const STORAGE_KEY_WEBHOOK = "spatialVision.n8nWebhook";
const STORAGE_KEY_USE_N8N = "spatialVision.useN8n";
const STORAGE_KEY_INTERVAL = "spatialVision.intervalSec";
const STORAGE_KEY_SPEECH_RATE = "spatialVision.speechRate";

const DEFAULT_INTERVAL_SEC = 4;
const SCORE_THRESHOLD = 0.45;
const MAX_OBJECTS = 8;

const video = document.getElementById("webcam");
const canvasElement = document.getElementById("output_canvas");
const canvasCtx = canvasElement.getContext("2d");
const startBtn = document.getElementById("start-btn");
const stopBtn = document.getElementById("stop-btn");
const scanBtn = document.getElementById("scan-btn");
const settingsToggle = document.getElementById("settings-toggle");
const settingsPanel = document.getElementById("settings-panel");
const webhookInput = document.getElementById("webhook-url");
const useN8nInput = document.getElementById("use-n8n");
const intervalInput = document.getElementById("interval-sec");
const speechRateInput = document.getElementById("speech-rate");
const saveSettingsBtn = document.getElementById("save-settings");
const statusRegion = document.getElementById("status");
const announcementRegion = document.getElementById("announcement");
const objectList = document.getElementById("object-list");
const muteBtn = document.getElementById("mute-btn");

let objectDetector = undefined;
let lastVideoTime = -1;
let running = false;
let muted = false;
let lastN8nCallAt = 0;
let lastSceneSignature = "";
let pendingN8nRequest = false;
let cameraStream = null;
let defaultWebhookUrl = "";

let runtimeConfig = {
    webhookUrl: "",
    useN8n: true,
    intervalSec: DEFAULT_INTERVAL_SEC,
    speechRate: 1
};

async function loadRuntimeConfig() {
    try {
        const mod = await import("./config.js");
        defaultWebhookUrl = mod.N8N_WEBHOOK_URL || "";
        runtimeConfig.webhookUrl = localStorage.getItem(STORAGE_KEY_WEBHOOK) || defaultWebhookUrl;
        runtimeConfig.useN8n = localStorage.getItem(STORAGE_KEY_USE_N8N) !== "false" && mod.USE_N8N !== false;
        runtimeConfig.intervalSec = Number(localStorage.getItem(STORAGE_KEY_INTERVAL)) || mod.N8N_MIN_INTERVAL_SEC || DEFAULT_INTERVAL_SEC;
    } catch {
        runtimeConfig.webhookUrl = localStorage.getItem(STORAGE_KEY_WEBHOOK) || "";
        runtimeConfig.useN8n = localStorage.getItem(STORAGE_KEY_USE_N8N) !== "false";
        runtimeConfig.intervalSec = Number(localStorage.getItem(STORAGE_KEY_INTERVAL)) || DEFAULT_INTERVAL_SEC;
    }

    runtimeConfig.speechRate = Number(localStorage.getItem(STORAGE_KEY_SPEECH_RATE)) || 1;
    syncSettingsForm();
}

function syncSettingsForm() {
    webhookInput.value = runtimeConfig.webhookUrl;
    useN8nInput.checked = runtimeConfig.useN8n;
    intervalInput.value = String(runtimeConfig.intervalSec);
    speechRateInput.value = String(runtimeConfig.speechRate);
}

function setStatus(message) {
    statusRegion.textContent = message;
}

function setAnnouncement(message) {
    announcementRegion.textContent = message;
}

function withTimeout(promise, ms, label) {
    return Promise.race([
        promise,
        new Promise((_, reject) => {
            setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms);
        })
    ]);
}

async function loadObjectDetector() {
    setStatus("Loading object recognition model. First load may take 30 to 60 seconds.");

    const vision = await withTimeout(
        FilesetResolver.forVisionTasks(
            "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.8/wasm"
        ),
        60000,
        "MediaPipe WASM load"
    );

    return withTimeout(
        ObjectDetector.createFromOptions(vision, {
            baseOptions: {
                modelAssetPath:
                    "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite2/float16/1/efficientdet_lite2.task",
                delegate: "CPU"
            },
            runningMode: "VIDEO",
            scoreThreshold: SCORE_THRESHOLD,
            maxResults: MAX_OBJECTS,
            categoryAllowlist: undefined
        }),
        120000,
        "Object detector model load"
    );
}

async function startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Camera access is not supported in this browser.");
    }

    setStatus("Requesting camera permission.");

    cameraStream = await navigator.mediaDevices.getUserMedia({
        video: {
            width: { ideal: 640 },
            height: { ideal: 480 },
            facingMode: "environment"
        },
        audio: false
    });

    await new Promise((resolve, reject) => {
        video.onloadedmetadata = () => resolve();
        video.onerror = () => reject(new Error("Camera preview failed to start."));
        video.srcObject = cameraStream;
    });

    canvasElement.width = video.videoWidth;
    canvasElement.height = video.videoHeight;
    await video.play();
}

function stopCamera() {
    running = false;
    if (cameraStream) {
        cameraStream.getTracks().forEach((track) => track.stop());
        cameraStream = null;
    }
    video.srcObject = null;
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    startBtn.disabled = false;
    startBtn.hidden = false;
    stopBtn.hidden = true;
    scanBtn.hidden = true;
    setStatus("Camera stopped.");
}

function horizontalZone(centerX) {
    if (centerX < 0.33) return "left";
    if (centerX > 0.66) return "right";
    return "center";
}

function depthFromArea(area) {
    if (area >= 0.12) return "very_near";
    if (area >= 0.06) return "near";
    if (area >= 0.02) return "medium";
    return "far";
}

function depthLabel(depth) {
    const labels = {
        very_near: "very close",
        near: "close",
        medium: "at medium distance",
        far: "far away"
    };
    return labels[depth] || depth;
}

function spatialPosition(bbox) {
    const centerX = bbox.originX + bbox.width / 2;
    const centerY = bbox.originY + bbox.height / 2;
    const area = bbox.width * bbox.height;

    return {
        horizontal: horizontalZone(centerX),
        vertical: centerY < 0.33 ? "upper" : centerY > 0.66 ? "lower" : "middle",
        depth: depthFromArea(area),
        center_x: Number(centerX.toFixed(3)),
        center_y: Number(centerY.toFixed(3)),
        area: Number(area.toFixed(4))
    };
}

function normalizeDetections(detections) {
    return detections
        .map((detection) => {
            const category = detection.categories?.[0];
            if (!category || category.score < SCORE_THRESHOLD) {
                return null;
            }

            const bbox = detection.boundingBox;
            const position = spatialPosition(bbox);

            return {
                label: category.categoryName,
                display_name: category.displayName || category.categoryName,
                confidence: Number(category.score.toFixed(3)),
                position,
                bbox: {
                    x: Number(bbox.originX.toFixed(3)),
                    y: Number(bbox.originY.toFixed(3)),
                    width: Number(bbox.width.toFixed(3)),
                    height: Number(bbox.height.toFixed(3))
                }
            };
        })
        .filter(Boolean)
        .sort((a, b) => b.confidence - a.confidence);
}

function sceneSignature(objects) {
    return objects
        .map((obj) => `${obj.label}:${obj.position.horizontal}:${obj.position.depth}`)
        .sort()
        .join("|");
}

function buildPayload(objects) {
    return {
        source: "spatial-vision-assistant",
        version: "1.0",
        timestamp: new Date().toISOString(),
        frame: {
            width: video.videoWidth,
            height: video.videoHeight
        },
        object_count: objects.length,
        objects,
        hints: {
            horizontal_axis: "left is camera-left (user's left when facing same direction as camera)",
            depth_proxy: "bbox area — larger means closer",
            purpose: "Convert detections into one concise spatial sentence for a blind user"
        }
    };
}

function buildLocalSpatialSentence(objects) {
    if (objects.length === 0) {
        return "I do not see any recognizable objects in front of you.";
    }

    const parts = objects.slice(0, 4).map((obj) => {
        const where =
            obj.position.horizontal === "center"
                ? "in front of you"
                : `on your ${obj.position.horizontal}`;
        return `a ${obj.display_name.replace(/_/g, " ")}, ${depthLabel(obj.position.depth)}, ${where}`;
    });

    if (objects.length === 1) {
        return `I see ${parts[0]}.`;
    }

    const last = parts.pop();
    return `I see ${parts.join("; ")}, and ${last}.`;
}

async function sendToN8n(payload) {
    const url = runtimeConfig.webhookUrl.trim();
    if (!url || !runtimeConfig.useN8n) {
        return null;
    }

    const response = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        throw new Error(`n8n webhook returned ${response.status}`);
    }

    const text = await response.text();
    if (!text) {
        return null;
    }

    try {
        return JSON.parse(text);
    } catch {
        return { spatial_sentence: text.trim() };
    }
}

function speak(text) {
    if (muted || !text || !window.speechSynthesis) {
        return;
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = runtimeConfig.speechRate;
    utterance.pitch = 1;
    utterance.volume = 1;
    window.speechSynthesis.speak(utterance);
}

function renderObjectList(objects) {
    objectList.innerHTML = "";

    if (objects.length === 0) {
        const item = document.createElement("li");
        item.textContent = "No objects detected";
        objectList.appendChild(item);
        return;
    }

    objects.forEach((obj) => {
        const item = document.createElement("li");
        item.textContent = `${obj.display_name} — ${depthLabel(obj.position.depth)}, ${obj.position.horizontal} (${Math.round(obj.confidence * 100)}%)`;
        objectList.appendChild(item);
    });
}

function drawDetections(objects) {
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    canvasCtx.lineWidth = +2;
    canvasCtx.font = "14px sans-serif";

    objects.forEach((obj) => {
        const x = obj.bbox.x * canvasElement.width;
        const y = obj.bbox.y * canvasElement.height;
        const w = obj.bbox.width * canvasElement.width;
        const h = obj.bbox.height * canvasElement.height;

        canvasCtx.strokeStyle = "#22c55e";
        canvasCtx.fillStyle = "rgba(34, 197, 94, 0.15)";
        canvasCtx.fillRect(x, y, w, h);
        canvasCtx.strokeRect(x, y, w, h);

        const tag = `${obj.display_name} ${Math.round(obj.confidence * 100)}%`;
        canvasCtx.fillStyle = "#14532d";
        canvasCtx.fillRect(x, Math.max(0, y - 18), canvasCtx.measureText(tag).width + 8, 18);
        canvasCtx.fillStyle = "#ecfdf5";
        canvasCtx.fillText(tag, x + 4, Math.max(12, y - 5));
    });
}

async function announceScene(objects, force = false) {
    const signature = sceneSignature(objects);
    const now = Date.now();
    const intervalMs = runtimeConfig.intervalSec * 1000;

    if (!force && signature === lastSceneSignature) {
        return;
    }

    if (!force && now - lastN8nCallAt < intervalMs) {
        return;
    }

    if (pendingN8nRequest) {
        return;
    }

    lastSceneSignature = signature;
    lastN8nCallAt = now;
    pendingN8nRequest = true;

    const payload = buildPayload(objects);
    let sentence = buildLocalSpatialSentence(objects);

    try {
        if (runtimeConfig.useN8n && runtimeConfig.webhookUrl.trim()) {
            setStatus("Describing scene...");
            const n8nResult = await sendToN8n(payload);
            if (n8nResult?.spatial_sentence) {
                sentence = n8nResult.spatial_sentence;
            } else if (n8nResult?.message) {
                sentence = n8nResult.message;
            }
        }
    } catch (err) {
        console.warn("n8n unavailable, using local description:", err);
        setStatus("Using local description (n8n unavailable).");
    } finally {
        pendingN8nRequest = false;
    }

    setAnnouncement(sentence);
    speak(sentence);

    if (objects.length === 0) {
        setStatus("Scanning. No objects in view.");
    } else {
        setStatus(`Scanning. ${objects.length} object${objects.length === 1 ? "" : "s"} detected.`);
    }
}

function processFrame(forceAnnounce = false) {
    if (!objectDetector || video.readyState < 2) {
        return;
    }

    const results = objectDetector.detectForVideo(video, performance.now());
    const objects = normalizeDetections(results.detections || []);

    drawDetections(objects);
    renderObjectList(objects);
    announceScene(objects, forceAnnounce);
}

function predictWebcam() {
    if (!running) {
        return;
    }

    if (lastVideoTime !== video.currentTime) {
        lastVideoTime = video.currentTime;
        processFrame(false);
    }

    window.requestAnimationFrame(predictWebcam);
}

async function startApp() {
    if (running) {
        return;
    }

    if (window.location.protocol === "file:") {
        setStatus("Open this page over HTTPS (for example on Netlify) for reliable camera access.");
    }

    startBtn.disabled = true;

    try {
        await startCamera();
        setStatus("Camera active. Loading object recognition model.");
        objectDetector = await loadObjectDetector();
        running = true;
        startBtn.hidden = true;
        stopBtn.hidden = false;
        scanBtn.hidden = false;
        setStatus("Ready. Point the camera at your surroundings.");
        setAnnouncement("Vision assistant started.");
        speak("Vision assistant started. I will describe objects around you.");
        predictWebcam();
    } catch (err) {
        console.error(err);
        startBtn.disabled = false;

        if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
            setStatus("Camera blocked. Allow camera access, then press Start again.");
        } else if (err.name === "NotFoundError") {
            setStatus("No camera found. Connect a camera and try again.");
        } else {
            setStatus(`Error: ${err.message}`);
        }
    }
}

function saveSettings() {
    runtimeConfig.webhookUrl = webhookInput.value.trim();
    runtimeConfig.useN8n = useN8nInput.checked;
    runtimeConfig.intervalSec = Math.max(2, Number(intervalInput.value) || DEFAULT_INTERVAL_SEC);
    runtimeConfig.speechRate = Math.min(2, Math.max(0.5, Number(speechRateInput.value) || 1));

    localStorage.setItem(STORAGE_KEY_WEBHOOK, runtimeConfig.webhookUrl);
    localStorage.setItem(STORAGE_KEY_USE_N8N, String(runtimeConfig.useN8n));
    localStorage.setItem(STORAGE_KEY_INTERVAL, String(runtimeConfig.intervalSec));
    localStorage.setItem(STORAGE_KEY_SPEECH_RATE, String(runtimeConfig.speechRate));

    setStatus("Settings saved.");
    speak("Settings saved.");
}

settingsToggle.addEventListener("click", () => {
    const expanded = settingsToggle.getAttribute("aria-expanded") === "true";
    settingsToggle.setAttribute("aria-expanded", String(!expanded));
    settingsPanel.hidden = expanded;
});

saveSettingsBtn.addEventListener("click", saveSettings);
startBtn.addEventListener("click", startApp);
stopBtn.addEventListener("click", stopCamera);
scanBtn.addEventListener("click", () => {
    if (running) {
        processFrame(true);
    }
});

muteBtn.addEventListener("click", () => {
    muted = !muted;
    muteBtn.setAttribute("aria-pressed", String(muted));
    muteBtn.textContent = muted ? "Unmute speech" : "Mute speech";
    if (muted) {
        window.speechSynthesis?.cancel();
    }
});

document.addEventListener("keydown", (event) => {
    if (event.target.matches("input, textarea")) {
        return;
    }

    if (event.code === "Space" && running) {
        event.preventDefault();
        processFrame(true);
    }
});

await loadRuntimeConfig();
