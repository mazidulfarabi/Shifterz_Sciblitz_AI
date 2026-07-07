const video = document.getElementById("webcam");
const canvasElement = document.getElementById("output_canvas");
const canvasCtx = canvasElement.getContext("2d");
const outputDiv = document.getElementById("output");
const startBtn = document.getElementById("start-btn");

let running = false;
let lastInferenceAt = 0;
let inferenceCanvasSize = { width: 320, height: 240 };
let stream = null;
let inferenceLoopId = null;

function setStatus(message) {
  outputDiv.innerText = message;
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

  const scaleX = canvasElement.width / inferenceCanvasSize.width;
  const scaleY = canvasElement.height / inferenceCanvasSize.height;

  predictions.forEach((prediction) => {
    const x = Number(prediction.x ?? prediction.center_x ?? 0);
    const y = Number(prediction.y ?? prediction.center_y ?? 0);
    const width = Number(prediction.width ?? prediction.w ?? 0);
    const height = Number(prediction.height ?? prediction.h ?? 0);

    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height)) {
      return;
    }

    const left = (x - width / 2) * scaleX;
    const top = (y - height / 2) * scaleY;
    const boxWidth = width * scaleX;
    const boxHeight = height * scaleY;

    canvasCtx.strokeStyle = "#22c55e";
    canvasCtx.lineWidth = 3;
    canvasCtx.strokeRect(left, top, boxWidth, boxHeight);

    canvasCtx.fillStyle = "#22c55e";
    canvasCtx.font = "16px sans-serif";
    canvasCtx.fillText(`${prediction.class_name || prediction.className || "Object"} ${(prediction.confidence * 100).toFixed(0)}%`, left, Math.max(top - 8, 10));
  });
}

async function runInference() {
  if (!running || video.readyState < 2) {
    return;
  }

  const now = Date.now();
  if (now - lastInferenceAt < 800) {
    return;
  }
  lastInferenceAt = now;

  const inferenceCanvas = document.createElement("canvas");
  const targetWidth = 320;
  const targetHeight = Math.round((video.videoHeight / video.videoWidth) * targetWidth || 240);
  inferenceCanvas.width = targetWidth;
  inferenceCanvas.height = targetHeight;
  inferenceCanvasSize = { width: targetWidth, height: targetHeight };

  const inferenceCtx = inferenceCanvas.getContext("2d");
  inferenceCtx.drawImage(video, 0, 0, targetWidth, targetHeight);

  const dataUrl = inferenceCanvas.toDataURL("image/jpeg", 0.7);
  const imageBase64 = dataUrl.split(",")[1];

  setStatus("Analyzing frame...");

  try {
    const response = await fetch("/.netlify/functions/roboflow", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ imageBase64 })
    });

    const payload = await response.json();
    const predictions = payload.predictions || [];

    if (predictions.length > 0) {
      const topPrediction = predictions.reduce((best, current) => {
        const currentScore = Number(current.confidence || 0);
        const bestScore = Number(best.confidence || 0);
        return currentScore > bestScore ? current : best;
      });

      const label = topPrediction.class_name || topPrediction.className || "Detected object";
      const confidence = Math.round((topPrediction.confidence || 0) * 100);
      setStatus(`${label} (${confidence}%)`);
    } else {
      setStatus("No object detected — move into frame");
    }

    drawVideoFrame();
    drawPredictions(predictions);
  } catch (error) {
    console.error(error);
    setStatus(`Inference error: ${error.message}`);
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