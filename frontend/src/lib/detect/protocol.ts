import type { Box } from "../types";

export const DETECTOR_URL = import.meta.env.VITE_DETECTOR_URL ?? "/models/detector-v4-s_int8.onnx";
export const DETECTOR_NAME = "detector-v4-s_int8";

export type ClientDetection = { class: string; score: number; box: [number, number, number, number] };
export type ClientPanel = { panelId: string; detections: ClientDetection[] };
export type ClientDetect = { model: string; device: string; ms: number; panels: ClientPanel[] };

export type DetectRequest = { image: Blob; panels: { id: string; bbox: Box }[]; modelUrl: string };

export type DetectTiming = { loadMs: number; firstMs: number; panelMs: number[] };

export type DetectMessage =
  | { type: "progress"; done: number; total: number; device: string }
  | { type: "result"; result: ClientDetect; timing: DetectTiming }
  | { type: "error"; message: string };
