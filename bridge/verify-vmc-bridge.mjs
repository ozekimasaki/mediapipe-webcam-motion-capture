import { spawn } from "node:child_process";
import dgram from "node:dgram";
import http from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { WebSocket } from "ws";

const wsPort = randomPort();
const oscPort = randomPort();
const oscMessages = [];
const wsMessages = [];

const udp = dgram.createSocket("udp4");
let bridge;

try {
  await bindUdp();
  bridge = spawn(process.execPath, [
    "bridge/vmc-bridge.mjs",
    "--ws-port",
    String(wsPort),
    "--osc-host",
    "127.0.0.1",
    "--osc-port",
    String(oscPort),
  ], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
  });

  let bridgeLog = "";
  bridge.stdout.on("data", (chunk) => {
    bridgeLog += String(chunk);
  });
  bridge.stderr.on("data", (chunk) => {
    bridgeLog += String(chunk);
  });

  await waitForHttp();
  await sendMotionFrame();
  await delay(350);

  assert(wsMessages.some((packet) => packet.type === "bridge-status"), "missing bridge-status");
  assert(wsMessages.some((packet) => packet.type === "bridge-stats"), "missing bridge-stats");
  assert(hasAddress("/VMC/Ext/Root/Pos"), "missing root OSC packet");
  assert(hasAddress("/VMC/Ext/Bone/Pos"), "missing bone OSC packet");
  assert(hasStringArg("/VMC/Ext/Bone/Pos", "Hips"), "missing Hips bone packet");
  assert(hasStringArg("/VMC/Ext/Bone/Pos", "LeftIndexProximal"), "missing finger bone packet");
  assert(hasStringArg("/VMC/Ext/Blend/Val", "A"), "missing A blendshape packet");
  assert(hasAddress("/VMC/Ext/Blend/Apply"), "missing blendshape apply packet");
  assert(hasAddress("/VMC/Ext/OK"), "missing status OSC packet");

  console.log(`Verified ${oscMessages.length} OSC packets through ws://127.0.0.1:${wsPort}`);
} finally {
  udp.close();
  if (bridge && !bridge.killed) {
    bridge.kill();
  }
}

function bindUdp() {
  return new Promise((resolve, reject) => {
    udp.once("error", reject);
    udp.on("message", (message) => {
      oscMessages.push(decodeOscMessage(message));
    });
    udp.bind(oscPort, "127.0.0.1", () => {
      udp.off("error", reject);
      resolve();
    });
  });
}

async function waitForHttp() {
  const deadline = Date.now() + 5000;

  while (Date.now() < deadline) {
    try {
      const response = await httpGet(`http://127.0.0.1:${wsPort}/`);
      if (response.statusCode === 200 && response.body.includes("MediaPipe Motion Capture")) {
        return;
      }
    } catch {
      // The bridge may still be starting.
    }

    await delay(120);
  }

  throw new Error("local bridge app did not become ready");
}

function sendMotionFrame() {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${wsPort}`);
    const done = once(resolve, reject);

    socket.on("message", (data) => {
      wsMessages.push(JSON.parse(String(data)));
    });
    socket.on("open", () => {
      socket.send(JSON.stringify({
        type: "motion",
        schema: "mediapipe-motion.v1",
        motion: sampleMotion(),
      }));

      setTimeout(() => {
        socket.close();
        done.resolve();
      }, 1150);
    });
    socket.on("error", done.reject);
  });
}

function sampleMotion() {
  return {
    version: 1,
    head: null,
    torso: {
      centerX: 0.5,
      centerY: 0.42,
      shoulderTilt: 0,
      hipTilt: 0,
    },
    bones: {
      hips: {
        position: { x: 0.5, y: 0.62, z: 0 },
        rotation: { x: 0.05, y: 0, z: 0 },
      },
      leftUpperArm: {
        position: { x: 0.36, y: 0.35, z: 0 },
        rotation: { x: -0.2, y: -0.4, z: 0.1 },
      },
    },
    blendShapes: {
      "vrm.aa": 0.65,
      "vrm.blinkLeft": 0.25,
    },
    hands: [{
      label: "Left",
      wrist: { x: 0.32, y: 0.52, z: 0 },
      indexTip: { x: 0.28, y: 0.42, z: 0 },
      pinch: 0.4,
      fingers: {
        thumb: 0.2,
        index: 0.7,
        middle: 0.5,
        ring: 0.35,
        pinky: 0.25,
      },
    }],
    timestamp: 1,
  };
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (response) => {
      let body = "";
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        resolve({ statusCode: response.statusCode, body });
      });
    }).on("error", reject);
  });
}

function decodeOscMessage(buffer) {
  let offset = 0;
  const address = readOscString(buffer, offset);
  offset = address.nextOffset;
  const tags = readOscString(buffer, offset);
  offset = tags.nextOffset;

  const args = [];
  for (const tag of tags.value.replace(",", "")) {
    if (tag === "s") {
      const value = readOscString(buffer, offset);
      offset = value.nextOffset;
      args.push(value.value);
    } else if (tag === "f") {
      args.push(buffer.readFloatBE(offset));
      offset += 4;
    } else if (tag === "i") {
      args.push(buffer.readInt32BE(offset));
      offset += 4;
    }
  }

  return { address: address.value, tags: tags.value, args };
}

function readOscString(buffer, offset) {
  let end = offset;
  while (end < buffer.length && buffer[end] !== 0) {
    end += 1;
  }

  const value = buffer.toString("utf8", offset, end);
  return {
    value,
    nextOffset: Math.ceil((end + 1) / 4) * 4,
  };
}

function hasAddress(address) {
  return oscMessages.some((message) => message.address === address);
}

function hasStringArg(address, value) {
  return oscMessages.some((message) => (
    message.address === address && message.args.includes(value)
  ));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function once(resolve, reject) {
  let settled = false;

  return {
    resolve: () => {
      if (settled) return;
      settled = true;
      resolve();
    },
    reject: (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    },
  };
}

function randomPort() {
  return 18000 + Math.floor(Math.random() * 20000);
}
