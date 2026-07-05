const MODEL_ID = "asl-m42ip-ac86g/1";
const SERVERLESS_URL = "https://serverless.roboflow.com";
const CAPTURE_SIZE = 416;
const CONFIDENCE_THRESHOLD = 0.5;
const STABLE_HITS_REQUIRED = 2;
const WORD_COMMIT_DELAY_MS = 1200;
const FRAME_INTERVAL_MS = 900;
const API_KEY_STORAGE_KEY = "roboflow-api-key";

const video = document.getElementById("webcam");
const canvasElement = document.getElementById("output_canvas");
const canvasCtx = canvasElement.getContext("2d");
const outputDiv = document.getElementById("output");
const apiHint = document.getElementById("api-hint");
const apiKeyInput = document.getElementById("api-key");
const saveKeyBtn = document.getElementById("save-key-btn");
const clearBtn = document.getElementById("clear-btn");
const startBtn = document.getElementById("start-btn");
const detectedLetterEl = document.getElementById("detected-letter");
const currentWordEl = document.getElementById("current-word");
const sentenceEl = document.getElementById("sentence");

let running = false;
let inferenceBusy = false;
let cameraStream = null;
let captureCanvas = document.createElement("canvas");
let captureCtx = captureCanvas.getContext("2d");
let lastInferenceAt = 0;
let lastConfidenceAt = 0;
let currentStableToken = "";
let currentStableHits = 0;
let commitLocked = false;
let currentWord = "";
let sentence = [];
let lastDetectedLabel = "-";

function setStatus(message) {
    outputDiv.textContent = message;
}

function setDetectedLetter(message) {
    detectedLetterEl.textContent = message;
}

function setCurrentWord() {
    currentWordEl.textContent = currentWord || "-";
}

function setSentence() {
    sentenceEl.textContent = sentence.length > 0 ? sentence.join(" ") : "-";
}

function renderTranscript() {
    setCurrentWord();
    setSentence();
}

function getSavedApiKey() {
    return localStorage.getItem(API_KEY_STORAGE_KEY) || "";
}

function getApiKey() {
    return apiKeyInput.value.trim() || getSavedApiKey();
}

function saveApiKey() {
    const apiKey = apiKeyInput.value.trim();

    if (!apiKey) {
        setStatus("Paste your Roboflow API key before saving.");
        return;
    }

    localStorage.setItem(API_KEY_STORAGE_KEY, apiKey);
    setStatus("Roboflow API key saved locally in this browser.");
}

function normalizeToken(value) {
    return String(value ?? "").trim().toLowerCase().replace(/[\s_-]+/g, "");
}

function displayLabel(value) {
    const raw = String(value ?? "").trim();

    if (!raw) {
        return "-";
    }

    if (raw.length === 1) {
        return raw.toUpperCase();
    }

    return raw
        .replace(/_/g, " ")
        .replace(/\b\w/g, (character) => character.toUpperCase());
}

function commitWord() {
    if (!currentWord) {
        return;
    }

    sentence.push(currentWord);
    currentWord = "";
    renderTranscript();
}

function appendLetter(label) {
    currentWord += label;
    renderTranscript();
}

function backspaceLetter() {
    if (currentWord.length > 0) {
        currentWord = currentWord.slice(0, -1);
    } else if (sentence.length > 0) {
        sentence.pop();
    }

    renderTranscript();
}

function clearTranscript() {
    currentWord = "";
    sentence = [];
    currentStableToken = "";
    currentStableHits = 0;
    commitLocked = false;
    lastDetectedLabel = "-";
    lastConfidenceAt = 0;
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    setDetectedLetter("-");
    renderTranscript();
    setStatus("Transcript cleared.");
}

async function startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Camera access is not supported in this browser.");
    }

    setStatus("Requesting camera permission...");

    cameraStream = await navigator.mediaDevices.getUserMedia({
        video: {
            width: { ideal: 640 },
            height: { ideal: 480 },
            facingMode: "user"
        },
        audio: false
    });

    await new Promise((resolve, reject) => {
        video.onloadedmetadata = () => resolve();
        video.onerror = () => reject(new Error("Camera preview failed to start."));
        video.srcObject = cameraStream;
    });

    canvasElement.width = 640;
    canvasElement.height = 480;
    captureCanvas.width = CAPTURE_SIZE;
    captureCanvas.height = CAPTURE_SIZE;

    await video.play();
}

function captureFrameBase64() {
    captureCtx.save();
    captureCtx.setTransform(-1, 0, 0, 1, CAPTURE_SIZE, 0);
    captureCtx.drawImage(video, 0, 0, CAPTURE_SIZE, CAPTURE_SIZE);
    captureCtx.restore();
    return captureCanvas.toDataURL("image/jpeg", 0.82).split(",")[1];
}

async function inferFrame(base64Frame) {
    const apiKey = getApiKey();

    if (!apiKey) {
        throw new Error("Add your Roboflow API key before starting the camera.");
    }

    const response = await fetch(`${SERVERLESS_URL}/${MODEL_ID}?api_key=${encodeURIComponent(apiKey)}`, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded"
        },
        body: base64Frame
    });

    if (!response.ok) {
        const details = await response.text();
        throw new Error(`Roboflow request failed (${response.status}): ${details}`);
    }

    return response.json();
}

function drawPredictions(predictions) {
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);

    if (!predictions.length) {
        return;
    }

    const scaleX = canvasElement.width / CAPTURE_SIZE;
    const scaleY = canvasElement.height / CAPTURE_SIZE;

    predictions.slice(0, 3).forEach((prediction, index) => {
        const x = (prediction.x - prediction.width / 2) * scaleX;
        const y = (prediction.y - prediction.height / 2) * scaleY;
        const width = prediction.width * scaleX;
        const height = prediction.height * scaleY;
        const confidence = Math.round((prediction.confidence || 0) * 100);

        canvasCtx.strokeStyle = index === 0 ? "#38bdf8" : "#f59e0b";
        canvasCtx.lineWidth = 3;
        canvasCtx.strokeRect(x, y, width, height);

        const label = `${displayLabel(prediction.class)} ${confidence}%`;
        canvasCtx.font = "bold 18px 'Segoe UI', sans-serif";
        const textWidth = canvasCtx.measureText(label).width;
        const labelX = x;
        const labelY = Math.max(24, y - 8);

        canvasCtx.fillStyle = "rgba(2, 6, 11, 0.78)";
        canvasCtx.fillRect(labelX - 2, labelY - 20, textWidth + 14, 26);
        canvasCtx.fillStyle = "#f8fafc";
        canvasCtx.fillText(label, labelX + 5, labelY);
    });
}

function commitPrediction(prediction) {
    const token = normalizeToken(prediction.class);

    if (!token) {
        return;
    }

    if (token === "space" || token === "blank") {
        commitWord();
        return;
    }

    if (token === "del" || token === "delete" || token === "backspace") {
        backspaceLetter();
        return;
    }

    const label = displayLabel(prediction.class);
    const finalLabel = label.length === 1 ? label.toUpperCase() : label.toUpperCase();
    appendLetter(finalLabel);
}

function processPredictionResult(result) {
    const predictions = Array.isArray(result?.predictions) ? result.predictions : [];
    const topPrediction = predictions[0];

    drawPredictions(predictions);

    if (!topPrediction || (topPrediction.confidence || 0) < CONFIDENCE_THRESHOLD) {
        setDetectedLetter("-");

        if (currentWord && performance.now() - lastConfidenceAt > WORD_COMMIT_DELAY_MS) {
            commitWord();
        }

        currentStableToken = "";
        currentStableHits = 0;
        commitLocked = false;
        lastDetectedLabel = "-";
        return;
    }

    lastConfidenceAt = performance.now();

    const token = normalizeToken(topPrediction.class);
    const label = displayLabel(topPrediction.class);
    const confidence = Math.round((topPrediction.confidence || 0) * 100);
    lastDetectedLabel = `${label} (${confidence}%)`;
    setDetectedLetter(lastDetectedLabel);

    if (token === "space" || token === "blank") {
        commitWord();
        currentStableToken = token;
        currentStableHits = 0;
        commitLocked = false;
        return;
    }

    if (token === "del" || token === "delete" || token === "backspace") {
        backspaceLetter();
        currentStableToken = token;
        currentStableHits = 0;
        commitLocked = false;
        return;
    }

    if (token === currentStableToken) {
        currentStableHits += 1;
    } else {
        currentStableToken = token;
        currentStableHits = 1;
        commitLocked = false;
    }

    if (currentStableHits >= STABLE_HITS_REQUIRED && !commitLocked) {
        commitPrediction(topPrediction);
        commitLocked = true;
    }
}

async function inferenceLoop() {
    if (!running) {
        return;
    }

    if (!inferenceBusy && video.readyState >= 2 && performance.now() - lastInferenceAt >= FRAME_INTERVAL_MS) {
        inferenceBusy = true;
        lastInferenceAt = performance.now();

        try {
            const frame = captureFrameBase64();
            const result = await inferFrame(frame);
            processPredictionResult(result);
        } catch (error) {
            console.error(error);
            setStatus(error?.message || "Inference failed.");
            inferenceBusy = false;
            return;
        } finally {
            inferenceBusy = false;
        }
    }

    if (currentWord && performance.now() - lastConfidenceAt > WORD_COMMIT_DELAY_MS) {
        commitWord();
    }

    window.requestAnimationFrame(inferenceLoop);
}

async function startApp() {
    if (running) {
        return;
    }

    if (!getApiKey()) {
        setStatus("Add your Roboflow API key, save it, then start the camera.");
        apiKeyInput.focus();
        return;
    }

    startBtn.disabled = true;
    saveKeyBtn.disabled = true;
    clearBtn.disabled = true;

    try {
        await startCamera();
        running = true;
        startBtn.style.display = "none";
        clearBtn.disabled = false;
        setStatus("Camera ready. Hold an ASL letter steady to build words.");
        setDetectedLetter("-");
        renderTranscript();
        inferenceLoop();
    } catch (error) {
        console.error(error);
        startBtn.disabled = false;
        saveKeyBtn.disabled = false;
        clearBtn.disabled = false;

        if (error.name === "NotAllowedError" || error.name === "PermissionDeniedError") {
            setStatus("Camera blocked. Allow camera access in your browser settings, then click Start again.");
        } else if (error.name === "NotFoundError") {
            setStatus("No camera found. Connect a webcam and try again.");
        } else {
            setStatus(`Error: ${error.message}`);
        }
    }
}

function initialize() {
    const savedKey = getSavedApiKey();

    if (savedKey) {
        apiKeyInput.value = savedKey;
        apiHint.textContent = `Model: ${MODEL_ID}. Your saved key will be used when you start the camera.`;
    }

    setDetectedLetter("-");
    renderTranscript();
    setStatus("Add your Roboflow API key, save it, then start the camera.");

    saveKeyBtn.addEventListener("click", saveApiKey);
    clearBtn.addEventListener("click", clearTranscript);
    startBtn.addEventListener("click", startApp);
}

initialize();
