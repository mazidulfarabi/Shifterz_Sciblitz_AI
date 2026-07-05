import { GestureRecognizer, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.8/wasm/vision_bundle.js";

const video = document.getElementById("webcam");
const canvasElement = document.getElementById("output_canvas");
const canvasCtx = canvasElement.getContext("2d");
const outputDiv = document.getElementById("output");
const supportedDiv = document.getElementById("supported-gestures");

let gestureRecognizer = undefined;
let lastVideoTime = -1;

const SUPPORTED_GESTURES = [
    "Closed_Fist",
    "Open_Palm",
    "Pointing_Up",
    "Thumb_Down",
    "Thumb_Up",
    "Victory",
    "ILoveYou"
];

async function initializeGestureRecognizer() {
    if (window.location.protocol === "file:") {
        outputDiv.innerText = "Open this app through a local server, not as a file.";
        outputDiv.title = "Run: python -m http.server 8080 then visit http://localhost:8080";
        return;
    }

    outputDiv.innerText = "Loading AI model...";

    try {
        const vision = await FilesetResolver.forVisionTasks(
            "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.8/wasm"
        );

        const options = {
            baseOptions: {
                modelAssetPath:
                    "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task"
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

        try {
            gestureRecognizer = await GestureRecognizer.createFromOptions(vision, {
                ...options,
                baseOptions: { ...options.baseOptions, delegate: "GPU" }
            });
        } catch (gpuError) {
            console.warn("GPU delegate unavailable, falling back to CPU.", gpuError);
            gestureRecognizer = await GestureRecognizer.createFromOptions(vision, {
                ...options,
                baseOptions: { ...options.baseOptions, delegate: "CPU" }
            });
        }

        outputDiv.innerText = "Model loaded. Starting camera...";
        await startCamera();
    } catch (err) {
        console.error("Failed to initialize gesture recognizer:", err);
        outputDiv.innerText = "Failed to load the AI model. Check your internet connection and reload.";
    }
}

async function startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
        outputDiv.innerText = "Camera access is not supported in this browser.";
        return;
    }

    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: {
                width: { ideal: 640 },
                height: { ideal: 480 },
                facingMode: "user"
            }
        });

        video.srcObject = stream;
        video.addEventListener("loadeddata", () => {
            canvasElement.width = video.videoWidth;
            canvasElement.height = video.videoHeight;
            video.play()
                .then(() => predictWebcam())
                .catch((playError) => {
                    console.error("Unable to start video playback:", playError);
                    outputDiv.innerText = "Unable to start the camera preview. Try reloading the page.";
                });
        }, { once: true });
    } catch (err) {
        console.error("Camera access denied:", err);
        outputDiv.innerText = "Please allow camera access and reload the page.";
    }
}

function predictWebcam() {
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
                outputDiv.innerText = `Detected: ${label} (${confidence}%)`;
            } else {
                outputDiv.innerText = "Show a supported hand gesture to the camera";
            }

            if (results.landmarks?.length) {
                results.landmarks.forEach((landmarks) => drawLandmarks(landmarks));
            }
        } else {
            outputDiv.innerText = "No hand detected — move your hand into the frame";
        }
    }

    window.requestAnimationFrame(predictWebcam);
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

if (supportedDiv) {
    supportedDiv.innerText = `Supported gestures: ${SUPPORTED_GESTURES.map(formatGestureName).join(", ")}`;
}

initializeGestureRecognizer();
