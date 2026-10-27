export type Box = [number, number, number, number];

export type Panel = { id: string; order: number; bbox: Box };

export type Kind = "speech" | "thought" | "caption" | "sfx" | "sign" | "none";
export type Align = "left" | "center" | "right";

export type Source = { text: string; lines: string[]; align: Align; caps: boolean };

export type Region = {
  id: string;
  panelId: string;
  order: number;
  detClass: "bubble" | "text_bubble" | "text_free";
  score: number;
  textBox: Box;
  bubbleBox?: Box;
  kind?: Kind;
  replace: boolean;
  source?: Source;
  speaker?: string;
  fitBox?: Box;
  glyphHeight?: number;
};

export type Scene = {
  summary: string;
  characters: { name: string; description: string }[];
  panels: { panelId: string; description: string }[];
  speakers: Record<string, string>;
  notes: string[];
};

export type RegionTranslation = {
  text: string;
  literal?: string;
  notes?: string;
  maxChars?: number;
  maxLines?: number;
};

export type Translation = {
  lang: string;
  updatedAt: string;
  regions: Record<string, RegionTranslation>;
  model?: string;
  origin: "llm" | "shared" | "demo" | "user";
  by?: string;
  edited?: boolean;
  draft?: boolean;
};

export type CallStat = { stage: string; model: string; ms: number; costUsd: number; tokensIn: number; tokensOut: number; error?: string };

export type StripRecord = {
  id: string;
  name: string;
  createdAt: string;
  width: number;
  height: number;
  panels: Panel[];
  regions: Region[];
  detected: boolean;
  ocr: boolean;
  ocrFree?: boolean;
  ocrBy?: string;
  srcLang?: string;
  unboxed?: string[];
  font?: string;
  scene?: Scene;
  drafts: Record<string, Record<string, RegionTranslation>>;
  translations: Record<string, Translation>;
  versions?: Record<string, Translation[]>;
  calls: CallStat[];
  shared: Record<string, number>;
};

// SharedTranslation is the file posted to the hub and shipped with the demos:
// everything needed to letter the strip again, no image.
export type SharedTranslation = {
  format: 1;
  hash: string;
  width: number;
  height: number;
  srcLang: string;
  panels: Panel[];
  regions: Region[];
  unboxed?: string[];
  font?: string;
  scene: Scene;
  lang: string;
  translation: Record<string, RegionTranslation>;
  model?: string;
  nick?: string;
  createdAt: string;
};

export type SharedListing = { id: number | string; lang: string; srcLang: string; nick?: string; createdAt: string };

export type StageStatus = "pending" | "running" | "done" | "cached" | "error" | "skipped";

export const STAGES = ["panels", "detect", "clean", "shared", "ocr", "scene", "translate", "review"] as const;
export type StageName = (typeof STAGES)[number];

export type StageState = { status: StageStatus; message?: string; progress?: { done: number; total: number } };
