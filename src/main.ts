import {
  FaceLandmarker,
  FilesetResolver,
  HandLandmarker,
  PoseLandmarker,
  type FaceLandmarkerResult,
  type HandLandmarkerResult,
  type Landmark,
  type NormalizedLandmark,
  type PoseLandmarkerResult
} from "@mediapipe/tasks-vision";
import type { BonePose, Euler, FingerCurl, MotionSnapshot, Point } from "./motion-types";
import "./style.css";

type TrackerBundle = {
  pose: PoseLandmarker;
  face: FaceLandmarker;
  hand: HandLandmarker;
};

type PoseModelQuality = "lite" | "full" | "heavy";

type VrmViewer = {
  applyMotion: (motion: MotionSnapshot) => void;
  loadFile: (file: File) => Promise<void>;
  resize: () => void;
};

const WASM_ROOT = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm";
const MODEL_ROOT = "https://storage.googleapis.com/mediapipe-models";

const POSE_MODELS: Record<PoseModelQuality, string> = {
  lite: `${MODEL_ROOT}/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task`,
  full: `${MODEL_ROOT}/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task`,
  heavy: `${MODEL_ROOT}/pose_landmarker/pose_landmarker_heavy/float16/latest/pose_landmarker_heavy.task`,
};
const FACE_MODEL = `${MODEL_ROOT}/face_landmarker/face_landmarker/float16/latest/face_landmarker.task`;
const HAND_MODEL = `${MODEL_ROOT}/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task`;

const POSE_CONNECTIONS: Array<[number, number]> = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 7],
  [0, 4],
  [4, 5],
  [5, 6],
  [6, 8],
  [9, 10],
  [11, 12],
  [11, 13],
  [13, 15],
  [15, 17],
  [15, 19],
  [15, 21],
  [17, 19],
  [12, 14],
  [14, 16],
  [16, 18],
  [16, 20],
  [16, 22],
  [18, 20],
  [11, 23],
  [12, 24],
  [23, 24],
  [23, 25],
  [24, 26],
  [25, 27],
  [26, 28],
  [27, 29],
  [28, 30],
  [29, 31],
  [30, 32],
  [27, 31],
  [28, 32],
];

const HAND_CONNECTIONS: Array<[number, number]> = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  [5, 9],
  [9, 10],
  [10, 11],
  [11, 12],
  [9, 13],
  [13, 14],
  [14, 15],
  [15, 16],
  [13, 17],
  [17, 18],
  [18, 19],
  [19, 20],
  [0, 17],
];

const FACE_CONNECTIONS: Array<[number, number]> = [
  ...chain([10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152]),
  ...chain([152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109, 10]),
  ...chain([33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246, 33]),
  ...chain([263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466, 263]),
  ...chain([61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185, 61]),
  ...chain([70, 63, 105, 66, 107, 55, 65, 52, 53, 46]),
  ...chain([336, 296, 334, 293, 300, 276, 283, 282, 295, 285]),
];

const video = element<HTMLVideoElement>("camera");
const canvas = element<HTMLCanvasElement>("wireCanvas");
const canvasContext = canvas.getContext("2d");

if (!canvasContext) {
  throw new Error("Canvas 2D context is not available.");
}

const ctx: CanvasRenderingContext2D = canvasContext;

const startButton = element<HTMLButtonElement>("startButton");
const calibrateButton = element<HTMLButtonElement>("calibrateButton");
const resetCalibrationButton = element<HTMLButtonElement>("resetCalibrationButton");
const recordButton = element<HTMLButtonElement>("recordButton");
const copyButton = element<HTMLButtonElement>("copyButton");
const downloadButton = element<HTMLButtonElement>("downloadButton");
const statusText = element("status");
const smoothingInput = element<HTMLInputElement>("smoothing");
const confidenceInput = element<HTMLInputElement>("confidence");
const scaleInput = element<HTMLInputElement>("scale");
const cameraSelect = element<HTMLSelectElement>("cameraSelect");
const mirrorInput = element<HTMLInputElement>("mirrorInput");
const bodyOutputInput = element<HTMLInputElement>("bodyOutput");
const faceOutputInput = element<HTMLInputElement>("faceOutput");
const handsOutputInput = element<HTMLInputElement>("handsOutput");
const wsFpsInput = element<HTMLInputElement>("wsFps");
const poseModelSelect = element<HTMLSelectElement>("poseModel");
const wsUrlInput = element<HTMLInputElement>("wsUrl");
const wsButton = element<HTMLButtonElement>("wsButton");
const fpsText = element("fps");
const poseState = element("poseState");
const faceState = element("faceState");
const handState = element("handState");
const frameState = element("frameState");
const wsState = element("wsState");
const bridgeState = element("bridgeState");
const recordState = element("recordState");
const motionOutput = element<HTMLPreElement>("motionOutput");
const vrmContainer = element("vrmContainer");
const vrmFileInput = element<HTMLInputElement>("vrmFile");
const avatarStrengthInput = element<HTMLInputElement>("avatarStrength");
const vrmState = element("vrmState");

const smoothedPoints = new Map<string, Point>();
let trackers: TrackerBundle | null = null;
let vrmViewer: VrmViewer | null = null;
let vrmViewerPromise: Promise<VrmViewer> | null = null;
let animationId = 0;
let lastVideoTime = -1;
let fpsFrames = 0;
let fpsStartedAt = performance.now();
let calibrationOffset = { x: 0, y: 0 };
let isRecording = false;
let cameraStream: MediaStream | null = null;
let preferredCameraDeviceId = "";
let lastOutputAt = 0;
let lastWsSentAt = 0;
let recordedFrames: MotionSnapshot[] = [];
let motionSocket: WebSocket | null = null;
let latestMotion: MotionSnapshot = {
  version: 1,
  head: null,
  torso: null,
  bones: {},
  blendShapes: {},
  hands: [],
  timestamp: 0,
};

window.addEventListener("resize", () => {
  resizeCanvas();
  vrmViewer?.resize();
});
startButton.addEventListener("click", start);
calibrateButton.addEventListener("click", calibrate);
resetCalibrationButton.addEventListener("click", resetCalibration);
recordButton.addEventListener("click", toggleRecording);
copyButton.addEventListener("click", copyLatestMotion);
downloadButton.addEventListener("click", downloadRecording);
wsButton.addEventListener("click", toggleWebSocket);
vrmFileInput.addEventListener("change", () => {
  const file = vrmFileInput.files?.[0];
  if (file) {
    void loadVrmFile(file);
  }
});
cameraSelect.addEventListener("change", () => {
  saveSettings();
  if (cameraStream) {
    void restartCamera();
  }
});
mirrorInput.addEventListener("change", saveSettings);
bodyOutputInput.addEventListener("change", saveSettings);
faceOutputInput.addEventListener("change", saveSettings);
handsOutputInput.addEventListener("change", saveSettings);
smoothingInput.addEventListener("input", saveSettings);
confidenceInput.addEventListener("input", saveSettings);
scaleInput.addEventListener("input", saveSettings);
avatarStrengthInput.addEventListener("input", saveSettings);
wsFpsInput.addEventListener("input", saveSettings);
poseModelSelect.addEventListener("change", () => {
  saveSettings();
  if (trackers) {
    void recreateTrackers();
  }
});
wsUrlInput.addEventListener("change", saveSettings);
loadSettings();
applyDefaultWebSocketUrl();
resizeCanvas();
drawIdle();
void enumerateCameras();

async function start(): Promise<void> {
  startButton.disabled = true;
  setStatus("MediaPipeモデルを読み込み中");

  try {
    trackers ??= await createTrackers();
    setStatus("カメラ権限を待機中");

    const stream = await openCameraStream();
    await video.play();
    await enumerateCameras();
    calibrateButton.disabled = false;
    resetCalibrationButton.disabled = false;
    recordButton.disabled = false;
    copyButton.disabled = false;
    downloadButton.disabled = false;
    setStatus("トラッキング中");
    cancelAnimationFrame(animationId);
    renderLoop();
  } catch (error) {
    console.error(error);
    setStatus(error instanceof Error ? error.message : "起動に失敗しました");
    startButton.disabled = false;
  }
}

async function restartCamera(): Promise<void> {
  if (!trackers) return;

  setStatus("カメラを切り替え中");
  const stream = await openCameraStream();
  await video.play();
  await enumerateCameras();
  smoothedPoints.clear();
  lastVideoTime = -1;
  setStatus("トラッキング中");
}

async function openCameraStream(): Promise<MediaStream> {
  stopCameraStream();

  const selectedDeviceId = cameraSelect.value;
  const videoConstraints: MediaTrackConstraints = selectedDeviceId
    ? {
        deviceId: { exact: selectedDeviceId },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      }
    : {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        facingMode: "user",
      };

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: videoConstraints,
  });

  cameraStream = stream;
  video.srcObject = stream;
  return stream;
}

function stopCameraStream(): void {
  cameraStream?.getTracks().forEach((track) => track.stop());
  cameraStream = null;
}

async function enumerateCameras(): Promise<void> {
  if (!navigator.mediaDevices?.enumerateDevices) return;

  const currentValue = cameraSelect.value || preferredCameraDeviceId;
  const devices = await navigator.mediaDevices.enumerateDevices();
  const cameras = devices.filter((device) => device.kind === "videoinput");

  cameraSelect.innerHTML = "";
  cameraSelect.append(new Option("自動選択", ""));

  cameras.forEach((device, index) => {
    const label = device.label || `カメラ ${index + 1}`;
    cameraSelect.append(new Option(label, device.deviceId));
  });

  const activeDeviceId = cameraStream?.getVideoTracks()[0]?.getSettings().deviceId;
  cameraSelect.value =
    activeDeviceId && cameras.some((device) => device.deviceId === activeDeviceId)
      ? activeDeviceId
      : cameras.some((device) => device.deviceId === currentValue)
        ? currentValue
        : "";
}

function loadSettings(): void {
  const settings = readSettings();
  if (!settings) return;

  if (typeof settings.cameraDeviceId === "string") {
    preferredCameraDeviceId = settings.cameraDeviceId;
  }
  if (typeof settings.mirror === "boolean") mirrorInput.checked = settings.mirror;
  if (typeof settings.bodyOutput === "boolean") bodyOutputInput.checked = settings.bodyOutput;
  if (typeof settings.faceOutput === "boolean") faceOutputInput.checked = settings.faceOutput;
  if (typeof settings.handsOutput === "boolean") handsOutputInput.checked = settings.handsOutput;
  if (isPoseModelQuality(settings.poseModel)) poseModelSelect.value = settings.poseModel;
  setInputValue(smoothingInput, settings.smoothing);
  setInputValue(confidenceInput, settings.confidence);
  setInputValue(scaleInput, settings.scale);
  setInputValue(avatarStrengthInput, settings.avatarStrength);
  setInputValue(wsFpsInput, settings.wsFps);
  if (typeof settings.wsUrl === "string") wsUrlInput.value = settings.wsUrl;
}

function applyDefaultWebSocketUrl(): void {
  if (wsUrlInput.value.trim()) return;
  if (location.hostname !== "127.0.0.1" && location.hostname !== "localhost") return;

  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  wsUrlInput.value = `${protocol}//${location.host}`;
}

function saveSettings(): void {
  preferredCameraDeviceId = cameraSelect.value;
  const settings = {
    cameraDeviceId: cameraSelect.value,
    mirror: mirrorInput.checked,
    bodyOutput: bodyOutputInput.checked,
    faceOutput: faceOutputInput.checked,
    handsOutput: handsOutputInput.checked,
    poseModel: poseModelSelect.value,
    smoothing: smoothingInput.value,
    confidence: confidenceInput.value,
    scale: scaleInput.value,
    avatarStrength: avatarStrengthInput.value,
    wsFps: wsFpsInput.value,
    wsUrl: wsUrlInput.value,
  };

  localStorage.setItem("mediapipe-motion-settings-v1", JSON.stringify(settings));
}

function readSettings(): Record<string, unknown> | null {
  const raw = localStorage.getItem("mediapipe-motion-settings-v1");
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function isPoseModelQuality(value: unknown): value is PoseModelQuality {
  return value === "lite" || value === "full" || value === "heavy";
}

function getPoseModelQuality(): PoseModelQuality {
  const value = poseModelSelect.value;
  return isPoseModelQuality(value) ? value : "full";
}

function setInputValue(input: HTMLInputElement, value: unknown): void {
  if (typeof value !== "string") return;
  input.value = value;
}

async function createTrackers(): Promise<TrackerBundle> {
  const vision = await FilesetResolver.forVisionTasks(WASM_ROOT);
  const poseModel = getPoseModelQuality();

  const [pose, face, hand] = await Promise.all([
    PoseLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: POSE_MODELS[poseModel],
        delegate: "GPU",
      },
      runningMode: "VIDEO",
      numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    }),
    FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: FACE_MODEL,
        delegate: "GPU",
      },
      runningMode: "VIDEO",
      numFaces: 1,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
      minFaceDetectionConfidence: 0.5,
      minFacePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    }),
    HandLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: HAND_MODEL,
        delegate: "GPU",
      },
      runningMode: "VIDEO",
      numHands: 2,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    }),
  ]);

  return { pose, face, hand };
}

async function recreateTrackers(): Promise<void> {
  setStatus("MediaPipeモデルを切り替え中");
  const previous = trackers;
  trackers = null;
  previous?.pose.close();
  previous?.face.close();
  previous?.hand.close();
  smoothedPoints.clear();
  lastVideoTime = -1;

  try {
    trackers = await createTrackers();
    setStatus(cameraStream ? "トラッキング中" : "MediaPipeモデルを切り替えました");
  } catch (error) {
    console.error(error);
    setStatus(error instanceof Error ? error.message : "MediaPipeモデルの切り替えに失敗しました");
  }
}

function renderLoop(): void {
  if (!trackers || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    animationId = requestAnimationFrame(renderLoop);
    return;
  }

  resizeCanvas();

  if (video.currentTime !== lastVideoTime) {
    const timestamp = performance.now();
    const pose = trackers.pose.detectForVideo(video, timestamp);
    const face = trackers.face.detectForVideo(video, timestamp);
    const hand = trackers.hand.detectForVideo(video, timestamp);

    lastVideoTime = video.currentTime;
    latestMotion = toMotionSnapshot(pose, face, hand, timestamp);
    window.dispatchEvent(new CustomEvent("mediapipe-motion", { detail: latestMotion }));
    vrmViewer?.applyMotion(latestMotion);
    updateMotionOutput(timestamp);
    sendMotionOverWebSocket(timestamp);
    drawResults(pose, face, hand);
    updateReadout(pose, face, hand);
    updateFps();
  }

  animationId = requestAnimationFrame(renderLoop);
}

async function loadVrmFile(file: File): Promise<void> {
  try {
    const viewer = await ensureVrmViewer();
    await viewer.loadFile(file);
  } finally {
    vrmFileInput.value = "";
  }
}

async function ensureVrmViewer(): Promise<VrmViewer> {
  if (vrmViewer) return vrmViewer;

  vrmState.textContent = "loading viewer";
  setStatus("VRMビューアを読み込み中");
  vrmViewerPromise ??= import("./vrm-viewer").then(({ createVrmViewer }) =>
    createVrmViewer({
      container: vrmContainer,
      strengthInput: avatarStrengthInput,
      stateElement: vrmState,
      setStatus,
    }),
  );
  vrmViewer = await vrmViewerPromise;
  vrmViewer.resize();
  return vrmViewer;
}

function drawResults(
  pose: PoseLandmarkerResult,
  face: FaceLandmarkerResult,
  hand: HandLandmarkerResult,
): void {
  clearStage();

  const scale = Number(scaleInput.value);
  const confidence = Number(confidenceInput.value);
  const poseLandmarks = bodyOutputInput.checked
    ? pose.landmarks[0]?.map((point, index) => smooth(`pose:${index}`, transform(point, scale)))
    : undefined;
  const faceLandmarks = faceOutputInput.checked
    ? face.faceLandmarks[0]?.map((point, index) =>
        smooth(`face:${index}`, transform(point, scale)),
      )
    : undefined;

  if (poseLandmarks) {
    drawConnections(poseLandmarks, POSE_CONNECTIONS, "#63e6be", 4, confidence);
    drawPoints(poseLandmarks, "#d6fff4", 4, confidence);
  }

  if (faceLandmarks) {
    drawConnections(faceLandmarks, FACE_CONNECTIONS, "#8cb6ff", 2, confidence);
    drawPoints(faceLandmarks.filter((_, index) => index % 7 === 0), "#e7efff", 2, 0);
  }

  if (handsOutputInput.checked) {
    hand.landmarks.forEach((landmarks, handIndex) => {
      const label = hand.handednesses[handIndex]?.[0]?.categoryName ?? `Hand ${handIndex + 1}`;
      const color = label === "Left" ? "#ffcc66" : "#ff8fb3";
      const points = landmarks.map((point, pointIndex) =>
        smooth(`hand:${handIndex}:${pointIndex}`, transform(point, scale)),
      );
      drawConnections(points, HAND_CONNECTIONS, color, 3, 0);
      drawPoints(points, "#fff7df", 4, 0);
    });
  }

  drawCenterGuide();
}

function drawConnections(
  points: Point[],
  connections: Array<[number, number]>,
  color: string,
  width: number,
  minVisibility: number,
): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (const [from, to] of connections) {
    const a = points[from];
    const b = points[to];
    if (!a || !b || !visible(a, minVisibility) || !visible(b, minVisibility)) continue;

    ctx.beginPath();
    ctx.moveTo(a.x * canvas.width, a.y * canvas.height);
    ctx.lineTo(b.x * canvas.width, b.y * canvas.height);
    ctx.stroke();
  }

  ctx.restore();
}

function drawPoints(points: Point[], color: string, radius: number, minVisibility: number): void {
  ctx.save();
  ctx.fillStyle = color;

  for (const point of points) {
    if (!visible(point, minVisibility)) continue;
    ctx.beginPath();
    ctx.arc(point.x * canvas.width, point.y * canvas.height, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function toMotionSnapshot(
  pose: PoseLandmarkerResult,
  face: FaceLandmarkerResult,
  hand: HandLandmarkerResult,
  timestamp: number,
): MotionSnapshot {
  const bodyEnabled = bodyOutputInput.checked;
  const faceEnabled = faceOutputInput.checked;
  const handsEnabled = handsOutputInput.checked;
  const poseLandmarks = pose.landmarks[0] ?? [];
  const faceLandmarks = face.faceLandmarks[0] ?? [];
  const worldLandmarks = pose.worldLandmarks[0] ?? [];
  const leftShoulder = poseLandmarks[11];
  const rightShoulder = poseLandmarks[12];
  const leftHip = poseLandmarks[23];
  const rightHip = poseLandmarks[24];
  const nose = faceLandmarks[1] ?? poseLandmarks[0];
  const leftEye = faceLandmarks[33] ?? poseLandmarks[2];
  const rightEye = faceLandmarks[263] ?? poseLandmarks[5];
  const chin = faceLandmarks[152];

  const head =
    faceEnabled && nose && leftEye && rightEye
      ? {
          x: mirrored(nose.x),
          y: nose.y,
          z: nose.z,
          yaw: clamp((distance2d(nose, leftEye) - distance2d(nose, rightEye)) * 4, -1, 1),
          pitch: chin ? clamp((chin.y - nose.y - 0.12) * 4, -1, 1) : 0,
          roll: clamp(Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x), -1, 1),
        }
      : null;

  const bones = bodyEnabled ? makeBonePoses(poseLandmarks, worldLandmarks, faceLandmarks) : {};
  const blendShapes = faceEnabled ? makeBlendShapes(face) : {};
  const torso =
    bodyEnabled && leftShoulder && rightShoulder && leftHip && rightHip
      ? {
          centerX: mirrored((leftShoulder.x + rightShoulder.x + leftHip.x + rightHip.x) / 4),
          centerY: (leftShoulder.y + rightShoulder.y + leftHip.y + rightHip.y) / 4,
          shoulderTilt: rightShoulder.y - leftShoulder.y,
          hipTilt: rightHip.y - leftHip.y,
        }
      : null;

  const hands = handsEnabled
    ? hand.landmarks.map((landmarks, index) => {
        const label = hand.handednesses[index]?.[0]?.categoryName ?? `Hand ${index + 1}`;
        const wrist = landmarks[0];
        const indexTip = landmarks[8];
        const thumbTip = landmarks[4];

        return {
          label,
          wrist: { x: mirrored(wrist.x), y: wrist.y, z: wrist.z },
          indexTip: { x: mirrored(indexTip.x), y: indexTip.y, z: indexTip.z },
          pinch: clamp(1 - distance2d(indexTip, thumbTip) / 0.12, 0, 1),
          fingers: makeFingerCurls(landmarks),
        };
      })
    : [];

  return { version: 1, head, torso, bones, blendShapes, hands, timestamp };
}

function makeBonePoses(
  poseLandmarks: NormalizedLandmark[],
  worldLandmarks: Landmark[],
  faceLandmarks: NormalizedLandmark[],
): Record<string, BonePose> {
  const bones: Record<string, BonePose> = {};
  const source = worldLandmarks.length ? worldLandmarks : poseLandmarks;
  const sourcePoint = (index: number): Point | undefined => toMotionPoint(source[index]);
  const screenPoint = (index: number): Point | undefined => toScreenPoint(poseLandmarks[index]);
  const facePoint = (index: number): Point | undefined => toScreenPoint(faceLandmarks[index]);

  addLimbBone(bones, "leftUpperArm", sourcePoint(11), sourcePoint(13), screenPoint(11));
  addLimbBone(bones, "leftLowerArm", sourcePoint(13), sourcePoint(15), screenPoint(13));
  addLimbBone(bones, "leftHand", sourcePoint(15), sourcePoint(19), screenPoint(15));
  addLimbBone(bones, "rightUpperArm", sourcePoint(12), sourcePoint(14), screenPoint(12));
  addLimbBone(bones, "rightLowerArm", sourcePoint(14), sourcePoint(16), screenPoint(14));
  addLimbBone(bones, "rightHand", sourcePoint(16), sourcePoint(20), screenPoint(16));
  addLimbBone(bones, "leftUpperLeg", sourcePoint(23), sourcePoint(25), screenPoint(23));
  addLimbBone(bones, "leftLowerLeg", sourcePoint(25), sourcePoint(27), screenPoint(25));
  addLimbBone(bones, "rightUpperLeg", sourcePoint(24), sourcePoint(26), screenPoint(24));
  addLimbBone(bones, "rightLowerLeg", sourcePoint(26), sourcePoint(28), screenPoint(26));

  const leftHip = screenPoint(23);
  const rightHip = screenPoint(24);
  const leftShoulder = screenPoint(11);
  const rightShoulder = screenPoint(12);
  const nose = facePoint(1) ?? screenPoint(0);
  const hipCenter = averagePoint(leftHip, rightHip);
  const shoulderCenter = averagePoint(leftShoulder, rightShoulder);

  if (leftHip && rightHip && hipCenter) {
    bones.hips = {
      position: hipCenter,
      rotation: {
        x: 0,
        y: 0,
        z: clamp(Math.atan2(rightHip.y - leftHip.y, rightHip.x - leftHip.x) / Math.PI, -1, 1),
      },
    };
  }

  if (hipCenter && shoulderCenter) {
    const spineRotation = vectorToEuler(hipCenter, shoulderCenter);
    bones.spine = { position: averagePoint(hipCenter, shoulderCenter), rotation: spineRotation };
    bones.chest = { position: shoulderCenter, rotation: spineRotation };
  }

  if (shoulderCenter && nose) {
    bones.neck = { position: shoulderCenter, rotation: vectorToEuler(shoulderCenter, nose) };
  }

  const leftEye = facePoint(33);
  const rightEye = facePoint(263);
  if (nose && leftEye && rightEye) {
    bones.head = {
      position: nose,
      rotation: {
        x: facePoint(152) ? clamp((facePoint(152)!.y - nose.y - 0.12) * 4, -1, 1) : 0,
        y: clamp((distance2d(nose, leftEye) - distance2d(nose, rightEye)) * 4, -1, 1),
        z: clamp(Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x), -1, 1),
      },
    };
  }

  return bones;
}

function makeBlendShapes(face: FaceLandmarkerResult): Record<string, number> {
  const raw: Record<string, number> = {};
  const categories = face.faceBlendshapes[0]?.categories ?? [];

  for (const category of categories) {
    raw[category.categoryName] = round(category.score);
  }

  return {
    ...raw,
    "vrm.aa": round(raw.jawOpen ?? 0),
    "vrm.ih": round(((raw.mouthSmileLeft ?? 0) + (raw.mouthSmileRight ?? 0)) / 2),
    "vrm.ou": round(Math.max(raw.mouthFunnel ?? 0, raw.mouthPucker ?? 0)),
    "vrm.ee": round(((raw.mouthStretchLeft ?? 0) + (raw.mouthStretchRight ?? 0)) / 2),
    "vrm.oh": round(Math.max(raw.mouthFunnel ?? 0, raw.jawOpen ?? 0) * 0.75),
    "vrm.blinkLeft": round(raw.eyeBlinkLeft ?? 0),
    "vrm.blinkRight": round(raw.eyeBlinkRight ?? 0),
    "vrm.happy": round(((raw.mouthSmileLeft ?? 0) + (raw.mouthSmileRight ?? 0)) / 2),
  };
}

function makeFingerCurls(landmarks: NormalizedLandmark[]): FingerCurl {
  return {
    thumb: fingerCurl(landmarks, 1, 2, 4),
    index: fingerCurl(landmarks, 5, 6, 8),
    middle: fingerCurl(landmarks, 9, 10, 12),
    ring: fingerCurl(landmarks, 13, 14, 16),
    pinky: fingerCurl(landmarks, 17, 18, 20),
  };
}

function addLimbBone(
  bones: Record<string, BonePose>,
  name: string,
  from: Point | undefined,
  to: Point | undefined,
  position: Point | undefined,
): void {
  if (!from || !to) return;
  bones[name] = {
    position,
    rotation: vectorToEuler(from, to),
  };
}

function calibrate(): void {
  const torso = latestMotion.torso;
  if (!torso) {
    setStatus("キャリブレーションには上半身の検出が必要です");
    return;
  }

  calibrationOffset = {
    x: 0.5 - torso.centerX,
    y: 0.5 - torso.centerY,
  };
  setStatus("ニュートラル姿勢を保存しました");
}

function resetCalibration(): void {
  calibrationOffset = { x: 0, y: 0 };
  smoothedPoints.clear();
  setStatus("キャリブレーションを解除しました");
}

function transform(point: Point, scale: number): Point {
  const centeredX = mirrored(point.x) - 0.5;
  const centeredY = point.y - 0.5;

  return {
    x: clamp(0.5 + centeredX * scale + calibrationOffset.x, 0, 1),
    y: clamp(0.5 + centeredY * scale + calibrationOffset.y, 0, 1),
    z: point.z,
    visibility: point.visibility,
  };
}

function smooth(key: string, point: Point): Point {
  const smoothing = Number(smoothingInput.value);
  const previous = smoothedPoints.get(key);

  if (!previous) {
    smoothedPoints.set(key, point);
    return point;
  }

  const next = {
    x: previous.x * smoothing + point.x * (1 - smoothing),
    y: previous.y * smoothing + point.y * (1 - smoothing),
    z: previous.z * smoothing + point.z * (1 - smoothing),
    visibility: point.visibility,
  };

  smoothedPoints.set(key, next);
  return next;
}

function updateReadout(
  pose: PoseLandmarkerResult,
  face: FaceLandmarkerResult,
  hand: HandLandmarkerResult,
): void {
  poseState.textContent = bodyOutputInput.checked ? (pose.landmarks.length ? "OK" : "-") : "OFF";
  faceState.textContent = faceOutputInput.checked ? (face.faceLandmarks.length ? "OK" : "-") : "OFF";
  handState.textContent = handsOutputInput.checked ? String(hand.landmarks.length) : "OFF";
  frameState.textContent = String(recordedFrames.length);
}

function updateMotionOutput(timestamp: number): void {
  if (isRecording) {
    recordedFrames.push(latestMotion);
  }

  if (timestamp - lastOutputAt < 120) return;
  lastOutputAt = timestamp;
  motionOutput.textContent = JSON.stringify(latestMotion, null, 2);
  recordState.textContent = isRecording ? "recording" : "live";
}

function toggleRecording(): void {
  isRecording = !isRecording;
  recordButton.textContent = isRecording ? "記録停止" : "記録開始";
  recordState.textContent = isRecording ? "recording" : "idle";

  if (isRecording) {
    recordedFrames = [];
    frameState.textContent = "0";
  }
}

async function copyLatestMotion(): Promise<void> {
  const text = JSON.stringify(latestMotion, null, 2);
  await navigator.clipboard.writeText(text);
  setStatus("最新モーションJSONをコピーしました");
}

function toggleWebSocket(): void {
  if (motionSocket) {
    closeWebSocket("切断しました");
    return;
  }

  const url = wsUrlInput.value.trim();
  if (!url) {
    setStatus("WebSocket送信先URLを入力してください");
    return;
  }

  if (!url.startsWith("ws://") && !url.startsWith("wss://")) {
    setStatus("WebSocket URLはws://またはwss://で始めてください");
    return;
  }

  try {
    const socket = new WebSocket(url);
    motionSocket = socket;
    wsState.textContent = "OPENING";
    wsButton.textContent = "切断";

    socket.addEventListener("open", () => {
      wsState.textContent = "ON";
      bridgeState.textContent = "waiting";
      setStatus("WebSocket送信を開始しました");
      socket.send(
        JSON.stringify({
          type: "hello",
          app: "mediapipe-webcam-motion-capture",
          schema: "mediapipe-motion.v1",
          sentAt: performance.now(),
        }),
      );
    });

    socket.addEventListener("message", (event) => {
      handleWebSocketMessage(event.data);
    });

    socket.addEventListener("close", () => {
      if (motionSocket === socket) {
        closeWebSocket("WebSocketが切断されました");
      }
    });

    socket.addEventListener("error", () => {
      if (motionSocket === socket) {
        closeWebSocket("WebSocket接続エラー");
      }
    });
  } catch (error) {
    closeWebSocket(error instanceof Error ? error.message : "WebSocket接続に失敗しました");
  }
}

function sendMotionOverWebSocket(timestamp: number): void {
  if (!motionSocket || motionSocket.readyState !== WebSocket.OPEN) return;
  const interval = 1000 / clamp(Number(wsFpsInput.value), 5, 60);
  if (timestamp - lastWsSentAt < interval) return;

  lastWsSentAt = timestamp;
  motionSocket.send(
    JSON.stringify({
      type: "motion",
      schema: "mediapipe-motion.v1",
      motion: latestMotion,
    }),
  );
}

function closeWebSocket(message: string): void {
  const socket = motionSocket;
  motionSocket = null;

  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.close();
  }

  wsState.textContent = "OFF";
  bridgeState.textContent = "-";
  wsButton.textContent = "接続";
  setStatus(message);
}

function handleWebSocketMessage(data: unknown): void {
  if (typeof data !== "string") return;

  try {
    const packet = JSON.parse(data);
    if (packet?.type === "bridge-status") {
      bridgeState.textContent = `${packet.oscHost ?? "osc"}:${packet.oscPort ?? "-"}`;
      setStatus("VMCブリッジに接続しました");
    } else if (packet?.type === "bridge-stats") {
      bridgeState.textContent = `${packet.frames ?? 0}f`;
    }
  } catch {
    // Ignore non-JSON messages from custom receivers.
  }
}

function downloadRecording(): void {
  const payload = {
    app: "mediapipe-webcam-motion-capture",
    createdAt: new Date().toISOString(),
    frames: recordedFrames.length ? recordedFrames : [latestMotion],
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `mediapipe-motion-${Date.now()}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function updateFps(): void {
  fpsFrames += 1;
  const now = performance.now();
  const elapsed = now - fpsStartedAt;

  if (elapsed >= 500) {
    fpsText.textContent = String(Math.round((fpsFrames / elapsed) * 1000));
    fpsFrames = 0;
    fpsStartedAt = now;
  }
}

function resizeCanvas(): void {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width * window.devicePixelRatio));
  const height = Math.max(1, Math.round(rect.height * window.devicePixelRatio));

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
}

function clearStage(): void {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.fillStyle = "rgba(4, 9, 9, 0.38)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
}

function drawCenterGuide(): void {
  ctx.save();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.13)";
  ctx.lineWidth = 1;
  ctx.setLineDash([8, 16]);
  ctx.beginPath();
  ctx.moveTo(canvas.width / 2, 0);
  ctx.lineTo(canvas.width / 2, canvas.height);
  ctx.moveTo(0, canvas.height / 2);
  ctx.lineTo(canvas.width, canvas.height / 2);
  ctx.stroke();
  ctx.restore();
}

function drawIdle(): void {
  clearStage();
  drawCenterGuide();
  ctx.save();
  ctx.fillStyle = "rgba(233, 242, 239, 0.76)";
  ctx.font = `${Math.round(15 * window.devicePixelRatio)}px sans-serif`;
  ctx.textAlign = "center";
  ctx.fillText("Ready", canvas.width / 2, canvas.height / 2 - 18);
  ctx.restore();
}

function setStatus(message: string): void {
  statusText.textContent = message;
}

function chain(points: number[]): Array<[number, number]> {
  return points.slice(1).map((point, index) => [points[index], point]);
}

function element<T extends HTMLElement = HTMLElement>(id: string): T {
  const found = document.getElementById(id);

  if (!found) {
    throw new Error(`Missing #${id}`);
  }

  return found as T;
}

function visible(point: Point, minVisibility: number): boolean {
  return point.visibility === undefined || point.visibility >= minVisibility;
}

function toScreenPoint(point: Point | undefined): Point | undefined {
  if (!point) return undefined;
  return {
    x: mirrored(point.x),
    y: point.y,
    z: point.z,
    visibility: point.visibility,
  };
}

function toMotionPoint(point: Point | undefined): Point | undefined {
  if (!point) return undefined;
  return {
    x: -point.x,
    y: point.y,
    z: point.z,
    visibility: point.visibility,
  };
}

function averagePoint(a: Point | undefined, b: Point | undefined): Point | undefined {
  if (!a || !b) return undefined;
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    z: (a.z + b.z) / 2,
    visibility:
      a.visibility === undefined || b.visibility === undefined
        ? undefined
        : Math.min(a.visibility, b.visibility),
  };
}

function vectorToEuler(a: Point, b: Point): Euler {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const horizontal = Math.hypot(dx, dz);

  return {
    x: round(clamp(Math.atan2(-dy, horizontal) / (Math.PI / 2), -1, 1)),
    y: round(clamp(Math.atan2(dx, Math.hypot(dy, dz)) / (Math.PI / 2), -1, 1)),
    z: round(clamp(Math.atan2(dy, dx) / Math.PI, -1, 1)),
  };
}

function fingerCurl(
  landmarks: NormalizedLandmark[],
  rootIndex: number,
  middleIndex: number,
  tipIndex: number,
): number {
  const root = landmarks[rootIndex];
  const middle = landmarks[middleIndex];
  const tip = landmarks[tipIndex];
  if (!root || !middle || !tip) return 0;

  const bend = angle(root, middle, tip);
  return round(clamp(1 - bend / Math.PI, 0, 1));
}

function angle(a: Point, b: Point, c: Point): number {
  const ab = { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
  const cb = { x: c.x - b.x, y: c.y - b.y, z: c.z - b.z };
  const dot = ab.x * cb.x + ab.y * cb.y + ab.z * cb.z;
  const mag = Math.hypot(ab.x, ab.y, ab.z) * Math.hypot(cb.x, cb.y, cb.z);

  if (mag === 0) return Math.PI;
  return Math.acos(clamp(dot / mag, -1, 1));
}

function mirrored(x: number): number {
  return mirrorInput.checked ? 1 - x : x;
}

function distance2d(a: Pick<Landmark, "x" | "y">, b: Pick<Landmark, "x" | "y">): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
