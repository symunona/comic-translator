import { batch, createSignal, onCleanup } from "solid-js";
import { createStore, reconcile, unwrap } from "solid-js/store";
import { decode, toBlob, type Img } from "./cv/image";
import { panels as findPanels } from "./cv/panels";
import { cleanStrip, detectedRegions } from "./cv/regions";
import { toBox } from "./cv/rect";
import { detectInBrowser } from "./detect";
import { contribute, fetchShared, listings, type Listing } from "./hub";
import { LLMError, type CallOptions } from "./llm/openrouter";
import { PADDLE } from "./free/models";
import { chromeStarted, chromeTranslator, route, type Progress } from "./free/mt";
import { hasWebGPU, repairOCR } from "./free/vlm";

const freeEngine = () => import("./free/engine");
const EMPTY_SCENE: Scene = { summary: "", characters: [], panels: [], speakers: {}, notes: [] };
import { langEnglishName } from "./langs";
import { getImage, loadStrip, saveStrip } from "./local";
import { reviewPass, runOCR, runScene, translatable, translatePass } from "./pipeline";
import { settings, type AiStep } from "./settings";
import { STAGES, type CallStat, type Region, type RegionTranslation, type Scene, type SharedTranslation, type StageName, type StageState, type StripRecord, type Translation } from "./types";

export type SaveState = "idle" | "pending" | "saved" | "error";
export type Phase = "loading" | "needKey" | "done" | "fatal";
export type ShareState = "off" | "needCaptcha" | "queued" | "sharing" | "shared" | "error" | "idle";

const emptyStages = () => Object.fromEntries(STAGES.map((s) => [s, { status: "pending" }])) as Record<StageName, StageState>;

const now = () => new Date().toISOString();

class Cancelled extends Error {}

export function sharedFile(rec: StripRecord, t: Translation): SharedTranslation {
  return {
    format: 1,
    hash: rec.id,
    width: rec.width,
    height: rec.height,
    srcLang: rec.srcLang ?? "",
    panels: rec.panels,
    regions: rec.regions.map(({ fitBox: _f, glyphHeight: _g, speaker: _s, ...r }) => r),
    unboxed: rec.unboxed,
    font: rec.font,
    scene: rec.scene ?? EMPTY_SCENE,
    lang: t.lang,
    translation: t.regions,
    model: t.model,
    createdAt: now(),
  };
}

export function createWork(id: string) {
  const [state, setState] = createStore({
    rec: null as StripRecord | null,
    regions: [] as Region[],
    stages: emptyStages(),
    translation: null as Translation | null,
    phase: "loading" as Phase,
    error: "",
    imageUrl: "",
    cleanUrl: "",
    listings: [] as Listing[],
    share: "idle" as ShareState,
    shareError: "",
  });
  const [lang, setLang] = createSignal("");
  const [saveState, setSaveState] = createSignal<SaveState>("idle");

  let orig: Img | null = null;
  let gen = 0;
  let abort: AbortController | null = null;
  let cleanUrl = "";
  let imageUrl = "";

  let cur: StripRecord | null = null;
  const stage = (name: StageName, s: StageState) => setState("stages", name, s);
  const rec = () => cur!;
  const plain = <T,>(v: T): T => structuredClone(unwrap(v));

  const mutate = (fn: (r: StripRecord) => void) => {
    const r = structuredClone(rec());
    fn(r);
    saveStrip(r);
    cur = r;
    setState("rec", reconcile(structuredClone(r)));
    return r;
  };

  const withSpeakers = (r: StripRecord, regs: Region[]) => regs.map((x) => ({ ...x, speaker: r.scene?.speakers?.[x.id] }));

  const reclean = async () => {
    if (!orig) return;
    const { clean, regions } = cleanStrip(orig, rec().regions);
    const url = URL.createObjectURL(await toBlob(clean));
    if (cleanUrl) URL.revokeObjectURL(cleanUrl);
    cleanUrl = url;
    batch(() => {
      setState("regions", reconcile(withSpeakers(rec(), regions)));
      setState("cleanUrl", url);
    });
  };

  const onStat = (s: CallStat) => mutate((r) => void r.calls.push(s));

  const llm = (stageName: string, signal: AbortSignal, model = settings.model()): CallOptions => ({ key: settings.apiKey(), model, stage: stageName, signal, onStat });

  const check = (g: number) => {
    if (g !== gen) throw new Cancelled();
  };

  const timed = async <T>(name: StageName, fn: () => Promise<T>, message?: (t: T) => string): Promise<T> => {
    stage(name, { status: "running" });
    const t0 = performance.now();
    const out = await fn();
    stage(name, { status: "done", message: message?.(out) ?? `${((performance.now() - t0) / 1000).toFixed(1)} s` });
    return out;
  };

  const applyShared = (f: SharedTranslation, l: Listing, withTranslation: boolean) =>
    mutate((r) => {
      r.panels = f.panels;
      r.regions = f.regions;
      r.detected = true;
      r.ocr = true;
      r.ocrFree = false;
      r.ocrBy = l.demo ? "demo" : "shared";
      r.srcLang = f.srcLang || r.srcLang;
      r.unboxed = f.unboxed;
      r.font = f.font || r.font;
      r.scene = f.scene;
      if (withTranslation) {
        r.translations[f.lang] = { lang: f.lang, regions: f.translation, updatedAt: f.createdAt || now(), model: f.model, origin: l.demo ? "demo" : "shared", by: f.nick || l.nick };
        r.shared[f.lang] = typeof l.id === "number" ? l.id : -1;
      }
    });

  // fresh makes a new version: no cached translation, no shared one. It holds
  // across retries until the version is done or the language changes.
  let wantFresh = false;
  const run = async (l: string, fresh = wantFresh) => {
    const g = ++gen;
    abort?.abort();
    const ac = new AbortController();
    abort = ac;
    batch(() => {
      setState("stages", emptyStages());
      setState("phase", "loading");
      setState("error", "");
      setState("translation", null);
    });
    try {
      const loaded = loadStrip(id);
      if (!loaded) throw new Error("This strip is not in this browser. Open it from the home page or drop the image again.");
      let r: StripRecord = loaded;
      cur = r;
      setState("rec", reconcile(structuredClone(r)));
      if (!orig) {
        const blob = await getImage(id);
        if (!blob) throw new Error("The image of this strip is missing from this browser. Drop it again.");
        imageUrl = URL.createObjectURL(blob);
        setState("imageUrl", imageUrl);
        orig = await decode(blob);
      }
      check(g);

      if (!r.panels.length) {
        await timed("panels", async () => {
          const rects = findPanels(orig!);
          r = mutate((x) => void (x.panels = rects.map((rc, i) => ({ id: `p${i}`, order: i, bbox: toBox(rc) }))));
          return rects.length;
        }, (n) => `${n} panel${n === 1 ? "" : "s"}`);
      } else stage("panels", { status: "cached", message: `${r.panels.length} panels` });
      check(g);

      if (!r.detected) {
        stage("detect", { status: "running", message: "loading detector…" });
        const det = await detectInBrowser(state.imageUrl, r.panels, (done, total, device) =>
          stage("detect", { status: "running", message: device, progress: { done, total } }),
        );
        check(g);
        const regions = detectedRegions(r.panels, det.result.panels);
        r = mutate((x) => {
          x.regions = regions;
          x.detected = true;
        });
        stage("detect", { status: "done", message: `${regions.length} text areas · ${(det.result.ms / 1000).toFixed(1)} s` });
      } else stage("detect", { status: "cached", message: `${r.regions.length} text areas` });
      check(g);

      await timed("clean", reclean);
      check(g);

      const have = r.translations[l];
      if (have && !fresh) {
        batch(() => {
          for (const s of ["shared", "ocr", "scene", "translate", "review"] as const) stage(s, { status: "cached" });
          setState("translation", reconcile(structuredClone(have)));
          setState("phase", "done");
        });
        refreshListings();
        return;
      }

      const found = fresh ? [] : await (stage("shared", { status: "running", message: "looking for shared translations" }), listings(id));
      check(g);
      if (!fresh) setState("listings", found);
      const exact = found.find((x) => x.lang === l);
      const base = exact ?? (!r.ocr ? found[0] : undefined);
      if (base) {
        const f = await fetchShared(base);
        check(g);
        r = applyShared(f, base, !!exact && f.lang === l);
        await reclean();
        if (exact) {
          stage("shared", { status: "done", message: `${base.demo ? "demo" : "shared"} translation${base.nick ? ` by ${base.nick}` : ""}` });
          for (const s of ["ocr", "scene", "translate", "review"] as const) stage(s, { status: "skipped" });
          batch(() => {
            setState("translation", reconcile(structuredClone(rec().translations[l])));
            setState("phase", "done");
            setState("share", "shared");
          });
          return;
        }
        stage("shared", { status: "done", message: `reusing text and scene from a ${base.lang} translation` });
      } else if (fresh) stage("shared", { status: "skipped", message: "new version" });
      else stage("shared", { status: "done", message: found.length ? "none in this language" : settings.share() ? "nothing shared yet" : "sharing is off" });

      // Each step reads its engine when it starts, so a switch mid-run takes
      // effect from the next step.
      const keyMissing = () => {
        if (settings.apiKey()) return false;
        setState("phase", "needKey");
        return true;
      };

      if (!settings.isFree("ocr") && (!r.ocr || r.ocrFree)) {
        if (keyMissing()) return;
        const m = settings.modelFor("ocr");
        await timed("ocr", async () => {
          const o = await runOCR(orig!, r, llm("ocr", ac.signal, m));
          check(g);
          r = mutate((x) => {
            x.panels = o.panels;
            x.regions = o.regions;
            x.srcLang = o.srcLang;
            x.unboxed = o.unboxed;
            x.font = o.font;
            x.ocr = true;
            x.ocrFree = false;
            x.ocrBy = m;
          });
          await reclean();
          return o;
        }, (o) => `${o.regions.filter((x) => x.source).length} texts · ${o.srcLang}${o.rtl ? " · right to left" : ""}${o.font ? ` · ${o.font}` : ""}`);
      } else if (!r.ocr) r = await readFree(r, g);
      else stage("ocr", { status: "cached", message: r.srcLang });
      check(g);

      if (r.scene) stage("scene", { status: "cached" });
      else if (settings.isFree("scene")) stage("scene", { status: "skipped", message: "free: skipped" });
      else {
        if (keyMissing()) return;
        await timed("scene", async () => {
          const sc = await runScene(orig!, r, llm("scene", ac.signal, settings.modelFor("scene")));
          check(g);
          r = mutate((x) => void (x.scene = sc));
          setState("regions", (regs) => withSpeakers(r, regs));
        });
      }
      check(g);

      const ids = translatable(r);
      let draft = r.drafts[l];
      if (!draft) {
        let by: string;
        if (settings.isFree("translate")) {
          const out = await translateFree(r, l, g);
          if (!out) return;
          draft = out.regions;
          by = `free:${rec().ocrBy ?? (rec().ocrFree ? PADDLE.name : "llm-ocr")}+${out.engine}`;
        } else {
          if (keyMissing()) return;
          by = settings.modelFor("translate");
          draft = await timed("translate", () => translatePass(orig!, r, { lang: l, ids }, llm(`translate:${l}`, ac.signal, by)));
        }
        check(g);
        const d = draft;
        r = mutate((x) => {
          x.drafts[l] = d;
          x.draftBy = { ...x.draftBy, [l]: by };
        });
      } else stage("translate", { status: "cached" });
      setState("translation", { lang: l, regions: structuredClone(draft), updatedAt: now(), origin: "llm", draft: true });

      let final = draft;
      let model = r.draftBy?.[l] ?? settings.model();
      let reviewError = "";
      if (settings.isFree("review")) stage("review", { status: "skipped", message: "free: skipped" });
      else if (keyMissing()) return;
      else {
        const m = settings.modelFor("review");
        try {
          final = await timed("review", () => reviewPass(orig!, r, { lang: l, ids }, draft!, llm(`review:${l}`, ac.signal, m)));
          if (m !== model) model += `+review:${m}`;
        } catch (e) {
          if (e instanceof Cancelled || ac.signal.aborted) throw e;
          reviewError = e instanceof Error ? e.message : String(e);
          stage("review", { status: "error", message: `${reviewError} · kept the draft` });
        }
      }
      check(g);
      finish({ lang: l, regions: final, updatedAt: now(), model, origin: "llm", draft: !!reviewError });
    } catch (e) {
      if (e instanceof Cancelled || (e instanceof DOMException && e.name === "AbortError")) return;
      if (g !== gen) return;
      const msg = e instanceof Error ? e.message : String(e);
      const running = STAGES.find((s) => state.stages[s].status === "running");
      if (running) stage(running, { status: "error", message: msg });
      if (e instanceof LLMError && (e.status === 401 || e.status === 402)) {
        batch(() => {
          setState("error", e.status === 402 ? "Your OpenRouter balance is empty. Add credits and try again." : "OpenRouter rejected the API key.");
          setState("phase", "needKey");
        });
        return;
      }
      batch(() => {
        setState("phase", "fatal");
        setState("error", msg);
      });
    }
  };

  const progress =
    (name: StageName): Progress =>
    (p) =>
      stage(name, { status: "running", message: p.message, progress: p.total ? { done: p.done ?? 0, total: p.total } : undefined });

  const needClick = (message: string) =>
    batch(() => {
      setState("error", message);
      setState("phase", "needKey");
    });

  function finish(t: Translation) {
    wantFresh = false;
    mutate((x) => (x.translations[t.lang] = t));
    batch(() => {
      setState("translation", reconcile(structuredClone(t)));
      setState("phase", "done");
    });
    autoShare();
  }

  // readFree reads the bubbles on this computer: Paddle OCR, language guess,
  // accents, and the optional Qwen re-read on WebGPU.
  async function readFree(r: StripRecord, g: number): Promise<StripRecord> {
    const { freeOCR, withAccents } = await freeEngine();
    let note = "";
    await timed("ocr", async () => {
      const o = await freeOCR(orig!, r, progress("ocr"));
      check(g);
      let by: string = PADDLE.name;
      if (settings.freeGpu() && (await hasWebGPU())) {
        try {
          const { repairs } = await repairOCR(orig!, o.regions, o.srcLang, progress("ocr"));
          check(g);
          const fixes = new Map(repairs.map((x) => [x.id, x]));
          o.regions = o.regions.map((reg) => {
            const fix = fixes.get(reg.id);
            return fix?.ok && reg.source ? { ...reg, source: { ...reg.source, text: fix.used, lines: fix.lines } } : reg;
          });
          o.regions = await withAccents(o.regions, o.srcLang);
          by += "+qwen3.5-0.8b";
        } catch (e) {
          if (e instanceof Cancelled) throw e;
          note = " · GPU letter check failed, kept the plain OCR";
        }
      }
      r = mutate((x) => {
        x.regions = o.regions;
        x.srcLang = o.srcLang;
        x.unboxed = o.unboxed;
        x.ocr = true;
        x.ocrFree = true;
        x.ocrBy = by;
      });
      await reclean();
      return o;
    }, (o) => `${o.regions.filter((x) => x.source).length} texts · ${langEnglishName(o.srcLang)}${note}`);
    return r;
  }

  // translateFree translates on this computer: Chrome's built-in translator or
  // opus-mt. null when it has to wait for a click or no translator fits.
  async function translateFree(r: StripRecord, l: string, g: number): Promise<{ regions: Record<string, RegionTranslation>; engine: string } | null> {
    const src = r.srcLang ?? "hu";
    const ids = translatable(r);
    if (src === l || !ids.size) {
      stage("translate", { status: "skipped", message: src === l ? "already in this language" : "no text" });
      return { regions: Object.fromEntries(r.regions.filter((x) => ids.has(x.id)).map((x) => [x.id, { text: x.source!.text }])), engine: "copy" };
    }
    const rt = await route(src, l);
    check(g);
    const pair = `${langEnglishName(src)} → ${langEnglishName(l)}`;
    if (rt.engine === "none") {
      stage("translate", { status: "error", message: `no free translator for ${pair} here` });
      needClick(`No free translator for ${pair} in this browser. Chrome on a desktop has the most languages, or use an OpenRouter key.`);
      return null;
    }
    if (rt.engine === "chrome" && rt.state === "download" && !navigator.userActivation?.isActive && !chromeStarted(src, l)) {
      stage("translate", { status: "pending", message: "waiting for one click" });
      needClick(`Chrome downloads its ${pair} translator once, after one click.`);
      return null;
    }
    const { freeTranslate } = await freeEngine();
    const tr = await timed("translate", () => freeTranslate(r, l, ids, progress("translate")), (x) => x.engine);
    check(g);
    return tr;
  }

  const refreshListings = () => listings(id).then((ls) => setState("listings", ls)).catch(() => {});

  const connect = (l: string) => {
    flush();
    publishPending();
    setLang(l);
    wantFresh = false;
    setState("share", "idle");
    run(l);
  };

  const retry = () => run(lang());

  const publishable = (t?: Translation) => !!t && (t.origin === "llm" || t.origin === "user") && Object.values(t.regions).some((x) => x.text.trim());

  // shareNow posts the saved translation of the current language. auto never asks
  // for the captcha: without a session it leaves the manual button.
  const shareNow = async (auto = false) => {
    const l = lang();
    if (!auto) {
      clearTimeout(publishTimer);
      publishTimer = undefined;
    }
    await flush();
    if (!cur) return;
    const t = rec().translations[l];
    if (!publishable(t)) return;
    const live = () => lang() === l;
    if (!settings.validSession()) {
      if (live()) setState("share", auto ? "idle" : "needCaptcha");
      return;
    }
    lastPublish = Date.now();
    if (live()) setState("share", "sharing");
    try {
      const sid = await contribute(sharedFile(rec(), t));
      mutate((x) => void (x.shared[l] = sid));
      if (live()) setState("share", "shared");
      refreshListings();
    } catch (e) {
      if (live())
        batch(() => {
          setState("share", "error");
          setState("shareError", e instanceof Error ? e.message : String(e));
        });
    }
  };

  function autoShare() {
    const t = state.translation;
    if (!t || !settings.share()) return setState("share", "off");
    if (rec().shared[t.lang] !== undefined) return setState("share", "shared");
    shareNow(true);
  }

  // Edits publish on their own while sharing is on: after PUBLISH_QUIET_MS without
  // edits, at most once per PUBLISH_GAP_MS. The hub keeps every version, newest first.
  const PUBLISH_QUIET_MS = 15_000;
  const PUBLISH_GAP_MS = 60_000;
  let publishTimer: number | undefined;
  let lastPublish = 0;

  function schedulePublish() {
    if (!settings.share()) return setState("share", "off");
    clearTimeout(publishTimer);
    const wait = Math.max(PUBLISH_QUIET_MS, lastPublish + PUBLISH_GAP_MS - Date.now());
    publishTimer = window.setTimeout(() => {
      publishTimer = undefined;
      shareNow(true);
    }, wait);
    setState("share", "queued");
  }

  function publishPending() {
    if (publishTimer === undefined) return;
    clearTimeout(publishTimer);
    publishTimer = undefined;
    shareNow(true);
  }

  let timer: number | undefined;

  const persistTranslation = () => {
    const t = state.translation;
    if (!t || !state.rec) return;
    try {
      mutate((x) => {
        x.translations[t.lang] = { ...plain(t), draft: false };
        delete x.shared[t.lang];
      });
      setSaveState(timer === undefined ? "saved" : "pending");
    } catch {
      setSaveState("error");
    }
  };

  function flush(): Promise<void> {
    if (timer === undefined) return Promise.resolve();
    clearTimeout(timer);
    timer = undefined;
    persistTranslation();
    return Promise.resolve();
  }

  const editText = (rid: string, text: string) => {
    if (!state.translation) return;
    batch(() => {
      setState("translation", "regions", rid, (x) => ({ ...(x ?? {}), text }));
      setState("translation", "edited", true);
      if (state.translation?.origin === "shared" || state.translation?.origin === "demo") setState("translation", "origin", "llm");
    });
    schedulePublish();
    setSaveState("pending");
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = undefined;
      persistTranslation();
    }, 500);
  };

  const setReplace = async (rid: string, replace: boolean) => {
    mutate((x) => {
      const reg = x.regions.find((y) => y.id === rid);
      if (reg) reg.replace = replace;
    });
    if (publishable(rec().translations[lang()])) schedulePublish();
    await reclean();
  };

  const retranslate = async (rid: string, hint?: string) => {
    const free = settings.isFree("translate");
    if (!free && !settings.apiKey()) {
      setState("phase", "needKey");
      return;
    }
    await flush();
    const l = lang();
    const r = rec();
    const ids = translatable(r, [rid]);
    if (!ids.size || !orig) return;
    let entry: RegionTranslation | undefined;
    if (free) entry = (await (await freeEngine()).freeTranslate(r, l, ids)).regions[rid];
    else {
      const signal = new AbortController().signal;
      const pass = { lang: l, ids, current: state.translation ? plain(state.translation.regions) : undefined, hint };
      const draft = await translatePass(orig, r, pass, llm("retranslate", signal, settings.modelFor("translate")));
      const final = settings.isFree("review") ? draft : await reviewPass(orig, r, pass, draft, llm("retranslate", signal, settings.modelFor("review"))).catch(() => draft);
      entry = final[rid];
    }
    if (entry && state.translation) {
      setState("translation", "regions", rid, entry);
      setState("translation", "origin", "llm");
      persistTranslation();
      schedulePublish();
    }
  };

  // goFree moves every step to this computer and runs, still inside the click so
  // Chrome may download its translator pack.
  const goFree = () => {
    settings.setAllFree(true);
    settings.setPathChoice("free");
    const src = cur?.srcLang;
    const l = lang();
    if (src)
      route(src, l).then((rt) => {
        if (rt.engine === "chrome" && rt.state === "download") chromeTranslator(src, l).catch(() => {});
      });
    run(l);
  };

  // googleSuggest asks Google Translate for one bubble. It sends the text to Google.
  const googleSuggest = async (rid: string): Promise<string> => {
    const r = rec();
    const reg = r.regions.find((x) => x.id === rid);
    if (!reg?.source) return "";
    const [{ googleTranslate }, { sentenceCase }] = await Promise.all([import("./free/google"), freeEngine()]);
    const src = r.srcLang ?? "auto";
    const [out] = await googleTranslate([sentenceCase(reg.source.text, src === "auto" ? "en" : src)], lang(), src);
    return out ?? "";
  };

  // newVersion runs the read/translate steps again with the current settings and
  // keeps the current translation among the versions of this language.
  const MAX_VERSIONS = 10;
  // rerunFrom reruns one AI step with its current engine and every step after it.
  // Text and scene feed every language, so their reruns drop all drafts.
  const rerunFrom = async (from: AiStep) => {
    const l = lang();
    await flush();
    clearTimeout(publishTimer);
    publishTimer = undefined;
    setState("share", "idle");
    mutate((x) => {
      const t = x.translations[l];
      if (t) x.versions = { ...x.versions, [l]: [t, ...(x.versions?.[l] ?? [])].slice(0, MAX_VERSIONS) };
      delete x.translations[l];
      delete x.shared[l];
      if (from === "ocr") x.ocr = false;
      if (from === "ocr" || from === "scene") {
        delete x.scene;
        x.drafts = {};
        x.draftBy = {};
      }
      if (from === "translate") delete x.drafts[l];
    });
    wantFresh = true;
    run(l);
  };
  const newVersion = () => rerunFrom("translate");

  // pickVersion makes an older version current; the current one joins the others.
  const pickVersion = async (i: number) => {
    const l = lang();
    await flush();
    clearTimeout(publishTimer);
    publishTimer = undefined;
    const r = mutate((x) => {
      const old = x.versions?.[l] ?? [];
      const pick = old[i];
      if (!pick) return;
      const cur = x.translations[l];
      x.versions = { ...x.versions, [l]: cur ? old.map((v, j) => (j === i ? cur : v)) : old.filter((_, j) => j !== i) };
      x.translations[l] = pick;
      delete x.shared[l];
    });
    batch(() => {
      setState("translation", reconcile(structuredClone(r.translations[l])));
      setState("share", "idle");
    });
  };

  // editEmpty opens the editor with every bubble blank, for lettering by hand.
  const editEmpty = () => {
    const l = lang();
    if (!state.rec || !orig) return;
    gen++;
    abort?.abort();
    const t: Translation = { lang: l, regions: Object.fromEntries(rec().regions.map((r) => [r.id, { text: "" }])), updatedAt: now(), origin: "user", edited: true };
    mutate((x) => (x.translations[l] = t));
    batch(() => {
      for (const st of STAGES) if (state.stages[st].status === "pending" || state.stages[st].status === "running") stage(st, { status: "skipped" });
      setState("translation", reconcile(structuredClone(t)));
      setState("phase", "done");
      setState("error", "");
      setState("share", "off");
    });
  };

  // translateAI drops a hand-made translation and runs the LLM steps for the language.
  const translateAI = () => {
    const l = lang();
    flush();
    clearTimeout(publishTimer);
    publishTimer = undefined;
    mutate((x) => void delete x.translations[l]);
    run(l);
  };

  onCleanup(() => {
    flush();
    publishPending();
    gen++;
    abort?.abort();
    if (cleanUrl) URL.revokeObjectURL(cleanUrl);
    if (imageUrl) URL.revokeObjectURL(imageUrl);
  });

  return { state, lang, connect, retry, editText, setReplace, retranslate, flush, saveState, shareNow, editEmpty, translateAI, googleSuggest, newVersion, rerunFrom, goFree, pickVersion };
}

export type Work = ReturnType<typeof createWork>;
