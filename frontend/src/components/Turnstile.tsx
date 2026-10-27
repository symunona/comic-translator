import { Show, createSignal, onCleanup, onMount } from "solid-js";
import { hubConfig, startSession } from "../lib/hub";

type TurnstileApi = {
  render(el: HTMLElement, o: Record<string, unknown>): string;
  remove(id: string): void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptP: Promise<TurnstileApi> | null = null;

function loadScript(): Promise<TurnstileApi> {
  scriptP ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true;
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("captcha did not load")));
    s.onerror = () => {
      scriptP = null;
      reject(new Error("captcha did not load"));
    };
    document.head.appendChild(s);
  });
  return scriptP;
}

// Turnstile shows Cloudflare's captcha and trades its token for a hub session.
export default function Turnstile(p: { onVerified: () => void }) {
  const [error, setError] = createSignal("");
  let el!: HTMLDivElement;
  let widget = "";
  onMount(async () => {
    try {
      const [{ turnstileSiteKey }, ts] = await Promise.all([hubConfig(), loadScript()]);
      if (!turnstileSiteKey) throw new Error("sharing is not configured on this server");
      widget = ts.render(el, {
        sitekey: turnstileSiteKey,
        theme: "light",
        callback: async (token: string) => {
          try {
            await startSession(token);
            p.onVerified();
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          }
        },
        "error-callback": () => setError("captcha failed, reload the page to try again"),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  });
  onCleanup(() => widget && window.turnstile?.remove(widget));
  return (
    <div class="turnstile">
      <div ref={el} />
      <Show when={error()}>
        <p class="fatal">{error()}</p>
      </Show>
    </div>
  );
}
