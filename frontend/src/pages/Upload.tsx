import { useNavigate } from "@solidjs/router";
import { For, Show, createResource, createSignal } from "solid-js";
import LangPicker from "../components/LangPicker";
import Logo from "../components/Logo";
import { api, isMock } from "../lib/api";
import { LANGS } from "../lib/types";

const fmtDate = (s: string) => {
  const d = new Date(s);
  return isNaN(+d) ? "" : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
};

export default function Upload() {
  const navigate = useNavigate();
  const [lang, setLang] = createSignal("en");
  const [drag, setDrag] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal("");
  const [recent] = createResource(() => api.listStrips(10));
  let input!: HTMLInputElement;

  const go = (id: string, l = lang()) => navigate(`/s/${encodeURIComponent(id)}?lang=${l}`);
  const view = (id: string, langs: string[]) =>
    navigate(`/v/${encodeURIComponent(id)}${langs.length ? `?lang=${langs.includes(lang()) ? lang() : langs[0]}` : ""}`);

  const upload = async (file?: File | null) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) return setError("That is not an image.");
    setBusy(true);
    setError("");
    try {
      const { id } = await api.upload(file);
      go(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div class="home">
      <header class="hero">
        <h1>
          <Logo size={58} />
          <span class="brand-name">
            comic<span>·</span>translator
          </span>
        </h1>
        <p>Drop a strip. It finds the bubbles, reads them, gets the joke, and letters it back in your language.</p>
        <Show when={isMock}>
          <p class="mock-flag">mock mode: no backend, scripted pipeline</p>
        </Show>
      </header>

      <div
        class="dropzone"
        classList={{ drag: drag(), busy: busy() }}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          upload(e.dataTransfer?.files[0]);
        }}
        onClick={() => !busy() && input.click()}
      >
        <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => upload(e.currentTarget.files?.[0])} />
        <div class="drop-art">
          <svg viewBox="0 0 64 48" aria-hidden="true">
            <path d="M8 6h48a4 4 0 0 1 4 4v20a4 4 0 0 1-4 4H26l-12 10 2-10H8a4 4 0 0 1-4-4V10a4 4 0 0 1 4-4z" />
          </svg>
        </div>
        <strong>{busy() ? "Uploading…" : "Drop a comic strip here"}</strong>
        <span>or click to pick a PNG, JPG or WebP</span>
        <div class="lang-pick" onClick={(e) => e.stopPropagation()}>
          <span>translate to</span>
          <LangPicker value={lang()} translated={LANGS.map((l) => l.code)} translatedTitle="Translate to" credits={0} onSelect={setLang} align="left" />
        </div>
      </div>
      <Show when={error()}>
        <p class="fatal">{error()}</p>
      </Show>

      <section class="recent">
        <h2>Recent</h2>
        <Show when={!recent.error} fallback={<p class="muted">Could not load recent strips ({String(recent.error?.message ?? recent.error)}).</p>}>
          <Show when={recent()?.length} fallback={<p class="muted">{recent.loading ? "loading…" : "Nothing here yet."}</p>}>
            <ul class="grid">
              <For each={recent()}>
                {(s) => (
                  <li>
                    <button class="thumb-card" onClick={() => view(s.id, s.langs ?? [])}>
                      <div class="thumb">
                        <img src={s.thumbUrl || api.imageUrl(s.id, "orig.png")} alt="" loading="lazy" />
                      </div>
                      <div class="thumb-meta">
                        <strong title={s.origName}>{s.origName}</strong>
                        <span>{fmtDate(s.createdAt)}</span>
                        <span class="langs">
                          <For each={s.langs ?? []}>{(l) => <i>{l}</i>}</For>
                        </span>
                      </div>
                    </button>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </Show>
      </section>
    </div>
  );
}
