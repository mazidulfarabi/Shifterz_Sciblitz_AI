import {
    ObjectDetector,
    GestureRecognizer,
    FaceDetector,
    FilesetResolver
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.8/vision_bundle.mjs";

const STORAGE_KEY_INTERVAL = "spatialVision.intervalSec";
const STORAGE_KEY_SPEECH_RATE = "spatialVision.speechRate";
const STORAGE_KEY_TTS_MODE = "spatialVision.ttsMode";

const DEFAULT_INTERVAL_SEC = 4;
const SCORE_THRESHOLD = 0.45;
const MAX_OBJECTS = 8;
const GESTURE_SCORE_THRESHOLD = 0.6;
const GESTURE_FRAME_SKIP = 2;
const FACE_SCORE_THRESHOLD = 0.5;
const SPEECH_LANG = "en-US";
const GOOGLE_TTS_LANG = "en";
const TTS_MODES = {
    AUTO: "auto",
    BROWSER: "browser",
    GOOGLE: "google"
};

const DEPTH_LABELS = {
    very_near: "very close",
    near: "close",
    medium: "medium distance",
    far: "far"
};

const HORIZONTAL_LABELS = {
    left: "on your left",
    center: "in front of you",
    right: "on your right"
};

const video = document.getElementById("webcam");
const canvasElement = document.getElementById("output_canvas");
const canvasCtx = canvasElement.getContext("2d");
const startBtn = document.getElementById("start-btn");
const stopBtn = document.getElementById("stop-btn");
const scanBtn = document.getElementById("scan-btn");
const statusRegion = document.getElementById("status");
const announcementRegion = document.getElementById("announcement");
const gestureOverlay = document.getElementById("gesture-overlay");
const muteBtn = document.getElementById("mute-btn");

let objectDetector = undefined;
let gestureRecognizer = undefined;
let faceDetector = undefined;
let lastVideoTime = -1;
let running = false;
let muted = false;
let lastAnnounceAt = 0;
let lastSceneSignature = "";
let pendingAnnounce = false;
let cameraStream = null;
let gestureFrameCounter = 0;
let lastGestures = [];
let speechVoice = null;
let speakGeneration = 0;
let currentAudio = null;
let speechPrimed = false;
let speechUserActivated = false;

let runtimeConfig = {
    intervalSec: DEFAULT_INTERVAL_SEC,
    speechRate: 1,
    ttsMode: TTS_MODES.BROWSER
};

function refreshVoice() {
    const voices = window.speechSynthesis?.getVoices() || [];
    const preferredVoice = voices.find((voice) => voice.lang?.startsWith("en")) ||
        voices[0] ||
        null;

    speechVoice = preferredVoice || null;
}

function markSpeechActivated() {
    speechUserActivated = true;
    window.speechSynthesis?.resume();
}

function registerSpeechActivationHandlers() {
    const activateSpeech = () => {
        markSpeechActivated();
    };

    ["pointerdown", "touchstart", "keydown", "click"].forEach((eventName) => {
        document.addEventListener(eventName, activateSpeech, { passive: true });
    });
}

async function ensureSpeechReady() {
    if (speechUserActivated || !window.speechSynthesis) {
        return;
    }

    await Promise.race([
        new Promise((resolve) => {
            const activateSpeech = () => {
                markSpeechActivated();
                resolve();
            };

            ["pointerdown", "touchstart", "keydown", "click"].forEach((eventName) => {
                document.addEventListener(eventName, activateSpeech, { once: true, passive: true });
            });
        }),
        new Promise((resolve) => setTimeout(resolve, 1200))
    ]);

    window.speechSynthesis?.resume();
}

function initSpeech() {
    refreshVoice();
    registerSpeechActivationHandlers();
    if (window.speechSynthesis) {
        window.speechSynthesis.onvoiceschanged = refreshVoice;
    }
}

function primeSpeech() {
    if (speechPrimed || !window.speechSynthesis) {
        return;
    }

    speechPrimed = true;
    refreshVoice();
    markSpeechActivated();
    window.speechSynthesis.resume();

    const warmup = new SpeechSynthesisUtterance("");
    warmup.volume = 0;
    warmup.lang = SPEECH_LANG;
    window.speechSynthesis.speak(warmup);
}

function stopSpeaking() {
    speakGeneration += 1;
    window.speechSynthesis?.cancel();
    if (currentAudio) {
        currentAudio.pause();
        currentAudio.src = "";
        currentAudio = null;
    }
}

function splitSpeechChunks(text, maxLength = 180) {
    const chunks = [];
    const sentences = text.match(/[^.!?]+[.!?]?/g) || [text];
    let current = "";

    for (const sentence of sentences) {
        const trimmed = sentence.trim();
        if (!trimmed) {
            continue;
        }

        if ((current + trimmed).length <= maxLength) {
            current += trimmed;
            continue;
        }

        if (current) {
            chunks.push(current.trim());
        }

        if (trimmed.length <= maxLength) {
            current = trimmed;
        } else {
            for (let index = 0; index < trimmed.length; index += maxLength) {
                chunks.push(trimmed.slice(index, index + maxLength));
            }
            current = "";
        }
    }

    if (current.trim()) {
        chunks.push(current.trim());
    }

    return chunks.length > 0 ? chunks : [text];
}

function speakWithBrowser(text) {
    return new Promise((resolve) => {
        refreshVoice();
        markSpeechActivated();
        window.speechSynthesis.resume();

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = SPEECH_LANG;
        utterance.rate = runtimeConfig.speechRate;
        utterance.pitch = 1;
        utterance.volume = 1;

        if (speechVoice) {
            utterance.voice = speechVoice;
        }

        const timeoutId = window.setTimeout(() => resolve(false), 5000);
        utterance.onstart = () => {
            window.clearTimeout(timeoutId);
        };
        utterance.onend = () => {
            window.clearTimeout(timeoutId);
            resolve(true);
        };
        utterance.onerror = () => {
            window.clearTimeout(timeoutId);
            resolve(false);
        };
        window.speechSynthesis.speak(utterance);
    });
}

function getGoogleTtsUrls(text) {
    const encoded = encodeURIComponent(text);
    return [
        `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${GOOGLE_TTS_LANG}&q=${encoded}`,
        `https://translate.googleapis.com/translate_tts?ie=UTF-8&client=gtx&tl=${GOOGLE_TTS_LANG}&q=${encoded}`
    ];
}

function playGoogleTtsChunk(text) {
    return new Promise((resolve, reject) => {
        const urls = getGoogleTtsUrls(text);
        let attemptIndex = 0;

        const tryNext = () => {
            if (attemptIndex >= urls.length) {
                reject(new Error("Google TTS playback failed"));
                return;
            }

            const url = urls[attemptIndex];
            attemptIndex += 1;
            const audio = new Audio(url);
            audio.preload = "auto";
            audio.playbackRate = runtimeConfig.speechRate;
            currentAudio = audio;

            const cleanup = () => {
                if (currentAudio === audio) {
                    currentAudio = null;
                }
            };

            const timeoutId = window.setTimeout(() => {
                cleanup();
                tryNext();
            }, 8000);

            audio.onended = () => {
                window.clearTimeout(timeoutId);
                cleanup();
                resolve();
            };
            audio.onerror = () => {
                window.clearTimeout(timeoutId);
                cleanup();
                tryNext();
            };

            audio.play().catch(() => {
                window.clearTimeout(timeoutId);
                cleanup();
                tryNext();
            });
        };

        tryNext();
    });
}

async function speakWithGoogle(text, generation) {
    const chunks = splitSpeechChunks(text);

    for (const chunk of chunks) {
        if (generation !== speakGeneration) {
            return;
        }

        await playGoogleTtsChunk(chunk);
    }
}

async function speak(text) {
    if (muted || !text) {
        return;
    }

    await ensureSpeechReady();
    stopSpeaking();
    const generation = speakGeneration;
    refreshVoice();

    const mode = runtimeConfig.ttsMode;
    const shouldTryBrowser = Boolean(window.speechSynthesis) && (mode === TTS_MODES.BROWSER || mode === TTS_MODES.AUTO || mode === TTS_MODES.GOOGLE);

    if (shouldTryBrowser) {
        const browserWorked = await speakWithBrowser(text);
        if (browserWorked && generation === speakGeneration) {
            return;
        }
    }

    if (mode === TTS_MODES.BROWSER) {
        return;
    }

    try {
        await speakWithGoogle(text, generation);
    } catch (err) {
        console.warn("TTS failed:", err);
    }
}

async function loadRuntimeConfig() {
    try {
        const mod = await import("./config.js");
        runtimeConfig.intervalSec = Number(localStorage.getItem(STORAGE_KEY_INTERVAL)) || mod.MIN_INTERVAL_SEC || DEFAULT_INTERVAL_SEC;
    } catch {
        runtimeConfig.intervalSec = Number(localStorage.getItem(STORAGE_KEY_INTERVAL)) || DEFAULT_INTERVAL_SEC;
    }

    runtimeConfig.speechRate = Number(localStorage.getItem(STORAGE_KEY_SPEECH_RATE)) || 1;
    runtimeConfig.ttsMode = localStorage.getItem(STORAGE_KEY_TTS_MODE) || TTS_MODES.BROWSER;
    syncSettingsForm();
}

function syncSettingsForm() {
    return;
}

function setStatus(message) {
    statusRegion.textContent = message;
}

function setAnnouncement(message) {
    announcementRegion.textContent = message;
}

function updateGestureOverlay(gestures) {
    if (!gestureOverlay) {
        return;
    }

    if (gestures.length === 0) {
        gestureOverlay.textContent = "";
        gestureOverlay.hidden = true;
        return;
    }

    gestureOverlay.hidden = false;
    gestureOverlay.textContent = gestures
        .map((gesture) => `${gesture.hand}: ${gesture.gesture.replace(/_/g, " ")}`)
        .join(" | ");
}

function withTimeout(promise, ms, label) {
    return Promise.race([
        promise,
        new Promise((_, reject) => {
            setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms);
        })
    ]);
}

async function loadVisionTasks() {
    return withTimeout(
        FilesetResolver.forVisionTasks(
            "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.8/wasm"
        ),
        60000,
        "MediaPipe WASM load"
    );
}

async function loadObjectDetector(vision) {
    setStatus("Loading object detection model (30–60 seconds on first load)...");

    return withTimeout(
        ObjectDetector.createFromOptions(vision, {
            baseOptions: {
                modelAssetPath:
                    "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float32/1/efficientdet_lite0.tflite",
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

async function loadFaceDetector(vision) {
    return withTimeout(
        FaceDetector.createFromOptions(vision, {
            baseOptions: {
                modelAssetPath:
                    "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite",
                delegate: "CPU"
            },
            runningMode: "VIDEO",
            minDetectionConfidence: FACE_SCORE_THRESHOLD
        }),
        120000,
        "Face detector model load"
    );
}

async function loadGestureRecognizer(vision) {
    return withTimeout(
        GestureRecognizer.createFromOptions(vision, {
            baseOptions: {
                modelAssetPath:
                    "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task",
                delegate: "CPU"
            },
            runningMode: "VIDEO",
            numHands: 2
        }),
        120000,
        "Gesture recognizer model load"
    );
}

async function startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Camera is not supported in this browser.");
    }

    setStatus("Requesting camera permission...");

    cameraStream = await navigator.mediaDevices.getUserMedia({
        video: {
            width: { ideal: 640 },
            height: { ideal: 480 },
            facingMode: { ideal: "user" }
        },
        audio: false
    });

    await new Promise((resolve, reject) => {
        video.onloadedmetadata = () => resolve();
        video.onerror = () => reject(new Error("Failed to start camera preview."));
        video.srcObject = cameraStream;
    });

    canvasElement.width = video.videoWidth;
    canvasElement.height = video.videoHeight;
    await video.play();
}

function stopCamera() {
    running = false;
    stopSpeaking();
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
    lastGestures = [];
    updateGestureOverlay([]);
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
    return DEPTH_LABELS[depth] || depth;
}

function horizontalLabel(horizontal) {
    return HORIZONTAL_LABELS[horizontal] || horizontal;
}

const OBJECT_COLORS = {
    person: "#FF6B6B",
    face: "#FFD700",
    bicycle: "#4ECDC4",
    car: "#45B7D1",
    motorcycle: "#FFA07A",
    bus: "#98D8C8",
    train: "#F7DC6F",
    truck: "#BB8FCE",
    boat: "#85C1E2",
    bird: "#F8B88B",
    cat: "#F0A500",
    dog: "#D2B48C",
    horse: "#8B4513",
    backpack: "#9B59B6",
    umbrella: "#3498DB",
    handbag: "#E74C3C",
    tie: "#2980B9",
    suitcase: "#A93226",
    bottle: "#16A085",
    cup: "#27AE60",
    fork: "#BDC3C7",
    knife: "#95A5A6",
    spoon: "#7F8C8D",
    bowl: "#34495E",
    banana: "#F39C12",
    apple: "#C0392B",
    sandwich: "#D35400",
    orange: "#E67E22",
    pizza: "#E59866",
    donut: "#F4D03F",
    cake: "#DC7633",
    chair: "#A29BFE",
    couch: "#6C5CE7",
    "potted plant": "#00B894",
    bed: "#FF7675",
    "dining table": "#FDCB6E",
    toilet: "#74B9FF",
    tv: "#A29BFE",
    laptop: "#636E72",
    mouse: "#2D3436",
    remote: "#00CEC9",
    keyboard: "#0984E3",
    "cell phone": "#6C5CE7",
    microwave: "#FF6348",
    oven: "#FF5252",
    refrigerator: "#536DFE",
    book: "#5352ED",
    clock: "#FF8B94",
    vase: "#BA55D3",
    scissors: "#778899",
    "teddy bear": "#CD853F"
};

function getObjectColor(label) {
    const key = label.toLowerCase();
    return OBJECT_COLORS[key] || "#00BFFF";
}

function handLabelFromHandedness(handednessCategory) {
    const name = handednessCategory?.categoryName;
    if (name === "Left") {
        return "Left hand";
    }
    if (name === "Right") {
        return "Right hand";
    }
    return "Hand";
}

function spatialPosition(bbox, frameWidth, frameHeight) {
    const fw = frameWidth || 1;
    const fh = frameHeight || 1;
    const centerX = (bbox.originX + bbox.width / 2) / fw;
    const centerY = (bbox.originY + bbox.height / 2) / fh;
    const area = (bbox.width * bbox.height) / (fw * fh);

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
    const fw = video.videoWidth || 1;
    const fh = video.videoHeight || 1;

    return detections
        .map((detection) => {
            const category = detection.categories?.[0];
            if (!category || category.score < SCORE_THRESHOLD) {
                return null;
            }

            const bbox = detection.boundingBox;
            const position = spatialPosition(bbox, fw, fh);

            return {
                label: category.categoryName,
                display_name: category.displayName || category.categoryName,
                confidence: Number(category.score.toFixed(3)),
                position,
                bbox: {
                    x: Number((bbox.originX / fw).toFixed(3)),
                    y: Number((bbox.originY / fh).toFixed(3)),
                    width: Number((bbox.width / fw).toFixed(3)),
                    height: Number((bbox.height / fh).toFixed(3))
                }
            };
        })
        .filter(Boolean)
        .sort((a, b) => b.confidence - a.confidence);
}

function detectFaces() {
    if (!faceDetector || video.readyState < 2) {
        return [];
    }

    const results = faceDetector.detectForVideo(video, performance.now());
    const fw = video.videoWidth || 1;
    const fh = video.videoHeight || 1;

    return (results.detections || [])
        .map((detection) => {
            const category = detection.categories?.[0];
            if (!category || category.score < FACE_SCORE_THRESHOLD) {
                return null;
            }

            const bbox = detection.boundingBox;
            const position = spatialPosition(bbox, fw, fh);

            return {
                label: "face",
                display_name: "Face",
                confidence: Number(category.score.toFixed(3)),
                position,
                bbox: {
                    x: Number((bbox.originX / fw).toFixed(3)),
                    y: Number((bbox.originY / fh).toFixed(3)),
                    width: Number((bbox.width / fw).toFixed(3)),
                    height: Number((bbox.height / fh).toFixed(3))
                }
            };
        })
        .filter(Boolean)
        .sort((a, b) => b.confidence - a.confidence);
}

function hasPerson(objects) {
    return objects.some((obj) => obj.label.toLowerCase() === "person");
}

function detectGestures() {
    if (!gestureRecognizer || video.readyState < 2) {
        return [];
    }

    const results = gestureRecognizer.recognizeForVideo(video, performance.now());
    const fw = video.videoWidth || 1;
    const fh = video.videoHeight || 1;
    const gestures = [];

    (results.gestures || []).forEach((handGestures, handIndex) => {
        const topGesture = handGestures?.[0];
        if (!topGesture || topGesture.score < GESTURE_SCORE_THRESHOLD) {
            return;
        }

        if (topGesture.categoryName === "None") {
            return;
        }

        const landmarks = results.landmarks?.[handIndex];
        const wrist = landmarks?.[0];
        const centerX = wrist ? wrist.x : 0.5;
        const centerY = wrist ? wrist.y : 0.5;
        const handednessCategory = results.handedness?.[handIndex]?.[0];

        gestures.push({
            hand: handLabelFromHandedness(handednessCategory),
            gesture: topGesture.categoryName,
            confidence: Number(topGesture.score.toFixed(3)),
            horizontal: horizontalZone(centerX),
            center_x: centerX,
            center_y: centerY,
            landmarks: landmarks || []
        });
    });

    return gestures;
}

function sceneSignature(objects, faces, gestures) {
    const objectPart = objects
        .map((obj) => `${obj.label}:${obj.position.horizontal}:${obj.position.depth}`)
        .sort()
        .join("|");

    const facePart = faces
        .map((face) => `${face.label}:${face.position.horizontal}:${face.position.depth}`)
        .sort()
        .join("|");

    const gesturePart = gestures
        .map((gesture) => `${gesture.hand}:${gesture.gesture}:${gesture.horizontal}`)
        .sort()
        .join("|");

    return `${objectPart}::${facePart}::${gesturePart}`;
}

function buildSpatialSentence(objects, faces, gestures) {
    const parts = [];

    if (objects.length === 0 && faces.length === 0 && gestures.length === 0) {
        return "No detected objects, faces, or gestures.";
    }

    if (objects.length > 0) {
        const objectParts = objects.slice(0, 4).map((obj) => {
            const name = obj.display_name;
            const where = horizontalLabel(obj.position.horizontal);
            return `${name}, ${depthLabel(obj.position.depth)}, ${where}`;
        });

        if (objectParts.length === 1) {
            parts.push(`Detected: ${objectParts[0]}`);
        } else {
            const last = objectParts.pop();
            parts.push(`Detected: ${objectParts.join("; ")}, and ${last}`);
        }
    }

    if (faces.length > 0) {
        const faceParts = faces.slice(0, 3).map((face) => {
            const where = horizontalLabel(face.position.horizontal);
            return `Face, ${depthLabel(face.position.depth)}, ${where}`;
        });

        if (parts.length === 0) {
            parts.push(`Detected: ${faceParts.join("; ")}`);
        } else {
            parts.push(`Also: ${faceParts.join("; ")}`);
        }
    }

    if (gestures.length > 0) {
        const gestureParts = gestures.map((gesture) => {
            const where = horizontalLabel(gesture.horizontal);
            return `${where} ${gesture.hand} showing ${gesture.gesture.replace(/_/g, " ")}`;
        });

        if (parts.length === 0) {
            parts.push(gestureParts.join("; "));
        } else {
            parts.push(`Also: ${gestureParts.join("; ")}`);
        }
    }

    return `${parts.join(". ")}.`;
}

function drawDetections(objects, faces, gestures) {
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    canvasCtx.lineWidth = 2;
    canvasCtx.font = "12px sans-serif";

    const drawBox = (item) => {
        const x = item.bbox.x * canvasElement.width;
        const y = item.bbox.y * canvasElement.height;
        const w = item.bbox.width * canvasElement.width;
        const h = item.bbox.height * canvasElement.height;

        const color = getObjectColor(item.label);
        canvasCtx.strokeStyle = color;
        canvasCtx.lineWidth = 2;
        canvasCtx.strokeRect(x, y, w, h);

        canvasCtx.fillStyle = color + "30";
        canvasCtx.fillRect(x, y, w, h);

        const tag = `${item.display_name} ${Math.round(item.confidence * 100)}%`;
        const textWidth = canvasCtx.measureText(tag).width;

        canvasCtx.fillStyle = color;
        canvasCtx.fillRect(x, Math.max(0, y - 20), textWidth + 8, 18);
        canvasCtx.fillStyle = "#fff";
        canvasCtx.fillText(tag, x + 4, Math.max(14, y - 6));
    };

    objects.forEach(drawBox);
    faces.forEach(drawBox);

    if (gestures.length > 0) {
        gestures.forEach((gesture) => {
            const landmarks = gesture.landmarks || [];
            canvasCtx.fillStyle = "#FF0000";
            canvasCtx.strokeStyle = "#880000";
            landmarks.forEach((lm) => {
                const lx = (lm.x || 0) * canvasElement.width;
                const ly = (lm.y || 0) * canvasElement.height;
                const r = 3;
                canvasCtx.beginPath();
                canvasCtx.arc(lx, ly, r, 0, 2 * Math.PI);
                canvasCtx.fill();
            });

            if (typeof gesture.center_x === "number" && typeof gesture.center_y === "number") {
                const handX = gesture.center_x * canvasElement.width;
                const handY = gesture.center_y * canvasElement.height;
                canvasCtx.strokeStyle = "#FF0000";
                canvasCtx.lineWidth = 2;
                canvasCtx.beginPath();
                canvasCtx.arc(handX, handY, 6, 0, 2 * Math.PI);
                canvasCtx.stroke();
            }
        });
    }
}

async function announceScene(objects, faces, gestures, force = false) {
    const signature = sceneSignature(objects, faces, gestures);
    const now = Date.now();
    const intervalMs = runtimeConfig.intervalSec * 1000;

    if (!force && signature === lastSceneSignature) {
        return;
    }

    if (!force && now - lastAnnounceAt < intervalMs) {
        return;
    }

    if (pendingAnnounce) {
        return;
    }

    lastSceneSignature = signature;
    lastAnnounceAt = now;
    pendingAnnounce = true;

    const sentence = buildSpatialSentence(objects, faces, gestures);

    pendingAnnounce = false;

    setAnnouncement(sentence);
    speak(sentence);

    if (objects.length === 0 && faces.length === 0 && gestures.length === 0) {
        setStatus("Scanning. No objects detected.");
    } else {
        const objectCount = objects.length;
        const faceCount = faces.length;
        const gestureCount = gestures.length;
        let status = `Scanning. ${objectCount} object${objectCount !== 1 ? "s" : ""}`;

        if (faceCount > 0) {
            status += `, ${faceCount} face${faceCount !== 1 ? "s" : ""}`;
        }

        if (gestureCount > 0) {
            status += `, ${gestureCount} gesture${gestureCount !== 1 ? "s" : ""}`;
        }

        setStatus(`${status} detected.`);
    }
}

function processFrame(forceAnnounce = false) {
    if (!objectDetector || video.readyState < 2) {
        return;
    }

    const results = objectDetector.detectForVideo(video, performance.now());
    const objects = normalizeDetections(results.detections || []);
    const faces = detectFaces();

    let gestures = lastGestures;
    if (hasPerson(objects) || faces.length > 0) {
        gestureFrameCounter += 1;
        if (forceAnnounce || gestureFrameCounter % GESTURE_FRAME_SKIP === 0) {
            gestures = detectGestures();
            lastGestures = gestures;
        }
    } else {
        gestureFrameCounter = 0;
        gestures = [];
        lastGestures = [];
    }

    updateGestureOverlay(gestures);
    drawDetections(objects, faces, gestures);
    announceScene(objects, faces, gestures, forceAnnounce);
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
        setStatus("For reliable camera access, open this page from HTTPS (e.g., Netlify).");
    }

    startBtn.disabled = true;
    primeSpeech();

    try {
        await startCamera();
        setStatus("Camera active. Loading AI models...");
        const vision = await loadVisionTasks();
        objectDetector = await loadObjectDetector(vision);
        faceDetector = await loadFaceDetector(vision);
        gestureRecognizer = await loadGestureRecognizer(vision);
        running = true;
        startBtn.hidden = true;
        stopBtn.hidden = false;
        scanBtn.hidden = false;
        setStatus("Ready. Point camera at your surroundings.");
        setAnnouncement("Detection active.");
        predictWebcam();
    } catch (err) {
        console.error(err);
        startBtn.disabled = false;

        if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
            setStatus("Camera access denied. Allow camera in browser settings, then try again.");
        } else if (err.name === "NotFoundError") {
            setStatus("No camera found. Connect a camera and try again.");
        } else {
            setStatus(`Error: ${err.message}`);
        }
    }
}

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
    muteBtn.textContent = muted ? "Unmute Audio" : "Mute Audio";
    if (muted) {
        stopSpeaking();
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

initSpeech();
await loadRuntimeConfig();
