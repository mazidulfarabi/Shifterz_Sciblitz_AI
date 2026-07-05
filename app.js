const SERVERLESS_URL = "https://serverless.roboflow.com";
const CAPTURE_SIZE = 416;
const CONFIDENCE_THRESHOLD = 0.5;
const STABLE_HITS_REQUIRED = 2;
const WORD_COMMIT_DELAY_MS = 1200;
const FRAME_INTERVAL_MS = 900;
const API_KEY_STORAGE_KEY = "roboflow-api-key";
const INFERENCE_CONFIG_STORAGE_KEY = "roboflow-inference-config";

const video = document.getElementById("webcam");
const canvasElement = document.getElementById("output_canvas");
const canvasCtx = canvasElement.getContext("2d");
const outputDiv = document.getElementById("output");
const apiHint = document.getElementById("api-hint");
const apiKeyInput = document.getElementById("api-key");
const inferenceModeInput = document.getElementById("inference-mode");
const modelIdInput = document.getElementById("model-id");
const sam3PromptsInput = document.getElementById("sam3-prompts");
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
let inferenceMode = "model";
let modelId = "";
let sam3Prompts = ["hand", "finger", "thumb", "palm"];

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

function getSavedInferenceConfig() {
    try {
        const storedConfig = JSON.parse(localStorage.getItem(INFERENCE_CONFIG_STORAGE_KEY) || "{}");

        return {
            mode: storedConfig.mode === "sam3" ? "sam3" : "model",
            modelId: typeof storedConfig.modelId === "string" ? storedConfig.modelId : "",
            sam3Prompts: Array.isArray(storedConfig.sam3Prompts) && storedConfig.sam3Prompts.length > 0
                ? storedConfig.sam3Prompts
                : ["hand", "finger", "thumb", "palm"]
        };
    } catch {
        return {
            mode: "model",
            modelId: "",
            sam3Prompts: ["hand", "finger", "thumb", "palm"]
        };
    }
}

function getApiKey() {
    return apiKeyInput.value.trim() || getSavedApiKey();
}

function getInferenceMode() {
    return inferenceModeInput.value === "sam3" ? "sam3" : "model";
}

function getModelId() {
    return modelIdInput.value.trim();
}

function getSam3Prompts() {
    return sam3PromptsInput.value
        .split(",")
        .map((prompt) => prompt.trim())
        .filter(Boolean);
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

function saveInferenceConfig() {
    localStorage.setItem(INFERENCE_CONFIG_STORAGE_KEY, JSON.stringify({
        mode: getInferenceMode(),
        modelId: getModelId(),
        sam3Prompts: getSam3Prompts()
    }));
}

function syncModeVisibility() {
    const isSam3 = getInferenceMode() === "sam3";
    modelIdInput.closest("label").style.display = isSam3 ? "none" : "grid";
    sam3PromptsInput.closest("label").style.display = isSam3 ? "grid" : "none";
}

function updateApiHint() {
    apiHint.textContent = getInferenceMode() === "sam3"
        ? "SAM3 is prompt-based. Enter concepts like hand, finger, or palm to segment matching regions."
        : "Use a full Roboflow model or workflow ID for ASL letter recognition.";
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

async function inferModelFrame(base64Frame) {
    const apiKey = getApiKey();
    const activeModelId = getModelId();

    if (!apiKey) {
        throw new Error("Add your Roboflow API key before starting the camera.");
    }

    if (!activeModelId) {
        throw new Error("Enter a Roboflow model ID or workflow ID before starting the camera.");
    }

    const response = await fetch(`${SERVERLESS_URL}/${activeModelId}?api_key=${encodeURIComponent(apiKey)}`, {
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

async function inferSam3Frame(base64Frame) {
    const apiKey = getApiKey();
    const prompts = getSam3Prompts();

    if (!apiKey) {
        throw new Error("Add your Roboflow API key before starting the camera.");
    }

    if (!prompts.length) {
        throw new Error("Add at least one SAM3 prompt before starting the camera.");
    }

    const response = await fetch(`${SERVERLESS_URL}/sam3/concept_segment?api_key=${encodeURIComponent(apiKey)}`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            image: {
                type: "base64",
                value: base64Frame
            },
            prompts: prompts.map((prompt) => ({
                type: "text",
                text: prompt
            })),
            output_prob_thresh: 0.5,
            format: "polygon"
        })
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

function drawBoundingBoxes(predictions, color) {
    if (!predictions.length) {
        return;
    }

    const scaleX = canvasElement.width / CAPTURE_SIZE;
    const scaleY = canvasElement.height / CAPTURE_SIZE;

    predictions.slice(0, 6).forEach((prediction) => {
        const width = prediction.width || 0;
        const height = prediction.height || 0;

        if (!prediction.x || !prediction.y || !width || !height) {
            return;
        }

        const x = (prediction.x - width / 2) * scaleX;
        const y = (prediction.y - height / 2) * scaleY;
        const boxWidth = width * scaleX;
        const boxHeight = height * scaleY;
        const label = prediction.label || displayLabel(prediction.class || prediction.echo || "Concept");
        const confidence = Math.round((prediction.confidence || 0) * 100);

        canvasCtx.strokeStyle = color;
        canvasCtx.lineWidth = 3;
        canvasCtx.strokeRect(x, y, boxWidth, boxHeight);

        const caption = `${label} ${confidence}%`;
        canvasCtx.font = "bold 18px 'Segoe UI', sans-serif";
        const textWidth = canvasCtx.measureText(caption).width;
        const labelY = Math.max(24, y - 8);

        canvasCtx.fillStyle = "rgba(2, 6, 11, 0.78)";
        canvasCtx.fillRect(x - 2, labelY - 20, textWidth + 14, 26);
        canvasCtx.fillStyle = "#f8fafc";
        canvasCtx.fillText(caption, x + 5, labelY);
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

function processModelPredictionResult(result) {
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

function flattenSam3Predictions(result) {
    const promptResults = Array.isArray(result?.prompt_results) ? result.prompt_results : [];

    return promptResults.flatMap((promptResult) => {
        const label = displayLabel(promptResult?.echo || promptResult?.prompt || promptResult?.text || "Concept");
        const promptPredictions = Array.isArray(promptResult?.predictions) ? promptResult.predictions : [];

        return promptPredictions.map((prediction) => {
            const polygonPoints = Array.isArray(prediction?.polygon)
                ? prediction.polygon
                : Array.isArray(prediction?.points)
                    ? prediction.points
                    : [];

            const xValues = polygonPoints.map((point) => Number(point.x ?? point[0])).filter(Number.isFinite);
            const yValues = polygonPoints.map((point) => Number(point.y ?? point[1])).filter(Number.isFinite);
            const xMin = xValues.length ? Math.min(...xValues) : prediction.x;
            const xMax = xValues.length ? Math.max(...xValues) : prediction.x + (prediction.width || 0);
            const yMin = yValues.length ? Math.min(...yValues) : prediction.y;
            const yMax = yValues.length ? Math.max(...yValues) : prediction.y + (prediction.height || 0);

            return {
                ...prediction,
                label,
                x: prediction.x ?? (xMin + xMax) / 2,
                y: prediction.y ?? (yMin + yMax) / 2,
                width: prediction.width ?? Math.max(1, xMax - xMin),
                height: prediction.height ?? Math.max(1, yMax - yMin)
            };
        });
    });
}

function processSam3PredictionResult(result) {
    const predictions = flattenSam3Predictions(result);

    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);

    if (!predictions.length) {
        setDetectedLetter("-");
        setStatus("SAM3 returned no matches for the current prompts.");
        return;
    }

    drawBoundingBoxes(predictions, "#f59e0b");

    const topPrediction = predictions[0];
    const label = topPrediction.label || displayLabel(topPrediction.class || "Concept");
    const confidence = Math.round((topPrediction.confidence || 0) * 100);
    setDetectedLetter(`${label} (${confidence}%)`);
    setStatus(`SAM3 detected ${predictions.length} match${predictions.length === 1 ? "" : "es"}.`);
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
            const activeMode = getInferenceMode();
            const result = activeMode === "sam3"
                ? await inferSam3Frame(frame)
                : await inferModelFrame(frame);

            if (activeMode === "sam3") {
                processSam3PredictionResult(result);
            } else {
                processModelPredictionResult(result);
            }
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

    if (getInferenceMode() === "model" && !getModelId()) {
        setStatus("Enter the full Roboflow model ID or workflow ID, then start the camera again.");
        modelIdInput.focus();
        return;
    }

    if (getInferenceMode() === "sam3" && !getSam3Prompts().length) {
        setStatus("Add at least one SAM3 prompt, then start the camera again.");
        sam3PromptsInput.focus();
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
        setStatus(getInferenceMode() === "sam3"
            ? "Camera ready. SAM3 prompt segmentation is running."
            : "Camera ready. Hold an ASL letter steady to build words.");
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
    const savedConfig = getSavedInferenceConfig();

    if (savedKey) {
        apiKeyInput.value = savedKey;
    }

    inferenceModeInput.value = savedConfig.mode;
    modelIdInput.value = savedConfig.modelId;
    sam3PromptsInput.value = savedConfig.sam3Prompts.join(", ");
    syncModeVisibility();
    updateApiHint();

    setDetectedLetter("-");
    renderTranscript();
    setStatus("Add your Roboflow API key, save it, then start the camera.");

    inferenceModeInput.addEventListener("change", () => {
        syncModeVisibility();
        updateApiHint();
        saveInferenceConfig();
    });
    modelIdInput.addEventListener("input", saveInferenceConfig);
    sam3PromptsInput.addEventListener("input", saveInferenceConfig);
    saveKeyBtn.addEventListener("click", () => {
        saveApiKey();
        saveInferenceConfig();
    });
    clearBtn.addEventListener("click", clearTranscript);
    startBtn.addEventListener("click", startApp);
}

initialize();
