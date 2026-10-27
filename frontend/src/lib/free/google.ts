// Google Translate's browser-extension endpoint: no key, open CORS. Unlike the
// rest of the free path this sends the text to Google.
const ENDPOINT = "https://clients5.google.com/translate_a/t";
const CODES: Record<string, string> = { "pt-BR": "pt", nb: "no", he: "iw", zh: "zh-CN", "zh-Hant": "zh-TW", fil: "tl" };
const code = (l: string) => CODES[l] ?? l;

export async function googleTranslate(texts: string[], tgt: string, src = "auto"): Promise<string[]> {
  const q = new URLSearchParams({ client: "dict-chrome-ex", sl: src === "auto" ? src : code(src), tl: code(tgt) });
  for (const t of texts) q.append("q", t);
  const res = await fetch(`${ENDPOINT}?${q}`);
  if (!res.ok) throw new Error(res.status === 429 ? "Google Translate is rate-limiting this network, try later" : `Google Translate: HTTP ${res.status}`);
  const out = (await res.json()) as (string | [string, string])[];
  return out.map((x) => (Array.isArray(x) ? x[0] : x));
}
