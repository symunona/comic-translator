import { bounds, luma, type Img } from "./image";
import { empty, intersect, inset, rect, type Pt, type Rect, ZR } from "./rect";

const PANEL_INK = 128;
const SPECK_AREA = 2;
const PANEL_MIN_GAP = 12;
const PANEL_MIN_SIZE = 60;
const PANEL_PAD = 4;

export type Component = { pixels: Pt[]; box: Rect; touchesFrame: boolean };

export function components(ink: Uint8Array, w: number, h: number): Component[] {
  const seen = new Uint8Array(ink.length);
  const comps: Component[] = [];
  const stack: number[] = [];
  for (let start = 0; start < ink.length; start++) {
    if (!ink[start] || seen[start]) continue;
    const c: Component = { pixels: [], box: ZR, touchesFrame: false };
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    seen[start] = 1;
    stack.length = 0;
    stack.push(start);
    while (stack.length) {
      const i = stack.pop()!;
      const px = i % w;
      const py = (i - px) / w;
      c.pixels.push({ x: px, y: py });
      if (px < x0) x0 = px;
      if (py < y0) y0 = py;
      if (px + 1 > x1) x1 = px + 1;
      if (py + 1 > y1) y1 = py + 1;
      if (px === 0 || py === 0 || px === w - 1 || py === h - 1) c.touchesFrame = true;
      for (let ddy = -1; ddy <= 1; ddy++) {
        for (let ddx = -1; ddx <= 1; ddx++) {
          const x = px + ddx;
          const y = py + ddy;
          if (x < 0 || y < 0 || x >= w || y >= h) continue;
          const j = y * w + x;
          if (ink[j] && !seen[j]) {
            seen[j] = 1;
            stack.push(j);
          }
        }
      }
    }
    c.box = rect(x0, y0, x1, y1);
    comps.push(c);
  }
  return comps;
}

class InkMap {
  ink: Uint8Array;
  constructor(public w: number, public h: number, img: Img, threshold: number) {
    this.ink = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) this.ink[y * w + x] = luma(img, x, y) < threshold ? 1 : 0;
  }

  despeckle(maxArea: number) {
    for (const c of components(this.ink, this.w, this.h)) {
      if (c.pixels.length <= maxArea) for (const p of c.pixels) this.ink[p.y * this.w + p.x] = 0;
    }
  }

  profile(r: Rect, rows: boolean): boolean[] {
    const n = rows ? r.y1 - r.y0 : r.x1 - r.x0;
    const across = rows ? r.x1 - r.x0 : r.y1 - r.y0;
    const filled = new Array<boolean>(n).fill(false);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < across && !filled[i]; j++) {
        const x = rows ? r.x0 + j : r.x0 + i;
        const y = rows ? r.y0 + i : r.y0 + j;
        filled[i] = this.ink[y * this.w + x] === 1;
      }
    }
    return filled;
  }

  trim(r: Rect): Rect {
    const ys = span(this.profile(r, true));
    const xs = span(this.profile(r, false));
    if (!ys || !xs) return ZR;
    return rect(r.x0 + xs[0], r.y0 + ys[0], r.x0 + xs[1], r.y0 + ys[1]);
  }
}

function span(filled: boolean[]): [number, number] | null {
  let lo = -1;
  let hi = -1;
  filled.forEach((f, i) => {
    if (!f) return;
    if (lo < 0) lo = i;
    hi = i + 1;
  });
  return lo >= 0 ? [lo, hi] : null;
}

function segments(filled: boolean[]): [number, number][] {
  const out: [number, number][] = [];
  let start = -1;
  let gap = 0;
  filled.forEach((f, i) => {
    if (f) {
      if (start < 0) start = i;
      else if (gap >= PANEL_MIN_GAP) {
        out.push([start, i - gap]);
        start = i;
      }
      gap = 0;
    } else if (start >= 0) gap++;
  });
  if (start >= 0) out.push([start, filled.length - gap]);
  return out;
}

// panels splits a strip into panels by recursive XY-cut on the ink projection,
// in reading order: rows top to bottom, columns left to right or right to left.
export function panels(img: Img, rtl = false): Rect[] {
  const m = new InkMap(img.w, img.h, img, PANEL_INK);
  m.despeckle(SPECK_AREA);
  const out: Rect[] = [];
  const cut = (r0: Rect) => {
    const r = m.trim(r0);
    if (empty(r)) return;
    for (const rows of [true, false]) {
      const segs = segments(m.profile(r, rows));
      if (segs.length < 2) continue;
      for (const [a, b] of rtl && !rows ? segs.reverse() : segs) cut(rows ? rect(r.x0, r.y0 + a, r.x1, r.y0 + b) : rect(r.x0 + a, r.y0, r.x0 + b, r.y1));
      return;
    }
    if (r.x1 - r.x0 >= PANEL_MIN_SIZE && r.y1 - r.y0 >= PANEL_MIN_SIZE) out.push(intersect(inset(r, -PANEL_PAD), bounds(img)));
  };
  cut(bounds(img));
  return out.length ? out : [bounds(img)];
}
