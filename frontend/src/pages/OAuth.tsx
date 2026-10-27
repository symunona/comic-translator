import { useNavigate, useSearchParams } from "@solidjs/router";
import { Show, createSignal, onMount } from "solid-js";
import { finishOAuth } from "../lib/llm/openrouter";
import { settings } from "../lib/settings";

export default function OAuth() {
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = createSignal("");
  onMount(async () => {
    const code = typeof search.code === "string" ? search.code : "";
    if (!code) return setError("OpenRouter did not send a code back.");
    try {
      const { key, returnTo } = await finishOAuth(code);
      settings.setApiKey(key);
      navigate(returnTo || "/", { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  });
  return (
    <div class="home">
      <Show when={error()} fallback={<p class="muted"><i class="spinner" /> Getting your key from OpenRouter…</p>}>
        <p class="fatal">{error()}</p>
        <a href="/">Back</a>
      </Show>
    </div>
  );
}
