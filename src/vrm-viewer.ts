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

type IkBoneConfig = {
  sourceName: string;
  boneName: VRMHumanBoneName;
  childBoneName: VRMHumanBoneName;
  maxAngle: number;
  weight: number;
};

type VrmRigCache = {
  restDirections: Partial<Record<VRMHumanBoneName, THREE.Vector3>>;
  parentBones: Partial<Record<VRMHumanBoneName, VRMHumanBoneName>>;
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

const torsoBoneMap: Record<string, VRMHumanBoneName> = {
  hips: VRMHumanBoneName.Hips,
  spine: VRMHumanBoneName.Spine,
  chest: VRMHumanBoneName.Chest,
  neck: VRMHumanBoneName.Neck,
  head: VRMHumanBoneName.Head,
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

const ikBoneConfigs: IkBoneConfig[] = [
  {
    sourceName: "leftUpperArm",
    boneName: VRMHumanBoneName.LeftUpperArm,
    childBoneName: VRMHumanBoneName.LeftLowerArm,
    maxAngle: 2.4,
    weight: 1,
  },
  {
    sourceName: "leftLowerArm",
    boneName: VRMHumanBoneName.LeftLowerArm,
    childBoneName: VRMHumanBoneName.LeftHand,
    maxAngle: 2.6,
    weight: 1,
  },
  {
    sourceName: "rightUpperArm",
    boneName: VRMHumanBoneName.RightUpperArm,
    childBoneName: VRMHumanBoneName.RightLowerArm,
    maxAngle: 2.4,
    weight: 1,
  },
  {
    sourceName: "rightLowerArm",
    boneName: VRMHumanBoneName.RightLowerArm,
    childBoneName: VRMHumanBoneName.RightHand,
    maxAngle: 2.6,
    weight: 1,
  },
  {
    sourceName: "leftUpperLeg",
    boneName: VRMHumanBoneName.LeftUpperLeg,
    childBoneName: VRMHumanBoneName.LeftLowerLeg,
    maxAngle: 1.6,
    weight: 0.82,
  },
  {
    sourceName: "leftLowerLeg",
    boneName: VRMHumanBoneName.LeftLowerLeg,
    childBoneName: VRMHumanBoneName.LeftFoot,
    maxAngle: 1.9,
    weight: 0.9,
  },
  {
    sourceName: "rightUpperLeg",
    boneName: VRMHumanBoneName.RightUpperLeg,
    childBoneName: VRMHumanBoneName.RightLowerLeg,
    maxAngle: 1.6,
    weight: 0.82,
  },
  {
    sourceName: "rightLowerLeg",
    boneName: VRMHumanBoneName.RightLowerLeg,
    childBoneName: VRMHumanBoneName.RightFoot,
    maxAngle: 1.9,
    weight: 0.9,
  },
];

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
  let currentRigCache: VrmRigCache | null = null;
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
        applyMotionToVrm(currentVrm, latestMotion, Number(strengthInput.value), currentRigCache);
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
        currentRigCache = null;
      }

      VRMUtils.rotateVRM0(vrm);
      currentVrm = vrm;
      currentRigCache = createRigCache(vrm);
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

function applyMotionToVrm(
  vrm: VRM,
  motion: MotionSnapshot,
  strength: number,
  rigCache: VrmRigCache | null,
): void {
  const pose: VRMPose = {};

  for (const [sourceName, boneName] of Object.entries(torsoBoneMap)) {
    const bone = motion.bones[sourceName];
    if (!bone) continue;
    pose[boneName] = {
      rotation: eulerToQuaternionTuple(scaleTorsoEuler(sourceName, bone.rotation, strength)),
    };
  }

  if (motion.head) {
    pose[VRMHumanBoneName.Head] = {
      rotation: eulerToQuaternionTuple({
        x: -motion.head.pitch * strength * 0.55,
        y: motion.head.yaw * strength * 0.55,
        z: -motion.head.roll * strength * 0.28,
      }),
    };
  }

  if (rigCache) {
    applyLimbIkPose(pose, motion, strength, rigCache);
  }
  applyEulerFallbackPose(pose, motion, strength);

  applyFingerPose(pose, motion.hands, strength);
  vrm.humanoid.setNormalizedPose(pose);
  applyExpressions(vrm, motion.blendShapes);
}

function createRigCache(vrm: VRM): VrmRigCache {
  vrm.humanoid.resetNormalizedPose();
  vrm.humanoid.normalizedHumanBonesRoot.updateWorldMatrix(true, true);

  const boneNames = Object.values(VRMHumanBoneName);
  const nodeToBone = new Map<THREE.Object3D, VRMHumanBoneName>();
  const parentBones: Partial<Record<VRMHumanBoneName, VRMHumanBoneName>> = {};
  const restDirections: Partial<Record<VRMHumanBoneName, THREE.Vector3>> = {};

  for (const boneName of boneNames) {
    const node = vrm.humanoid.getNormalizedBoneNode(boneName);
    if (node) {
      nodeToBone.set(node, boneName);
    }
  }

  for (const boneName of boneNames) {
    const node = vrm.humanoid.getNormalizedBoneNode(boneName);
    if (!node) continue;

    let parent = node.parent;
    while (parent) {
      const parentBone = nodeToBone.get(parent);
      if (parentBone) {
        parentBones[boneName] = parentBone;
        break;
      }
      parent = parent.parent;
    }
  }

  for (const config of ikBoneConfigs) {
    const boneNode = vrm.humanoid.getNormalizedBoneNode(config.boneName);
    const childNode = vrm.humanoid.getNormalizedBoneNode(config.childBoneName);
    if (!boneNode || !childNode) continue;

    const direction = childNode
      .getWorldPosition(new THREE.Vector3())
      .sub(boneNode.getWorldPosition(new THREE.Vector3()));
    if (direction.lengthSq() > 0.000001) {
      restDirections[config.boneName] = direction.normalize();
    }
  }

  return { restDirections, parentBones };
}

function applyEulerFallbackPose(
  pose: VRMPose,
  motion: MotionSnapshot,
  strength: number,
): void {
  for (const [sourceName, boneName] of Object.entries(bodyBoneMap)) {
    if (torsoBoneMap[sourceName]) continue;

    const bone = motion.bones[sourceName];
    if (!bone || pose[boneName]) continue;
    pose[boneName] = {
      rotation: eulerToQuaternionTuple(scaleEuler(bone.rotation, strength)),
    };
  }
}

function applyLimbIkPose(
  pose: VRMPose,
  motion: MotionSnapshot,
  strength: number,
  rigCache: VrmRigCache,
): void {
  const worldRotations: Partial<Record<VRMHumanBoneName, THREE.Quaternion>> = {};
  const strengthAmount = clamp(strength, 0, 1);
  seedWorldRotationsFromPose(pose, rigCache.parentBones, worldRotations);

  for (const config of ikBoneConfigs) {
    const sourceBone = motion.bones[config.sourceName];
    const targetDirection = sourceBone?.direction;
    const restDirection = rigCache.restDirections[config.boneName];
    if (!targetDirection || !restDirection || !visibleEnough(targetDirection)) continue;

    const parentWorldRotation = getSolvedParentWorldRotation(
      config.boneName,
      rigCache.parentBones,
      worldRotations,
    );
    const localTargetDirection = new THREE.Vector3(
      targetDirection.x,
      targetDirection.y,
      targetDirection.z,
    )
      .normalize()
      .applyQuaternion(parentWorldRotation.clone().invert());
    const localRestDirection = restDirection.clone();

    const delta = new THREE.Quaternion().setFromUnitVectors(
      localRestDirection.normalize(),
      localTargetDirection.normalize(),
    );
    const limited = limitQuaternionAngle(delta, config.maxAngle);
    const weighted = new THREE.Quaternion().identity().slerp(
      limited,
      clamp(strengthAmount * config.weight, 0, 1),
    );

    pose[config.boneName] = {
      rotation: [weighted.x, weighted.y, weighted.z, weighted.w],
    };
    worldRotations[config.boneName] = parentWorldRotation.clone().multiply(weighted);
  }
}

function seedWorldRotationsFromPose(
  pose: VRMPose,
  parentBones: VrmRigCache["parentBones"],
  worldRotations: Partial<Record<VRMHumanBoneName, THREE.Quaternion>>,
): void {
  for (const boneName of [
    VRMHumanBoneName.Hips,
    VRMHumanBoneName.Spine,
    VRMHumanBoneName.Chest,
    VRMHumanBoneName.UpperChest,
    VRMHumanBoneName.Neck,
    VRMHumanBoneName.Head,
  ]) {
    const rotation = pose[boneName]?.rotation;
    if (!rotation) continue;

    const parentWorldRotation = getSolvedParentWorldRotation(
      boneName,
      parentBones,
      worldRotations,
    );
    const localRotation = new THREE.Quaternion().fromArray(rotation);
    worldRotations[boneName] = parentWorldRotation.multiply(localRotation);
  }
}

function getSolvedParentWorldRotation(
  boneName: VRMHumanBoneName,
  parentBones: VrmRigCache["parentBones"],
  worldRotations: Partial<Record<VRMHumanBoneName, THREE.Quaternion>>,
): THREE.Quaternion {
  let parentBone = parentBones[boneName];

  while (parentBone) {
    const parentRotation = worldRotations[parentBone];
    if (parentRotation) {
      return parentRotation.clone();
    }
    parentBone = parentBones[parentBone];
  }

  return new THREE.Quaternion();
}

function limitQuaternionAngle(quaternion: THREE.Quaternion, maxAngle: number): THREE.Quaternion {
  const normalized = quaternion.clone().normalize();
  const angle = 2 * Math.acos(clamp(Math.abs(normalized.w), 0, 1));
  if (angle <= maxAngle) return normalized;

  return new THREE.Quaternion().identity().slerp(normalized, maxAngle / angle);
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

function scaleTorsoEuler(sourceName: string, rotation: Euler, strength: number): Euler {
  const scaled = scaleEuler(rotation, strength);

  if (sourceName === "hips") {
    return {
      x: scaled.x * 0.25,
      y: scaled.y * 0.35,
      z: scaled.z * 0.35,
    };
  }

  if (sourceName === "spine" || sourceName === "chest") {
    return {
      x: scaled.x * 0.34,
      y: scaled.y * 0.28,
      z: scaled.z * 0.28,
    };
  }

  if (sourceName === "neck") {
    return {
      x: scaled.x * 0.32,
      y: scaled.y * 0.36,
      z: scaled.z * 0.28,
    };
  }

  return scaled;
}

function visibleEnough(point: { visibility?: number }): boolean {
  return point.visibility === undefined || point.visibility >= 0.35;
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
