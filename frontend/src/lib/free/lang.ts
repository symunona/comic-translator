import { franc } from "franc-min";

const ISO3: Record<string, string> = {
  hun: "hu", eng: "en", deu: "de", fra: "fr", spa: "es", ita: "it", por: "pt", nld: "nl", pol: "pl", ces: "cs", slk: "sk",
  ron: "ro", hrv: "hr", srp: "sr", bos: "bs", slv: "sl", swe: "sv", dan: "da", nob: "nb", fin: "fi", est: "et", lit: "lt",
  lvs: "lv", tur: "tr", ind: "id", zlm: "ms", vie: "vi", tgl: "tl", swh: "sw", cat: "ca", glg: "gl", eus: "eu", afr: "af",
  azj: "az", uzn: "uz", som: "so", hau: "ha", yor: "yo", ibo: "ig", zul: "zu", xho: "xh",
};

const STOPWORDS: Record<string, string> = {
  en: "the you i is are was to of and it do what why how would my me that this in on not no yes with have be we they he she your can just",
  hu: "az es hogy nem ez meg is van volt mi de csak mar egy ki mit te en itt ott na hat jo igen ha mert akkor most nekem neked ezt azt vagy vagyok lesz kell",
  de: "der die das und ist nicht ich du er sie es ein eine was wie warum mit auf zu den dem ja nein mein dein wir",
  fr: "le la les et est pas je tu il elle un une que qui quoi pourquoi avec sur dans ce mon ton oui non nous vous",
  es: "el la los las y es no yo tu un una que por para con en mi su pero si como esta",
  it: "il lo la gli le e non io tu un una che per con mi ma si come questo sono",
  nl: "de het een en is niet ik je jij wat waarom met op te van dat dit ja nee mijn",
  pl: "nie jest to i w na z ze co jak dlaczego tak ja ty mnie sie czy",
  pt: "o a os as e nao eu voce um uma que com em meu sim mas por",
};
const STOP = Object.entries(STOPWORDS).map(([lang, w]) => [lang, new Set(w.split(" "))] as const);

function byStopwords(text: string): string | null {
  const words = text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^\p{L}]+/u)
    .filter((w) => w.length > 1);
  const scores = STOP.map(([lang, set]) => [lang, words.filter((w) => set.has(w)).length] as const).sort((a, b) => b[1] - a[1]);
  const [[lang, top], [, next]] = scores;
  return top >= 2 && top >= 1.5 * next ? lang : null;
}

type Detector = { detect(text: string): Promise<{ detectedLanguage: string; confidence: number }[]> };
type DetectorApi = { availability(): Promise<string>; create(): Promise<Detector> };

let chrome: Promise<Detector | null> | null = null;

function chromeDetector(): Promise<Detector | null> {
  chrome ??= (async () => {
    const api = (globalThis as { LanguageDetector?: DetectorApi }).LanguageDetector;
    if (!api || (await api.availability()) !== "available") return null;
    return api.create();
  })().catch(() => null);
  return chrome;
}

export type Detected = { lang: string; how: string; confidence?: number };

export async function detectLang(text: string, fallback = "hu"): Promise<Detected> {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return { lang: fallback, how: "none" };
  const d = await chromeDetector();
  if (d) {
    const [top] = await d.detect(t.toLowerCase());
    if (top && top.detectedLanguage !== "und" && top.confidence >= 0.3) return { lang: top.detectedLanguage, how: "chrome", confidence: top.confidence };
  }
  const stop = byStopwords(t);
  if (stop) return { lang: stop, how: "stopwords" };
  const code = ISO3[franc(t.toLowerCase(), { minLength: 8 })];
  return code ? { lang: code, how: "franc" } : { lang: fallback, how: "default" };
}
