import { toCanvas, type Img } from "../cv/image";
import { budget, defaultReplace } from "../pipeline";
import type { Kind, Region, RegionTranslation, StripRecord } from "../types";
import { restoreAccents } from "./accents";
import { detectLang } from "./lang";
import { translateTexts, type Progress } from "./mt";
import type { OcrLine, OcrMessage, OcrRequest } from "./protocol";
import { joinLines } from "./text";

const CROP_PAD = 4;
const MIN_CONFIDENCE = 0.5;

async function paddle(img: Img, regions: Region[], onProgress?: Progress): Promise<{ lines: Record<string, OcrLine[]>; ms: number }> {
  const src = toCanvas(img);
  const crops = await Promise.all(
    regions.map(async (r) => {
      const x = Math.max(0, r.textBox[0] - CROP_PAD);
      const y = Math.max(0, r.textBox[1] - CROP_PAD);
      const w = Math.min(img.w, r.textBox[0] + r.textBox[2] + CROP_PAD) - x;
      const h = Math.min(img.h, r.textBox[1] + r.textBox[3] + CROP_PAD) - y;
      return { id: r.id, image: await createImageBitmap(src, x, y, Math.max(w, 1), Math.max(h, 1)) };
    }),
  );
  const worker = new Worker(new URL("./paddle.worker.ts", import.meta.url), { type: "module" });
  try {
    return await new Promise((resolve, reject) => {
      worker.onerror = (e) => reject(new Error(e.message || "OCR worker failed"));
      worker.onmessage = (e: MessageEvent<OcrMessage>) => {
        const m = e.data;
        if (m.type === "loading") onProgress?.({ message: `downloading OCR model · ${(m.loaded / 1e6).toFixed(1)} MB`, done: m.loaded, total: m.total });
        else if (m.type === "progress") onProgress?.({ message: "reading text", done: m.done, total: m.total });
        else if (m.type === "result") resolve({ lines: m.lines, ms: m.ms });
        else reject(new Error(m.message));
      };
      worker.postMessage({ crops } satisfies OcrRequest, crops.map((c) => c.image));
    });
  } finally {
    worker.terminate();
  }
}

function isCaps(text: string): boolean {
  const letters = [...text].filter((c) => c.toLowerCase() !== c.toUpperCase());
  return letters.filter((c) => c === c.toUpperCase()).length >= 0.8 * letters.length;
}

function guessKind(r: Region, lines: string[]): Kind {
  if (r.detClass !== "text_free") return "speech";
  const words = lines.join(" ").split(/\s+/).filter(Boolean).length;
  return lines.length === 1 && words <= 2 ? "sfx" : "caption";
}

export async function freeOCR(img: Img, rec: StripRecord, onProgress?: Progress): Promise<{ regions: Region[]; srcLang: string; unboxed: string[]; ms: number; langHow: string }> {
  const { lines, ms } = await paddle(img, rec.regions, onProgress);
  const regions = rec.regions.map((reg): Region => {
    const ls = (lines[reg.id] ?? []).filter((l) => l.confidence >= MIN_CONFIDENCE && /[\p{L}\p{N}]/u.test(l.text)).map((l) => l.text.trim());
    if (!ls.length) return { ...reg, kind: "none", source: undefined, replace: false };
    const kind = guessKind(reg, ls);
    const text = joinLines(ls);
    return { ...reg, kind, source: { text, lines: ls, align: "center", caps: isCaps(text) }, replace: defaultReplace(kind) };
  });
  const all = regions.filter((r) => r.kind === "speech" || r.kind === "caption").map((r) => r.source!.text).join(" ");
  const det = await detectLang(all);
  return { regions: await withAccents(regions, det.lang), srcLang: det.lang, unboxed: [], ms, langHow: det.how };
}

export async function withAccents(regions: Region[], lang: string): Promise<Region[]> {
  const fixed = await restoreAccents(
    regions.flatMap((r) => r.source?.lines ?? []),
    lang,
  ).catch(() => null);
  if (!fixed) return regions;
  let i = 0;
  return regions.map((r) => {
    if (!r.source) return r;
    const lines = r.source.lines.map(() => fixed[i++]);
    return { ...r, source: { ...r.source, lines, text: joinLines(lines) } };
  });
}

// sentenceCase undoes comic lettering caps so the translator reads normal text.
export function sentenceCase(text: string, lang: string): string {
  if (!isCaps(text)) return text;
  let s = text.toLocaleLowerCase(lang).replace(/(^|[.!?…]\s+)(\p{L})/gu, (_m, a: string, b: string) => a + b.toLocaleUpperCase(lang));
  if (lang.startsWith("en")) s = s.replace(/\bi\b/g, "I").replace(/\bi'/g, "I'");
  return s;
}

export async function freeTranslate(rec: StripRecord, lang: string, ids: Set<string>, onProgress?: Progress, only?: "chrome" | "opus"): Promise<{ regions: Record<string, RegionTranslation>; engine: string }> {
  const src = rec.srcLang ?? "hu";
  const regs = rec.regions.filter((r) => ids.has(r.id) && r.source);
  const { texts, engine } = await translateTexts(
    regs.map((r) => sentenceCase(r.source!.text, src)),
    src,
    lang,
    onProgress,
    only,
  );
  const out: Record<string, RegionTranslation> = {};
  regs.forEach((r, i) => {
    const [maxChars, maxLines] = budget(r.source!.text, r.source!.lines);
    out[r.id] = { text: texts[i] ?? "", maxChars, maxLines };
  });
  return { regions: out, engine };
}
