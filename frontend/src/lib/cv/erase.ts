import { bounds, luma, setGray, type Img } from "./image";
import { components } from "./panels";
import { add, contains, dx, dy, empty, intersect, inset, overlaps, rect, sub, union, type Pt, type Rect, ZR } from "./rect";

const ERASE_PAD = 6;
const ERASE_REACH = 24;
const ERASE_BUBBLE_TOL = 8;
export const ERASE_INK = 160;
const ERASE_DILATE = 2;
const ERASE_TALL_RATIO = 3;
const ENCLOSE_RATIO = 0.9;
const FIT_ERODE = 4;

export type Erased = { changed: Rect; pixels: Pt[]; glyphHeight: number };

// eraseArea is the work area for a text box: padded text box clipped to the bubble.
export function eraseArea(text: Rect, bubble: Rect, b: Rect): Rect {
  let a = inset(text, -ERASE_PAD);
  if (!empty(bubble)) a = intersect(a, bubble);
  return intersect(a, b);
}

function searchArea(text: Rect, bubble: Rect, b: Rect): Rect {
  let s = inset(text, -ERASE_REACH);
  if (!empty(bubble)) s = intersect(s, inset(bubble, -ERASE_BUBBLE_TOL));
  return intersect(s, b);
}

const encloses = (box: Rect, a: Rect) => dx(box) > ENCLOSE_RATIO * dx(a) && dy(box) > ENCLOSE_RATIO * dy(a);

// erase removes the lettering of one text region in place. Ink components
// count as lettering when they reach into the work area, do not touch the
// search frame (bubble outline, tail, art), are not unusually tall and do not
// enclose the text (nested bubble outlines).
export function erase(img: Img, text: Rect, bubble: Rect): Erased {
  const a = eraseArea(text, bubble, bounds(img));
  const s = union(searchArea(text, bubble, bounds(img)), a);
  if (empty(a)) return { changed: a, pixels: [], glyphHeight: 0 };
  const w = dx(s);
  const h = dy(s);
  const ink = new Uint8Array(w * h);
  const paper: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const l = luma(img, s.x0 + x, s.y0 + y);
      if (l < ERASE_INK) ink[y * w + x] = 1;
      else if (contains(a, { x: s.x0 + x, y: s.y0 + y })) paper.push(l);
    }
  }
  const local = sub(a, { x: s.x0, y: s.y0 });
  const cands = [];
  const heights: number[] = [];
  const keep = new Uint8Array(w * h);
  for (const c of components(ink, w, h)) {
    if (!c.touchesFrame && overlaps(c.box, local) && !encloses(c.box, local)) {
      cands.push(c);
      heights.push(dy(c.box));
      continue;
    }
    for (const p of c.pixels) keep[p.y * w + p.x] = 1;
  }
  if (!cands.length) return { changed: a, pixels: [], glyphHeight: 0 };
  heights.sort((p, q) => p - q);
  const limit = heights[Math.trunc((heights.length * 3) / 4)] * ERASE_TALL_RATIO;
  const res: Erased = { changed: a, pixels: [], glyphHeight: glyphHeight(heights, limit) };

  const mask = new Uint8Array(w * h);
  for (const c of cands) {
    if (dy(c.box) > limit) {
      for (const p of c.pixels) keep[p.y * w + p.x] = 1;
      continue;
    }
    for (const p of c.pixels) {
      for (let ddy = -ERASE_DILATE; ddy <= ERASE_DILATE; ddy++) {
        for (let ddx = -ERASE_DILATE; ddx <= ERASE_DILATE; ddx++) {
          const x = p.x + ddx;
          const y = p.y + ddy;
          if (x >= 0 && y >= 0 && x < w && y < h) mask[y * w + x] = 1;
        }
      }
    }
  }

  let fill = 255;
  if (paper.length) {
    paper.sort((p, q) => p - q);
    fill = paper[Math.trunc(paper.length / 2)];
  }
  let changed = a;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x] && !keep[y * w + x]) {
        const p = { x: s.x0 + x, y: s.y0 + y };
        setGray(img, p.x, p.y, fill);
        res.pixels.push(p);
        changed = union(changed, rect(p.x, p.y, p.x + 1, p.y + 1));
      }
    }
  }
  res.changed = changed;
  return res;
}

function glyphHeight(sorted: number[], limit: number): number {
  const floor = Math.trunc(sorted[Math.trunc((sorted.length * 3) / 4)] / 2);
  const letters = sorted.filter((h) => h >= floor && h <= limit);
  return letters.length ? letters[Math.trunc(letters.length / 2)] : 0;
}

// fitBox finds where replacement text can go: the paper region reachable from
// the erased pixels without crossing ink, limited to limit, eroded away from
// the outline, reduced to its largest inscribed axis-aligned rectangle.
export function fitBox(img: Img, seeds: Pt[], limit: Rect, text: Rect): Rect {
  const l = intersect(limit, bounds(img));
  if (empty(l)) return ZR;
  const w = dx(l);
  const h = dy(l);
  const paper = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) paper[y * w + x] = luma(img, l.x0 + x, l.y0 + y) >= ERASE_INK ? 1 : 0;
  const start: number[] = [];
  for (const p of seeds) if (contains(l, p)) start.push((p.y - l.y0) * w + p.x - l.x0);
  const interior = erode(flood(paper, w, h, start), w, h, FIT_ERODE);
  const piece = bestPiece(interior, w, h, sub(text, { x: l.x0, y: l.y0 }));
  if (!piece) return ZR;
  return add(maxRect(piece, w, h), { x: l.x0, y: l.y0 });
}

function flood(open: Uint8Array, w: number, h: number, start: number[]): Uint8Array {
  const inside = new Uint8Array(open.length);
  const stack: number[] = [];
  for (const i of start) {
    if (open[i] && !inside[i]) {
      inside[i] = 1;
      stack.push(i);
    }
  }
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w;
    const y = (i - x) / w;
    const visit = (nx: number, ny: number) => {
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) return;
      const j = ny * w + nx;
      if (open[j] && !inside[j]) {
        inside[j] = 1;
        stack.push(j);
      }
    };
    visit(x - 1, y);
    visit(x + 1, y);
    visit(x, y - 1);
    visit(x, y + 1);
  }
  return inside;
}

const erode = (m: Uint8Array, w: number, h: number, r: number) => erodePass(erodePass(m, w, h, r, 1, w), w, h, r, w, 1);

function erodePass(m: Uint8Array, w: number, h: number, r: number, step: number, across: number): Uint8Array {
  const [n, lines] = step === 1 ? [w, h] : [h, w];
  const out = new Uint8Array(m.length);
  for (let line = 0; line < lines; line++) {
    const base = line * across;
    let run = 0;
    for (let i = 0; i < n; i++) {
      run = m[base + i * step] ? run + 1 : 0;
      if (run >= 2 * r + 1) out[base + (i - r) * step] = 1;
    }
  }
  return out;
}

function bestPiece(m: Uint8Array, w: number, h: number, text: Rect): Uint8Array | null {
  const t = intersect(text, rect(0, 0, w, h));
  const label = new Int32Array(m.length);
  const overlap: number[] = [];
  const size: number[] = [];
  for (let i = 0; i < m.length; i++) {
    if (!m[i] || label[i]) continue;
    const id = size.length + 1;
    const piece = flood(m, w, h, [i]);
    let ov = 0;
    let sz = 0;
    for (let j = 0; j < piece.length; j++) {
      if (!piece[j]) continue;
      label[j] = id;
      sz++;
      if (contains(t, { x: j % w, y: Math.trunc(j / w) })) ov++;
    }
    overlap.push(ov);
    size.push(sz);
  }
  if (!size.length) return null;
  let best = 0;
  for (let k = 0; k < size.length; k++) {
    if (overlap[k] > overlap[best] || (overlap[k] === overlap[best] && size[k] > size[best])) best = k;
  }
  const out = new Uint8Array(m.length);
  for (let i = 0; i < label.length; i++) out[i] = label[i] === best + 1 ? 1 : 0;
  return out;
}

// maxRect is the largest all-true axis-aligned rectangle (histogram stack method).
function maxRect(m: Uint8Array, w: number, h: number): Rect {
  const heights = new Int32Array(w + 1);
  let best = ZR;
  let bestArea = 0;
  const stack: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) heights[x] = m[y * w + x] ? heights[x] + 1 : 0;
    stack.length = 0;
    for (let x = 0; x <= w; x++) {
      while (stack.length && heights[stack[stack.length - 1]] >= heights[x]) {
        const top = heights[stack.pop()!];
        const left = stack.length ? stack[stack.length - 1] + 1 : 0;
        const a = top * (x - left);
        if (a > bestArea) {
          bestArea = a;
          best = rect(left, y + 1 - top, x, y + 1);
        }
      }
      stack.push(x);
    }
  }
  return best;
}
