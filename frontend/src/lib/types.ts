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
  overlayBox?: Box;
  overlayUrl?: string;
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
  final: boolean;
  edited: boolean;
  updatedAt: string;
  regions: Record<string, RegionTranslation>;
};

export type Meta = {
  id: string;
  origName: string;
  createdAt?: string;
  width: number;
  height: number;
  mime?: string;
  imageUrl?: string;
};

export type Strip = {
  meta: Meta;
  panels: Panel[];
  regions: Region[];
  scene?: Scene;
  stages: Record<string, string>;
  imageUrl: string;
  cleanUrl?: string;
};

export type StripSummary = {
  id: string;
  origName: string;
  createdAt: string;
  width: number;
  height: number;
  thumbUrl: string;
  langs: string[];
};

export type StageStatus = "pending" | "running" | "done" | "cached" | "error";

export type StageEvent = {
  stage: string;
  status: Exclude<StageStatus, "pending">;
  message?: string;
  progress?: { done: number; total: number };
};

export type DataEvent =
  | { kind: "meta"; payload: Meta }
  | { kind: "panels"; payload: Panel[] }
  | { kind: "regions"; payload: Region[] }
  | { kind: "region"; payload: Region }
  | { kind: "scene"; payload: Scene }
  | { kind: "overlays"; payload: Region[] }
  | { kind: "translation"; payload: Translation };

export type StreamHandlers = {
  stage: (e: StageEvent) => void;
  data: (e: DataEvent) => void;
  done: () => void;
  fatal: (message: string) => void;
};

export const STAGES = ["ingest", "panels", "detect", "order", "ocr", "scene", "clean", "translate", "review"] as const;
export type StageName = (typeof STAGES)[number];

export const LANGS: { code: string; name: string }[] = [
  { code: "en", name: "English" },
  { code: "de", name: "Deutsch" },
  { code: "fr", name: "Français" },
  { code: "es", name: "Español" },
  { code: "it", name: "Italiano" },
  { code: "pl", name: "Polski" },
  { code: "hu", name: "Magyar" },
];
