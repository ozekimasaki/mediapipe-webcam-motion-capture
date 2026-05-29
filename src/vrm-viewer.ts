import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
  VRMExpressionPresetName,
  VRMHumanBoneName,
  VRMLoaderPlugin,
  VRMUtils,
  type VRM,
  type VRMPose,
} from "@pixiv/three-vrm";
import type { Euler, FingerCurl, MotionSnapshot } from "./motion-types";

type ViewerOptions = {
  container: HTMLElement;
  strengthInput: HTMLInputElement;
  stateElement: HTMLElement;
  setStatus: (message: string) => void;
};

type VrmViewer = {
  applyMotion: (motion: MotionSnapshot) => void;
  loadFile: (file: File) => Promise<void>;
  resize: () => void;
};

const bodyBoneMap: Record<string, VRMHumanBoneName> = {
  hips: VRMHumanBoneName.Hips,
  spine: VRMHumanBoneName.Spine,
  chest: VRMHumanBoneName.Chest,
  neck: VRMHumanBoneName.Neck,
  head: VRMHumanBoneName.Head,
  leftUpperArm: VRMHumanBoneName.LeftUpperArm,
  leftLowerArm: VRMHumanBoneName.LeftLowerArm,
  leftHand: VRMHumanBoneName.LeftHand,
  rightUpperArm: VRMHumanBoneName.RightUpperArm,
  rightLowerArm: VRMHumanBoneName.RightLowerArm,
  rightHand: VRMHumanBoneName.RightHand,
  leftUpperLeg: VRMHumanBoneName.LeftUpperLeg,
  leftLowerLeg: VRMHumanBoneName.LeftLowerLeg,
  rightUpperLeg: VRMHumanBoneName.RightUpperLeg,
  rightLowerLeg: VRMHumanBoneName.RightLowerLeg,
};

const expressionMap: Record<string, VRMExpressionPresetName> = {
  "vrm.aa": VRMExpressionPresetName.Aa,
  "vrm.ih": VRMExpressionPresetName.Ih,
  "vrm.ou": VRMExpressionPresetName.Ou,
  "vrm.ee": VRMExpressionPresetName.Ee,
  "vrm.oh": VRMExpressionPresetName.Oh,
  "vrm.blinkLeft": VRMExpressionPresetName.BlinkLeft,
  "vrm.blinkRight": VRMExpressionPresetName.BlinkRight,
  "vrm.happy": VRMExpressionPresetName.Happy,
};

const fingerBoneMap = {
  Left: {
    thumb: [
      VRMHumanBoneName.LeftThumbProximal,
      VRMHumanBoneName.LeftThumbDistal,
    ],
    index: [
      VRMHumanBoneName.LeftIndexProximal,
      VRMHumanBoneName.LeftIndexIntermediate,
      VRMHumanBoneName.LeftIndexDistal,
    ],
    middle: [
      VRMHumanBoneName.LeftMiddleProximal,
      VRMHumanBoneName.LeftMiddleIntermediate,
      VRMHumanBoneName.LeftMiddleDistal,
    ],
    ring: [
      VRMHumanBoneName.LeftRingProximal,
      VRMHumanBoneName.LeftRingIntermediate,
      VRMHumanBoneName.LeftRingDistal,
    ],
    pinky: [
      VRMHumanBoneName.LeftLittleProximal,
      VRMHumanBoneName.LeftLittleIntermediate,
      VRMHumanBoneName.LeftLittleDistal,
    ],
  },
  Right: {
    thumb: [
      VRMHumanBoneName.RightThumbProximal,
      VRMHumanBoneName.RightThumbDistal,
    ],
    index: [
      VRMHumanBoneName.RightIndexProximal,
      VRMHumanBoneName.RightIndexIntermediate,
      VRMHumanBoneName.RightIndexDistal,
    ],
    middle: [
      VRMHumanBoneName.RightMiddleProximal,
      VRMHumanBoneName.RightMiddleIntermediate,
      VRMHumanBoneName.RightMiddleDistal,
    ],
    ring: [
      VRMHumanBoneName.RightRingProximal,
      VRMHumanBoneName.RightRingIntermediate,
      VRMHumanBoneName.RightRingDistal,
    ],
    pinky: [
      VRMHumanBoneName.RightLittleProximal,
      VRMHumanBoneName.RightLittleIntermediate,
      VRMHumanBoneName.RightLittleDistal,
    ],
  },
} satisfies Record<"Left" | "Right", Record<keyof FingerCurl, VRMHumanBoneName[]>>;

export function createVrmViewer(options: ViewerOptions): VrmViewer {
  const { container, strengthInput, stateElement, setStatus } = options;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x070b10);

  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 20);
  camera.position.set(0, 1.35, 3.2);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.target.set(0, 1.25, 0);

  const clock = new THREE.Clock();
  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));

  let currentVrm: VRM | null = null;
  let latestMotion: MotionSnapshot | null = null;

  scene.add(new THREE.AmbientLight(0xffffff, 1.8));
  const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
  keyLight.position.set(1.8, 3.2, 2.4);
  scene.add(keyLight);
  const floor = new THREE.GridHelper(4, 12, 0x244240, 0x142523);
  floor.position.y = 0;
  scene.add(floor);

  resize();
  renderer.setAnimationLoop(() => {
    const delta = clock.getDelta();
    controls.update();

    if (currentVrm) {
      if (latestMotion) {
        applyMotionToVrm(currentVrm, latestMotion, Number(strengthInput.value));
      }
      currentVrm.update(delta);
    }

    renderer.render(scene, camera);
  });

  async function loadVrmFile(file: File): Promise<void> {
    stateElement.textContent = "loading";
    setStatus("VRMモデルを読み込み中");

    try {
      const buffer = await file.arrayBuffer();
      const gltf = await parseVrm(buffer);
      const vrm = gltf.userData.vrm;

      if (!vrm) {
        throw new Error("VRMデータを取得できませんでした");
      }

      if (currentVrm) {
        scene.remove(currentVrm.scene);
        VRMUtils.deepDispose(currentVrm.scene);
      }

      VRMUtils.rotateVRM0(vrm);
      currentVrm = vrm;
      currentVrm.scene.position.set(0, 0, 0);
      scene.add(currentVrm.scene);
      stateElement.textContent = file.name;
      setStatus("VRMモデルを読み込みました");
    } catch (error) {
      console.error(error);
      stateElement.textContent = "load error";
      setStatus(error instanceof Error ? error.message : "VRMモデルの読み込みに失敗しました");
    }
  }

  function parseVrm(buffer: ArrayBuffer): Promise<{ userData: { vrm?: VRM } }> {
    return new Promise((resolve, reject) => {
      loader.parse(buffer, "", resolve, reject);
    });
  }

  function resize(): void {
    const rect = container.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  return {
    applyMotion: (motion) => {
      latestMotion = motion;
    },
    loadFile: loadVrmFile,
    resize,
  };
}

function applyMotionToVrm(vrm: VRM, motion: MotionSnapshot, strength: number): void {
  const pose: VRMPose = {};

  for (const [sourceName, boneName] of Object.entries(bodyBoneMap)) {
    const bone = motion.bones[sourceName];
    if (!bone) continue;
    pose[boneName] = {
      rotation: eulerToQuaternionTuple(scaleEuler(bone.rotation, strength)),
    };
  }

  applyFingerPose(pose, motion.hands, strength);
  vrm.humanoid.setNormalizedPose(pose);
  applyExpressions(vrm, motion.blendShapes);
}

function applyFingerPose(
  pose: VRMPose,
  hands: MotionSnapshot["hands"],
  strength: number,
): void {
  for (const hand of hands) {
    const side = hand.label === "Left" || hand.label === "Right" ? hand.label : null;
    if (!side) continue;

    const map = fingerBoneMap[side];
    for (const [fingerName, boneNames] of Object.entries(map) as Array<
      [keyof FingerCurl, VRMHumanBoneName[]]
    >) {
      const curl = hand.fingers[fingerName] * strength;
      boneNames.forEach((boneName: VRMHumanBoneName, index: number) => {
        pose[boneName] = {
          rotation: eulerToQuaternionTuple({
            x: -curl * [0.8, 1, 0.85][index],
            y: fingerName === "thumb" ? (side === "Left" ? 0.18 : -0.18) : 0,
            z: 0,
          }),
        };
      });
    }
  }
}

function applyExpressions(vrm: VRM, blendShapes: MotionSnapshot["blendShapes"]): void {
  const manager = vrm.expressionManager;
  if (!manager) return;

  for (const [sourceName, expressionName] of Object.entries(expressionMap)) {
    manager.setValue(expressionName, clamp(blendShapes[sourceName] ?? 0, 0, 1));
  }
}

function scaleEuler(rotation: Euler, strength: number): Euler {
  return {
    x: rotation.x * strength,
    y: rotation.y * strength,
    z: rotation.z * strength,
  };
}

function eulerToQuaternionTuple(rotation: Euler): [number, number, number, number] {
  const x = clamp(rotation.x, -1.5, 1.5) * (Math.PI / 2);
  const y = clamp(rotation.y, -1.5, 1.5) * (Math.PI / 2);
  const z = clamp(rotation.z, -1.5, 1.5) * Math.PI;
  const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z, "XYZ"));
  return [quaternion.x, quaternion.y, quaternion.z, quaternion.w];
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
