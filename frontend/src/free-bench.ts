import { decode } from "./lib/cv/image";
import { freeOCR, freeTranslate, sentenceCase } from "./lib/free/engine";
import { chromeTranslator, route, translateTexts } from "./lib/free/mt";
import { repairOCR, vlmDevice, vlmTranslate } from "./lib/free/vlm";
import type { Panel, Region, StripRecord } from "./lib/types";

type Fixture = { id: string; src: string; lang: string; image: string; panels: Panel[]; regions: Region[]; ref: Record<string, string> };

const q = new URLSearchParams(location.search);
const only = q.get("strips")?.split(",");
const systems = (q.get("systems") ?? "chrome,opus").split(",").filter(Boolean) as ("chrome" | "opus")[];
const v2 = q.has("v2");
const log = (s: string) => (document.getElementById("log")!.textContent += s + "\n");
const w = window as unknown as { __result?: unknown; __error?: string };

const record = (f: Fixture, regions: Region[], srcLang: string): StripRecord => ({
  id: f.id, name: f.id, createdAt: "", width: 0, height: 0, panels: f.panels, regions, detected: true, ocr: true, srcLang,
  drafts: {}, translations: {}, calls: [], shared: {},
});

async function run(fixtures: Fixture[]) {
  const out = [];
  for (const f of fixtures) {
    log(`== ${f.id} ${f.src}->${f.lang}`);
    const img = await decode(await fetch(`/.bench/${f.image}`).then((r) => r.blob()));
    const boxes = f.regions.map(({ source: _s, kind: _k, ...r }) => ({ ...r, replace: false }) as Region);
    const t0 = performance.now();
    const ocr = await freeOCR(img, record(f, boxes, ""));
    log(`ocr ${(ocr.ms / 1000).toFixed(1)} s · lang ${ocr.srcLang} (${ocr.langHow})`);
    const gtRec = record(f, f.regions, f.src);
    const ids = new Set(f.regions.filter((r) => r.source && r.kind !== "none").map((r) => r.id));
    const paddleRec = record(f, ocr.regions.map((r) => (ids.has(r.id) && !r.source ? { ...r, source: { text: "", lines: [], align: "center", caps: true } } : r)), ocr.srcLang);
    const res: Record<string, unknown> = { id: f.id, src: f.src, lang: f.lang, detected: ocr.srcLang, langHow: ocr.langHow, ocrMs: ocr.ms, totalOcrMs: performance.now() - t0 };
    res.paddle = Object.fromEntries(ocr.regions.filter((r) => ids.has(r.id)).map((r) => [r.id, r.source?.text ?? ""]));
    res.gt = Object.fromEntries(f.regions.filter((r) => ids.has(r.id)).map((r) => [r.id, r.source!.text]));
    res.ref = f.ref;
    for (const sys of systems) {
      for (const [name, rec] of [["paddle", paddleRec], ["gt", gtRec]] as const) {
        const t1 = performance.now();
        try {
          const tr = await freeTranslate(rec, f.lang, ids, undefined, sys);
          res[`${sys}:${name}`] = Object.fromEntries(Object.entries(tr.regions).map(([k, v]) => [k, v.text]));
          res[`${sys}:${name}:engine`] = tr.engine;
        } catch (e) {
          res[`${sys}:${name}`] = { error: String(e) };
        }
        res[`${sys}:${name}:ms`] = performance.now() - t1;
        log(`${sys}:${name} ${((performance.now() - t1) / 1000).toFixed(1)} s`);
      }
    }
    if (systems.includes("chrome")) {
      const regs = paddleRec.regions.filter((r) => ids.has(r.id));
      const caps = await translateTexts(regs.map((r) => r.source?.text ?? ""), ocr.srcLang, f.lang, undefined, "chrome").catch((e) => ({ texts: [String(e)] }));
      res["chrome:paddle-caps"] = Object.fromEntries(regs.map((r, i) => [r.id, caps.texts[i] ?? ""]));
    }
    if (v2) {
      const t2 = performance.now();
      const rp = await repairOCR(img, paddleRec.regions.filter((r) => ids.has(r.id)), ocr.srcLang);
      res.vlmMs = rp.ms;
      res.vlmDevice = vlmDevice();
      res.vlmRaw = Object.fromEntries(rp.repairs.map((x) => [x.id, x.read]));
      res.vlm = { ...(res.paddle as Record<string, string>), ...Object.fromEntries(rp.repairs.map((x) => [x.id, x.used])) };
      log(`vlm repair ${((performance.now() - t2) / 1000).toFixed(1)} s · ${vlmDevice()}`);
      const vlmRec = record(f, paddleRec.regions.map((r) => (ids.has(r.id) ? { ...r, source: { ...r.source!, text: (res.vlm as Record<string, string>)[r.id] ?? "" } } : r)), ocr.srcLang);
      if ((await route(ocr.srcLang, f.lang, "chrome")).engine === "chrome" && !q.has("nochrome")) {
        const tr = await freeTranslate(vlmRec, f.lang, ids, undefined, "chrome");
        res["chrome:vlm"] = Object.fromEntries(Object.entries(tr.regions).map(([k, v]) => [k, v.text]));
      }
      const t3 = performance.now();
      const items = vlmRec.regions.filter((r) => ids.has(r.id) && r.source?.text).map((r) => ({ id: r.id, text: r.source!.text }));
      res["qwen:vlm"] = await vlmTranslate(items, ocr.srcLang, f.lang);
      res["qwen:vlm:ms"] = performance.now() - t3;
      log(`qwen translate ${((performance.now() - t3) / 1000).toFixed(1)} s`);
    }
    out.push(res);
  }
  return out;
}

type Prior = { id: string; src: string; lang: string; detected: string; vlm: Record<string, string> } & Record<string, unknown>;

async function translatePrior(prior: Prior[], fields: string[]) {
  for (const r of prior) {
    for (const field of fields) {
      const src = { ...r.vlm, ...(r[field] as Record<string, string>) };
      const ids = Object.keys(src);
      const { texts } = await translateTexts(ids.map((id) => sentenceCase((src[id] ?? "").replace(/\s*\n\s*/g, " "), r.detected)), r.detected, r.lang, undefined, "chrome");
      r[`chrome:${field}`] = Object.fromEntries(ids.map((id, i) => [id, src[id] ? texts[i] : ""]));
    }
    log(`${r.id} done`);
  }
  return prior;
}

document.getElementById("go")!.onclick = () => {
  const prior = q.get("prior");
  if (prior) {
    for (const [s, t] of [["hu", "en"], ["en", "hu"]]) chromeTranslator(s, t).catch((e) => log(`chrome ${s}-${t}: ${e}`));
    fetch(`/.bench/${prior}`)
      .then((r) => r.json())
      .then((j: { result: Prior[] }) => translatePrior(j.result, (q.get("fields") ?? "vlm").split(",")))
      .then((r) => (w.__result = r))
      .catch((e) => (w.__error = String(e?.stack ?? e)));
    return;
  }
  if ((systems.includes("chrome") || v2) && "Translator" in self) for (const [s, t] of [["hu", "en"], ["en", "hu"]]) chromeTranslator(s, t).catch((e) => log(`chrome ${s}-${t}: ${e}`));
  fetch("/.bench/fixtures.json")
    .then((r) => r.json())
    .then((fx: Fixture[]) => run(fx.filter((f) => !only || only.includes(f.id))))
    .then((r) => (w.__result = r))
    .catch((e) => {
      w.__error = String(e?.stack ?? e);
      log(w.__error);
    });
};

