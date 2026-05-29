# MediaPipe Webcam Motion Capture

WebcamMotionCapture-like browser motion capture using only MediaPipe for tracking.

## Live App

https://mediapipe-webcam-motion-capture.maigo999.workers.dev

## Features

- Hidden camera feed
- Wireframe-only preview
- Camera device selection and mirror toggle
- Persistent settings, calibration reset, and WebSocket send-FPS control
- Body, face, and hands output toggles
- Pose quality selection: Lite, Full, Heavy
- MediaPipe Pose, Face, and Hand tracking
- Avatar-oriented JSON output
- Local VRM model preview in the browser
- Face blendshapes and simple VRM expression aliases
- Hand pinch and finger curl values
- Recording, copy, and JSON download
- Optional WebSocket streaming to a local bridge or another receiver
- Local WebSocket-to-VMC Protocol OSC bridge
- Bridge status and OSC target feedback in the web UI

## WebSocket Output

Enter a `ws://` or `wss://` URL in the WebSocket field and click `接続`.
The app sends a hello packet first, then motion packets at about 30fps.
When connected to the included VMC bridge, the bridge also sends `bridge-status` and `bridge-stats` packets back to the web UI so the `Bridge` readout can show the OSC target and transmitted frame count.

Hello packet:

```json
{
  "type": "hello",
  "app": "mediapipe-webcam-motion-capture",
  "schema": "mediapipe-motion.v1",
  "sentAt": 12345
}
```

Motion packet:

```json
{
  "type": "motion",
  "schema": "mediapipe-motion.v1",
  "motion": {
    "version": 1,
    "head": {},
    "torso": {},
    "bones": {},
    "blendShapes": {},
    "hands": [],
    "timestamp": 12345
  }
}
```

Bridge status packet:

```json
{
  "type": "bridge-status",
  "schema": "mediapipe-motion.bridge.v1",
  "oscHost": "127.0.0.1",
  "oscPort": 39539
}
```

Minimal Node receiver:

```bash
npm install ws
```

```js
import { WebSocketServer } from "ws";

const server = new WebSocketServer({ port: 8787 });

server.on("connection", (socket) => {
  socket.on("message", (data) => {
    const packet = JSON.parse(String(data));
    if (packet.type === "motion") {
      console.log(packet.motion.head, packet.motion.hands);
    }
  });
});
```

Use `ws://127.0.0.1:8787` as the app's WebSocket destination.

## VRM Preview

Use the `VRMモデル` file input to load a local `.vrm` file in the browser.
The model is not uploaded anywhere; it is read with the browser `File` API and animated locally.

The preview applies:

- Body, neck, and head bone rotation
- Arm and leg bone rotation
- Synthesized finger curl poses
- VRM expression presets: `aa`, `ih`, `ou`, `ee`, `oh`, `blinkLeft`, `blinkRight`, `happy`

Use `モーション強度` to reduce or exaggerate body and finger motion.

## Camera Settings

Use `カメラ` to select a specific camera after browser permission is granted.
Use `左右反転` to switch between selfie-style mirrored tracking and raw camera coordinates.
Use `Body出力`, `Face出力`, and `Hands出力` to disable unstable tracking parts from the wire preview, Motion JSON, VRM preview, and WebSocket output.
Use `Pose品質` to switch between `Lite`, `Full`, and `Heavy`; Lite is lighter, Heavy is more accurate but slower.
The app stores camera, mirror, output toggles, pose quality, smoothing, scale, WebSocket URL, send FPS, and avatar strength settings in `localStorage`.
Use `補正解除` to clear neutral-pose calibration.

## VMC Protocol OSC Bridge

The browser app cannot send UDP/OSC directly, so this repo includes a local bridge:

```bash
npm run build
npm run bridge
```

Default routing:

- Local web app -> `http://127.0.0.1:8787`
- WebSocket -> `ws://127.0.0.1:8787`
- Bridge -> VMC Protocol OSC receiver at `127.0.0.1:39539`

Open `http://127.0.0.1:8787`, enter `ws://127.0.0.1:8787` in `WebSocket送信先`, and click `接続`.
Then start camera tracking.

You can also use the Cloudflare-hosted live app with the same WebSocket URL, but the local app URL is useful when a browser blocks mixed secure/insecure WebSocket connections.

Custom ports:

```bash
npm run bridge -- --ws-port 8787 --osc-host 127.0.0.1 --osc-port 39539
```

Useful options:

```bash
npm run bridge -- --no-fingers
npm run bridge -- --swap-hands
npm run bridge -- --no-blend-shapes
```

The bridge sends:

- `/VMC/Ext/Root/Pos`
- `/VMC/Ext/Bone/Pos`
- `/VMC/Ext/Blend/Val`
- `/VMC/Ext/Blend/Apply`
- `/VMC/Ext/OK`

Bone names follow Unity `HumanBodyBones` names, such as `Hips`, `Spine`, `Head`, `LeftUpperArm`, `RightLowerLeg`, `LeftIndexProximal`, and `RightLittleDistal`.
Finger bones are synthesized from MediaPipe hand curl values, so they are approximate but compatible with VMC receivers that listen to finger `HumanBodyBones`.
BlendShape aliases are mapped to VRM-style names such as `A`, `I`, `U`, `E`, `O`, `Blink_L`, `Blink_R`, and `Joy`.

## Deploy

```bash
npm install
npm run deploy
```
