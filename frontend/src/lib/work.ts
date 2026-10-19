import { batch, createSignal, onCleanup } from "solid-js";
import { createStore, produce, reconcile } from "solid-js/store";
import { api } from "./api";
import { translatedLangs } from "./langs";
import { STAGES, type Meta, type Panel, type Region, type Scene, type StageEvent, type StageName, type StageStatus, type Translation } from "./types";

export type StageState = { status: StageStatus; message?: string; progress?: { done: number; total: number } };
export type SaveState = "idle" | "pending" | "saving" | "saved" | "error";

const emptyStages = () => Object.fromEntries(STAGES.map((s) => [s, { status: "pending" }])) as Record<StageName, StageState>;

const stageName = (s: string) => s.split(":")[0] as StageName;

export function createWork(id: string) {
  const [state, setState] = createStore({
    meta: null as Meta | null,
    panels: [] as Panel[],
    regions: [] as Region[],
    scene: null as Scene | null,
    stages: emptyStages(),
    translation: null as Translation | null,
    langs: [] as string[],
    phase: "loading" as "loading" | "done" | "fatal",
    everDone: false,
    error: "",
  });
  const [lang, setLang] = createSignal("");
  const [saveState, setSaveState] = createSignal<SaveState>("idle");
  const [overlayRev, setOverlayRev] = createSignal<Record<string, number>>({});

  const upsertRegions = (list: Region[], replace = false) =>
    setState(
      "regions",
      produce((rs) => {
        if (replace) {
          const ids = new Set(list.map((r) => r.id));
          for (let i = rs.length - 1; i >= 0; i--) if (!ids.has(rs[i].id)) rs.splice(i, 1);
        }
        for (const r of list) {
          const i = rs.findIndex((x) => x.id === r.id);
          if (i < 0) rs.push(r);
          else for (const [k, v] of Object.entries(r)) if (v != null) (rs[i] as Record<string, unknown>)[k] = v;
        }
        rs.sort((a, b) => a.order - b.order);
      }),
    );

  const setTranslation = (t: Translation) => {
    if (t.lang && t.lang !== lang()) return;
    setState("translation", reconcile(t));
  };

  const onStage = (e: StageEvent) => {
    const name = stageName(e.stage);
    if (!(name in state.stages)) return;
    setState("stages", name, { status: e.status, message: e.message, progress: e.progress });
  };

  let close: (() => void) | null = null;
  let timer: number | undefined;

  const connect = (l: string) => {
    close?.();
    flush();
    batch(() => {
      setLang(l);
      setState("stages", emptyStages());
      setState("translation", null);
      setState("phase", "loading");
      setState("error", "");
      setSaveState("idle");
    });
    api
      .getStrip(id)
      .then((s) => {
        setState("langs", (ls) => [...new Set([...ls, ...translatedLangs(s.stages)])]);
        if (state.meta) return;
        batch(() => {
          setState("meta", { ...s.meta, imageUrl: s.imageUrl || s.meta.imageUrl });
          if (!state.panels.length) setState("panels", s.panels ?? []);
          upsertRegions(s.regions ?? []);
          if (s.scene) setState("scene", s.scene);
        });
      })
      .catch(() => {});
    close = api.stream(id, l, {
      stage: onStage,
      data: (e) => {
        switch (e.kind) {
          case "meta":
            return setState("meta", e.payload);
          case "panels":
            return setState("panels", e.payload);
          case "regions":
            return upsertRegions(e.payload, true);
          case "overlays":
            return upsertRegions(e.payload);
          case "region":
            return upsertRegions([e.payload]);
          case "scene":
            return setState("scene", e.payload);
          case "translation":
            return setTranslation(e.payload);
        }
      },
      done: async () => {
        const t = await api.getTranslation(id, l).catch(() => null);
        if (l !== lang()) return;
        batch(() => {
          if (t) setTranslation(t);
          setState("langs", (ls) => (ls.includes(l) ? ls : [...ls, l]));
          setState("phase", "done");
          setState("everDone", true);
        });
      },
      fatal: (message) => batch(() => {
        setState("phase", "fatal");
        setState("error", message);
      }),
    });
  };

  const put = async () => {
    const t = state.translation;
    if (!t) return;
    setSaveState("saving");
    try {
      const saved = await api.putTranslation(id, t.lang, { ...t, edited: true, regions: { ...t.regions } });
      if (saved.lang === lang()) setState("translation", "updatedAt", saved.updatedAt);
      setSaveState(timer === undefined ? "saved" : "pending");
    } catch {
      setSaveState("error");
    }
  };

  function flush(): Promise<void> {
    if (timer === undefined) return Promise.resolve();
    clearTimeout(timer);
    timer = undefined;
    return put();
  }

  const editText = (rid: string, text: string) => {
    if (!state.translation) return;
    setState("translation", "regions", rid, (r) => ({ ...(r ?? {}), text }));
    setState("translation", "edited", true);
    setSaveState("pending");
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = undefined;
      put();
    }, 600);
  };

  const setReplace = async (rid: string, replace: boolean) => {
    setState("regions", (r) => r.id === rid, "replace", replace);
    try {
      const r = await api.patchRegion(id, rid, { replace });
      upsertRegions([r]);
      setOverlayRev((m) => ({ ...m, [rid]: Date.now() }));
    } catch {
      setState("regions", (r) => r.id === rid, "replace", !replace);
    }
  };

  const retranslate = async (rid: string, hint?: string) => {
    await flush();
    const t = await api.retranslate(id, lang(), { regionIds: [rid], hint });
    const entry = t.regions[rid];
    if (entry && state.translation) setState("translation", "regions", rid, entry);
    else setTranslation(t);
  };

  onCleanup(() => {
    flush();
    close?.();
  });

  return { state, lang, connect, editText, setReplace, retranslate, flush, saveState, overlayRev };
}

export type Work = ReturnType<typeof createWork>;
