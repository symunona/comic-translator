import type { ClientPanel } from "../detect/protocol";
import type { Box, Panel, Region } from "../types";
import { cloneImg, bounds, type Img } from "./image";
import { erase, eraseArea, fitBox, type Erased } from "./erase";
import { area, contains, empty, fromBox, intersect, iouOf, rect, toBox, union, type Rect } from "./rect";

const MIN_SCORE = 0.35;
const NMS_IOU = 0.5;
const CONTAINED_RATIO = 0.9;
const BUBBLE_SHRINK = 0.12;
const ROW_OVERLAP = 0.5;
const CLASSES = ["bubble", "text_bubble", "text_free"];

type Det = { cls: string; score: number; box: Rect };

const center = (r: Rect) => ({ x: Math.trunc((r.x0 + r.x1) / 2), y: Math.trunc((r.y0 + r.y1) / 2) });

function shrink(r: Rect, f: number): Rect {
  const sx = Math.trunc(((r.x1 - r.x0) * f) / 2);
  const sy = Math.trunc(((r.y1 - r.y0) * f) / 2);
  return rect(r.x0 + sx, r.y0 + sy, r.x1 - sx, r.y1 - sy);
}

const round2 = (f: number) => Math.trunc(f * 100 + 0.5) / 100;

function nms(dets: Det[]): Det[] {
  const sorted = [...dets].sort((a, b) => b.score - a.score);
  const keep: Det[] = [];
  for (const d of sorted) if (keep.every((k) => iouOf(d.box, k.box) <= NMS_IOU)) keep.push(d);
  return keep;
}

function dropContained(dets: Det[]): Det[] {
  return dets.filter(
    (d, i) =>
      !dets.some((o, j) => i !== j && o.cls === d.cls && area(o.box) > area(d.box) && area(intersect(d.box, o.box)) > CONTAINED_RATIO * area(d.box)),
  );
}

function smallestContaining(dets: Det[], p: { x: number; y: number }): number {
  let best = -1;
  dets.forEach((d, i) => {
    if (contains(d.box, p) && (best < 0 || area(d.box) < area(dets[best].box))) best = i;
  });
  return best;
}

function panelRegions(dets: Det[]): Omit<Region, "id" | "panelId" | "order">[] {
  const by = (c: string) => dets.filter((d) => d.cls === c);
  const bubbles = nms(by("bubble"));
  const texts = dropContained(nms([...nms(by("text_bubble")), ...nms(by("text_free"))]));
  const regions: Omit<Region, "id" | "panelId" | "order">[] = [];
  const inBubble = new Map<number, number>();
  for (const t of texts) {
    const bi = smallestContaining(bubbles, center(t.box));
    const k = inBubble.get(bi);
    if (bi >= 0 && k !== undefined) {
      regions[k].textBox = toBox(union(fromBox(regions[k].textBox), t.box));
      continue;
    }
    const reg: Omit<Region, "id" | "panelId" | "order"> = { detClass: t.cls as Region["detClass"], score: round2(t.score), textBox: toBox(t.box), replace: false };
    if (bi >= 0) {
      reg.bubbleBox = toBox(bubbles[bi].box);
      inBubble.set(bi, regions.length);
    }
    regions.push(reg);
  }
  bubbles.forEach((b, i) => {
    if (inBubble.has(i)) return;
    regions.push({ detClass: "bubble", score: round2(b.score), textBox: toBox(shrink(b.box, BUBBLE_SHRINK)), bubbleBox: toBox(b.box), replace: false });
  });
  return regions;
}

function verticalOverlap(a: Box, b: Box): number {
  const top = Math.max(a[1], b[1]);
  const bottom = Math.min(a[1] + a[3], b[1] + b[3]);
  const h = Math.min(a[3], b[3]);
  return bottom <= top || h <= 0 ? 0 : (bottom - top) / h;
}

function readingOrder<T extends { textBox: Box }>(regs: T[], rtl = false): T[] {
  const sorted = [...regs].sort((a, b) => a.textBox[1] - b.textBox[1]);
  const rows: T[][] = [];
  for (const r of sorted) {
    const last = rows[rows.length - 1];
    if (last && verticalOverlap(last[0].textBox, r.textBox) > ROW_OVERLAP) last.push(r);
    else rows.push([r]);
  }
  const right = (b: Box) => b[0] + b[2];
  return rows.flatMap((row) => row.sort(rtl ? (a, b) => right(b.textBox) - right(a.textBox) : (a, b) => a.textBox[0] - b.textBox[0]));
}

// reorder renumbers panels and regions for a comic read right to left.
// Ids stay, so translations keyed by region id keep working.
export function reorder(rects: Rect[], panels: Panel[], regions: Region[], rtl: boolean): { panels: Panel[]; regions: Region[] } {
  const rank = (p: Panel) => {
    const i = rects.findIndex((r) => toBox(r).every((v, k) => v === p.bbox[k]));
    return i < 0 ? rects.length + p.order : i;
  };
  const ordered = [...panels].sort((a, b) => rank(a) - rank(b)).map((p, i) => ({ ...p, order: i }));
  const out: Region[] = [];
  for (const p of ordered) for (const r of readingOrder(regions.filter((r) => r.panelId === p.id), rtl)) out.push({ ...r, order: out.length });
  return { panels: ordered, regions: out };
}

// detectedRegions turns raw browser detections into ordered regions r0..rN.
// Before OCR, bubble text is erased by default so the strip shows empty bubbles.
export function detectedRegions(panels: Panel[], raw: ClientPanel[]): Region[] {
  const out: Region[] = [];
  for (const panel of panels) {
    const [px, py, pw, ph] = panel.bbox;
    const dets: Det[] = [];
    for (const d of raw.find((r) => r.panelId === panel.id)?.detections ?? []) {
      if (d.score < MIN_SCORE || !CLASSES.includes(d.class)) continue;
      const b = intersect(rect(Math.trunc(d.box[0] + 0.5), Math.trunc(d.box[1] + 0.5), Math.trunc(d.box[2] + 0.5), Math.trunc(d.box[3] + 0.5)), rect(0, 0, pw, ph));
      if (empty(b)) continue;
      dets.push({ cls: d.class, score: d.score, box: rect(b.x0 + px, b.y0 + py, b.x1 + px, b.y1 + py) });
    }
    for (const reg of readingOrder(panelRegions(dets))) {
      out.push({ ...reg, id: `r${out.length}`, panelId: panel.id, order: out.length, replace: reg.detClass !== "text_free" });
    }
  }
  return out;
}

// cleanStrip erases every region with replace=true and computes where the
// translation fits. Returns the clean image and regions with fitBox/glyphHeight.
export function cleanStrip(orig: Img, regions: Region[]): { clean: Img; regions: Region[] } {
  const clean = cloneImg(orig);
  const erased = new Map<string, Erased>();
  for (const r of regions) if (r.replace) erased.set(r.id, erase(clean, fromBox(r.textBox), r.bubbleBox ? fromBox(r.bubbleBox) : rect(0, 0, 0, 0)));
  const out = regions.map((r) => {
    const reg: Region = { ...r, fitBox: undefined, glyphHeight: undefined };
    const e = erased.get(r.id);
    if (!e || empty(e.changed)) return reg;
    const bubble = r.bubbleBox ? fromBox(r.bubbleBox) : rect(0, 0, 0, 0);
    const limit = empty(bubble) ? eraseArea(fromBox(r.textBox), bubble, bounds(clean)) : bubble;
    const fit = fitBox(clean, e.pixels, limit, fromBox(r.textBox));
    if (!empty(fit)) reg.fitBox = toBox(fit);
    if (e.glyphHeight) reg.glyphHeight = e.glyphHeight;
    return reg;
  });
  return { clean, regions: out };
}
