import type { NormalizedLandmark } from "@mediapipe/tasks-vision";

export type Point = Pick<NormalizedLandmark, "x" | "y" | "z"> & {
  visibility?: number;
};

export type Euler = {
  x: number;
  y: number;
  z: number;
};

export type BonePose = {
  rotation: Euler;
  position?: Point;
  direction?: Point;
};

export type FingerCurl = {
  thumb: number;
  index: number;
  middle: number;
  ring: number;
  pinky: number;
};

export type MotionSnapshot = {
  version: 1;
  head: {
    x: number;
    y: number;
    z: number;
    yaw: number;
    pitch: number;
    roll: number;
  } | null;
  torso: {
    centerX: number;
    centerY: number;
    shoulderTilt: number;
    hipTilt: number;
  } | null;
  bones: Record<string, BonePose>;
  blendShapes: Record<string, number>;
  hands: Array<{
    label: string;
    wrist: Point;
    indexTip: Point;
    pinch: number;
    fingers: FingerCurl;
  }>;
  timestamp: number;
};
