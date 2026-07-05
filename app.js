import { GestureRecognizer, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.8/vision_bundle.mjs";

const video = document.getElementById("webcam");
const canvasElement = document.getElementById("output_canvas");
const canvasCtx = canvasElement.getContext("2d");
const outputDiv = document.getElementById("output");
const startBtn = document.getElementById("start-btn");

let gestureRecognizer = undefined;
let lastVideoTime = -1;
let running = false;

function setStatus(message) {
    outputDiv.innerText = message;
}

function withTimeout(promise, ms, label) {
    return Promise.race([
        promise,
        new Promise((_, reject) => {
            setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms);
        })
    ]);
}

async function loadGestureRecognizer() {
    setStatus("Loading AI model (first load can take 30–60 seconds)...");

    const vision = await withTimeout(
        FilesetResolver.forVisionTasks(
            "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.8/wasm"
        ),
        60000,
        "MediaPipe WASM load"
    );

    const options = {
        baseOptions: {
            modelAssetPath:
                "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task",
            delegate: "CPU"
        },
        runningMode: "VIDEO",
        numHands: 2,
        minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
        cannedGesturesClassifierOptions: {
            scoreThreshold: 0.35
        }
    };

    return withTimeout(
        GestureRecognizer.createFromOptions(vision, options),
        120000,
        "Gesture model load"
    );
}

async function startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Camera access is not supported in this browser.");
    }

    setStatus("Requesting camera permission...");

    const stream = await navigator.mediaDevices.getUserMedia({
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

    canvasElement.width = video.videoWidth;
    canvasElement.height = video.videoHeight;
    await video.play();
}

function formatGestureName(name) {
    return name.replace(/_/g, " ");
}

function drawLandmarks(landmarks) {
    canvasCtx.fillStyle = "#FF0000";
    canvasCtx.strokeStyle = "#00FF00";
    canvasCtx.lineWidth = 2;

    landmarks.forEach((landmark) => {
        const x = landmark.x * canvasElement.width;
        const y = landmark.y * canvasElement.height;
        canvasCtx.beginPath();
        canvasCtx.arc(x, y, 4, 0, 2 * Math.PI);
        canvasCtx.fill();
    });
}

function predictWebcam() {
    if (!running) {
        return;
    }

    if (!gestureRecognizer || video.readyState < 2) {
        window.requestAnimationFrame(predictWebcam);
        return;
    }

    if (lastVideoTime !== video.currentTime) {
        lastVideoTime = video.currentTime;

        const results = gestureRecognizer.recognizeForVideo(video, performance.now());

        canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);

        if (results.gestures?.length > 0) {
            const topGesture = results.gestures[0][0];
            const confidence = Math.round(topGesture.score * 100);
            const label = formatGestureName(topGesture.categoryName);

            if (topGesture.categoryName !== "None" && topGesture.score >= 0.35) {
                setStatus(`Detected: ${label} (${confidence}%)`);
            } else {
                setStatus("Show a supported hand gesture to the camera");
            }

            if (results.landmarks?.length) {
                results.landmarks.forEach((landmarks) => drawLandmarks(landmarks));
            }
        } else {
            setStatus("No hand detected — move your hand into the frame");
        }
    }

    window.requestAnimationFrame(predictWebcam);
}

async function startApp() {
    if (running) {
        return;
    }

    if (window.location.protocol === "file:") {
        setStatus("If the browser blocks camera access from a local file, open this page from a local server.");
    }

    startBtn.disabled = true;

    try {
        await startCamera();
        setStatus("Camera active. Loading AI model...");
        gestureRecognizer = await loadGestureRecognizer();
        running = true;
        startBtn.style.display = "none";
        setStatus("Ready — show a hand gesture to the camera");
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
