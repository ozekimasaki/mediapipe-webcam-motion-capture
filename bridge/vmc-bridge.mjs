import dgram from "node:dgram";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

const config = {
  wsPort: numberArg("--ws-port", "WS_PORT", 8787),
  oscHost: stringArg("--osc-host", "OSC_HOST", "127.0.0.1"),
  oscPort: numberArg("--osc-port", "OSC_PORT", 39539),
  localAddress: stringArg("--local-address", "OSC_LOCAL_ADDRESS", "0.0.0.0"),
  localPort: numberArg("--local-port", "OSC_LOCAL_PORT", 0),
  sendBones: boolArg("--bones", "SEND_BONES", true),
  sendFingers: boolArg("--fingers", "SEND_FINGERS", true),
  sendBlendShapes: boolArg("--blend-shapes", "SEND_BLEND_SHAPES", true),
  sendRoot: boolArg("--root", "SEND_ROOT", true),
  swapHands: boolArg("--swap-hands", "SWAP_HANDS", false),
};

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distRoot = path.join(projectRoot, "dist");

const boneNameMap = {
  hips: "Hips",
  spine: "Spine",
  chest: "Chest",
  neck: "Neck",
  head: "Head",
  leftUpperArm: "LeftUpperArm",
  leftLowerArm: "LeftLowerArm",
  leftHand: "LeftHand",
  rightUpperArm: "RightUpperArm",
  rightLowerArm: "RightLowerArm",
  rightHand: "RightHand",
  leftUpperLeg: "LeftUpperLeg",
  leftLowerLeg: "LeftLowerLeg",
  rightUpperLeg: "RightUpperLeg",
  rightLowerLeg: "RightLowerLeg",
};

const blendShapeMap = {
  "vrm.aa": "A",
  "vrm.ih": "I",
  "vrm.ou": "U",
  "vrm.ee": "E",
  "vrm.oh": "O",
  "vrm.blinkLeft": "Blink_L",
  "vrm.blinkRight": "Blink_R",
  "vrm.happy": "Joy",
};

const fingerNameMap = {
  thumb: "Thumb",
  index: "Index",
  middle: "Middle",
  ring: "Ring",
  pinky: "Little",
};

const fingerSegments = ["Proximal", "Intermediate", "Distal"];

const udp = dgram.createSocket("udp4");

let frameCount = 0;
let connectionCount = 0;
let lastLogAt = Date.now();
let lastStatsSentAt = 0;

udp.on("listening", () => {
  console.log(
    `OSC ready: ${config.localAddress}:${config.localPort} -> ${config.oscHost}:${config.oscPort}`,
  );
});

udp.on("error", (error) => {
  console.error("OSC error:", error.message);
});

udp.bind(config.localPort, config.localAddress);

const server = createServer((request, response) => {
  void serveStaticApp(request, response);
});
const wss = new WebSocketServer({ server });

server.listen(config.wsPort, "127.0.0.1", () => {
  console.log(`Local app listening: http://127.0.0.1:${config.wsPort}`);
  console.log(`WebSocket listening: ws://127.0.0.1:${config.wsPort}`);
  console.log("Open the local app URL, set the WebSocket field to the same ws:// URL, then click 接続.");
});

wss.on("connection", (socket, request) => {
  connectionCount += 1;
  console.log(`Web client connected: ${request.socket.remoteAddress ?? "unknown"}`);
  sendBridgeStatus(socket);

  socket.on("message", (data) => {
    let packet;

    try {
      packet = JSON.parse(String(data));
    } catch {
      console.warn("Ignored invalid JSON packet.");
      return;
    }

    if (packet?.type !== "motion" || packet?.schema !== "mediapipe-motion.v1") {
      return;
    }

    sendVmcFrame(packet.motion);
  });

  socket.on("close", () => {
    connectionCount = Math.max(0, connectionCount - 1);
    console.log("Web client disconnected.");
  });
});

wss.on("error", (error) => {
  console.error("WebSocket server error:", error.message);
});

async function serveStaticApp(request, response) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { "content-type": "text/plain; charset=utf-8" });
    response.end("Method Not Allowed");
    return;
  }

  const host = request.headers.host || `127.0.0.1:${config.wsPort}`;
  const url = new URL(request.url || "/", `http://${host}`);
  const pathname = decodeURIComponent(url.pathname);
  const filePath = await resolveStaticFile(pathname);

  if (!filePath) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Build output not found. Run `npm run build` before `npm run bridge`.");
    return;
  }

  const headers = {
    "content-type": mimeType(filePath),
    "cache-control": filePath.includes(`${path.sep}assets${path.sep}`)
      ? "public, max-age=31536000, immutable"
      : "no-cache",
  };

  response.writeHead(200, headers);

  if (request.method === "HEAD") {
    response.end();
    return;
  }

  createReadStream(filePath).pipe(response);
}

async function resolveStaticFile(pathname) {
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const candidate = path.resolve(distRoot, `.${requestedPath}`);

  if (!candidate.startsWith(distRoot + path.sep) && candidate !== distRoot) {
    return null;
  }

  if (await isFile(candidate)) {
    return candidate;
  }

  const indexPath = path.join(distRoot, "index.html");
  return (await isFile(indexPath)) ? indexPath : null;
}

async function isFile(filePath) {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

function mimeType(filePath) {
  const extension = path.extname(filePath).toLowerCase();

  return (
    {
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".wasm": "application/wasm",
      ".svg": "image/svg+xml",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".webp": "image/webp",
      ".ico": "image/x-icon",
    }[extension] || "application/octet-stream"
  );
}

function sendVmcFrame(motion) {
  if (!motion || typeof motion !== "object") return;

  frameCount += 1;

  if (config.sendRoot) {
    sendRoot(motion);
  }

  if (config.sendBones) {
    sendBones(motion.bones ?? {});
  }

  if (config.sendFingers) {
    sendFingers(motion.hands ?? {});
  }

  if (config.sendBlendShapes) {
    sendBlendShapes(motion.blendShapes ?? {});
  }

  sendStatus();
  sendBridgeStats();
  logStats();
}

function sendBridgeStatus(socket) {
  safeSend(socket, {
    type: "bridge-status",
    schema: "mediapipe-motion.bridge.v1",
    oscHost: config.oscHost,
    oscPort: config.oscPort,
    sendRoot: config.sendRoot,
    sendBones: config.sendBones,
    sendFingers: config.sendFingers,
    sendBlendShapes: config.sendBlendShapes,
    swapHands: config.swapHands,
  });
}

function sendBridgeStats() {
  const now = Date.now();
  if (now - lastStatsSentAt < 1000) return;

  lastStatsSentAt = now;
  broadcast({
    type: "bridge-stats",
    schema: "mediapipe-motion.bridge.v1",
    frames: frameCount,
    clients: connectionCount,
    oscHost: config.oscHost,
    oscPort: config.oscPort,
    sentAt: now,
  });
}

function sendRoot(motion) {
  const hips = motion.bones?.hips;
  const position = hips?.position ?? motion.torso;
  const rotation = hips?.rotation ?? { x: 0, y: 0, z: 0 };
  const quaternion = normalizedEulerToQuaternion(rotation);

  sendOsc("/VMC/Ext/Root/Pos", [
    stringArgValue("root"),
    floatArg(position?.x ? position.x - 0.5 : 0),
    floatArg(position?.y ? 1 - position.y : 0),
    floatArg(position?.z ?? 0),
    floatArg(quaternion.x),
    floatArg(quaternion.y),
    floatArg(quaternion.z),
    floatArg(quaternion.w),
  ]);
}

function sendBones(bones) {
  for (const [sourceName, vmcName] of Object.entries(boneNameMap)) {
    const bone = bones[sourceName];
    if (!bone) continue;

    const quaternion = normalizedEulerToQuaternion(bone.rotation ?? { x: 0, y: 0, z: 0 });
    const position = bone.position ?? { x: 0, y: 0, z: 0 };

    sendOsc("/VMC/Ext/Bone/Pos", [
      stringArgValue(vmcName),
      floatArg((position.x ?? 0.5) - 0.5),
      floatArg(1 - (position.y ?? 0.5)),
      floatArg(position.z ?? 0),
      floatArg(quaternion.x),
      floatArg(quaternion.y),
      floatArg(quaternion.z),
      floatArg(quaternion.w),
    ]);
  }
}

function sendBlendShapes(blendShapes) {
  let sent = 0;

  for (const [sourceName, vmcName] of Object.entries(blendShapeMap)) {
    const value = blendShapes[sourceName];
    if (typeof value !== "number") continue;

    sendOsc("/VMC/Ext/Blend/Val", [stringArgValue(vmcName), floatArg(clamp(value, 0, 1))]);
    sent += 1;
  }

  if (sent > 0) {
    sendOsc("/VMC/Ext/Blend/Apply", []);
  }
}

function sendFingers(hands) {
  if (!Array.isArray(hands)) return;

  for (const hand of hands) {
    const side = vmcHandSide(hand?.label);
    if (!side || !hand?.fingers) continue;

    for (const [sourceName, vmcFingerName] of Object.entries(fingerNameMap)) {
      const curl = clamp(Number(hand.fingers[sourceName] ?? 0), 0, 1);
      const spread = sourceName === "thumb" ? sideSign(side) * 0.22 : 0;

      fingerSegments.forEach((segment, index) => {
        const segmentCurl = curl * [0.75, 1, 0.8][index];
        const rotation = {
          x: -segmentCurl,
          y: sourceName === "thumb" ? spread : 0,
          z: 0,
        };
        const quaternion = normalizedEulerToQuaternion(rotation);

        sendOsc("/VMC/Ext/Bone/Pos", [
          stringArgValue(`${side}${vmcFingerName}${segment}`),
          floatArg(0),
          floatArg(0),
          floatArg(0),
          floatArg(quaternion.x),
          floatArg(quaternion.y),
          floatArg(quaternion.z),
          floatArg(quaternion.w),
        ]);
      });
    }
  }
}

function sendStatus() {
  sendOsc("/VMC/Ext/OK", [intArg(1)]);
}

function normalizedEulerToQuaternion(rotation) {
  const x = clamp(rotation?.x ?? 0, -1, 1) * (Math.PI / 2);
  const y = clamp(rotation?.y ?? 0, -1, 1) * (Math.PI / 2);
  const z = clamp(rotation?.z ?? 0, -1, 1) * Math.PI;

  const cx = Math.cos(x / 2);
  const sx = Math.sin(x / 2);
  const cy = Math.cos(y / 2);
  const sy = Math.sin(y / 2);
  const cz = Math.cos(z / 2);
  const sz = Math.sin(z / 2);

  return {
    x: sx * cy * cz - cx * sy * sz,
    y: cx * sy * cz + sx * cy * sz,
    z: cx * cy * sz - sx * sy * cz,
    w: cx * cy * cz + sx * sy * sz,
  };
}

function logStats() {
  const now = Date.now();
  if (now - lastLogAt < 3000) return;

  console.log(`frames=${frameCount} clients=${connectionCount}`);
  lastLogAt = now;
}

function broadcast(packet) {
  for (const client of wss.clients) {
    safeSend(client, packet);
  }
}

function safeSend(socket, packet) {
  if (socket.readyState !== 1) return;
  socket.send(JSON.stringify(packet));
}

function stringArgValue(value) {
  return { tag: "s", value };
}

function floatArg(value) {
  return { tag: "f", value: Number.isFinite(value) ? value : 0 };
}

function intArg(value) {
  return { tag: "i", value };
}

function vmcHandSide(label) {
  if (typeof label !== "string") return null;
  const normalized = label.toLowerCase();
  const side = normalized.includes("left") ? "Left" : normalized.includes("right") ? "Right" : null;

  if (!config.swapHands) return side;
  if (side === "Left") return "Right";
  if (side === "Right") return "Left";
  return null;
}

function sideSign(side) {
  return side === "Left" ? 1 : -1;
}

function sendOsc(address, args) {
  const message = encodeOscMessage(address, args);
  udp.send(message, config.oscPort, config.oscHost);
}

function encodeOscMessage(address, args) {
  const tags = `,${args.map((arg) => arg.tag).join("")}`;
  const parts = [encodeOscString(address), encodeOscString(tags)];

  for (const arg of args) {
    if (arg.tag === "s") {
      parts.push(encodeOscString(String(arg.value)));
    } else if (arg.tag === "f") {
      const buffer = Buffer.alloc(4);
      buffer.writeFloatBE(Number(arg.value), 0);
      parts.push(buffer);
    } else if (arg.tag === "i") {
      const buffer = Buffer.alloc(4);
      buffer.writeInt32BE(Number(arg.value), 0);
      parts.push(buffer);
    }
  }

  return Buffer.concat(parts);
}

function encodeOscString(value) {
  const raw = Buffer.from(`${value}\0`, "utf8");
  const paddedLength = Math.ceil(raw.length / 4) * 4;
  const padded = Buffer.alloc(paddedLength);
  raw.copy(padded);
  return padded;
}

function stringArg(flag, envName, fallback) {
  const index = process.argv.indexOf(flag);
  if (index >= 0 && process.argv[index + 1]) {
    return process.argv[index + 1];
  }

  return process.env[envName] || fallback;
}

function numberArg(flag, envName, fallback) {
  const raw = stringArg(flag, envName, String(fallback));
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function boolArg(flag, envName, fallback) {
  if (process.argv.includes(flag)) return true;
  if (process.argv.includes(`--no-${flag.slice(2)}`)) return false;

  const raw = process.env[envName];
  if (!raw) return fallback;

  return !["0", "false", "no", "off"].includes(raw.toLowerCase());
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
