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

## Tech Stack

- [Vite](https://vitejs.dev/) 6 with TypeScript for the browser app
- [@mediapipe/tasks-vision](https://www.npmjs.com/package/@mediapipe/tasks-vision) for pose, face, and hand tracking
- [three](https://threejs.org/) and [@pixiv/three-vrm](https://github.com/pixiv/three-vrm) for the local VRM preview
- [ws](https://github.com/websockets/ws) and Node.js `dgram` for the WebSocket-to-VMC OSC bridge
- [Wrangler](https://developers.cloudflare.com/workers/wrangler/) for Cloudflare deployment (static assets served as a single-page app)

## Requirements

- Node.js 20 or newer and npm (required by Vite 6 and Wrangler 4)
- A modern browser with WebGL support and a webcam
- Camera access requires a secure context, so run the app over `https://` or on `localhost` / `127.0.0.1`
- Network access at runtime: MediaPipe WASM and `.task` models are loaded from `cdn.jsdelivr.net` and `storage.googleapis.com`

## Getting Started

```bash
npm install
npm run dev
```

The dev server runs at `http://127.0.0.1:5173`. Open it in a browser and click `カメラ開始` to grant camera permission and begin tracking.

To create a production build in `dist/`:

```bash
npm run build
```

Preview the production build locally:

```bash
npm run preview
```

## Development Commands

| Command | Description |
| --- | --- |
| `npm run dev` | Start the Vite dev server on `127.0.0.1:5173`. |
| `npm run build` | Type-check with `tsc` (`noEmit`) and build the app into `dist/`. |
| `npm run preview` | Serve the production build locally with Vite. |
| `npm run bridge` | Run the local WebSocket-to-VMC OSC bridge (also serves `dist/` over HTTP). |
| `npm run verify` | Build, then run the bridge verification script. |
| `npm run verify:bridge` | Run only the bridge verification (requires an existing `dist/`). |
| `npm run deploy` | Build and deploy to Cloudflare with Wrangler. |

There is no separate lint or test command; `npm run build` runs `tsc` as the type-check step, and `npm run verify` exercises the bridge end to end.

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

## Verification

Run the build and local bridge verification:

```bash
npm run verify
```

This starts a temporary local bridge, serves the built app from the bridge HTTP server, sends a sample motion packet over WebSocket, and verifies that VMC-style OSC packets are emitted for root, body bones, synthesized finger bones, blendshapes, and status.

## Bridge Options

The bridge reads options from CLI flags (highest priority) or environment variables:

| Flag | Env | Default | Description |
| --- | --- | --- | --- |
| `--ws-port` | `WS_PORT` | `8787` | HTTP/WebSocket port for the local app and motion stream. |
| `--osc-host` | `OSC_HOST` | `127.0.0.1` | Destination host for VMC OSC packets. |
| `--osc-port` | `OSC_PORT` | `39539` | Destination UDP port for VMC OSC packets. |
| `--local-address` | `OSC_LOCAL_ADDRESS` | `0.0.0.0` | Local address to bind the UDP socket. |
| `--local-port` | `OSC_LOCAL_PORT` | `0` | Local UDP port (`0` picks an ephemeral port). |
| `--root` / `--no-root` | `SEND_ROOT` | on | Send `/VMC/Ext/Root/Pos`. |
| `--bones` / `--no-bones` | `SEND_BONES` | on | Send body bone `/VMC/Ext/Bone/Pos`. |
| `--fingers` / `--no-fingers` | `SEND_FINGERS` | on | Send synthesized finger bones. |
| `--blend-shapes` / `--no-blend-shapes` | `SEND_BLEND_SHAPES` | on | Send blendshape values. |
| `--swap-hands` | `SWAP_HANDS` | off | Swap left/right hand mapping. |

## Project Structure

```
.
├── index.html                 # App shell and UI controls
├── src/
│   ├── main.ts                # Entrypoint: camera, MediaPipe trackers, wire preview, WebSocket output
│   ├── vrm-viewer.ts          # three / three-vrm preview and motion-to-bone rigging
│   ├── motion-types.ts        # Shared MotionSnapshot / bone / blendshape types
│   └── style.css              # UI styles
├── bridge/
│   ├── vmc-bridge.mjs         # WebSocket-to-VMC OSC bridge + static file server
│   └── verify-vmc-bridge.mjs  # End-to-end verification script for the bridge
├── vite.config.ts             # Vite config (dev server on 127.0.0.1:5173)
├── tsconfig.json              # TypeScript config (strict, noEmit type-check)
└── wrangler.jsonc             # Cloudflare deployment config (dist/ as SPA)
```

## Deploy

```bash
npm install
npm run deploy
```

Deployment uses Wrangler and requires Cloudflare authentication (for example `npx wrangler login`).

## License

No license file is currently included in this repository, so all rights are reserved by default. Add a `LICENSE` file to define reuse terms.
