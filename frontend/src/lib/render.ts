import { FONT_FAMILY, drawLayout, layout, padBox, prepareText, type Layout } from "./layout";
import type { Region, Translation } from "./types";

export function regionLayout(r: Region, t: Translation | null, lang: string, family = FONT_FAMILY): Layout | null {
  const text = t?.regions[r.id]?.text;
  if (!r.replace || !text?.trim()) return null;
  const box = r.fitBox ?? padBox(r.textBox);
  return layout(prepareText(text, r.source?.caps ?? false, lang), box, r.source?.align ?? "center", r.glyphHeight, family);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`failed to load ${src}`));
    img.src = src;
  });
}

export async function renderStrip(width: number, height: number, cleanUrl: string, regions: Region[], t: Translation | null, lang: string, family = FONT_FAMILY): Promise<Blob> {
  await document.fonts.ready;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const c = canvas.getContext("2d")!;
  c.drawImage(await loadImage(cleanUrl), 0, 0, width, height);
  for (const r of regions) {
    const l = regionLayout(r, t, lang, family);
    if (l) drawLayout(c, l);
  }
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png"));
}
