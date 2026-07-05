import { HandLandmark, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.8/vision_bundle.mjs";

// Fingerpose uses global 'fp' - loaded via script tag in index.html
const video = document.getElementById("webcam");
const canvasElement = document.getElementById("output_canvas");
const canvasCtx = canvasElement.getContext("2d");
const outputDiv = document.getElementById("output");
const startBtn = document.getElementById("start-btn");

const { GestureEstimator, GestureDescription, Finger, FingerCurl, FingerDirection } = fp;

let handDetector = undefined;
let gestureEstimator = undefined;
let running = false;
let lastGesture = "";
let gestureStability = 0;

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

function createASLGestures() {
    return [
        // A: Fist with thumb up
        new GestureDescription("A")
            .addCurl(Finger.Thumb, FingerCurl.NoCurl)
            .addDirection(Finger.Thumb, FingerDirection.VerticalUp)
            .addCurl(Finger.Index, FingerCurl.FullCurl)
            .addCurl(Finger.Middle, FingerCurl.FullCurl)
            .addCurl(Finger.Ring, FingerCurl.FullCurl)
            .addCurl(Finger.Pinky, FingerCurl.FullCurl),

        // B: All fingers extended, palm forward
        new GestureDescription("B")
            .addCurl(Finger.Thumb, FingerCurl.FullCurl)
            .addCurl(Finger.Index, FingerCurl.NoCurl)
            .addDirection(Finger.Index, FingerDirection.VerticalUp)
            .addCurl(Finger.Middle, FingerCurl.NoCurl)
            .addDirection(Finger.Middle, FingerDirection.VerticalUp)
            .addCurl(Finger.Ring, FingerCurl.NoCurl)
            .addDirection(Finger.Ring, FingerDirection.VerticalUp)
            .addCurl(Finger.Pinky, FingerCurl.NoCurl)
            .addDirection(Finger.Pinky, FingerDirection.VerticalUp),

        // C: Curved fingers
        new GestureDescription("C")
            .addCurl(Finger.Thumb, FingerCurl.HalfCurl)
            .addCurl(Finger.Index, FingerCurl.HalfCurl)
            .addDirection(Finger.Index, FingerDirection.HorizontalRight)
            .addCurl(Finger.Middle, FingerCurl.HalfCurl)
            .addCurl(Finger.Ring, FingerCurl.HalfCurl)
            .addCurl(Finger.Pinky, FingerCurl.HalfCurl),

        // D: Index up, thumb touches index
        new GestureDescription("D")
            .addCurl(Finger.Thumb, FingerCurl.NoCurl)
            .addDirection(Finger.Thumb, FingerDirection.HorizontalRight)
            .addCurl(Finger.Index, FingerCurl.NoCurl)
            .addDirection(Finger.Index, FingerDirection.HorizontalRight)
            .addCurl(Finger.Middle, FingerCurl.FullCurl)
            .addCurl(Finger.Ring, FingerCurl.FullCurl)
            .addCurl(Finger.Pinky, FingerCurl.FullCurl),

        // E: Fingers curled into palm, thumb over
        new GestureDescription("E")
            .addCurl(Finger.Thumb, FingerCurl.HalfCurl)
            .addDirection(Finger.Thumb, FingerDirection.HorizontalRight)
            .addCurl(Finger.Index, FingerCurl.FullCurl)
            .addCurl(Finger.Middle, FingerCurl.FullCurl)
            .addCurl(Finger.Ring, FingerCurl.FullCurl)
            .addCurl(Finger.Pinky, FingerCurl.FullCurl),

        // F: Thumb and index touch, middle and ring extended
        new GestureDescription("F")
            .addCurl(Finger.Thumb, FingerCurl.NoCurl)
            .addDirection(Finger.Thumb, FingerDirection.VerticalUp)
            .addCurl(Finger.Index, FingerCurl.NoCurl)
            .addDirection(Finger.Index, FingerDirection.VerticalUp)
            .addCurl(Finger.Middle, FingerCurl.NoCurl)
            .addCurl(Finger.Ring, FingerCurl.HalfCurl)
            .addCurl(Finger.Pinky, FingerCurl.FullCurl),

        // G: Index point, thumb parallel
        new GestureDescription("G")
            .addCurl(Finger.Thumb, FingerCurl.HalfCurl)
            .addDirection(Finger.Thumb, FingerDirection.DiagonalDownRight)
            .addCurl(Finger.Index, FingerCurl.NoCurl)
            .addDirection(Finger.Index, FingerDirection.HorizontalRight)
            .addCurl(Finger.Middle, FingerCurl.FullCurl)
            .addCurl(Finger.Ring, FingerCurl.FullCurl)
            .addCurl(Finger.Pinky, FingerCurl.FullCurl),

        // H: Index and middle together
        new GestureDescription("H")
            .addCurl(Finger.Thumb, FingerCurl.FullCurl)
            .addCurl(Finger.Index, FingerCurl.NoCurl)
            .addDirection(Finger.Index, FingerDirection.HorizontalRight)
            .addCurl(Finger.Middle, FingerCurl.NoCurl)
            .addDirection(Finger.Middle, FingerDirection.HorizontalRight)
            .addCurl(Finger.Ring, FingerCurl.FullCurl)
            .addCurl(Finger.Pinky, FingerCurl.FullCurl),

        // I: Pinky up only
        new GestureDescription("I")
            .addCurl(Finger.Thumb, FingerCurl.FullCurl)
            .addCurl(Finger.Index, FingerCurl.FullCurl)
            .addCurl(Finger.Middle, FingerCurl.FullCurl)
            .addCurl(Finger.Ring, FingerCurl.FullCurl)
            .addCurl(Finger.Pinky, FingerCurl.NoCurl)
            .addDirection(Finger.Pinky, FingerDirection.VerticalUp),

        // K: Index and middle up, thumb between
        new GestureDescription("K")
            .addCurl(Finger.Thumb, FingerCurl.NoCurl)
            .addDirection(Finger.Thumb, FingerDirection.VerticalUp)
            .addCurl(Finger.Index, FingerCurl.NoCurl)
            .addDirection(Finger.Index, FingerDirection.VerticalUp)
            .addCurl(Finger.Middle, FingerCurl.NoCurl)
            .addDirection(Finger.Middle, FingerDirection.VerticalUp)
            .addCurl(Finger.Ring, FingerCurl.FullCurl)
            .addCurl(Finger.Pinky, FingerCurl.FullCurl),

        // L: Thumb and index perpendicular
        new GestureDescription("L")
            .addCurl(Finger.Thumb, FingerCurl.NoCurl)
            .addDirection(Finger.Thumb, FingerDirection.VerticalUp)
            .addCurl(Finger.Index, FingerCurl.NoCurl)
            .addDirection(Finger.Index, FingerDirection.HorizontalRight)
            .addCurl(Finger.Middle, FingerCurl.FullCurl)
            .addCurl(Finger.Ring, FingerCurl.FullCurl)
            .addCurl(Finger.Pinky, FingerCurl.FullCurl),

        // M: Thumb under three fingers
        new GestureDescription("M")
            .addCurl(Finger.Thumb, FingerCurl.FullCurl)
            .addDirection(Finger.Thumb, FingerDirection.HorizontalRight)
            .addCurl(Finger.Index, FingerCurl.FullCurl)
            .addCurl(Finger.Middle, FingerCurl.FullCurl)
            .addCurl(Finger.Ring, FingerCurl.FullCurl)
            .addCurl(Finger.Pinky, FingerCurl.NoCurl),

        // N: Thumb under two fingers
        new GestureDescription("N")
            .addCurl(Finger.Thumb, FingerCurl.FullCurl)
            .addCurl(Finger.Index, FingerCurl.FullCurl)
            .addCurl(Finger.Middle, FingerCurl.FullCurl)
            .addCurl(Finger.Ring, FingerCurl.FullCurl)
            .addCurl(Finger.Pinky, FingerCurl.NoCurl)
            .addDirection(Finger.Pinky, FingerDirection.VerticalUp),

        // O: Fingers form circle
        new GestureDescription("O")
            .addCurl(Finger.Thumb, FingerCurl.HalfCurl)
            .addCurl(Finger.Index, FingerCurl.HalfCurl)
            .addCurl(Finger.Middle, FingerCurl.HalfCurl)
            .addCurl(Finger.Ring, FingerCurl.HalfCurl)
            .addCurl(Finger.Pinky, FingerCurl.HalfCurl),

        // P: Thumb and index, palm down
        new GestureDescription("P")
            .addCurl(Finger.Thumb, FingerCurl.NoCurl)
            .addDirection(Finger.Thumb, FingerDirection.DiagonalDownRight)
            .addCurl(Finger.Index, FingerCurl.NoCurl)
            .addDirection(Finger.Index, FingerDirection.DiagonalDownRight)
            .addCurl(Finger.Middle, FingerCurl.FullCurl)
            .addCurl(Finger.Ring, FingerCurl.FullCurl)
            .addCurl(Finger.Pinky, FingerCurl.FullCurl),

        // Q: Index point down
        new GestureDescription("Q")
            .addCurl(Finger.Thumb, FingerCurl.FullCurl)
            .addCurl(Finger.Index, FingerCurl.NoCurl)
            .addDirection(Finger.Index, FingerDirection.DiagonalDownRight)
            .addCurl(Finger.Middle, FingerCurl.FullCurl)
            .addCurl(Finger.Ring, FingerCurl.FullCurl)
            .addCurl(Finger.Pinky, FingerCurl.FullCurl),

        // R: Cross index and middle
        new GestureDescription("R")
            .addCurl(Finger.Thumb, FingerCurl.FullCurl)
            .addCurl(Finger.Index, FingerCurl.NoCurl)
            .addDirection(Finger.Index, FingerDirection.VerticalUp)
            .addCurl(Finger.Middle, FingerCurl.NoCurl)
            .addDirection(Finger.Middle, FingerDirection.HorizontalRight)
            .addCurl(Finger.Ring, FingerCurl.FullCurl)
            .addCurl(Finger.Pinky, FingerCurl.FullCurl),

        // S: Closed fist
        new GestureDescription("S")
            .addCurl(Finger.Thumb, FingerCurl.HalfCurl)
            .addDirection(Finger.Thumb, FingerDirection.HorizontalRight)
            .addCurl(Finger.Index, FingerCurl.FullCurl)
            .addCurl(Finger.Middle, FingerCurl.FullCurl)
            .addCurl(Finger.Ring, FingerCurl.FullCurl)
            .addCurl(Finger.Pinky, FingerCurl.FullCurl),

        // T: Thumb between index and middle
        new GestureDescription("T")
            .addCurl(Finger.Thumb, FingerCurl.NoCurl)
            .addCurl(Finger.Index, FingerCurl.FullCurl)
            .addCurl(Finger.Middle, FingerCurl.FullCurl)
            .addCurl(Finger.Ring, FingerCurl.FullCurl)
            .addCurl(Finger.Pinky, FingerCurl.FullCurl),

        // U: Index and middle up together
        new GestureDescription("U")
            .addCurl(Finger.Thumb, FingerCurl.FullCurl)
            .addCurl(Finger.Index, FingerCurl.NoCurl)
            .addDirection(Finger.Index, FingerDirection.VerticalUp)
            .addCurl(Finger.Middle, FingerCurl.NoCurl)
            .addDirection(Finger.Middle, FingerDirection.VerticalUp)
            .addCurl(Finger.Ring, FingerCurl.FullCurl)
            .addCurl(Finger.Pinky, FingerCurl.FullCurl),

        // V: Index and middle up in V
        new GestureDescription("V")
            .addCurl(Finger.Thumb, FingerCurl.FullCurl)
            .addCurl(Finger.Index, FingerCurl.NoCurl)
            .addDirection(Finger.Index, FingerDirection.VerticalUp)
            .addCurl(Finger.Middle, FingerCurl.NoCurl)
            .addDirection(Finger.Middle, FingerDirection.VerticalUp)
            .addCurl(Finger.Ring, FingerCurl.FullCurl)
            .addCurl(Finger.Pinky, FingerCurl.FullCurl),

        // W: Three fingers up
        new GestureDescription("W")
            .addCurl(Finger.Thumb, FingerCurl.FullCurl)
            .addCurl(Finger.Index, FingerCurl.NoCurl)
            .addDirection(Finger.Index, FingerDirection.VerticalUp)
            .addCurl(Finger.Middle, FingerCurl.NoCurl)
            .addDirection(Finger.Middle, FingerDirection.VerticalUp)
            .addCurl(Finger.Ring, FingerCurl.NoCurl)
            .addDirection(Finger.Ring, FingerDirection.VerticalUp)
            .addCurl(Finger.Pinky, FingerCurl.FullCurl),

        // X: Bent index
        new GestureDescription("X")
            .addCurl(Finger.Thumb, FingerCurl.FullCurl)
            .addCurl(Finger.Index, FingerCurl.HalfCurl)
            .addDirection(Finger.Index, FingerDirection.VerticalUp)
            .addCurl(Finger.Middle, FingerCurl.FullCurl)
            .addCurl(Finger.Ring, FingerCurl.FullCurl)
            .addCurl(Finger.Pinky, FingerCurl.FullCurl),

        // Y: Thumb and pinky
        new GestureDescription("Y")
            .addCurl(Finger.Thumb, FingerCurl.NoCurl)
            .addDirection(Finger.Thumb, FingerDirection.VerticalUp)
            .addCurl(Finger.Index, FingerCurl.FullCurl)
            .addCurl(Finger.Middle, FingerCurl.FullCurl)
            .addCurl(Finger.Ring, FingerCurl.FullCurl)
            .addCurl(Finger.Pinky, FingerCurl.NoCurl)
            .addDirection(Finger.Pinky, FingerDirection.VerticalUp),

        // Z: Index like claw
        new GestureDescription("Z")
            .addCurl(Finger.Thumb, FingerCurl.FullCurl)
            .addCurl(Finger.Index, FingerCurl.HalfCurl)
            .addDirection(Finger.Index, FingerDirection.VerticalUp)
            .addCurl(Finger.Middle, FingerCurl.FullCurl)
            .addCurl(Finger.Ring, FingerCurl.FullCurl)
            .addCurl(Finger.Pinky, FingerCurl.FullCurl)
    ];
}

async function loadHandDetector() {
    setStatus("Loading MediaPipe Hands model...");

    const vision = await withTimeout(
        FilesetResolver.forVisionTasks(
            "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.8/wasm"
        ),
        60000,
        "MediaPipe WASM load"
    );

    const handDetector = await withTimeout(
        HandLandmark.createFromOptions(vision, {
            baseOptions: {
                modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
                delegate: "CPU"
            },
            runningMode: "VIDEO",
            numHands: 1,
            minHandDetectionConfidence: 0.7,
            minHandPresenceConfidence: 0.7,
            minTrackingConfidence: 0.7
        }),
        120000,
        "Hand model load"
    );

    return handDetector;
}

function flattenLandmarks(landmarks) {
    return landmarks.flatMap(l => [l.x, l.y, l.z]);
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
    if (!running) return;

    if (video.readyState < 2) {
        window.requestAnimationFrame(predictWebcam);
        return;
    }

    const results = handDetector.detectForVideo(video, performance.now());

    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);

    if (results.handLandmarks?.length > 0) {
        const landmarks = results.handLandmarks[0];
        drawLandmarks(landmarks);

        const gestureResults = gestureEstimator.estimate(flattenLandmarks(landmarks), 8.5);

        if (gestureResults.gestures.length > 0) {
            const topGesture = gestureResults.gestures[0];
            const confidence = Math.round(topGesture.score * 10);

            if (topGesture.name !== lastGesture && confidence >= 8) {
                gestureStability = 0;
                lastGesture = topGesture.name;
            }

            if (topGesture.score >= 8.5) {
                gestureStability++;
                if (gestureStability >= 3) {
                    setStatus(`ASL Letter: ${topGesture.name} (${confidence}/10)`);
                }
            } else {
                setStatus("Hold gesture steady...");
                gestureStability = 0;
            }
        } else {
            setStatus("Show an ASL letter to the camera");
            gestureStability = 0;
        }
    } else {
        setStatus("No hand detected — move your hand into the frame");
        lastGesture = "";
        gestureStability = 0;
    }

    window.requestAnimationFrame(predictWebcam);
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

async function startApp() {
    if (running) return;

    if (window.location.protocol === "file:") {
        setStatus("If the browser blocks camera access from a local file, open this page from a local server.");
    }

    startBtn.disabled = true;

    try {
        await startCamera();
        setStatus("Camera active. Loading AI model...");

        handDetector = await loadHandDetector();

        gestureEstimator = new GestureEstimator(createASLGestures());

        running = true;
        startBtn.style.display = "none";
        setStatus("Ready — show an ASL letter to the camera");
        lastGesture = "";
        gestureStability = 0;
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