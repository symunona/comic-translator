import { intersect, rect, type Rect } from "./rect";

export type Img = { w: number; h: number; data: Uint8ClampedArray };

export const bounds = (img: Img): Rect => rect(0, 0, img.w, img.h);

export function luma(img: Img, x: number, y: number): number {
  const i = (y * img.w + x) * 4;
  return Math.trunc((299 * img.data[i] + 587 * img.data[i + 1] + 114 * img.data[i + 2]) / 1000);
}

export function setGray(img: Img, x: number, y: number, v: number) {
  const i = (y * img.w + x) * 4;
  img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
  img.data[i + 3] = 255;
}

export const cloneImg = (img: Img): Img => ({ w: img.w, h: img.h, data: new Uint8ClampedArray(img.data) });

export function cropImg(img: Img, r: Rect): Img {
  const c = intersect(r, bounds(img));
  const w = c.x1 - c.x0;
  const h = c.y1 - c.y0;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) data.set(img.data.subarray(((c.y0 + y) * img.w + c.x0) * 4, ((c.y0 + y) * img.w + c.x1) * 4), y * w * 4);
  return { w, h, data };
}

function canvas(w: number, h: number) {
  const c = new OffscreenCanvas(w, h);
  return { c, ctx: c.getContext("2d")! };
}

// decode flattens transparency onto white, like the server's ToRGBA did.
export async function decode(blob: Blob): Promise<Img> {
  const bmp = await createImageBitmap(blob);
  const { width: w, height: h } = bmp;
  const { ctx } = canvas(w, h);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  const d = ctx.getImageData(0, 0, w, h);
  return { w: d.width, h: d.height, data: d.data };
}

export function toCanvas(img: Img): OffscreenCanvas {
  const { c, ctx } = canvas(img.w, img.h);
  ctx.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.w, img.h), 0, 0);
  return c;
}

export const toBlob = (img: Img, type = "image/png", quality?: number) => toCanvas(img).convertToBlob({ type, quality });

export async function toDataURL(c: OffscreenCanvas, type = "image/png"): Promise<string> {
  const blob = await c.convertToBlob({ type });
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = "";
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return `data:${type};base64,${btoa(s)}`;
}
