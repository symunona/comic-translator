import { A, useParams, useSearchParams } from "@solidjs/router";
import { For, Show, createEffect, createMemo, createSignal, on, onCleanup, onMount } from "solid-js";
import Brand from "../components/Brand";
import Checklist from "../components/Checklist";
import KeyDialog from "../components/KeyDialog";
import LangPicker from "../components/LangPicker";
import RegionCard from "../components/RegionCard";
import Strip from "../components/Strip";
import Turnstile from "../components/Turnstile";
import ViewToggle from "../components/ViewToggle";
import { FONT_FAMILY } from "../lib/layout";
import { renderStrip } from "../lib/render";
import { settings } from "../lib/settings";
import { STAGES, type Translation } from "../lib/types";
import { createWork } from "../lib/work";

const versionLabel = (t: Translation) => {
  const who =
    t.origin === "user"
      ? "by hand"
      : t.origin === "shared" || t.origin === "demo"
        ? `shared${t.by ? ` by ${t.by}` : ""}`
        : t.model?.startsWith("free:")
          ? `free (${t.model.slice(5)})`
          : (t.model?.split("/").pop() ?? "AI");
  const when = new Date(t.updatedAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  return `${who}${t.edited ? ", edited" : ""} · ${when}`;
};

const SAVE_LABEL = { idle: "", pending: "editing…", saved: "saved in this browser", error: "save failed" };

function WorkView(props: { id: string }) {
  const [search, setSearch] = useSearchParams();
  const lang = () => (typeof search.lang === "string" && search.lang) || settings.lastLang();
  const work = createWork(props.id);
  const s = work.state;

  const [fontsReady, setFontsReady] = createSignal(false);
  const [hovered, setHovered] = createSignal<string | null>(null);
  const [active, setActive] = createSignal<string | null>(null);
  const [showOriginal, setShowOriginal] = createSignal(false);
  const [summaryOpen, setSummaryOpen] = createSignal(false);
  const [exporting, setExporting] = createSignal(false);
  const [exportError, setExportError] = createSignal("");
  const [keyOpen, setKeyOpen] = createSignal(false);
  const [keyDismissed, setKeyDismissed] = createSignal(false);

  const boxEls = new Map<string, HTMLElement>();
  const cardEls = new Map<string, HTMLElement>();

  onMount(() => {
    Promise.all([document.fonts.load(`32px ${FONT_FAMILY}`, "Aa"), document.fonts.load(`32px ${FONT_FAMILY}`, "őű")]).finally(() => setFontsReady(true));
  });

  createEffect(
    on(lang, (l) => {
      settings.useLang(l);
      setKeyDismissed(false);
      work.connect(l);
    }),
  );

  const editing = () => s.phase === "done";
  const readRegions = createMemo(() => s.regions.filter((r) => r.source || s.translation?.regions[r.id] !== undefined));
  const running = createMemo(() => STAGES.find((n) => s.stages[n].status === "running"));
  const showKey = () => keyOpen() || (s.phase === "needKey" && !keyDismissed());
  const translatedLangs = () => Object.keys(s.rec?.translations ?? {});
  const versions = () => s.rec?.versions?.[lang()] ?? [];
  const sharedLangs = () => [...new Set(s.listings.map((l) => l.lang))];

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

  const save = async () => {
    const r = s.rec;
    if (!r || !s.cleanUrl) return;
    setExporting(true);
    setExportError("");
    try {
      await work.flush();
      const l = lang();
      const png = await renderStrip(r.width, r.height, s.cleanUrl, s.regions, s.translation, l);
      const url = URL.createObjectURL(png);
      const name = `${r.name.replace(/\.[^.]+$/, "")}.${l}.png`;
      Object.assign(document.createElement("a"), { href: url, download: name }).click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      setExportError(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  };

  const downloadEmpty = () => {
    const r = s.rec;
    if (!r || !s.cleanUrl) return;
    Object.assign(document.createElement("a"), { href: s.cleanUrl, download: `${r.name.replace(/\.[^.]+$/, "")}.empty.png` }).click();
  };

  const editEmpty = () => {
    const t = s.translation;
    if (t && t.origin !== "user" && Object.values(t.regions).some((x) => x.text.trim()) && !confirm("Replace this translation with empty bubbles?")) return;
    setKeyDismissed(true);
    work.editEmpty();
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") setKeyOpen(false);
  };
  window.addEventListener("keydown", onKey);
  onCleanup(() => window.removeEventListener("keydown", onKey));

  return (
    <div class="work">
      <header class="topbar">
        <Brand />
        <span class="strip-name" title={s.rec?.name}>
          {s.rec?.name ?? props.id.slice(0, 12)}
        </span>
        <Show when={running()}>
          <span class="busy">
            <i class="spinner" /> {running()}
          </span>
        </Show>
        <div class="spacer" />
        <span class={`save-state ${work.saveState()}`}>{SAVE_LABEL[work.saveState()]}</span>
        <ViewToggle original={showOriginal()} onChange={setShowOriginal} />
        <LangPicker value={lang()} translated={translatedLangs()} shared={sharedLangs()} onSelect={(l) => setSearch({ lang: l })} />
        <button type="button" class="ghost" title="OpenRouter key and sharing" onClick={() => setKeyOpen(true)}>
          {settings.apiKey() ? "Key ✓" : "Add key"}
        </button>
        <A class="button ghost" href={`/v/${encodeURIComponent(props.id)}?lang=${lang()}`}>
          View
        </A>
        <button class="primary" disabled={s.phase !== "done" || exporting()} onClick={save}>
          {exporting() ? "Rendering…" : "Save PNG"}
        </button>
      </header>

      <main class="columns">
        <section class="strip-col">
          <Show when={s.rec && s.imageUrl} fallback={<div class="strip-placeholder">{s.phase === "fatal" ? s.error : <><i class="spinner" /> loading strip…</>}</div>}>
            <Strip
              width={s.rec!.width}
              height={s.rec!.height}
              name={s.rec!.name}
              panels={s.rec!.panels}
              regions={s.regions}
              translation={s.translation}
              lang={work.lang()}
              loading={s.phase === "loading"}
              imageUrl={s.imageUrl}
              cleanUrl={s.cleanUrl}
              showOriginal={showOriginal()}
              fontsReady={fontsReady()}
              hovered={hovered()}
              active={active()}
              onHover={setHovered}
              onPick={pickFromStrip}
              boxRef={(rid, el) => boxEls.set(rid, el)}
            />
          </Show>
        </section>

        <aside class="sidebar" classList={{ editing: editing() }}>
          <div class="side-head">
            <h2>{editing() ? "Bubbles" : s.phase === "needKey" ? "Bubbles erased" : "Working on it"}</h2>
            <Show when={s.rec?.scene?.summary}>
              <p class="summary" classList={{ open: summaryOpen() }} title={summaryOpen() ? "" : "Show all"} onClick={() => setSummaryOpen((v) => !v)}>
                {s.rec!.scene!.summary}
              </p>
            </Show>
          </div>
          <Show when={s.phase === "needKey" && !showKey()}>
            <div class="need-key">
              <p>The bubbles are erased. Reading and translating them needs your OpenRouter key. Or letter them yourself.</p>
              <div class="step-actions">
                <button class="primary" onClick={() => setKeyDismissed(false)}>
                  Add key to continue
                </button>
                <button class="ghost" onClick={editEmpty}>
                  Edit empty
                </button>
                <button class="ghost" onClick={downloadEmpty}>
                  Download empty
                </button>
              </div>
            </div>
          </Show>
          <Checklist
            stages={s.stages}
            collapsed={editing()}
            error={s.phase === "fatal" ? s.error : ""}
            lang={work.lang()}
            calls={s.rec?.calls ?? []}
            model={settings.model()}
            freeRead={s.rec?.ocr ? !!s.rec.ocrFree : !settings.apiKey() || !settings.sotaRead()}
            freeTranslate={!settings.apiKey() || !settings.sotaTranslate()}
            freeGpu={settings.freeGpu()}
            hasKey={!!settings.apiKey()}
            onAddKey={() => setKeyOpen(true)}
            onNewVersion={s.phase === "done" || s.phase === "fatal" ? work.newVersion : undefined}
            onDownloadEmpty={s.cleanUrl ? downloadEmpty : undefined}
            onEditEmpty={s.cleanUrl ? editEmpty : undefined}
          />
          <Show when={s.phase === "fatal"}>
            <button class="ghost" onClick={work.retry}>
              Try again
            </button>
          </Show>
          <Show when={editing() && s.translation}>
            <div class="share-state">
              <Show when={versions().length}>
                <label class="versions">
                  Version
                  <select
                    value="-1"
                    onChange={(e) => {
                      const i = +e.currentTarget.value;
                      e.currentTarget.value = "-1";
                      if (i >= 0) work.pickVersion(i);
                    }}
                  >
                    <option value="-1">{s.translation ? versionLabel(s.translation) : "current"}</option>
                    <For each={versions()}>{(v, i) => <option value={i()}>{versionLabel(v)}</option>}</For>
                  </select>
                </label>
              </Show>
              <Show when={s.translation?.origin === "demo"}>
                <p class="muted">Demo translation, bundled with the site.</p>
              </Show>
              <Show when={s.translation?.origin === "shared"}>
                <p class="muted">Shared translation{s.translation?.by ? ` by ${s.translation.by}` : ""}. Edits stay in this browser until you share them.</p>
              </Show>
              <Show when={s.translation?.origin === "user"}>
                <p class="muted">Lettered by hand, saved in this browser.</p>
                <button class="ghost small" onClick={work.translateAI}>
                  Translate with AI instead
                </button>
              </Show>
              <Show when={s.translation?.origin === "llm" || s.translation?.origin === "user"}>
                <Show when={s.share === "queued"}>
                  <p class="muted">Your edits will be shared in a moment.</p>
                </Show>
                <Show when={s.share === "shared"}>
                  <p class="key-ok">Shared with others{settings.nick() ? ` as ${settings.nick()}` : " anonymously"}. Thanks!</p>
                </Show>
                <Show when={s.share === "sharing"}>
                  <p class="muted">
                    <i class="spinner" /> sharing…
                  </p>
                </Show>
                <Show when={s.share === "needCaptcha"}>
                  <p class="muted">One captcha, then your translation is shared.</p>
                  <Turnstile onVerified={() => work.shareNow()} />
                </Show>
                <Show when={s.share === "error"}>
                  <p class="fatal">Sharing failed: {s.shareError}</p>
                </Show>
                <Show when={s.share === "idle" || s.share === "error" || s.share === "off" || s.share === "queued"}>
                  <button class="ghost small" onClick={() => work.shareNow()}>
                    Share this translation
                  </button>
                </Show>
              </Show>
            </div>
          </Show>
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
                  onRetranslate={r.source ? () => work.retranslate(r.id) : undefined}
                  onGoogle={r.source ? () => work.googleSuggest(r.id) : undefined}
                />
              )}
            </For>
          </ol>
        </aside>
      </main>

      <Show when={showKey()}>
        <KeyDialog
          title={keyOpen() ? "OpenRouter key and sharing" : undefined}
          lead={keyOpen() ? "Your key stays in this browser. Change it, or change how you share." : undefined}
          error={s.phase === "needKey" ? s.error : ""}
          onDone={() => {
            setKeyOpen(false);
            if (s.phase === "needKey") work.retry();
          }}
          onClose={() => {
            setKeyOpen(false);
            setKeyDismissed(true);
          }}
          onShareReady={() => s.phase === "needKey" && work.retry()}
          lang={lang()}
          src={s.rec?.srcLang}
        />
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
