import type { Align, Box } from "./types";

export const FONT_FAMILY = '"Patrick Hand", "Comic Neue", "Comic Sans MS", cursive, sans-serif';
export const DEFAULT_FONT = "Patrick Hand";
export const AUTO_FONT = "auto";
export const FONTS: Record<string, string> = {
  "Patrick Hand": FONT_FAMILY,
  "Comic Sans MS": '"Comic Sans MS", "Comic Neue", cursive, sans-serif',
  Arial: "Arial, Helvetica, sans-serif",
  Verdana: "Verdana, Geneva, sans-serif",
  "Trebuchet MS": '"Trebuchet MS", Helvetica, sans-serif',
  Tahoma: "Tahoma, Verdana, sans-serif",
  Impact: 'Impact, "Arial Black", sans-serif',
  Georgia: "Georgia, serif",
  "Times New Roman": '"Times New Roman", Times, serif',
  "Courier New": '"Courier New", Courier, monospace',
};
export const fontFamily = (name: string) => FONTS[name] ?? FONT_FAMILY;
export const fontName = (guess: unknown) => Object.keys(FONTS).find((n) => n.toLowerCase() === String(guess ?? "").trim().toLowerCase());
export const chosenFont = (choice: string, guess?: string) => (choice === AUTO_FONT ? guess || DEFAULT_FONT : choice);
export const LINE_HEIGHT = 1.08;
const MIN_SIZE = 6;
const MAX_SIZE = 64;
const PAD = 2;
const CAP_SLACK = 1.15;

export type Layout = {
  box: Box;
  align: Align;
  family: string;
  fontSize: number;
  lineHeight: number;
  lines: string[];
  ascent: number;
  inkAscent: number;
  inkHeight: number;
  fits: boolean;
};

let ctx: CanvasRenderingContext2D | null = null;
const measurer = () => (ctx ??= document.createElement("canvas").getContext("2d")!);

export const fontString = (size: number, family = FONT_FAMILY) => `${size}px ${family}`;

export function padBox(textBox: Box): Box {
  const [x, y, w, h] = textBox;
  return [x - PAD, y - PAD, w + PAD * 2, h + PAD * 2];
}

function breakWord(word: string, width: number, measure: (s: string) => number): string[] {
  const parts: string[] = [];
  let cur = "";
  for (const ch of word) {
    if (cur && measure(cur + ch) > width) {
      parts.push(cur);
      cur = ch;
    } else cur += ch;
  }
  if (cur) parts.push(cur);
  return parts;
}

function wrap(text: string, width: number, measure: (s: string) => number, breakWords: boolean): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) {
      out.push("");
      continue;
    }
    let line = "";
    for (const word of words) {
      const pieces = breakWords && measure(word) > width ? breakWord(word, width, measure) : [word];
      for (const piece of pieces) {
        const next = line ? `${line} ${piece}` : piece;
        if (line && measure(next) > width) {
          out.push(line);
          line = piece;
        } else line = next;
      }
    }
    out.push(line);
  }
  while (out.length > 1 && out[out.length - 1] === "") out.pop();
  return out;
}

export function prepareText(text: string, caps: boolean, lang: string): string {
  const t = text.trim();
  return caps ? t.toLocaleUpperCase(lang) : t;
}

function capRatio(c: CanvasRenderingContext2D, family: string): number {
  c.font = fontString(100, family);
  return c.measureText("H").actualBoundingBoxAscent / 100;
}

export function layout(text: string, box: Box, align: Align, glyphHeight?: number, family = FONT_FAMILY): Layout {
  const c = measurer();
  const [, , w, h] = box;
  const maxSize = glyphHeight ? Math.max(MIN_SIZE, Math.min(MAX_SIZE, Math.floor((glyphHeight * CAP_SLACK) / capRatio(c, family)))) : MAX_SIZE;
  const attempt = (size: number, breakWords: boolean) => {
    c.font = fontString(size, family);
    const lines = wrap(text, w, (s) => c.measureText(s).width, breakWords);
    const widest = Math.max(0, ...lines.map((l) => c.measureText(l).width));
    const ink = inkExtent(c, lines, size * LINE_HEIGHT);
    return { lines, ink, fits: widest <= w && ink.height <= h };
  };
  const search = (breakWords: boolean) => {
    let lo = MIN_SIZE;
    let hi = maxSize;
    let best = { size: MIN_SIZE, ...attempt(MIN_SIZE, breakWords) };
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const r = attempt(mid, breakWords);
      if (r.fits) {
        best = { size: mid, ...r };
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return best;
  };
  const whole = search(false);
  const best = whole.fits ? whole : search(true);
  c.font = fontString(best.size, family);
  const m = c.measureText("ÁÉŐŰgjpqy");
  const lineHeight = best.size * LINE_HEIGHT;
  const content = m.fontBoundingBoxAscent + m.fontBoundingBoxDescent;
  return {
    box,
    align,
    family,
    fontSize: best.size,
    lineHeight,
    lines: best.lines,
    ascent: (lineHeight - content) / 2 + m.fontBoundingBoxAscent,
    inkAscent: best.ink.ascent,
    inkHeight: best.ink.height,
    fits: best.fits,
  };
}

function inkExtent(c: CanvasRenderingContext2D, lines: string[], lineHeight: number) {
  const ascent = c.measureText(lines[0] || "H").actualBoundingBoxAscent;
  const descent = Math.max(0, c.measureText(lines[lines.length - 1]).actualBoundingBoxDescent);
  return { ascent, height: (lines.length - 1) * lineHeight + ascent + descent };
}

export function blockTop(l: Layout): number {
  return l.box[1] + (l.box[3] - l.inkHeight) / 2 + l.inkAscent - l.ascent;
}

export function drawLayout(c: CanvasRenderingContext2D, l: Layout, color = "#111") {
  const [x, , w] = l.box;
  c.font = fontString(l.fontSize, l.family);
  c.fillStyle = color;
  c.textBaseline = "alphabetic";
  c.textAlign = l.align;
  const tx = l.align === "left" ? x : l.align === "right" ? x + w : x + w / 2;
  const top = blockTop(l);
  l.lines.forEach((line, i) => c.fillText(line, tx, top + i * l.lineHeight + l.ascent));
}
