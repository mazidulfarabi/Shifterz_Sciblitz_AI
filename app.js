import {
    ObjectDetector,
    GestureRecognizer,
    FilesetResolver
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.8/vision_bundle.mjs";

const STORAGE_KEY_INTERVAL = "spatialVision.intervalSec";

const DEFAULT_INTERVAL_SEC = 4;
const SCORE_THRESHOLD = 0.45;
const MAX_OBJECTS = 8;
const GESTURE_SCORE_THRESHOLD = 0.6;
const GESTURE_FRAME_SKIP = 2;
const SPEECH_LANG = "bn-BD";
const GOOGLE_TTS_LANG = "bn";
const TTS_MODES = {
    AUTO: "auto",
    BROWSER: "browser",
    GOOGLE: "google"
};

const OBJECT_NAMES_BN = {
    person: "একজন ব্যক্তি",
    bicycle: "একটি সাইকেল",
    car: "একটি গাড়ি",
    motorcycle: "একটি মোটরসাইকেল",
    bus: "একটি বাস",
    train: "একটি ট্রেন",
    truck: "একটি ট্রাক",
    boat: "একটি নৌকা",
    bird: "একটি পাখি",
    cat: "একটি বিড়াল",
    dog: "একটি কুকুর",
    horse: "একটি ঘোড়া",
    backpack: "একটি ব্যাকপ্যাক",
    umbrella: "একটি ছাতা",
    handbag: "একটি হ্যান্ডব্যাগ",
    tie: "একটি টাই",
    suitcase: "একটি স্যুটকেস",
    bottle: "একটি বোতল",
    cup: "একটি কাপ",
    fork: "একটি কাঁটাচামচ",
    knife: "একটি ছুরি",
    spoon: "একটি চামচ",
    bowl: "একটি বাটি",
    banana: "একটি কলা",
    apple: "একটি আপেল",
    sandwich: "একটি স্যান্ডউইচ",
    orange: "একটি কমলা",
    pizza: "একটি পিজ্জা",
    donut: "একটি ডোনাট",
    cake: "একটি কেক",
    chair: "একটি চেয়ার",
    couch: "একটি সোফা",
    "potted plant": "একটি গাছ",
    bed: "একটি বিছানা",
    "dining table": "একটি ডাইনিং টেবিল",
    toilet: "একটি টয়লেট",
    tv: "একটি টিভি",
    laptop: "একটি ল্যাপটপ",
    mouse: "একটি মাউস",
    remote: "একটি রিমোট",
    keyboard: "একটি কীবোর্ড",
    "cell phone": "একটি মোবাইল ফোন",
    microwave: "একটি মাইক্রোওয়েভ",
    oven: "একটি ওভেন",
    refrigerator: "একটি ফ্রিজ",
    book: "একটি বই",
    clock: "একটি ঘড়ি",
    vase: "একটি ফুলদানি",
    scissors: "একটি কাঁচি",
    "teddy bear": "একটি টেডি বিয়ার",
    toothbrush: "একটি টুথব্রাশ"
};

const GESTURE_NAMES_BN = {
    Closed_Fist: "মুষ্ঠি",
    Open_Palm: "খোলা হাত",
    Pointing_Up: "উপরের দিকে আঙুল",
    Thumb_Down: "অসম্মতি",
    Thumb_Up: "সম্মতি",
    Victory: "বিজয়ের চিহ্ন",
    ILoveYou: "আই লাভ ইউ ইশারা"
};

const DEPTH_LABELS_BN = {
    very_near: "খুব কাছে",
    near: "কাছে",
    medium: "মাঝারি দূরত্বে",
    far: "দূরে"
};

const HORIZONTAL_LABELS_BN = {
    left: "আপনার বামে",
    center: "আপনার সামনে",
    right: "আপনার ডানে"
};

const video = document.getElementById("webcam");
const canvasElement = document.getElementById("output_canvas");
const canvasCtx = canvasElement.getContext("2d");
const startBtn = document.getElementById("start-btn");
const stopBtn = document.getElementById("stop-btn");
const scanBtn = document.getElementById("scan-btn");
const statusRegion = document.getElementById("status");
const announcementRegion = document.getElementById("announcement");
const objectList = document.getElementById("object-list");
const gestureList = document.getElementById("gesture-list");
const muteBtn = document.getElementById("mute-btn");

let objectDetector = undefined;
let gestureRecognizer = undefined;
let lastVideoTime = -1;
let running = false;
let muted = false;
let lastAnnounceAt = 0;
let lastSceneSignature = "";
let pendingAnnounce = false;
let cameraStream = null;
let gestureFrameCounter = 0;
let lastGestures = [];
let bnVoice = null;
let speakGeneration = 0;
let currentAudio = null;
let speechPrimed = false;
let speechUserActivated = false;

let runtimeConfig = {
    intervalSec: DEFAULT_INTERVAL_SEC
};

function refreshBnVoice() {
    const voices = window.speechSynthesis?.getVoices() || [];
    const preferredCodes = ["bn-BD", "bn-IN", "bn"];
    const preferredVoice = voices.find((voice) => preferredCodes.includes(voice.lang)) ||
        voices.find((voice) => voice.lang?.startsWith("bn")) ||
        voices.find((voice) => voice.lang?.startsWith("en")) ||
        voices[0] ||
        null;

    bnVoice = preferredVoice || null;
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
    if (!isMobileDevice() || speechUserActivated || !window.speechSynthesis) {
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

function isMobileDevice() {
    return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 0 && window.innerWidth < 1024);
}

function initSpeech() {
    refreshBnVoice();
    if (!isMobileDevice()) {
        return;
    }

    registerSpeechActivationHandlers();
    if (window.speechSynthesis) {
        window.speechSynthesis.onvoiceschanged = refreshBnVoice;
    }
}

function primeSpeech() {
    if (speechPrimed || !isMobileDevice() || !window.speechSynthesis) {
        return;
    }

    speechPrimed = true;
    refreshBnVoice();
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
    const sentences = text.match(/[^।.!?]+[।.!?]?/g) || [text];
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
        refreshBnVoice();
        markSpeechActivated();
        window.speechSynthesis.resume();

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = SPEECH_LANG;
        utterance.rate = runtimeConfig.speechRate;
        utterance.pitch = 1;
        utterance.volume = 1;

        if (bnVoice) {
            utterance.voice = bnVoice;
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
    if (muted || !text || !isMobileDevice()) {
        return;
    }

    await ensureSpeechReady();
    stopSpeaking();
    const generation = speakGeneration;
    refreshBnVoice();

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
        console.warn("Bengali TTS failed:", err);
    }
}

async function loadRuntimeConfig() {
    try {
        const mod = await import("./config.js");
        runtimeConfig.intervalSec = Number(localStorage.getItem(STORAGE_KEY_INTERVAL)) || mod.MIN_INTERVAL_SEC || DEFAULT_INTERVAL_SEC;
    } catch {
        runtimeConfig.intervalSec = Number(localStorage.getItem(STORAGE_KEY_INTERVAL)) || DEFAULT_INTERVAL_SEC;
    }

    if (localStorage.getItem(STORAGE_KEY_INTERVAL)) {
        runtimeConfig.intervalSec = Number(localStorage.getItem(STORAGE_KEY_INTERVAL)) || DEFAULT_INTERVAL_SEC;
    }
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
    setStatus("বস্তু শনাক্তকরণ মডেল লোড হচ্ছে। প্রথমবার ৩০–৬০ সেকেন্ড লাগতে পারে।");

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
        throw new Error("এই ব্রাউজারে ক্যামেরা সমর্থিত নয়।");
    }

    setStatus("ক্যামেরার অনুমতি চাওয়া হচ্ছে।");

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
        video.onerror = () => reject(new Error("ক্যামেরা প্রিভিউ শুরু করতে ব্যর্থ।"));
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
    renderGestureList([]);
    setStatus("ক্যামেরা বন্ধ।");
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
    return DEPTH_LABELS_BN[depth] || depth;
}

function horizontalLabel(horizontal) {
    return HORIZONTAL_LABELS_BN[horizontal] || horizontal;
}

function objectNameBn(obj) {
    const key = obj.label.toLowerCase();
    if (OBJECT_NAMES_BN[key]) {
        return OBJECT_NAMES_BN[key];
    }

    const displayKey = obj.display_name.toLowerCase().replace(/_/g, " ");
    if (OBJECT_NAMES_BN[displayKey]) {
        return OBJECT_NAMES_BN[displayKey];
    }

    return "একটি বস্তু";
}

function handLabelFromHandedness(handednessCategory) {
    const name = handednessCategory?.categoryName;
    if (name === "Left") {
        return "বাম হাত";
    }
    if (name === "Right") {
        return "ডান হাত";
    }
    return "হাত";
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

function hasPerson(objects) {
    return objects.some((obj) => obj.label.toLowerCase() === "person");
}

function detectGestures() {
    if (!gestureRecognizer || video.readyState < 2) {
        return [];
    }

    const results = gestureRecognizer.recognizeForVideo(video, performance.now());
    const fw = video.videoWidth || 1;
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
        const handednessCategory = results.handedness?.[handIndex]?.[0];

        gestures.push({
            hand: handLabelFromHandedness(handednessCategory),
            gesture: topGesture.categoryName,
            gesture_bn: GESTURE_NAMES_BN[topGesture.categoryName] || "অজানা ইশারা",
            confidence: Number(topGesture.score.toFixed(3)),
            horizontal: horizontalZone(centerX)
        });
    });

    return gestures;
}

function sceneSignature(objects, gestures) {
    const objectPart = objects
        .map((obj) => `${obj.label}:${obj.position.horizontal}:${obj.position.depth}`)
        .sort()
        .join("|");

    const gesturePart = gestures
        .map((gesture) => `${gesture.hand}:${gesture.gesture}:${gesture.horizontal}`)
        .sort()
        .join("|");

    return `${objectPart}::${gesturePart}`;
}

function buildSpatialSentence(objects, gestures) {
    const parts = [];

    if (objects.length === 0 && gestures.length === 0) {
        return "আপনার সামনে কোনো চিহ্নিত বস্তু দেখছি না।";
    }

    if (objects.length > 0) {
        const objectParts = objects.slice(0, 4).map((obj) => {
            const name = objectNameBn(obj);
            const where = horizontalLabel(obj.position.horizontal);
            return `${name}, ${depthLabel(obj.position.depth)}, ${where}`;
        });

        if (objectParts.length === 1) {
            parts.push(`আমি দেখছি ${objectParts[0]}`);
        } else {
            const last = objectParts.pop();
            parts.push(`আমি দেখছি ${objectParts.join("; ")}, এবং ${last}`);
        }
    }

    if (gestures.length > 0) {
        const gestureParts = gestures.map((gesture) => {
            const where = horizontalLabel(gesture.horizontal);
            return `${where} ${gesture.hand} ${gesture.gesture_bn} ইশারা দেখাচ্ছে`;
        });

        if (parts.length === 0) {
            parts.push(gestureParts.join("; "));
        } else {
            parts.push(`এছাড়াও, ${gestureParts.join("; ")}`);
        }
    }

    return `${parts.join(". ")}।`;
}

function renderObjectList(objects) {
    objectList.innerHTML = "";

    if (objects.length === 0) {
        const item = document.createElement("li");
        item.textContent = "কোনো বস্তু শনাক্ত হয়নি";
        objectList.appendChild(item);
        return;
    }

    objects.forEach((obj) => {
        const item = document.createElement("li");
        item.textContent = `${objectNameBn(obj)} — ${depthLabel(obj.position.depth)}, ${horizontalLabel(obj.position.horizontal)} (${Math.round(obj.confidence * 100)}%)`;
        objectList.appendChild(item);
    });
}

function renderGestureList(gestures) {
    if (!gestureList) {
        return;
    }

    gestureList.innerHTML = "";

    if (gestures.length === 0) {
        const item = document.createElement("li");
        item.textContent = "কোনো হাতের ইশারা শনাক্ত হয়নি";
        gestureList.appendChild(item);
        return;
    }

    gestures.forEach((gesture) => {
        const item = document.createElement("li");
        item.textContent = `${gesture.hand} — ${gesture.gesture_bn}, ${horizontalLabel(gesture.horizontal)} (${Math.round(gesture.confidence * 100)}%)`;
        gestureList.appendChild(item);
    });
}

function drawDetections(objects, gestures) {
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    canvasCtx.lineWidth = 2;
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

        const tag = `${objectNameBn(obj)} ${Math.round(obj.confidence * 100)}%`;
        canvasCtx.fillStyle = "#14532d";
        canvasCtx.fillRect(x, Math.max(0, y - 18), canvasCtx.measureText(tag).width + 8, 18);
        canvasCtx.fillStyle = "#ecfdf5";
        canvasCtx.fillText(tag, x + 4, Math.max(12, y - 5));
    });

    gestures.forEach((gesture, index) => {
        const y = 24 + index * 22;
        const tag = `${gesture.gesture_bn} (${gesture.hand})`;
        canvasCtx.fillStyle = "#1e3a8a";
        canvasCtx.fillRect(8, y - 16, canvasCtx.measureText(tag).width + 10, 20);
        canvasCtx.fillStyle = "#dbeafe";
        canvasCtx.fillText(tag, 12, y);
    });
}

async function announceScene(objects, gestures, force = false) {
    const signature = sceneSignature(objects, gestures);
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

    const sentence = buildSpatialSentence(objects, gestures);

    pendingAnnounce = false;

    setAnnouncement(sentence);
    speak(sentence);

    if (objects.length === 0 && gestures.length === 0) {
        setStatus("স্ক্যান চলছে। কোনো বস্তু দেখা যাচ্ছে না।");
    } else {
        const objectCount = objects.length;
        const gestureCount = gestures.length;
        let status = `স্ক্যান চলছে। ${objectCount}টি বস্তু`;

        if (gestureCount > 0) {
            status += `, ${gestureCount}টি হাতের ইশারা`;
        }

        setStatus(`${status} শনাক্ত হয়েছে।`);
    }
}

function processFrame(forceAnnounce = false) {
    if (!objectDetector || video.readyState < 2) {
        return;
    }

    const results = objectDetector.detectForVideo(video, performance.now());
    const objects = normalizeDetections(results.detections || []);

    let gestures = lastGestures;
    if (hasPerson(objects)) {
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

    drawDetections(objects, gestures);
    renderObjectList(objects);
    renderGestureList(gestures);
    announceScene(objects, gestures, forceAnnounce);
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
        setStatus("নির্ভরযোগ্য ক্যামেরার জন্য HTTPS-এ (যেমন Netlify) পৃষ্ঠাটি খুলুন।");
    }

    startBtn.disabled = true;
    primeSpeech();

    try {
        await startCamera();
        setStatus("ক্যামেরা চালু। মডেল লোড হচ্ছে।");
        const vision = await loadVisionTasks();
        objectDetector = await loadObjectDetector(vision);
        gestureRecognizer = await loadGestureRecognizer(vision);
        running = true;
        startBtn.hidden = true;
        stopBtn.hidden = false;
        scanBtn.hidden = false;
        setStatus("প্রস্তুত। ক্যামেরা আপনার চারপাশের দিকে ধরুন।");
        setAnnouncement("দৃশ্য সহায়ক চালু হয়েছে।");
        speak("দৃশ্য সহায়ক চালু হয়েছে। আমি আপনার চারপাশের বস্তু এবং হাতের ইশারা বর্ণনা করব।");
        predictWebcam();
    } catch (err) {
        console.error(err);
        startBtn.disabled = false;

        if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
            setStatus("ক্যামেরা ব্লক করা। অনুমতি দিন, তারপর আবার শুরু চাপুন।");
        } else if (err.name === "NotFoundError") {
            setStatus("কোনো ক্যামেরা পাওয়া যায়নি। ক্যামেরা সংযুক্ত করে আবার চেষ্টা করুন।");
        } else {
            setStatus(`ত্রুটি: ${err.message}`);
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
    muteBtn.textContent = muted ? "কথা চালু করুন" : "কথা বন্ধ করুন";
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
