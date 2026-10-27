import { batch, createSignal, onCleanup } from "solid-js";
import { createStore, reconcile, unwrap } from "solid-js/store";
import { decode, toBlob, type Img } from "./cv/image";
import { panels as findPanels } from "./cv/panels";
import { cleanStrip, detectedRegions } from "./cv/regions";
import { toBox } from "./cv/rect";
import { detectInBrowser } from "./detect";
import { contribute, fetchShared, listings, type Listing } from "./hub";
import { LLMError, type CallOptions } from "./llm/openrouter";
import { getImage, loadStrip, saveStrip } from "./local";
import { reviewPass, runOCR, runScene, translatable, translatePass } from "./pipeline";
import { settings } from "./settings";
import { STAGES, type CallStat, type Region, type SharedTranslation, type StageName, type StageState, type StripRecord, type Translation } from "./types";

export type SaveState = "idle" | "pending" | "saved" | "error";
export type Phase = "loading" | "needKey" | "done" | "fatal";
export type ShareState = "off" | "needCaptcha" | "sharing" | "shared" | "error" | "idle";

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
    scene: rec.scene!,
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

  const llm = (stageName: string, signal: AbortSignal): CallOptions => ({ key: settings.apiKey(), model: settings.model(), stage: stageName, signal, onStat });

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
      r.srcLang = f.srcLang || r.srcLang;
      r.unboxed = f.unboxed;
      r.font = f.font || r.font;
      r.scene = f.scene;
      if (withTranslation) {
        r.translations[f.lang] = { lang: f.lang, regions: f.translation, updatedAt: f.createdAt || now(), model: f.model, origin: l.demo ? "demo" : "shared", by: f.nick || l.nick };
        r.shared[f.lang] = typeof l.id === "number" ? l.id : -1;
      }
    });

  const run = async (l: string) => {
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
      if (have) {
        batch(() => {
          for (const s of ["shared", "ocr", "scene", "translate", "review"] as const) stage(s, { status: "cached" });
          setState("translation", reconcile(structuredClone(have)));
          setState("phase", "done");
        });
        refreshListings();
        return;
      }

      stage("shared", { status: "running", message: "looking for shared translations" });
      const found = await listings(id);
      check(g);
      setState("listings", found);
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
      } else stage("shared", { status: "done", message: found.length ? "none in this language" : settings.share() ? "nothing shared yet" : "sharing is off" });

      if (!settings.apiKey()) {
        setState("phase", "needKey");
        return;
      }

      if (!r.ocr) {
        await timed("ocr", async () => {
          const o = await runOCR(orig!, r, llm("ocr", ac.signal));
          check(g);
          r = mutate((x) => {
            x.panels = o.panels;
            x.regions = o.regions;
            x.srcLang = o.srcLang;
            x.unboxed = o.unboxed;
            x.font = o.font;
            x.ocr = true;
          });
          await reclean();
          return o;
        }, (o) => `${o.regions.filter((x) => x.source).length} texts · ${o.srcLang}${o.rtl ? " · right to left" : ""}${o.font ? ` · ${o.font}` : ""}`);
      } else stage("ocr", { status: "cached", message: r.srcLang });
      check(g);

      if (!r.scene) {
        await timed("scene", async () => {
          const sc = await runScene(orig!, r, llm("scene", ac.signal));
          check(g);
          r = mutate((x) => void (x.scene = sc));
          setState("regions", (regs) => withSpeakers(r, regs));
        });
      } else stage("scene", { status: "cached" });
      check(g);

      const ids = translatable(r);
      let draft = r.drafts[l];
      if (!draft) {
        draft = await timed("translate", () => translatePass(orig!, r, { lang: l, ids }, llm(`translate:${l}`, ac.signal)));
        check(g);
        const d = draft;
        r = mutate((x) => void (x.drafts[l] = d));
      } else stage("translate", { status: "cached" });
      setState("translation", { lang: l, regions: structuredClone(draft), updatedAt: now(), origin: "llm", draft: true });

      let final = draft;
      let reviewError = "";
      try {
        final = await timed("review", () => reviewPass(orig!, r, { lang: l, ids }, draft!, llm(`review:${l}`, ac.signal)));
      } catch (e) {
        if (e instanceof Cancelled || ac.signal.aborted) throw e;
        reviewError = e instanceof Error ? e.message : String(e);
        stage("review", { status: "error", message: `${reviewError} · kept the draft` });
      }
      check(g);
      const t: Translation = { lang: l, regions: final, updatedAt: now(), model: settings.model(), origin: "llm", draft: !!reviewError };
      r = mutate((x) => (x.translations[l] = t));
      batch(() => {
        setState("translation", reconcile(structuredClone(t)));
        setState("phase", "done");
      });
      autoShare();
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

  const refreshListings = () => listings(id).then((ls) => setState("listings", ls)).catch(() => {});

  const connect = (l: string) => {
    flush();
    setLang(l);
    setState("share", "idle");
    run(l);
  };

  const retry = () => run(lang());

  const shareNow = async () => {
    const t = state.translation;
    const r = state.rec;
    if (!t || !r?.scene || t.origin !== "llm") return;
    if (!settings.validSession()) {
      setState("share", "needCaptcha");
      return;
    }
    await flush();
    setState("share", "sharing");
    try {
      const sid = await contribute(sharedFile(rec(), rec().translations[t.lang]));
      mutate((x) => void (x.shared[t.lang] = sid));
      setState("share", "shared");
      refreshListings();
    } catch (e) {
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
    shareNow();
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
      setState("share", settings.share() ? "idle" : "off");
    });
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
    await reclean();
  };

  const retranslate = async (rid: string, hint?: string) => {
    if (!settings.apiKey()) {
      setState("phase", "needKey");
      return;
    }
    await flush();
    const l = lang();
    const r = rec();
    const ids = translatable(r, [rid]);
    if (!ids.size || !orig) return;
    const signal = new AbortController().signal;
    const pass = { lang: l, ids, current: state.translation ? plain(state.translation.regions) : undefined, hint };
    const draft = await translatePass(orig, r, pass, llm("retranslate", signal));
    const final = await reviewPass(orig, r, pass, draft, llm("retranslate", signal)).catch(() => draft);
    const entry = final[rid];
    if (entry && state.translation) {
      setState("translation", "regions", rid, entry);
      setState("translation", "origin", "llm");
      persistTranslation();
      setState("share", settings.share() ? "idle" : "off");
    }
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
    mutate((x) => void delete x.translations[l]);
    run(l);
  };

  onCleanup(() => {
    flush();
    gen++;
    abort?.abort();
    if (cleanUrl) URL.revokeObjectURL(cleanUrl);
    if (imageUrl) URL.revokeObjectURL(imageUrl);
  });

  return { state, lang, connect, retry, editText, setReplace, retranslate, flush, saveState, shareNow, editEmpty, translateAI };
}

export type Work = ReturnType<typeof createWork>;
