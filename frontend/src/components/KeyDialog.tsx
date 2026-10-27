import { Show, createSignal, onCleanup, onMount } from "solid-js";
import { OPUS_MB, PADDLE } from "../lib/free/models";
import { chromeTranslator, route, type MtRoute } from "../lib/free/mt";
import { VLM_MB, hasWebGPU } from "../lib/free/vlm";
import { langEnglishName } from "../lib/langs";
import { keyInfo, startOAuth } from "../lib/llm/openrouter";
import { settings } from "../lib/settings";
import Turnstile from "./Turnstile";

type Props = {
  title?: string;
  lead?: string;
  error?: string;
  onDone: () => void;
  onClose?: () => void;
  onShareReady?: () => void;
  lang?: string;
  src?: string;
  ask?: boolean;
};

const KEY_RE = /^sk-or-[A-Za-z0-9_-]{20,}$/;

export default function KeyDialog(p: Props) {
  const [key, setKey] = createSignal(settings.apiKey());
  const [checking, setChecking] = createSignal(false);
  const [keyError, setKeyError] = createSignal("");
  const [keyNote, setKeyNote] = createSignal("");
  const [share, setShare] = createSignal(settings.share());
  const [nick, setNick] = createSignal(settings.nick());
  const [verified, setVerified] = createSignal(!!settings.validSession());

  const check = async (k = key().trim()) => {
    setKeyError("");
    setKeyNote("");
    if (!k) return false;
    if (!KEY_RE.test(k)) {
      setKeyError("OpenRouter keys start with sk-or-");
      return false;
    }
    setChecking(true);
    try {
      const info = await keyInfo(k);
      setKeyNote(info.limitRemaining != null ? `Key works · $${info.limitRemaining.toFixed(2)} left on its limit` : "Key works");
      return true;
    } catch (e) {
      setKeyError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setChecking(false);
    }
  };

  const [free, setFree] = createSignal<MtRoute | null>(null);
  const [gpu, setGpu] = createSignal(false);
  const freeSrc = () => p.src ?? "hu";

  onMount(() => {
    if (key()) check();
    if (p.lang) route(freeSrc(), p.lang).then(setFree, () => setFree({ engine: "none" }));
    hasWebGPU().then(setGpu);
  });

  const freeLine = () => {
    const r = free();
    if (!r) return "Checking this browser…";
    const target = langEnglishName(p.lang ?? "en");
    const pair = p.src ? `${langEnglishName(p.src)} → ${target}` : `into ${target}`;
    if (r.engine === "chrome") return `Works here: Chrome's built-in translator, ${PADDLE.mb} MB download.`;
    if (r.engine === "opus") return `Works here ${p.src ? `for ${pair}` : "for some languages"}: ${PADDLE.mb} MB + ${OPUS_MB} MB per language pair, slower.`;
    return `No free translator ${pair} in this browser. Chrome on a desktop has the most languages.`;
  };

  const useFree = () => {
    saveShare();
    if (p.lang && free()?.engine === "chrome") chromeTranslator(freeSrc(), p.lang).catch(() => {});
    settings.setAllFree(true);
    settings.setPathChoice("free");
    p.onDone();
  };

  const [asking, setAsking] = createSignal(!!p.ask);
  const goOpenRouter = () => {
    settings.setPathChoice("openrouter");
    setAsking(false);
  };

  const saveShare = () => {
    settings.setShare(share());
    settings.setNick(nick().trim().slice(0, 32));
  };

  onCleanup(saveShare);

  const close = () => {
    saveShare();
    p.onClose?.();
  };

  const submit = async (e: Event) => {
    e.preventDefault();
    saveShare();
    const k = key().trim();
    if (!(await check(k))) return;
    settings.setApiKey(k);
    settings.setAllFree(false);
    p.onDone();
  };

  const connect = () => {
    saveShare();
    settings.setAllFree(false);
    startOAuth(location.pathname + location.search);
  };

  return (
    <div class="dialog-backdrop" onClick={(e) => e.target === e.currentTarget && close()}>
      <form class="dialog key-dialog" onSubmit={submit}>
        <header>
          <h3>{p.title ?? "Bubbles are empty. Let's fill them."}</h3>
          <Show when={p.onClose}>
            <button type="button" class="x" aria-label="Close" title="Close" onClick={close}>
              ×
            </button>
          </Show>
        </header>
        <Show when={asking()}>
          <div class="dialog-body">
            <p class="lead">How should we read and translate them?</p>
            <div class="path-choice">
              <button type="button" class="primary" onClick={goOpenRouter}>
                <b>Go with OpenRouter</b>
                <span>Best: SOTA models read the lettering, get the jokes and fit the bubbles. Your own key, about $0.05–0.15 a strip.</span>
              </button>
              <button type="button" onClick={useFree} disabled={free()?.engine === "none"}>
                <b>Free, lower effort</b>
                <span>On this computer, nothing leaves it. Rougher: about 4 in 10 bubbles come out right as they are.</span>
                <em>{freeLine()}</em>
              </button>
            </div>
          </div>
        </Show>
        <div class="dialog-body" classList={{ hidden: asking() }}>
          <p class="lead">
            {p.lead ??
              "Reading the lettering, getting the jokes and translating them calls an AI model through OpenRouter, on your own API key. A strip costs about $0.05–0.15."}
          </p>
          <Show when={p.error}>
            <p class="fatal">{p.error}</p>
          </Show>

          <section class="key-box">
            <button type="button" class="primary" onClick={connect}>
              Connect with OpenRouter
            </button>
            <span class="muted">or paste a key</span>
            <div class="key-row">
              <input
                type="password"
                autocomplete="off"
                spellcheck={false}
                placeholder="sk-or-v1-…"
                value={key()}
                onInput={(e) => setKey(e.currentTarget.value)}
                onBlur={() => check()}
              />
            </div>
            <Show when={keyError()}>
              <p class="key-error">{keyError()}</p>
            </Show>
            <Show when={keyNote()}>
              <p class="key-ok">{keyNote()}</p>
            </Show>
            <p class="key-privacy">
              🔒 Your key is stored only on your computer, in this browser. Requests go straight from your browser to OpenRouter; our server never sees the key.
            </p>
            <details class="howto">
              <summary>No key yet? How to get one and charge it</summary>
              <ol>
                <li>
                  Sign in at <a href="https://openrouter.ai" target="_blank" rel="noopener">openrouter.ai</a> (Google or GitHub login works).
                </li>
                <li>
                  Add credits: <a href="https://openrouter.ai/settings/credits" target="_blank" rel="noopener">Settings → Credits → Add credits</a>. Card or crypto. $5 translates roughly 50 strips.
                </li>
                <li>
                  Create a key: <a href="https://openrouter.ai/settings/keys" target="_blank" rel="noopener">Settings → Keys → Create key</a>. Give it a credit limit (say $2) so a leaked key cannot spend more.
                </li>
                <li>Paste it above. Or skip the copy-paste: “Connect with OpenRouter” makes a key for this site in one click.</li>
              </ol>
            </details>
          </section>

          <section class="free-box">
            <h4>Or free, on this computer</h4>
            <p class="muted">
              No account, nothing leaves your computer. Much rougher than with a key: in our tests about 4 in 10 bubbles came out right as they are, 1 in 5 wrong, jokes
              literal. Fix any bubble by hand.
            </p>
            <p class={free()?.engine === "none" ? "key-error" : "key-ok"}>{freeLine()}</p>
            <Show when={gpu()}>
              <label class="toggle">
                <input type="checkbox" checked={settings.freeGpu()} onChange={(e) => settings.setFreeGpu(e.currentTarget.checked)} />
                <span>
                  Re-read the letters with a small AI model on your graphics card: fewer misread letters (bubbles right: 4 → 5 in 10 in our tests). {VLM_MB.q4} MB download once,
                  slow: about 30 s per bubble on a mid-range laptop GPU.
                </span>
              </label>
            </Show>
            <button type="button" onClick={useFree} disabled={free()?.engine === "none"}>
              {settings.allFree() ? "Keep translating for free" : "Translate for free"}
            </button>
          </section>

          <section class="share-box">
            <label class="toggle big">
              <input
                type="checkbox"
                checked={share()}
                onChange={(e) => {
                  setShare(e.currentTarget.checked);
                  settings.setShare(e.currentTarget.checked);
                }}
              />
              <span>I share my translations with others</span>
            </label>
            <Show when={share()}>
              <p class="muted small-print">
                Shared: the image's fingerprint (SHA-256 hash) and the translation file (text, bubble boxes). Never the image, never your key. In return you see what others already
                translated for the same image, and get it for free.
              </p>
              <input
                class="nick"
                maxLength={32}
                placeholder="stay anonymous"
                value={nick()}
                onInput={(e) => setNick(e.currentTarget.value)}
                onBlur={saveShare}
                title="A nickname collects your contributions. Leave empty to stay anonymous."
              />
              <Show when={!verified()} fallback={<p class="key-ok">Verified, sharing is on.</p>}>
                <Turnstile
                  onVerified={() => {
                    setVerified(true);
                    saveShare();
                    p.onShareReady?.();
                  }}
                />
              </Show>
            </Show>
          </section>
        </div>
        <footer class="dialog-foot" classList={{ hidden: asking() }}>
          <button type="submit" class="primary" disabled={checking() || !key().trim()}>
            {checking() ? "Checking…" : "Continue"}
          </button>
        </footer>
      </form>
    </div>
  );
}
