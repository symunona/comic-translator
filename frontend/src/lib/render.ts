import { drawLayout, layout, padBox, prepareText, type Layout } from "./layout";
import type { Meta, Region, Translation } from "./types";

export function regionLayout(r: Region, t: Translation | null, lang: string): Layout | null {
  const text = t?.regions[r.id]?.text;
  if (!r.replace || !text?.trim()) return null;
  const box = r.fitBox ?? padBox(r.textBox);
  return layout(prepareText(text, r.source?.caps ?? false, lang), box, r.source?.align ?? "center", r.glyphHeight);
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

export async function renderStrip(
  meta: Meta,
  imageUrl: string,
  regions: Region[],
  t: Translation | null,
  lang: string,
  overlaySrc: (r: Region) => string | undefined,
): Promise<Blob> {
  await document.fonts.ready;
  const canvas = document.createElement("canvas");
  canvas.width = meta.width;
  canvas.height = meta.height;
  const c = canvas.getContext("2d")!;
  c.drawImage(await loadImage(imageUrl), 0, 0, meta.width, meta.height);
  const replaced = regions.filter((r) => r.replace && r.overlayBox);
  const overlays = await Promise.all(replaced.map((r) => {
    const src = overlaySrc(r);
    return src ? loadImage(src) : null;
  }));
  replaced.forEach((r, i) => {
    const img = overlays[i];
    if (img) c.drawImage(img, ...r.overlayBox!);
  });
  for (const r of regions) {
    const l = regionLayout(r, t, lang);
    if (l) drawLayout(c, l);
  }
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png"));
}
