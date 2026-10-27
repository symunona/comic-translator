import { createRoot, createSignal, type Accessor } from "solid-js";
import { browserLang } from "./langs";
import { AUTO_FONT } from "./layout";
import { DEFAULT_MODEL } from "./llm/openrouter";
import { lsGet, lsSet } from "./local";

function persisted<T>(key: string, fallback: T): [Accessor<T>, (v: T) => void] {
  const [get, set] = createSignal<T>(lsGet(key, fallback));
  return [
    get,
    (v: T) => {
      set(() => v);
      lsSet(key, v);
    },
  ];
}

const randomSecret = () => [...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, "0")).join("");

export type Session = { token: string; exp: number };

// Each AI step runs on this computer ("free"), on the recommended model, or on a
// model id the user picked. Free scene and review are skipped.
export type AiStep = "ocr" | "scene" | "translate" | "review";
export const AI_STEPS: AiStep[] = ["ocr", "scene", "translate", "review"];
export const FREE = "free";
export const RECOMMENDED = "recommended";

function initialSteps(): Record<AiStep, string> {
  const all = (v: string) => Object.fromEntries(AI_STEPS.map((s) => [s, v])) as Record<AiStep, string>;
  const steps = all(RECOMMENDED);
  if (!lsGet<boolean>("sotaRead", true)) steps.ocr = FREE;
  if (!lsGet<boolean>("sotaTranslate", true)) Object.assign(steps, { scene: FREE, translate: FREE, review: FREE });
  return steps;
}

export const settings = createRoot(() => {
  const [apiKey, setApiKey] = persisted("apiKey", "");
  const [share, setShare] = persisted("share", true);
  const [nick, setNick] = persisted("nick", "");
  if (!lsGet("secret", "")) lsSet("secret", randomSecret());
  const [secret] = persisted("secret", "");
  const [session, setSession] = persisted<Session | null>("session", null);
  const [langs, setLangs] = persisted<string[]>("langs", []);
  const [model, setModel] = persisted("model", DEFAULT_MODEL);
  const [font, setFont] = persisted("font", AUTO_FONT);
  const [steps, setSteps] = persisted("steps", initialSteps());
  const [freeGpu, setFreeGpu] = persisted("freeGpu", false);
  const [pathChoice, setPathChoice] = persisted<"" | "openrouter" | "free" | "dismissed">("pathChoice", "");

  const lastLang = () => langs()[0] ?? browserLang();
  const useLang = (code: string) => setLangs([code, ...langs().filter((l) => l !== code)].slice(0, 12));
  const step = (s: AiStep) => steps()[s] ?? RECOMMENDED;
  const setStep = (s: AiStep, v: string) => setSteps({ ...steps(), [s]: v });
  const isFree = (s: AiStep) => step(s) === FREE;
  const modelFor = (s: AiStep) => (isFree(s) || step(s) === RECOMMENDED ? model() : step(s));
  const allFree = () => isFree("ocr") && isFree("translate");
  const setAllFree = (free: boolean) => setSteps(Object.fromEntries(AI_STEPS.map((s) => [s, free ? FREE : RECOMMENDED])) as Record<AiStep, string>);
  const validSession = () => {
    const s = session();
    return s && s.exp * 1000 > Date.now() + 60_000 ? s.token : "";
  };

  return {
    apiKey, setApiKey, share, setShare, nick, setNick, secret, session, setSession, validSession, langs, useLang, lastLang, model, setModel, font, setFont,
    step, setStep, isFree, modelFor, allFree, setAllFree, freeGpu, setFreeGpu, pathChoice, setPathChoice,
  };
});
