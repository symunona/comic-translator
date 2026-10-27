import { cachedFetch } from "./models";

// Per-language tables built by bench/free/accent_tables.py: the most frequent
// accented spelling of each unaccented word, one per line. Bench (hu comics):
// accents kept 32% -> 78%. Scores per language in the dataset card.
const REPO = "https://huggingface.co/datasets/bboborjan/comic-translator-accents/resolve/ef34796bf19797c8549f6678434831f2b690173c";
const LANGS = new Set("hu cs sk pl de fr es pt pt-BR ro hr bs sr sl tr vi lt lv et fi is ca gl da sv nb sq eo".split(" "));

// Letters NFD does not split into base + mark. Must match FOLD in accent_tables.py.
const FOLD: Record<string, string> = { ł: "l", đ: "d", ø: "o", ß: "ss", æ: "ae", œ: "oe", ı: "i", ħ: "h", ŀ: "l" };

const fold = (w: string) =>
  [...w.toLowerCase()]
    .map((c) => FOLD[c] ?? c)
    .join("")
    .normalize("NFD")
    .replace(/\p{M}/gu, "");

const tables = new Map<string, Promise<Map<string, string>>>();

const code = (lang: string) => (lang === "no" ? "nb" : lang);

function table(lang: string): Promise<Map<string, string>> | null {
  lang = code(lang);
  if (!LANGS.has(lang)) return null;
  let t = tables.get(lang);
  if (!t) {
    t = cachedFetch(`${REPO}/${lang}.txt`).then((buf) => {
      const m = new Map<string, string>();
      for (const w of new TextDecoder().decode(buf).split("\n")) if (w && !w.startsWith("#")) m.set(fold(w), w);
      return m;
    });
    t.catch(() => tables.delete(lang));
    tables.set(lang, t);
  }
  return t;
}

export const hasAccentTable = (lang: string) => LANGS.has(code(lang));

function matchCase(w: string, best: string, lang: string): string {
  if (w === w.toLocaleUpperCase(lang)) return best.toLocaleUpperCase(lang);
  if (w[0] === w[0].toLocaleUpperCase(lang)) return best[0].toLocaleUpperCase(lang) + best.slice(1);
  return best;
}

export async function restoreAccents(texts: string[], lang: string): Promise<string[]> {
  const t = table(lang);
  if (!t) return texts;
  const m = await t;
  return texts.map((text) =>
    text.replace(/\p{L}+/gu, (w) => {
      const best = m.get(fold(w));
      return best ? matchCase(w, best, lang) : w;
    }),
  );
}
