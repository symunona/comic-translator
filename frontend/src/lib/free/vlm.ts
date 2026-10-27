import { toCanvas, type Img } from "../cv/image";
import { langEnglishName } from "../langs";
import type { Region } from "../types";
import type { Progress } from "./mt";
import { joinLines, splitLines } from "./text";

export const VLM_REPO = "onnx-community/Qwen3.5-0.8B-ONNX";
export const VLM_MB = { q4f16: 616, q4: 682 };

export type VlmJob = { id: string; prompt: string; image?: ImageBitmap; maxTokens: number };
export type VlmRequest = { repo: string; jobs: VlmJob[] };
export type VlmMessage =
  | { type: "loading"; loaded: number; total: number }
  | { type: "ready"; device: string }
  | { type: "progress"; done: number; total: number }
  | { type: "result"; texts: Record<string, string>; ms: number }
  | { type: "error"; message: string };

const ACCENTS: Record<string, string> = {
  hu: "á é í ó ö ő ú ü ű",
  de: "ä ö ü ß",
  fr: "é è ê à ç ô û",
  es: "á é í ó ú ñ ¿ ¡",
  pl: "ą ć ę ł ń ó ś ź ż",
  cs: "á č ď é ě í ň ó ř š ť ú ů ý ž",
  sk: "á ä č ď é í ľ ň ó ô ŕ š ť ú ý ž",
  ro: "ă â î ș ț",
  pt: "á â ã à ç é ê í ó ô õ ú",
  it: "à è é ì ò ù",
};

let worker: Worker | null = null;
let device = "";

export const vlmDevice = () => device;

export async function hasWebGPU(): Promise<boolean> {
  const a = (await navigator.gpu?.requestAdapter().catch(() => null)) as (GPUAdapter & { isFallbackAdapter?: boolean }) | null | undefined;
  return !!a && !a.isFallbackAdapter;
}

export function runVlm(jobs: VlmJob[], onProgress?: Progress): Promise<{ texts: Record<string, string>; ms: number }> {
  worker ??= new Worker(new URL("./vlm.worker.ts", import.meta.url), { type: "module" });
  const w = worker;
  return new Promise((resolve, reject) => {
    w.onerror = (e) => {
      worker?.terminate();
      worker = null;
      reject(new Error(e.message || "VLM worker failed"));
    };
    w.onmessage = (e: MessageEvent<VlmMessage>) => {
      const m = e.data;
      if (m.type === "loading") onProgress?.({ message: `downloading Qwen3.5-0.8B · ${(m.loaded / 1e6).toFixed(0)} of ${(m.total / 1e6).toFixed(0)} MB`, done: m.loaded, total: m.total });
      else if (m.type === "ready") device = m.device;
      else if (m.type === "progress") onProgress?.({ message: `checking letters · ${device}`, done: m.done, total: m.total });
      else if (m.type === "result") resolve({ texts: m.texts, ms: m.ms });
      else reject(new Error(m.message));
    };
    w.postMessage({ repo: VLM_REPO, jobs } satisfies VlmRequest, jobs.flatMap((j) => (j.image ? [j.image] : [])));
  });
}

export function disposeVlm() {
  worker?.terminate();
  worker = null;
}

const CROP_PAD = 6;
const MIN_HEIGHT = 96;

async function crop(img: Img, r: Region): Promise<ImageBitmap> {
  const x = Math.max(0, r.textBox[0] - CROP_PAD);
  const y = Math.max(0, r.textBox[1] - CROP_PAD);
  const w = Math.max(1, Math.min(img.w, r.textBox[0] + r.textBox[2] + CROP_PAD) - x);
  const h = Math.max(1, Math.min(img.h, r.textBox[1] + r.textBox[3] + CROP_PAD) - y);
  const f = h < MIN_HEIGHT ? Math.min(MIN_HEIGHT / h, 3) : 1;
  return createImageBitmap(toCanvas(img), x, y, w, h, { resizeWidth: Math.round(w * f), resizeHeight: Math.round(h * f), resizeQuality: "high" });
}

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toUpperCase()
    .replace(/[^\p{L}\p{N}]/gu, "");

// plausible only rejects empty or chatty answers. Distance or length guards against
// the Paddle draft threw away more good fixes than bad ones: the model also
// recovers whole lines Paddle missed (bench: CER 0.120 unguarded, 0.138 guarded).
export function plausible(read: string): boolean {
  return !!fold(read) && !/^(based on|the text|here is|i'm sorry|i can't)/i.test(read.trim());
}

export type Repair = { id: string; draft: string; read: string; ok: boolean; used: string; lines: string[] };

export async function repairOCR(img: Img, regions: Region[], lang: string, onProgress?: Progress): Promise<{ repairs: Repair[]; ms: number }> {
  const name = langEnglishName(lang);
  const letters = ACCENTS[lang] ? ` It may use the ${name} letters ${ACCENTS[lang]}.` : "";
  const todo = regions.filter((r) => r.source?.text);
  const jobs = await Promise.all(
    todo.map(async (r): Promise<VlmJob> => {
      const draft = r.source!.lines.join("\n");
      return {
        id: r.id,
        image: await crop(img, r),
        maxTokens: Math.ceil(draft.length / 2) + 24,
        prompt: `This picture is a piece of hand-lettered text from a comic, in ${name}.${letters}\nAn OCR program read it as:\n${draft}\nThe OCR often drops accents and confuses letters. Write the text exactly as it appears in the picture, line by line, keeping capital letters and punctuation. Reply with the text only.`,
      };
    }),
  );
  const { texts, ms } = await runVlm(jobs, onProgress);
  const repairs = todo.map((r) => {
    const draft = r.source!.text;
    const read = (texts[r.id] ?? "").replace(/^["'“„]+|["'”]+$/g, "").trim();
    const ok = plausible(read);
    const lines = ok ? splitLines(read) : r.source!.lines;
    return { id: r.id, draft, read, ok, used: ok ? joinLines(lines) : draft, lines };
  });
  return { repairs, ms };
}

export async function vlmTranslate(items: { id: string; text: string }[], src: string, tgt: string, onProgress?: Progress): Promise<Record<string, string>> {
  const jobs = items.map(
    (it): VlmJob => ({
      id: it.id,
      maxTokens: Math.ceil(it.text.length / 2) + 32,
      prompt: `Translate this comic speech bubble from ${langEnglishName(src)} to ${langEnglishName(tgt)}. Keep it short and natural, like a comic. Reply with the translation only.\n\n${it.text}`,
    }),
  );
  return (await runVlm(jobs, onProgress)).texts;
}
