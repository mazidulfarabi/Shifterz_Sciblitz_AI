const video = document.getElementById("webcam");
const canvasElement = document.getElementById("output_canvas");
const canvasCtx = canvasElement.getContext("2d");
const outputDiv = document.getElementById("output");
const debugDiv = document.getElementById("debug-output");
const startBtn = document.getElementById("start-btn");

let running = false;
let stream = null;
let handLandmarker = null;
let drawingUtils = null;
let lastVideoTime = -1;
let lastInferenceAt = 0;
let inferenceInFlight = false;
let lastPredictionLabel = "";

function setStatus(message) {
  outputDiv.innerText = message;
}

function setDebug(message) {
  debugDiv.innerText = message;
}

function drawVideoFrame() {
  if (!running || video.readyState < 2) {
    return;
  }

  canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
  canvasCtx.drawImage(video, 0, 0, canvasElement.width, canvasElement.height);
}

function drawHandOverlay(result) {
  if (!running || !result?.landmarks?.length || !drawingUtils) {
    return;
  }

  canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
  canvasCtx.drawImage(video, 0, 0, canvasElement.width, canvasElement.height);

  result.landmarks.forEach((landmarks) => {
    drawingUtils.drawConnectors(landmarks, handLandmarker.HAND_CONNECTIONS, {
      color: "#ef4444",
      lineWidth: 3
    });
    drawingUtils.drawLandmarks(landmarks, {
      color: "#ef4444",
      lineWidth: 2
    });
  });
}

function drawNoHandState() {
  canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
  canvasCtx.drawImage(video, 0, 0, canvasElement.width, canvasElement.height);
  canvasCtx.fillStyle = "rgba(239, 68, 68, 0.95)";
  canvasCtx.font = "bold 20px sans-serif";
  canvasCtx.fillText("Hand not detected", 16, 32);
}

async function loadHandLandmarker() {
  setStatus("Loading hand tracker...");

  const vision = await import("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.8/vision_bundle.mjs");
  const { FilesetResolver, HandLandmarker, DrawingUtils } = vision;

  const filesetResolver = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.8/wasm"
  );

  handLandmarker = await HandLandmarker.createFromOptions(filesetResolver, {
    baseOptions: {
      modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
      delegate: "CPU"
    },
    runningMode: "VIDEO",
    numHands: 1,
    minHandDetectionConfidence: 0.5,
    minHandPresenceConfidence: 0.5,
    minTrackingConfidence: 0.5
  });

  drawingUtils = new DrawingUtils(canvasCtx);
  setStatus("Hand tracker ready");
}

async function runInference() {
  if (!running || video.readyState < 2 || inferenceInFlight) {
    return;
  }

  const now = Date.now();
  if (now - lastInferenceAt < 1000) {
    return;
  }

  lastInferenceAt = now;
  inferenceInFlight = true;

  const inferenceCanvas = document.createElement("canvas");
  const targetWidth = 320;
  const targetHeight = Math.round((video.videoHeight / video.videoWidth) * targetWidth || 240);
  inferenceCanvas.width = targetWidth;
  inferenceCanvas.height = targetHeight;

  const inferenceCtx = inferenceCanvas.getContext("2d");
  inferenceCtx.drawImage(video, 0, 0, targetWidth, targetHeight);

  const dataUrl = inferenceCanvas.toDataURL("image/jpeg", 0.85);
  const imageBase64 = dataUrl.split(",")[1];

  try {
    setStatus("Analyzing sign...");

    const response = await fetch("/.netlify/functions/roboflow", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ imageBase64, mimeType: "image/jpeg" })
    });

    const rawText = await response.text();
    let payload = {};

    try {
      payload = rawText ? JSON.parse(rawText) : {};
    } catch {
      payload = { error: rawText || "Invalid response from Roboflow" };
    }

    setDebug(JSON.stringify(payload, null, 2));

    if (!response.ok) {
      const message = payload.error || payload.message || `Request failed with ${response.status}`;
      setStatus(`Roboflow error: ${message}`);
      drawVideoFrame();
      return;
    }

    const predictions = Array.isArray(payload.predictions)
      ? payload.predictions
      : Array.isArray(payload.result?.predictions)
        ? payload.result.predictions
        : [];

    const parsedPredictions = predictions.filter((prediction) => prediction && typeof prediction === "object");
    const topPrediction = parsedPredictions.length > 0
      ? parsedPredictions.reduce((best, current) => {
          const currentScore = Number(current.confidence || current.conf || current.score || 0);
          const bestScore = Number(best.confidence || best.conf || best.score || 0);
          return currentScore > bestScore ? current : best;
        })
      : null;

    if (topPrediction) {
      const label = topPrediction.class_name || topPrediction.className || topPrediction.class || topPrediction.label || topPrediction.name || topPrediction.predicted_class || topPrediction.top_class || "Detected sign";
      const confidence = Number(topPrediction.confidence || topPrediction.conf || topPrediction.score || 0);
      const confidencePercent = Math.round(confidence * 100);

      if (confidence >= 0.6) {
        setStatus(`${label} (${confidencePercent}%)`);
        lastPredictionLabel = label;
      } else {
        setStatus("No clear sign detected");
      }
    } else {
      const detail = payload.error || payload.message || "";
      setStatus(detail ? `No clear sign detected — ${detail}` : "No clear sign detected");
    }

    drawVideoFrame();
  } catch (error) {
    console.error(error);
    setStatus(`Inference error: ${error.message}`);
  } finally {
    inferenceInFlight = false;
  }
}

function predictWebcam() {
  if (!running) {
    return;
  }

  if (!handLandmarker || video.readyState < 2) {
    window.requestAnimationFrame(predictWebcam);
    return;
  }

  if (video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    const result = handLandmarker.detectForVideo(video, performance.now());

    if (result.landmarks?.length) {
      drawHandOverlay(result);
      if (Date.now() - lastInferenceAt > 900) {
        runInference();
      }
    } else {
      drawNoHandState();
      if (lastPredictionLabel) {
        setStatus("No hand detected — position your hand in frame");
      }
    }
  }

  window.requestAnimationFrame(predictWebcam);
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Camera access is not supported in this browser.");
  }

  setStatus("Requesting camera permission...");

  stream = await navigator.mediaDevices.getUserMedia({
    video: {
      width: { ideal: 640 },
      height: { ideal: 480 },
      facingMode: "user"
    }
  });

  await new Promise((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error("Camera preview failed to start."));
    video.srcObject = stream;
  });

  canvasElement.width = video.videoWidth || 640;
  canvasElement.height = video.videoHeight || 480;
  await video.play();
}

async function startApp() {
  if (running) {
    return;
  }

  startBtn.disabled = true;

  try {
    await startCamera();
    running = true;
    startBtn.style.display = "none";
    setStatus("Camera active — loading hand tracker...");
    await loadHandLandmarker();
    predictWebcam();
  } catch (err) {
    console.error(err);
    startBtn.disabled = false;

    if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
      setStatus("Camera blocked. Allow camera access in your browser settings, then click Start again.");
    } else if (err.name === "NotFoundError") {
      setStatus("No camera found. Connect a webcam and try again.");
    } else {
      setStatus(`Error: ${err.message}`);
    }
  }
}

startBtn.addEventListener("click", startApp);