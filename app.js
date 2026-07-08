import {
    ObjectDetector,
    GestureRecognizer,
    FaceLandmarker,
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
const YAWN_JAW_OPEN_THRESHOLD = 0.45;
const SMILE_THRESHOLD = 0.4;
const FROWN_THRESHOLD = 0.35;
const EYE_CLOSED_THRESHOLD = 0.5;
const SURPRISE_BROW_THRESHOLD = 0.4;
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
const switchCameraBtn = document.getElementById("switch-camera-btn");
const statusRegion = document.getElementById("status");
const announcementRegion = document.getElementById("announcement");
const gestureOverlay = document.getElementById("gesture-overlay");
const engineLoader = document.getElementById("engine-loader");
const engineLoaderText = document.getElementById("engine-loader-text");
const muteBtn = document.getElementById("mute-btn");

let objectDetector = undefined;
let gestureRecognizer = undefined;
let faceLandmarker = undefined;
let lastVideoTime = -1;
let running = false;
let muted = false;
let lastAnnounceAt = 0;
let lastSceneSignature = "";
let pendingAnnounce = false;
let cameraStream = null;
let cameraFacingMode = "user";
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

function showLoader(message) {
    if (engineLoader) {
        engineLoader.hidden = false;
    }
    setLoaderMessage(message);
}

function hideLoader() {
    if (engineLoader) {
        engineLoader.hidden = true;
    }
}

function setLoaderMessage(message) {
    if (engineLoaderText && message) {
        engineLoaderText.textContent = message;
    }
}

function updateGestureOverlay(gestures, faceAnalyses = []) {
    if (!gestureOverlay) {
        return;
    }

    const lines = [];

    faceAnalyses.forEach((face) => {
        if (face.expressions.length > 0) {
            lines.push(face.expressions.map(capitalizeFirst).join(", "));
        }
    });

    gestures.forEach((gesture) => {
        lines.push(`${gesture.hand}: ${gesture.gesture.replace(/_/g, " ")}`);
    });

    if (lines.length === 0) {
        gestureOverlay.textContent = "";
        gestureOverlay.hidden = true;
        return;
    }

    gestureOverlay.hidden = false;
    gestureOverlay.textContent = lines.join(" | ");
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
    setLoaderMessage("Loading object detection model…");
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

async function loadFaceLandmarker(vision) {
    setLoaderMessage("Loading face analysis model…");

    return withTimeout(
        FaceLandmarker.createFromOptions(vision, {
            baseOptions: {
                modelAssetPath:
                    "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
                delegate: "CPU"
            },
            runningMode: "VIDEO",
            numFaces: 2,
            outputFaceBlendshapes: true,
            minFaceDetectionConfidence: FACE_SCORE_THRESHOLD
        }),
        120000,
        "Face landmarker model load"
    );
}

async function loadGestureRecognizer(vision) {
    setLoaderMessage("Loading gesture recognition model…");

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

async function startCamera(facingMode = cameraFacingMode) {
    if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Camera is not supported in this browser.");
    }

    cameraFacingMode = facingMode;

    cameraStream = await navigator.mediaDevices.getUserMedia({
        video: {
            width: { ideal: 640 },
            height: { ideal: 480 },
            facingMode: { ideal: facingMode }
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
    updateSwitchCameraLabel();
}

function updateSwitchCameraLabel() {
    if (!switchCameraBtn) {
        return;
    }

    switchCameraBtn.textContent = cameraFacingMode === "user"
        ? "Use Back Camera"
        : "Use Front Camera";
}

async function switchCamera() {
    if (!running) {
        return;
    }

    const nextMode = cameraFacingMode === "user" ? "environment" : "user";
    const previousMode = cameraFacingMode;

    if (switchCameraBtn) {
        switchCameraBtn.disabled = true;
    }

    try {
        if (cameraStream) {
            cameraStream.getTracks().forEach((track) => track.stop());
            cameraStream = null;
        }

        await startCamera(nextMode);
        lastVideoTime = -1;
        lastSceneSignature = "";
        setStatus(`Using ${nextMode === "user" ? "front" : "back"} camera.`);
        processFrame(true);
    } catch (err) {
        console.error(err);
        cameraFacingMode = previousMode;

        try {
            await startCamera(previousMode);
            setStatus("Could not switch camera. This device may only have one camera.");
        } catch (restoreErr) {
            console.error(restoreErr);
            setStatus("Camera error while switching. Try stopping and starting again.");
        }
    } finally {
        if (switchCameraBtn) {
            switchCameraBtn.disabled = false;
        }
    }
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
    if (switchCameraBtn) {
        switchCameraBtn.hidden = true;
    }
    lastGestures = [];
    hideLoader();
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

function capitalizeFirst(text) {
    if (!text) {
        return text;
    }
    return text.charAt(0).toUpperCase() + text.slice(1);
}

function blendshapeScores(blendshapes) {
    const scores = {};
    (blendshapes?.categories || []).forEach((category) => {
        scores[category.categoryName] = category.score;
    });
    return scores;
}

function extractExpressions(blendshapes) {
    const scores = blendshapeScores(blendshapes);
    const expressions = [];

    const jawOpen = scores.jawOpen || 0;
    const mouthSmile = ((scores.mouthSmileLeft || 0) + (scores.mouthSmileRight || 0)) / 2;
    const mouthFrown = ((scores.mouthFrownLeft || 0) + (scores.mouthFrownRight || 0)) / 2;
    const eyeBlinkLeft = scores.eyeBlinkLeft || 0;
    const eyeBlinkRight = scores.eyeBlinkRight || 0;
    const browInnerUp = scores.browInnerUp || 0;
    const eyeWideLeft = scores.eyeWideLeft || 0;
    const eyeWideRight = scores.eyeWideRight || 0;
    const cheekPuff = scores.cheekPuff || 0;

    if (jawOpen >= YAWN_JAW_OPEN_THRESHOLD) {
        expressions.push("yawning");
    }

    if (mouthSmile >= SMILE_THRESHOLD && jawOpen < YAWN_JAW_OPEN_THRESHOLD) {
        expressions.push("smiling");
    }

    if (mouthFrown >= FROWN_THRESHOLD) {
        expressions.push("frowning");
    }

    if (eyeBlinkLeft >= EYE_CLOSED_THRESHOLD && eyeBlinkRight >= EYE_CLOSED_THRESHOLD) {
        expressions.push("eyes closed");
    }

    if (browInnerUp >= SURPRISE_BROW_THRESHOLD && eyeWideLeft > 0.25 && eyeWideRight > 0.25) {
        expressions.push("looking surprised");
    }

    if (cheekPuff >= 0.4) {
        expressions.push("puffing cheeks");
    }

    return expressions;
}

function landmarkBoundingBox(landmarks, frameWidth, frameHeight) {
    let minX = 1;
    let minY = 1;
    let maxX = 0;
    let maxY = 0;

    landmarks.forEach((landmark) => {
        minX = Math.min(minX, landmark.x);
        minY = Math.min(minY, landmark.y);
        maxX = Math.max(maxX, landmark.x);
        maxY = Math.max(maxY, landmark.y);
    });

    return {
        originX: minX * frameWidth,
        originY: minY * frameHeight,
        width: (maxX - minX) * frameWidth,
        height: (maxY - minY) * frameHeight
    };
}

function analyzeFaces() {
    if (!faceLandmarker || video.readyState < 2) {
        return [];
    }

    const results = faceLandmarker.detectForVideo(video, performance.now());
    const fw = video.videoWidth || 1;
    const fh = video.videoHeight || 1;
    const analyses = [];

    (results.faceLandmarks || []).forEach((landmarks, index) => {
        if (!landmarks?.length) {
            return;
        }

        const bbox = landmarkBoundingBox(landmarks, fw, fh);
        const position = spatialPosition(bbox, fw, fh);
        const expressions = extractExpressions(results.faceBlendshapes?.[index]);

        analyses.push({
            label: "face",
            display_name: "Face",
            confidence: 1,
            position,
            expressions,
            landmarks,
            bbox: {
                x: Number((bbox.originX / fw).toFixed(3)),
                y: Number((bbox.originY / fh).toFixed(3)),
                width: Number((bbox.width / fw).toFixed(3)),
                height: Number((bbox.height / fh).toFixed(3))
            }
        });
    });

    return analyses.sort((a, b) => b.position.area - a.position.area);
}

function hasPerson(objects, faceAnalyses) {
    return objects.some((obj) => obj.label.toLowerCase() === "person") || faceAnalyses.length > 0;
}

function formatGesturePhrase(gestureName) {
    const phrases = {
        Thumb_Up: "showing a thumbs up",
        Thumb_Down: "showing a thumbs down",
        Open_Palm: "showing an open palm",
        Closed_Fist: "making a fist",
        Victory: "showing a peace sign",
        Pointing_Up: "pointing up",
        ILoveYou: "showing an I love you sign"
    };

    return phrases[gestureName] || `showing ${gestureName.replace(/_/g, " ").toLowerCase()}`;
}

function joinNaturalList(items) {
    if (items.length === 0) {
        return "";
    }
    if (items.length === 1) {
        return items[0];
    }
    if (items.length === 2) {
        return `${items[0]} and ${items[1]}`;
    }
    return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function personLocationPhrase(position) {
    const { horizontal, depth } = position;

    if (horizontal === "center") {
        if (depth === "very_near" || depth === "near") {
            return "in front of you";
        }
        if (depth === "far") {
            return "far in front of you";
        }
        return `${depthLabel(depth)} in front of you`;
    }

    if (depth === "medium") {
        return horizontalLabel(horizontal);
    }

    return `${depthLabel(depth)} ${horizontalLabel(horizontal)}`;
}

function objectLocationPhrase(position) {
    const { horizontal, depth } = position;

    if (horizontal === "center") {
        if (depth === "very_near" || depth === "near") {
            return "in front of you";
        }
        if (depth === "far") {
            return "far in front of you";
        }
        return `${depthLabel(depth)} in front of you`;
    }

    if (depth === "medium") {
        return horizontalLabel(horizontal);
    }

    return `${depthLabel(depth)} ${horizontalLabel(horizontal)}`;
}

function articleFor(noun) {
    return /^[aeiou]/i.test(noun) ? "an" : "a";
}

function getPrimaryPersonPosition(personObjects, faceAnalyses) {
    if (personObjects.length > 0) {
        return personObjects.reduce((best, current) =>
            (current.position.area > best.position.area ? current : best)
        ).position;
    }

    if (faceAnalyses.length > 0) {
        return faceAnalyses[0].position;
    }

    return null;
}

function countPeople(personObjects, faceAnalyses) {
    if (personObjects.length === 0 && faceAnalyses.length === 0) {
        return 0;
    }

    if (faceAnalyses.length > 0) {
        return faceAnalyses.length;
    }

    return personObjects.length;
}

function buildPersonDescription(personObjects, faceAnalyses, gestures) {
    const peopleCount = countPeople(personObjects, faceAnalyses);
    const position = getPrimaryPersonPosition(personObjects, faceAnalyses);

    if (!position || peopleCount === 0) {
        return "";
    }

    const traits = [];
    const seenExpressions = new Set();

    faceAnalyses.forEach((face) => {
        face.expressions.forEach((expression) => {
            if (!seenExpressions.has(expression)) {
                seenExpressions.add(expression);
                traits.push(expression);
            }
        });
    });

    const seenGestures = new Set();
    gestures.forEach((gesture) => {
        const phrase = formatGesturePhrase(gesture.gesture);
        if (!seenGestures.has(phrase)) {
            seenGestures.add(phrase);
            traits.push(phrase);
        }
    });

    const location = personLocationPhrase(position);
    const personLabel = peopleCount === 1 ? "a person" : `${peopleCount} people`;
    let sentence = `There's ${personLabel} ${location}`;

    if (traits.length > 0) {
        sentence += `, ${joinNaturalList(traits)}`;
    }

    return sentence;
}

function buildObjectDescriptions(objects) {
    if (objects.length === 0) {
        return [];
    }

    const grouped = new Map();

    objects.forEach((obj) => {
        const key = `${obj.position.horizontal}:${obj.position.depth}`;
        if (!grouped.has(key)) {
            grouped.set(key, { position: obj.position, names: [] });
        }
        grouped.get(key).names.push(obj.display_name.toLowerCase());
    });

    return Array.from(grouped.values()).map((group) => {
        const formattedNames = group.names.map((name) => `${articleFor(name)} ${name}`);
        const location = objectLocationPhrase(group.position);
        return `${joinNaturalList(formattedNames)} ${location}`;
    });
}

function buildSpatialSentence(objects, faceAnalyses, gestures) {
    const personObjects = objects.filter((obj) => obj.label.toLowerCase() === "person");
    const otherObjects = objects.filter((obj) => obj.label.toLowerCase() !== "person");
    const sentences = [];

    const personSentence = buildPersonDescription(personObjects, faceAnalyses, gestures);
    if (personSentence) {
        sentences.push(personSentence);
    }

    const objectGroups = buildObjectDescriptions(otherObjects.slice(0, 4));
    objectGroups.forEach((groupText, index) => {
        const prefix = sentences.length === 0 && index === 0 ? "There's" : "There's also";
        sentences.push(`${prefix} ${groupText}`);
    });

    if (sentences.length === 0) {
        return "Nothing detected around you.";
    }

    return `${sentences.join(". ")}.`;
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

function sceneSignature(objects, faceAnalyses, gestures) {
    const otherObjects = objects
        .filter((obj) => obj.label.toLowerCase() !== "person")
        .map((obj) => `${obj.label}:${obj.position.horizontal}:${obj.position.depth}`)
        .sort()
        .join("|");

    const personObjects = objects.filter((obj) => obj.label.toLowerCase() === "person");
    const peopleCount = countPeople(personObjects, faceAnalyses);
    const position = getPrimaryPersonPosition(personObjects, faceAnalyses);
    const personPart = peopleCount > 0 && position
        ? `person:${peopleCount}:${position.horizontal}:${position.depth}`
        : "";

    const expressionPart = faceAnalyses
        .flatMap((face) => face.expressions)
        .sort()
        .join(",");

    const gesturePart = gestures
        .map((gesture) => gesture.gesture)
        .sort()
        .join(",");

    return `${otherObjects}::${personPart}::${expressionPart}::${gesturePart}`;
}

function drawDetections(objects, faceAnalyses, gestures) {
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    canvasCtx.lineWidth = 2;
    canvasCtx.font = "12px sans-serif";

    const hasFaceAnalysis = faceAnalyses.length > 0;

    const drawBox = (item, labelOverride) => {
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

        const tag = labelOverride || `${item.display_name} ${Math.round(item.confidence * 100)}%`;
        const textWidth = canvasCtx.measureText(tag).width;

        canvasCtx.fillStyle = color;
        canvasCtx.fillRect(x, Math.max(0, y - 20), textWidth + 8, 18);
        canvasCtx.fillStyle = "#fff";
        canvasCtx.fillText(tag, x + 4, Math.max(14, y - 6));
    };

    objects
        .filter((obj) => !(hasFaceAnalysis && obj.label.toLowerCase() === "person"))
        .forEach((obj) => drawBox(obj));

    faceAnalyses.forEach((face) => {
        const expressionLabel = face.expressions.length > 0
            ? capitalizeFirst(face.expressions[0])
            : "Face";
        drawBox(face, expressionLabel);
    });

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

async function announceScene(objects, faceAnalyses, gestures, force = false) {
    const signature = sceneSignature(objects, faceAnalyses, gestures);
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

    const sentence = buildSpatialSentence(objects, faceAnalyses, gestures);

    pendingAnnounce = false;

    setAnnouncement(sentence);
    speak(sentence);

    const personObjects = objects.filter((obj) => obj.label.toLowerCase() === "person");
    const otherCount = objects.length - personObjects.length;
    const peopleCount = countPeople(personObjects, faceAnalyses);
    const gestureCount = gestures.length;

    if (peopleCount === 0 && otherCount === 0 && gestureCount === 0) {
        setStatus("Scanning. Nothing detected.");
        return;
    }

    let status = "Scanning.";
    if (peopleCount > 0) {
        status += ` ${peopleCount} person${peopleCount !== 1 ? "s" : ""}`;
    }
    if (otherCount > 0) {
        status += `${peopleCount > 0 ? "," : ""} ${otherCount} object${otherCount !== 1 ? "s" : ""}`;
    }
    if (gestureCount > 0) {
        status += `, ${gestureCount} gesture${gestureCount !== 1 ? "s" : ""}`;
    }
    setStatus(`${status} detected.`);
}

function processFrame(forceAnnounce = false) {
    if (!objectDetector || video.readyState < 2) {
        return;
    }

    const results = objectDetector.detectForVideo(video, performance.now());
    const objects = normalizeDetections(results.detections || []);
    const faceAnalyses = analyzeFaces();

    let gestures = lastGestures;
    if (hasPerson(objects, faceAnalyses)) {
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

    updateGestureOverlay(gestures, faceAnalyses);
    drawDetections(objects, faceAnalyses, gestures);
    announceScene(objects, faceAnalyses, gestures, forceAnnounce);
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
        showLoader("Requesting camera access…");
        setStatus("Requesting camera permission...");
        await startCamera();
        setLoaderMessage("Loading vision engine…");
        setStatus("Camera active. Loading AI models...");
        const vision = await loadVisionTasks();
        objectDetector = await loadObjectDetector(vision);
        faceLandmarker = await loadFaceLandmarker(vision);
        gestureRecognizer = await loadGestureRecognizer(vision);
        hideLoader();
        running = true;
        startBtn.hidden = true;
        stopBtn.hidden = false;
        scanBtn.hidden = false;
        if (switchCameraBtn) {
            switchCameraBtn.hidden = false;
            updateSwitchCameraLabel();
        }
        setStatus("Ready. Point camera at your surroundings.");
        setAnnouncement("Detection active.");
        predictWebcam();
    } catch (err) {
        console.error(err);
        hideLoader();
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

if (switchCameraBtn) {
    switchCameraBtn.addEventListener("click", switchCamera);
}

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
