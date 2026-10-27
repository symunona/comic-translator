export type OcrCrop = { id: string; image: ImageBitmap };

export type OcrLine = { text: string; confidence: number };

export type OcrRequest = { crops: OcrCrop[] };

export type OcrMessage =
  | { type: "loading"; loaded: number; total: number }
  | { type: "progress"; done: number; total: number }
  | { type: "result"; lines: Record<string, OcrLine[]>; ms: number }
  | { type: "error"; message: string };
