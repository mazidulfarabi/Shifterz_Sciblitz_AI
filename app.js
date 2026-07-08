const video = document.getElementById("webcam");
const canvasElement = document.getElementById("output_canvas");
const canvasCtx = canvasElement.getContext("2d");
const outputDiv = document.getElementById("output");
const debugDiv = document.getElementById("debug-output");
const startBtn = document.getElementById("start-btn");

let running = false;
let lastInferenceAt = 0;
let inferenceCanvasSize = { width: 320, height: 240 };
let stream = null;
let inferenceLoopId = null;
let inferenceInFlight = false;

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

function drawPredictions(predictions) {
  if (!predictions?.length) {
    return;
  }

  canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
  canvasCtx.drawImage(video, 0, 0, canvasElement.width, canvasElement.height);

  const topPrediction = predictions.reduce((best, current) => {
    const currentScore = Number(current.confidence || current.conf || current.score || 0);
    const bestScore = Number(best.confidence || best.conf || best.score || 0);
    return currentScore > bestScore ? current : best;
  }, {});

  const label = topPrediction.class_name || topPrediction.className || topPrediction.class || topPrediction.label || topPrediction.name || topPrediction.predicted_class || topPrediction.top_class || "Detected sign";
  const confidence = Number(topPrediction.confidence || topPrediction.conf || topPrediction.score || 0);

  if (label && confidence >= 0.6) {
    canvasCtx.fillStyle = "rgba(239, 68, 68, 0.95)";
    canvasCtx.font = "bold 20px sans-serif";
    canvasCtx.fillText(label, 16, 32);
    canvasCtx.font = "16px sans-serif";
    canvasCtx.fillText(`${Math.round(confidence * 100)}%`, 16, 56);
  }
}

async function runInference() {
  if (!running || video.readyState < 2 || inferenceInFlight) {
    return;
  }

  const now = Date.now();
  if (now - lastInferenceAt < 700) {
    return;
  }
  lastInferenceAt = now;
  inferenceInFlight = true;

  const inferenceCanvas = document.createElement("canvas");
  const targetWidth = 320;
  const targetHeight = Math.round((video.videoHeight / video.videoWidth) * targetWidth || 240);
  inferenceCanvas.width = targetWidth;
  inferenceCanvas.height = targetHeight;
  inferenceCanvasSize = { width: targetWidth, height: targetHeight };

  const inferenceCtx = inferenceCanvas.getContext("2d");
  inferenceCtx.drawImage(video, 0, 0, targetWidth, targetHeight);

  const dataUrl = inferenceCanvas.toDataURL("image/jpeg", 0.85);
  const imageBase64 = dataUrl.split(",")[1];

  if (!inferenceInFlight) {
    setStatus("Analyzing frame...");
  }

  try {
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
      const confidence = Math.round((Number(topPrediction.confidence || topPrediction.conf || topPrediction.score || 0)) * 100);
      setStatus(`${label} (${confidence}%)`);
    } else {
      const detail = payload.error || payload.message || "";
      setStatus(detail ? `No object detected — ${detail}` : "No object detected — move into frame");
    }

    drawVideoFrame();
    drawPredictions(parsedPredictions);
  } catch (error) {
    console.error(error);
    setStatus(`Inference error: ${error.message}`);
  } finally {
    inferenceInFlight = false;
  }
}

function startRenderLoop() {
  const tick = () => {
    drawVideoFrame();
    if (running) {
      inferenceLoopId = window.requestAnimationFrame(tick);
    }
  };

  inferenceLoopId = window.requestAnimationFrame(tick);
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
    setStatus("Live stream active — detecting objects...");
    startRenderLoop();
    await runInference();
    window.setInterval(runInference, 800);
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