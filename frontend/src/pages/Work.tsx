import { A, useParams, useSearchParams } from "@solidjs/router";
import { For, Show, createEffect, createMemo, createSignal, on, onCleanup, onMount } from "solid-js";
import Brand from "../components/Brand";
import Checklist from "../components/Checklist";
import LangPicker from "../components/LangPicker";
import RegionCard from "../components/RegionCard";
import Strip from "../components/Strip";
import ViewToggle from "../components/ViewToggle";
import { api } from "../lib/api";
import { creditsFor } from "../lib/langs";
import { FONT_FAMILY } from "../lib/layout";
import { renderStrip } from "../lib/render";
import { STAGES, type Region } from "../lib/types";
import { createWork } from "../lib/work";

const SAVE_LABEL = { idle: "", pending: "editing…", saving: "saving…", saved: "saved", error: "save failed" };

const withRev = (url: string, rev?: number) => (rev && !/^(blob|data):/.test(url) ? `${url}${url.includes("?") ? "&" : "?"}v=${rev}` : url);

function WorkView(props: { id: string }) {
  const [search, setSearch] = useSearchParams();
  const lang = () => (typeof search.lang === "string" && search.lang) || "en";
  const work = createWork(props.id);
  const s = work.state;

  const [fontsReady, setFontsReady] = createSignal(false);
  const [hovered, setHovered] = createSignal<string | null>(null);
  const [active, setActive] = createSignal<string | null>(null);
  const [showOriginal, setShowOriginal] = createSignal(false);
  const [summaryOpen, setSummaryOpen] = createSignal(false);
  const [exporting, setExporting] = createSignal(false);
  const [result, setResult] = createSignal<{ url: string; name: string } | null>(null);
  const [exportError, setExportError] = createSignal("");

  const boxEls = new Map<string, HTMLElement>();
  const cardEls = new Map<string, HTMLElement>();

  onMount(() => {
    Promise.all([
      document.fonts.load(`32px ${FONT_FAMILY}`, "Aa"),
      document.fonts.load(`32px ${FONT_FAMILY}`, "őű"),
    ]).finally(() => setFontsReady(true));
  });

  createEffect(on(lang, (l) => work.connect(l)));

  const imageUrl = () => s.meta?.imageUrl || api.imageUrl(props.id, "orig.png");
  const overlaySrc = (r: Region) => {
    const url = r.overlayUrl || (r.overlayBox ? api.imageUrl(props.id, `overlays/${r.id}.png`) : undefined);
    return url && withRev(url, work.overlayRev()[r.id]);
  };
  const editing = () => s.everDone;
  const readRegions = createMemo(() => s.regions.filter((r) => r.source));
  const running = createMemo(() => STAGES.find((n) => s.stages[n].status === "running"));

  const pickFromCard = (rid: string) => {
    setActive(rid);
    boxEls.get(rid)?.scrollIntoView({ behavior: "smooth", block: "center" });
  };
  const pickFromStrip = (rid: string) => {
    setActive(rid);
    const card = cardEls.get(rid);
    card?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    card?.querySelector("textarea")?.focus({ preventScroll: true });
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") setResult(null);
  };
  window.addEventListener("keydown", onKey);
  onCleanup(() => window.removeEventListener("keydown", onKey));

  const save = async () => {
    if (!s.meta) return;
    setExporting(true);
    setExportError("");
    try {
      await work.flush();
      const l = lang();
      const png = await renderStrip(s.meta, imageUrl(), s.regions, s.translation, l, overlaySrc);
      const { url } = await api.render(props.id, l, png);
      const name = `${s.meta.origName.replace(/\.[^.]+$/, "")}.${l}.png`;
      const shown = withRev(url, Date.now());
      setResult({ url: shown, name });
      const a = Object.assign(document.createElement("a"), { href: shown, download: name });
      a.click();
    } catch (e) {
      setExportError(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div class="work">
      <header class="topbar">
        <Brand />
        <span class="strip-name" title={s.meta?.origName}>
          {s.meta?.origName ?? props.id.slice(0, 12)}
        </span>
        <Show when={s.everDone && running()}>
          <span class="busy">
            <i class="spinner" /> {running()}
          </span>
        </Show>
        <div class="spacer" />
        <span class={`save-state ${work.saveState()}`}>{SAVE_LABEL[work.saveState()]}</span>
        <ViewToggle original={showOriginal()} onChange={setShowOriginal} />
        <LangPicker
          value={lang()}
          translated={s.langs}
          credits={creditsFor(s.regions.length)}
          onSelect={(l) => setSearch({ lang: l })}
          onTranslate={(l) => setSearch({ lang: l })}
        />
        <A class="button ghost" href={`/v/${encodeURIComponent(props.id)}?lang=${lang()}`}>
          View
        </A>
        <button class="primary" disabled={!s.everDone || s.phase !== "done" || exporting()} onClick={save}>
          {exporting() ? "Rendering…" : "Save PNG"}
        </button>
      </header>

      <main class="columns">
        <section class="strip-col">
          <Show when={s.meta} fallback={<div class="strip-placeholder"><i class="spinner" /> loading strip…</div>}>
            <Strip
              meta={s.meta!}
              panels={s.panels}
              regions={s.regions}
              translation={s.translation}
              lang={work.lang()}
              loading={s.phase !== "done"}
              imageUrl={imageUrl()}
              showOriginal={showOriginal()}
              fontsReady={fontsReady()}
              hovered={hovered()}
              active={active()}
              onHover={setHovered}
              onPick={pickFromStrip}
              overlaySrc={overlaySrc}
              boxRef={(rid, el) => boxEls.set(rid, el)}
            />
          </Show>
        </section>

        <aside class="sidebar" classList={{ editing: editing() }}>
          <div class="side-head">
            <h2>{editing() ? "Bubbles" : "Working on it"}</h2>
            <Show when={s.scene?.summary}>
              <p class="summary" classList={{ open: summaryOpen() }} title={summaryOpen() ? "" : "Show all"} onClick={() => setSummaryOpen((v) => !v)}>
                {s.scene!.summary}
              </p>
            </Show>
          </div>
          <Checklist stages={s.stages} collapsed={s.everDone && s.phase !== "fatal"} error={s.error} />
          <Show when={exportError()}>
            <p class="fatal">{exportError()}</p>
          </Show>
          <ol class="cards">
            <For each={readRegions()}>
              {(r) => (
                <RegionCard
                  region={r}
                  tr={s.translation?.regions[r.id]}
                  editing={editing()}
                  hovered={hovered() === r.id}
                  active={active() === r.id}
                  ref={(el) => cardEls.set(r.id, el)}
                  onHover={(on) => setHovered(on ? r.id : null)}
                  onPick={() => pickFromCard(r.id)}
                  onText={(t) => work.editText(r.id, t)}
                  onReplace={(on) => work.setReplace(r.id, on)}
                  onRetranslate={() => work.retranslate(r.id)}
                />
              )}
            </For>
          </ol>
        </aside>
      </main>

      <Show when={result()}>
        {(res) => (
          <div class="dialog-backdrop" onClick={(e) => e.target === e.currentTarget && setResult(null)}>
            <div class="dialog">
              <header>
                <h3>Saved {res().name}</h3>
                <a class="button primary" href={res().url} download={res().name}>
                  Download
                </a>
                <button class="ghost" onClick={() => setResult(null)}>
                  Close
                </button>
              </header>
              <div class="dialog-body">
                <img src={res().url} alt="rendered strip" />
              </div>
            </div>
          </div>
        )}
      </Show>
    </div>
  );
}

export default function Work() {
  const params = useParams();
  return (
    <Show when={params.id} keyed>
      {(id) => <WorkView id={id} />}
    </Show>
  );
}
