import type { Box } from "../types";

export type Rect = { x0: number; y0: number; x1: number; y1: number };
export type Pt = { x: number; y: number };

export const ZR: Rect = { x0: 0, y0: 0, x1: 0, y1: 0 };

export const rect = (x0: number, y0: number, x1: number, y1: number): Rect => ({ x0, y0, x1, y1 });
export const dx = (r: Rect) => r.x1 - r.x0;
export const dy = (r: Rect) => r.y1 - r.y0;
export const empty = (r: Rect) => r.x0 >= r.x1 || r.y0 >= r.y1;
export const area = (r: Rect) => (empty(r) ? 0 : dx(r) * dy(r));

export function intersect(a: Rect, b: Rect): Rect {
  const r = rect(Math.max(a.x0, b.x0), Math.max(a.y0, b.y0), Math.min(a.x1, b.x1), Math.min(a.y1, b.y1));
  return empty(r) ? ZR : r;
}

export function union(a: Rect, b: Rect): Rect {
  if (empty(a)) return b;
  if (empty(b)) return a;
  return rect(Math.min(a.x0, b.x0), Math.min(a.y0, b.y0), Math.max(a.x1, b.x1), Math.max(a.y1, b.y1));
}

export function inset(r: Rect, n: number): Rect {
  let { x0, y0, x1, y1 } = r;
  if (dx(r) < 2 * n) x0 = x1 = Math.trunc((x0 + x1) / 2);
  else (x0 += n), (x1 -= n);
  if (dy(r) < 2 * n) y0 = y1 = Math.trunc((y0 + y1) / 2);
  else (y0 += n), (y1 -= n);
  return { x0, y0, x1, y1 };
}

export const add = (r: Rect, p: Pt): Rect => rect(r.x0 + p.x, r.y0 + p.y, r.x1 + p.x, r.y1 + p.y);
export const sub = (r: Rect, p: Pt): Rect => rect(r.x0 - p.x, r.y0 - p.y, r.x1 - p.x, r.y1 - p.y);
export const min = (r: Rect): Pt => ({ x: r.x0, y: r.y0 });

export const overlaps = (a: Rect, b: Rect) => !empty(a) && !empty(b) && a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
export const contains = (r: Rect, p: Pt) => r.x0 <= p.x && p.x < r.x1 && r.y0 <= p.y && p.y < r.y1;
export const eq = (a: Rect, b: Rect) => (empty(a) && empty(b)) || (a.x0 === b.x0 && a.y0 === b.y0 && a.x1 === b.x1 && a.y1 === b.y1);

export const toBox = (r: Rect): Box => [r.x0, r.y0, dx(r), dy(r)];
export const fromBox = (b: Box): Rect => rect(b[0], b[1], b[0] + b[2], b[1] + b[3]);

export function iouOf(a: Rect, b: Rect): number {
  const inter = area(intersect(a, b));
  const u = area(a) + area(b) - inter;
  return u === 0 ? 0 : inter / u;
}
