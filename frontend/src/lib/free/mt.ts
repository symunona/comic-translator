import type { OpusMessage, OpusRequest } from "./opus.worker";

const OPUS_PAIRS = new Set(
  "af-en ar-en cs-en da-de da-en de-en de-es de-fr en-af en-ar en-cs en-da en-de en-es en-fi en-fr en-hi en-hu en-id en-it en-nl en-ro en-ru en-sv en-uk en-vi en-xh en-zh es-de es-en es-fr es-it es-ru et-en fi-de fi-en fr-de fr-en fr-es fr-ro fr-ru hi-en hu-en id-en it-en it-es it-fr ja-en ko-en nl-en nl-fr no-de pl-en ro-fr ru-en ru-es ru-fr ru-uk sv-en th-en tr-en uk-en uk-ru vi-en xh-en zh-en".split(
    " ",
  ),
);

export type Progress = (p: { message: string; done?: number; total?: number }) => void;

type Translator = { translate(text: string): Promise<string> };
type TranslatorApi = {
  availability(o: { sourceLanguage: string; targetLanguage: string }): Promise<string>;
  create(o: { sourceLanguage: string; targetLanguage: string; monitor?: (m: EventTarget) => void }): Promise<Translator>;
};

const api = () => (globalThis as { Translator?: TranslatorApi }).Translator;
const base = (code: string) => code.split("-")[0];

export type MtRoute = { engine: "chrome"; state: "ready" | "download" } | { engine: "opus"; repos: string[] } | { engine: "none" };

export async function route(src: string, tgt: string, only?: "chrome" | "opus"): Promise<MtRoute> {
  const a = api();
  if (a && only !== "opus") {
    const s = await a.availability({ sourceLanguage: base(src), targetLanguage: tgt }).catch(() => "unavailable");
    if (s === "available") return { engine: "chrome", state: "ready" };
    if (s === "downloadable" || s === "downloading") return { engine: "chrome", state: "download" };
  }
  if (only === "chrome") return { engine: "none" };
  const s = base(src);
  const t = base(tgt);
  if (OPUS_PAIRS.has(`${s}-${t}`)) return { engine: "opus", repos: [`Xenova/opus-mt-${s}-${t}`] };
  if (OPUS_PAIRS.has(`${s}-en`) && OPUS_PAIRS.has(`en-${t}`)) return { engine: "opus", repos: [`Xenova/opus-mt-${s}-en`, `Xenova/opus-mt-en-${t}`] };
  return { engine: "none" };
}

const chromeTranslators = new Map<string, Promise<Translator>>();

export const chromeStarted = (src: string, tgt: string) => chromeTranslators.has(`${base(src)}-${tgt}`);

// chromeTranslator must first run inside a click when Chrome still has to download the pack.
// Chromium reports "downloadable" but never downloads: give up when no progress arrives.
const STALL_MS = 45_000;

export function chromeTranslator(src: string, tgt: string, onProgress?: Progress): Promise<Translator> {
  const key = `${base(src)}-${tgt}`;
  let t = chromeTranslators.get(key);
  if (!t) {
    t = new Promise<Translator>((resolve, reject) => {
      let timer = 0;
      const arm = () => {
        clearTimeout(timer);
        timer = window.setTimeout(() => reject(new Error("Chrome's translator download stalled")), STALL_MS);
      };
      arm();
      api()!
        .create({
          sourceLanguage: base(src),
          targetLanguage: tgt,
          monitor: (m) =>
            m.addEventListener("downloadprogress", (e) => {
              arm();
              onProgress?.({ message: "Chrome downloads the translator…", done: Math.round((e as ProgressEvent).loaded * 100), total: 100 });
            }),
        })
        .then(resolve, reject)
        .finally(() => clearTimeout(timer));
    });
    t.catch(() => chromeTranslators.delete(key));
    chromeTranslators.set(key, t);
  }
  return t;
}

let opusWorker: Worker | null = null;

function opus(repo: string, texts: string[], onProgress?: Progress): Promise<string[]> {
  opusWorker ??= new Worker(new URL("./opus.worker.ts", import.meta.url), { type: "module" });
  const w = opusWorker;
  const name = repo.split("/")[1];
  return new Promise((resolve, reject) => {
    w.onerror = (e) => reject(new Error(e.message || "translator worker failed"));
    w.onmessage = (e: MessageEvent<OpusMessage>) => {
      const m = e.data;
      if (m.type === "loading") onProgress?.({ message: `downloading ${name} · ${(m.loaded / 1e6).toFixed(0)} of ${(m.total / 1e6).toFixed(0)} MB`, done: m.loaded, total: m.total });
      else if (m.type === "progress") onProgress?.({ message: name, done: m.done, total: m.total });
      else if (m.type === "result") resolve(m.texts);
      else reject(new Error(m.message));
    };
    w.postMessage({ repo, texts } satisfies OpusRequest);
  });
}

export async function translateTexts(texts: string[], src: string, tgt: string, onProgress?: Progress, only?: "chrome" | "opus"): Promise<{ texts: string[]; engine: string }> {
  const r = await route(src, tgt, only);
  if (r.engine === "none") throw new Error(`No free translator for ${src} → ${tgt} in this browser. Chrome on a desktop has the most languages.`);
  if (r.engine === "chrome") {
    const t = await chromeTranslator(src, tgt, onProgress).catch(async (e) => {
      if (only === "chrome" || (await route(src, tgt, "opus")).engine === "none") throw e;
      return null;
    });
    if (!t) return translateTexts(texts, src, tgt, onProgress, "opus");
    const out: string[] = [];
    for (const [i, s] of texts.entries()) {
      out.push(s ? await t.translate(s) : "");
      onProgress?.({ message: "Chrome translator", done: i + 1, total: texts.length });
    }
    return { texts: out, engine: "chrome-translator" };
  }
  let cur = texts;
  for (const repo of r.repos) cur = await opus(repo, cur, onProgress);
  return { texts: cur, engine: r.repos.map((x) => x.split("/")[1]).join("+") };
}
