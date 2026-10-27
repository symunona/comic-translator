import { useNavigate } from "@solidjs/router";
import { For, Show, createResource, createSignal, onCleanup, onMount } from "solid-js";
import LangPicker from "../components/LangPicker";
import ModeToggle from "../components/ModeToggle";
import Logo from "../components/Logo";
import { demos, fetchImage, nickInfo, type Demo } from "../lib/hub";
import { ingest, nameFromUrl } from "../lib/ingest";
import { findLang } from "../lib/langs";
import { deleteStrip, getImage, listStrips, type StripSummary } from "../lib/local";
import { settings } from "../lib/settings";

const fmtDate = (s: string) => {
  const d = new Date(s);
  return isNaN(+d) ? "" : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
};

function LocalThumb(p: { id: string }) {
  const [url] = createResource(
    () => p.id,
    async (id) => {
      const b = await getImage(id);
      return b ? URL.createObjectURL(b) : "";
    },
  );
  onCleanup(() => url() && URL.revokeObjectURL(url()!));
  return <Show when={url()}>{(u) => <img src={u()} alt="" loading="lazy" />}</Show>;
}

export default function Upload() {
  const navigate = useNavigate();
  const [lang, setLang] = createSignal(settings.lastLang());
  const [drag, setDrag] = createSignal(false);
  const [busy, setBusy] = createSignal("");
  const [error, setError] = createSignal("");
  const [url, setUrl] = createSignal("");
  const [mine, setMine] = createSignal<StripSummary[]>(listStrips());
  const [demoList] = createResource(demos);
  const [contrib] = createResource(
    () => settings.nick().trim(),
    (n) => nickInfo(n).catch(() => null),
  );
  let input!: HTMLInputElement;

  const go = (id: string) => navigate(`/s/${encodeURIComponent(id)}?lang=${lang()}`);

  const take = async (label: string, get: () => Promise<{ blob: Blob; name: string }>) => {
    if (busy()) return;
    setBusy(label);
    setError("");
    try {
      const { blob, name } = await get();
      go(await ingest(blob, name));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy("");
    }
  };

  const fromFile = (file?: File | null) => file && take("Reading…", async () => ({ blob: file, name: file.name }));

  const fromUrl = (e?: Event) => {
    e?.preventDefault();
    const u = url().trim();
    if (!/^https?:\/\//i.test(u)) return setError("Paste a full image link, starting with http:// or https://");
    take("Fetching…", async () => ({ blob: await fetchImage(u), name: nameFromUrl(u) }));
  };

  const fromDemo = (d: Demo) =>
    take("Opening demo…", async () => {
      const res = await fetch(`/demos/${d.image}`);
      if (!res.ok) throw new Error(`demo image ${res.status}`);
      return { blob: await res.blob(), name: d.image };
    });

  const remove = async (id: string) => {
    await deleteStrip(id);
    setMine(listStrips());
  };

  onMount(() => {
    const onPaste = (e: ClipboardEvent) => {
      if ((e.target as HTMLElement).closest("input,textarea")) return;
      const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith("image/"));
      if (file) return fromFile(file);
      const text = e.clipboardData?.getData("text") ?? "";
      if (/^https?:\/\//i.test(text.trim())) {
        setUrl(text.trim());
        fromUrl();
      }
    };
    document.addEventListener("paste", onPaste);
    onCleanup(() => document.removeEventListener("paste", onPaste));
  });

  return (
    <div class="home">
      <a class="gh-ribbon" href="https://github.com/symunona/comic-translator" target="_blank" rel="noopener">
        Fork me on GitHub
      </a>
      <header class="hero">
        <h1>
          <Logo size={58} />
          <span class="brand-name">
            comic<span>·</span>translator
          </span>
        </h1>
        <p>Drop a strip. It finds the bubbles, clears them, translates them, reviews the result with LLMs, and you can edit every bubble by hand.</p>
        <p>Try it free, right in your browser. Or use SOTA LLMs on your own OpenRouter key.</p>
        <div class="mode-row">
          <ModeToggle />
          <span class="muted">{settings.allFree() ? "Free: nothing leaves your computer, rougher." : settings.apiKey() ? "SOTA models, about $0.05–0.15 a strip." : "SOTA models, about $0.05–0.15 a strip. Asks for your key."}</span>
        </div>
      </header>

      <div
        class="dropzone"
        classList={{ drag: drag(), busy: !!busy() }}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          const file = e.dataTransfer?.files[0];
          if (file) return fromFile(file);
          const link = e.dataTransfer?.getData("text/uri-list") || e.dataTransfer?.getData("text/plain");
          if (link) {
            setUrl(link.trim());
            fromUrl();
          }
        }}
        onClick={() => !busy() && input.click()}
      >
        <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" hidden onChange={(e) => fromFile(e.currentTarget.files?.[0])} />
        <div class="drop-art">
          <svg viewBox="0 0 64 48" aria-hidden="true">
            <path d="M8 6h48a4 4 0 0 1 4 4v20a4 4 0 0 1-4 4H26l-12 10 2-10H8a4 4 0 0 1-4-4V10a4 4 0 0 1 4-4z" />
          </svg>
        </div>
        <strong>{busy() || "Drop a comic strip here"}</strong>
        <span>or click to pick a file, or paste an image</span>
        <form class="url-row" onClick={(e) => e.stopPropagation()} onSubmit={fromUrl}>
          <input type="url" placeholder="…or paste an image link: https://…/strip.png" value={url()} onInput={(e) => setUrl(e.currentTarget.value)} />
          <button type="submit" disabled={!url().trim() || !!busy()}>
            Fetch
          </button>
        </form>
        <div class="lang-pick" onClick={(e) => e.stopPropagation()}>
          <span>translate to</span>
          <LangPicker value={lang()} onSelect={setLang} align="left" />
          <span class="muted">· source language is detected</span>
        </div>
      </div>
      <Show when={error()}>
        <p class="fatal">{error()}</p>
      </Show>

      <Show when={demoList()?.length}>
        <section class="recent demos">
          <h2>Try a demo</h2>
          <p class="muted">
            Strips by <a href="https://napirajz.hu" target="_blank" rel="noopener">Napirajz</a>, translated already. No key needed.
          </p>
          <ul class="grid">
            <For each={demoList()}>
              {(d) => (
                <li>
                  <button class="thumb-card" onClick={() => fromDemo(d)}>
                    <div class="thumb">
                      <img src={`/demos/${d.image}`} alt="" loading="lazy" />
                    </div>
                    <div class="thumb-meta">
                      <strong>{d.title}</strong>
                      <span class="langs">
                        <For each={Object.keys(d.translations)}>{(l) => <i>{l}</i>}</For>
                      </span>
                    </div>
                  </button>
                </li>
              )}
            </For>
          </ul>
        </section>
      </Show>

      <section class="recent">
        <h2>Your strips</h2>
        <p class="muted">Kept in this browser only.</p>
        <Show when={mine().length} fallback={<p class="muted">Nothing here yet.</p>}>
          <ul class="grid">
            <For each={mine()}>
              {(s) => (
                <li>
                  <button
                    class="thumb-card"
                    onClick={() =>
                      s.langs.length ? navigate(`/v/${encodeURIComponent(s.id)}?lang=${s.langs.includes(lang()) ? lang() : s.langs[0]}`) : go(s.id)
                    }
                  >
                    <div class="thumb">
                      <LocalThumb id={s.id} />
                    </div>
                    <div class="thumb-meta">
                      <strong title={s.name}>{s.name}</strong>
                      <span>{fmtDate(s.createdAt)}</span>
                      <span class="langs">
                        <For each={s.langs}>{(l) => <i title={findLang(l).name}>{l}</i>}</For>
                      </span>
                    </div>
                  </button>
                  <button class="ghost small thumb-del" title="Delete from this browser" onClick={() => remove(s.id)}>
                    ✕
                  </button>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </section>

      <Show when={contrib()?.translations.length}>
        <section class="recent">
          <h2>Shared as {contrib()!.nick}</h2>
          <p class="muted">
            {contrib()!.translations.length} translation{contrib()!.translations.length === 1 ? "" : "s"}:{" "}
            {[...new Set(contrib()!.translations.map((t) => findLang(t.lang).name))].join(", ")}
          </p>
        </section>
      </Show>

      <footer class="home-foot muted">
        Everything runs in your browser: bubble detection, erasing, lettering. Text goes to the AI model through OpenRouter on your key. If you share, the hub stores the image's hash and
        the translation file, never the image.
        <span class="foot-links">
          Human here, need tokens for my next project: <a href="https://buymeacoffee.com/symunona" target="_blank" rel="noopener">buy me a coffee</a> ·{" "}
          <a href="https://github.com/symunona/comic-translator" target="_blank" rel="noopener">GitHub</a>
        </span>
      </footer>
    </div>
  );
}
