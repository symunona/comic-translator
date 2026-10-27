import { cropImages, panelImages } from "./cv/annotate";
import type { Img } from "./cv/image";
import { fontName } from "./layout";
import { call, type CallOptions } from "./llm/openrouter";
import { CLASS_HINTS, OCR_SCHEMA, REVIEW_SCHEMA, SCENE_SCHEMA, TRANSLATE_SCHEMA, ocrPrompt, reviewPrompt, scenePrompt, translatePrompt, type OcrBox, type TrPromptData } from "./llm/prompts";
import type { Align, Kind, Region, RegionTranslation, Scene, StripRecord } from "./types";

const VALID_KINDS = new Set(["speech", "thought", "caption", "sfx", "sign", "none"]);

export const defaultReplace = (kind?: string) => kind === "speech" || kind === "thought" || kind === "caption";

const cleanLines = (lines: unknown): string[] => (Array.isArray(lines) ? lines.map((l) => String(l).trim()).filter(Boolean) : []);
const normAlign = (a: unknown): Align => (a === "left" || a === "right" ? a : "center");

type OcrReply = { lang?: string; regions?: { n: number; kind?: string; lines?: string[]; align?: string; caps?: boolean }[]; unboxed?: string[]; font?: string };

export async function runOCR(img: Img, rec: StripRecord, o: CallOptions): Promise<{ regions: Region[]; srcLang: string; unboxed: string[]; font?: string }> {
  const used = rec.panels.filter((p) => rec.regions.some((r) => r.panelId === p.id));
  const panels = await panelImages(img, used, rec.regions);
  const crops = await cropImages(img, rec.regions);
  const images = used.map((p) => panels.get(p.id)!);
  const boxes: OcrBox[] = [];
  for (const r of rec.regions) {
    const crop = crops.get(r.id);
    if (!crop) continue;
    images.push(crop);
    boxes.push({ n: r.order, panel: used.findIndex((p) => p.id === r.panelId) + 1, image: images.length, cls: r.detClass, hint: CLASS_HINTS[r.detClass] ?? "" });
  }
  const reply = await call<OcrReply>(ocrPrompt(used.length, boxes), images, OCR_SCHEMA, { ...o, effort: "low" });
  const regions = rec.regions.map((reg): Region => {
    const rr = reply.regions?.find((x) => Number(x.n) === reg.order);
    const lines = cleanLines(rr?.lines);
    let kind: Kind = rr && VALID_KINDS.has(String(rr.kind)) ? (rr.kind as Kind) : "none";
    if (!lines.length) kind = "none";
    return {
      ...reg,
      kind,
      source: lines.length ? { text: lines.join(" "), lines, align: normAlign(rr?.align), caps: rr?.caps !== false } : undefined,
      replace: defaultReplace(kind),
    };
  });
  const srcLang = /^[a-z]{2,3}(-[A-Za-z]+)?$/.test(reply.lang ?? "") ? reply.lang! : "hu";
  return { regions, srcLang, unboxed: cleanLines(reply.unboxed), font: fontName(reply.font) };
}

const quoteLines = (lines: string[]) => lines.map((l) => JSON.stringify(l)).join(" / ");

export const budget = (text: string, lines: string[]): [number, number] => [Math.ceil([...text].length * 1.2), Math.max(lines.length, 1) + 1];

// transcript lists regions per panel. With ids it only includes those regions
// and annotates speaker and budget.
function transcript(rec: StripRecord, ids: Set<string> | null, withBudget: boolean): string {
  let b = "";
  for (const p of rec.panels) {
    b += `Panel ${p.id}:\n`;
    for (const reg of rec.regions) {
      if (reg.panelId !== p.id || (ids && !ids.has(reg.id))) continue;
      if (!reg.source) {
        if (!withBudget) b += `  ${reg.id} [${reg.kind ?? "none"}, detector ${reg.detClass}]: (no text)\n`;
        continue;
      }
      b += `  ${reg.id} [${reg.kind}`;
      if (withBudget) {
        const sp = rec.scene?.speakers?.[reg.id];
        if (sp) b += `, speaker: ${sp}`;
        const [mc, ml] = budget(reg.source.text, reg.source.lines);
        b += `, maxChars ${mc}, maxLines ${ml}`;
      } else b += `, detector ${reg.detClass}`;
      b += `]: ${quoteLines(reg.source.lines)}\n`;
    }
  }
  if (!withBudget && rec.unboxed?.length) b += `(lettering outside any box, not editable: ${quoteLines(rec.unboxed)})\n`;
  return b;
}

async function sceneImages(img: Img, rec: StripRecord) {
  const imgs = await panelImages(img, rec.panels, rec.regions);
  return { images: rec.panels.map((p) => imgs.get(p.id)!), list: rec.panels.map((p, i) => ({ id: p.id, image: i + 1 })) };
}

export async function runScene(img: Img, rec: StripRecord, o: CallOptions): Promise<Scene> {
  const { images, list } = await sceneImages(img, rec);
  const sc = await call<Scene>(scenePrompt(rec.srcLang ?? "hu", list, transcript(rec, null, false)), images, SCENE_SCHEMA, o);
  return {
    summary: String(sc.summary ?? ""),
    characters: Array.isArray(sc.characters) ? sc.characters : [],
    panels: Array.isArray(sc.panels) ? sc.panels : [],
    speakers: sc.speakers && typeof sc.speakers === "object" ? sc.speakers : {},
    notes: Array.isArray(sc.notes) ? sc.notes.map(String) : [],
  };
}

export function translatable(rec: StripRecord, only?: string[]): Set<string> {
  const ids = new Set<string>();
  for (const r of rec.regions) if (r.source && r.kind !== "none" && (!only?.length || only.includes(r.id))) ids.add(r.id);
  return ids;
}

export type TrPass = { lang: string; ids: Set<string>; current?: Record<string, RegionTranslation>; hint?: string };

function promptData(rec: StripRecord, pass: TrPass): TrPromptData {
  const cur = rec.regions.filter((r) => pass.current?.[r.id] && !pass.ids.has(r.id)).map((r) => `  ${r.id}: ${JSON.stringify(pass.current![r.id].text)}`);
  return {
    src: rec.srcLang ?? "hu",
    lang: pass.lang,
    scene: JSON.stringify(rec.scene, null, 2),
    transcript: transcript(rec, pass.ids, true),
    current: cur.join("\n"),
    hint: pass.hint ?? "",
  };
}

type TrReply = { regions?: Record<string, Partial<RegionTranslation>> };

export async function translatePass(img: Img, rec: StripRecord, pass: TrPass, o: CallOptions): Promise<Record<string, RegionTranslation>> {
  if (!pass.ids.size) return {};
  const { images } = await sceneImages(img, rec);
  const reply = await call<TrReply>(translatePrompt(promptData(rec, pass)), images, TRANSLATE_SCHEMA, o);
  const out: Record<string, RegionTranslation> = {};
  for (const reg of rec.regions) {
    if (!pass.ids.has(reg.id) || !reg.source) continue;
    const t = reply.regions?.[reg.id] ?? {};
    const [maxChars, maxLines] = budget(reg.source.text, reg.source.lines);
    out[reg.id] = { text: String(t.text ?? ""), literal: t.literal ? String(t.literal) : undefined, notes: t.notes ? String(t.notes) : undefined, maxChars, maxLines };
  }
  return out;
}

export async function reviewPass(img: Img, rec: StripRecord, pass: TrPass, draft: Record<string, RegionTranslation>, o: CallOptions): Promise<Record<string, RegionTranslation>> {
  if (!pass.ids.size) return {};
  const { images } = await sceneImages(img, rec);
  const sorted = Object.entries(draft)
    .sort(([a], [b]) => Number(a.slice(1)) - Number(b.slice(1)))
    .map(([id, t]) => ({ id, literal: t.literal ?? "", text: t.text, ...(t.notes ? { notes: t.notes } : {}) }));
  const reply = await call<TrReply>(reviewPrompt({ ...promptData(rec, pass), draft: JSON.stringify(sorted, null, 2) }), images, REVIEW_SCHEMA, o);
  const out: Record<string, RegionTranslation> = {};
  for (const [id, d] of Object.entries(draft)) {
    const rv = reply.regions?.[id];
    out[id] = rv?.text && String(rv.text).trim() ? { ...d, text: String(rv.text), notes: rv.notes ? String(rv.notes) : undefined } : d;
  }
  return out;
}
