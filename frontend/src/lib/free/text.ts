export function joinLines(lines: string[]): string {
  let out = "";
  for (const l of lines) {
    if (!out) out = l;
    else if (/[A-Za-zÀ-ž]-$/.test(out)) out = out.slice(0, -1) + l;
    else out += " " + l;
  }
  return out.replace(/\s+([,.!?…])/g, "$1");
}

export const splitLines = (s: string) =>
  s
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
