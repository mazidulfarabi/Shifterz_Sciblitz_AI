import { GestureRecognizer, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.8/wasm/vision_bundle.js";

const video = document.getElementById("webcam");
const canvasElement = document.getElementById("output_canvas");
const canvasCtx = canvasElement.getContext("2d");
const outputDiv = document.getElementById("output");
let gestureRecognizer = undefined;
let lastVideoTime = -1;

// 1. Initialize the Pre-Trained Gesture Recognizer
async function initializeGestureRecognizer() {
    outputDiv.innerText = "Loading AI Model...";
    
    // Load the WebAssembly backend
    const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.8/wasm"
    );
    
    // Create the recognizer using Google's hosted model file
    gestureRecognizer = await GestureRecognizer.createFromOptions(vision, {
        baseOptions: {
            modelAssetPath: "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task",
            delegate: "GPU"
        },
        runningMode: "VIDEO",
        numHands: 1
    });
    
    outputDiv.innerText = "Model Loaded. Starting Camera...";
    startCamera();
}

// 2. Request Camera Permissions
function startCamera() {
    navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } })
        .then((stream) => {
            video.srcObject = stream;
            video.addEventListener("loadeddata", predictWebcam);
        })
        .catch((err) => {
            console.error("Camera access denied: ", err);
            outputDiv.innerText = "Please allow camera access.";
        });
}

// 3. Continuous Detection & Translation Loop
async function predictWebcam() {
    canvasElement.width = video.videoWidth;
    canvasElement.height = video.videoHeight;
    
    let startTimeMs = performance.now();
    if (lastVideoTime !== video.currentTime) {
        lastVideoTime = video.currentTime;
        
        // Let the AI analyze the frame
        const results = gestureRecognizer.recognizeForVideo(video, startTimeMs);
        
        canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
        
        if (results.gestures && results.gestures.length > 0) {
            // Get the best guess gesture and its confidence score
            const topGesture = results.gestures[0][0];
            const confidence = Math.round(topGesture.score * 100);
            
            // Output translation (ignoring 'None' if it doesn't recognize a specific sign)
            if (topGesture.categoryName !== "None") {
                outputDiv.innerText = `Sign Detected: ${topGesture.categoryName} (${confidence}%)`;
            } else {
                outputDiv.innerText = "Detecting...";
            }
            
            // Optional: Still draw the hand skeleton for visual feedback
            if (results.landmarks) {
                drawLandmarks(results.landmarks[0]);
            }
        } else {
            outputDiv.innerText = "No hand in frame";
        }
    }
    // Loop the function for the next frame
    window.requestAnimationFrame(predictWebcam);
}

// 4. Draw Coordinates on Canvas (Visual Feedback)
function drawLandmarks(landmarks) {
    canvasCtx.fillStyle = "#FF0000";
    canvasCtx.strokeStyle = "#00FF00";
    canvasCtx.lineWidth = 2;
    
    landmarks.forEach(landmark => {
        const x = landmark.x * canvasElement.width;
        const y = landmark.y * canvasElement.height;
        canvasCtx.beginPath();
        canvasCtx.arc(x, y, 4, 0, 2 * Math.PI);
        canvasCtx.fill();
    });
}

// Start the pipeline
initializeGestureRecognizer();