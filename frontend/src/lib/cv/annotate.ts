import type { Panel, Region } from "../types";
import { toCanvas, toDataURL, type Img } from "./image";

const CROP_PAD = 6;
const CROP_MIN_HEIGHT = 120;
const CROP_MAX_UPSCALE = 3;
const RED = "rgb(230,0,0)";

// panelImages crops every panel and draws red numbered boxes, the layout the
// prompts describe ("red box N marks region rN").
export async function panelImages(img: Img, panels: Panel[], regions: Region[]): Promise<Map<string, string>> {
  const src = toCanvas(img);
  const out = new Map<string, string>();
  for (const p of panels) {
    const [px, py, pw, ph] = p.bbox;
    const c = new OffscreenCanvas(pw, ph);
    const ctx = c.getContext("2d")!;
    ctx.drawImage(src, px, py, pw, ph, 0, 0, pw, ph);
    const regs = regions.filter((r) => r.panelId === p.id);
    ctx.strokeStyle = RED;
    ctx.lineWidth = 2;
    for (const r of regs) {
      const [x, y, w, h] = r.textBox;
      ctx.strokeRect(x - px - 3 + 1, y - py - 3 + 1, w + 6 - 2, h + 6 - 2);
    }
    ctx.font = "bold 15px sans-serif";
    ctx.textBaseline = "top";
    for (const r of regs) {
      const label = String(r.order);
      const tw = Math.ceil(ctx.measureText(label).width) + 6;
      const th = 17;
      let tx = r.textBox[0] - px - 3;
      let ty = r.textBox[1] - py - 3 - th;
      if (ty < 0) ty = r.textBox[1] - py - 3;
      tx = Math.min(Math.max(tx, 0), pw - tw);
      ctx.fillStyle = RED;
      ctx.fillRect(tx, ty, tw, th);
      ctx.fillStyle = "#fff";
      ctx.fillText(label, tx + 3, ty + 1);
    }
    out.set(p.id, await toDataURL(c));
  }
  return out;
}

// cropImages returns a clean, enlarged close-up of every region for OCR.
export async function cropImages(img: Img, regions: Region[]): Promise<Map<string, string>> {
  const src = toCanvas(img);
  const out = new Map<string, string>();
  for (const r of regions) {
    const x0 = Math.max(0, r.textBox[0] - CROP_PAD);
    const y0 = Math.max(0, r.textBox[1] - CROP_PAD);
    const x1 = Math.min(img.w, r.textBox[0] + r.textBox[2] + CROP_PAD);
    const y1 = Math.min(img.h, r.textBox[1] + r.textBox[3] + CROP_PAD);
    const w = x1 - x0;
    const h = y1 - y0;
    if (w <= 0 || h <= 0) continue;
    const f = h < CROP_MIN_HEIGHT ? Math.min(CROP_MIN_HEIGHT / h, CROP_MAX_UPSCALE) : 1;
    const c = new OffscreenCanvas(Math.round(w * f), Math.round(h * f));
    const ctx = c.getContext("2d")!;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(src, x0, y0, w, h, 0, 0, c.width, c.height);
    out.set(r.id, await toDataURL(c));
  }
  return out;
}
