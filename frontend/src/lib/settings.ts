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
  const [sotaRead, setSotaRead] = persisted("sotaRead", true);
  const [sotaTranslate, setSotaTranslate] = persisted("sotaTranslate", true);
  const [freeGpu, setFreeGpu] = persisted("freeGpu", false);
  const [pathChoice, setPathChoice] = persisted<"" | "openrouter" | "free" | "dismissed">("pathChoice", "");

  const lastLang = () => langs()[0] ?? browserLang();
  const useLang = (code: string) => setLangs([code, ...langs().filter((l) => l !== code)].slice(0, 12));
  const allFree = () => !sotaRead() && !sotaTranslate();
  const setAllFree = (free: boolean) => {
    setSotaRead(!free);
    setSotaTranslate(!free);
  };
  const validSession = () => {
    const s = session();
    return s && s.exp * 1000 > Date.now() + 60_000 ? s.token : "";
  };

  return {
    apiKey, setApiKey, share, setShare, nick, setNick, secret, session, setSession, validSession, langs, useLang, lastLang, model, setModel, font, setFont,
    sotaRead, setSotaRead, sotaTranslate, setSotaTranslate, allFree, setAllFree, freeGpu, setFreeGpu, pathChoice, setPathChoice,
  };
});
