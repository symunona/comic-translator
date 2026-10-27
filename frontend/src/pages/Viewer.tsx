import { A, useNavigate, useParams, useSearchParams } from "@solidjs/router";
import { Show, createMemo, createResource, createSignal, onCleanup, onMount } from "solid-js";
import Brand from "../components/Brand";
import LangPicker from "../components/LangPicker";
import Strip from "../components/Strip";
import ViewToggle from "../components/ViewToggle";
import { FONT_FAMILY, chosenFont, fontFamily } from "../lib/layout";
import { settings } from "../lib/settings";
import type { Panel, Translation } from "../lib/types";
import { loadView } from "../lib/view";

type Cam = { x: number; y: number; k: number };

const BAR = 76;
const MAX_SCALE = 1.8;
const MOVE_MS = 560;

function ViewerView(props: { id: string }) {
  const [search, setSearch] = useSearchParams();
  const navigate = useNavigate();
  const [strip] = createResource(() => props.id, loadView);
  onCleanup(() => {
    const v = strip();
    if (v) [v.imageUrl, v.cleanUrl].forEach(URL.revokeObjectURL);
  });
  const langs = createMemo(() => Object.keys(strip()?.rec.translations ?? {}));
  const asked = () => (typeof search.lang === "string" ? search.lang : "");
  const lang = createMemo(() => {
    const ls = langs();
    if (ls.includes(asked())) return asked();
    return ls[0] ?? (asked() || "en");
  });
  const translation = createMemo<Translation | null>(() => strip()?.rec.translations[lang()] ?? null);
  const [fontsReady, setFontsReady] = createSignal(false);
  const [showOriginal, setShowOriginal] = createSignal(false);
  const [idx, setIdx] = createSignal(-1);
  const [cam, setCam] = createSignal<Cam | null>(null);
  const [animate, setAnimate] = createSignal(false);

  const panels = createMemo<Panel[]>(() => [...(strip()?.rec.panels ?? [])].sort((a, b) => a.order - b.order));
  const zoomed = () => idx() >= 0;
  const untranslated = () => strip.state === "ready" && !langs().length;

  let stage!: HTMLDivElement;
  let frame!: HTMLDivElement;
  let move = 0;

  onMount(() => {
    Promise.all([
      document.fonts.load(`32px ${FONT_FAMILY}`, "Aa"),
      document.fonts.load(`32px ${FONT_FAMILY}`, "őű"),
    ]).finally(() => setFontsReady(true));
  });

  const scale = () => frame.offsetWidth / strip()!.rec.width;
  const view = () => ({ w: stage.clientWidth, h: stage.clientHeight - BAR, pad: stage.clientWidth < 640 ? 4 : 20 });

  const target = (p: Panel): Cam => {
    const [x, y, w, h] = p.bbox;
    const f = scale();
    const v = view();
    const k = Math.min((v.w - v.pad * 2) / (w * f), (v.h - v.pad * 2) / (h * f), Math.max(1, MAX_SCALE / f));
    return {
      x: v.w / 2 - frame.offsetLeft - (x + w / 2) * f * k,
      y: v.h / 2 - frame.offsetTop - (y + h / 2) * f * k,
      k,
    };
  };

  const entry = () => {
    const f = scale();
    const top = stage.scrollTop - frame.offsetTop + view().h * 0.3;
    const i = panels().findIndex((p) => (p.bbox[1] + p.bbox[3]) * f > top);
    return i < 0 ? panels().length - 1 : i;
  };

  const goTo = (i: number) => {
    const p = panels()[i];
    if (!p) return;
    const token = ++move;
    if (!zoomed()) {
      const st = stage.scrollTop;
      setAnimate(false);
      setCam({ x: 0, y: -st, k: 1 });
      setIdx(i);
      stage.scrollTop = 0;
      void frame.offsetHeight;
      requestAnimationFrame(() => {
        if (token !== move) return;
        setAnimate(true);
        setCam(target(p));
      });
      return;
    }
    setAnimate(true);
    setIdx(i);
    setCam(target(p));
  };

  const whole = () => {
    const p = panels()[idx()];
    if (!p) return;
    const token = ++move;
    const f = scale();
    const v = view();
    const max = frame.offsetTop * 2 + frame.offsetHeight - stage.clientHeight;
    const st = Math.max(0, Math.min(max, frame.offsetTop + (p.bbox[1] + p.bbox[3] / 2) * f - v.h / 2));
    setAnimate(true);
    setCam({ x: 0, y: -st, k: 1 });
    setTimeout(() => {
      if (token !== move) return;
      setAnimate(false);
      setCam(null);
      setIdx(-1);
      stage.scrollTop = st;
    }, MOVE_MS);
  };

  const next = () => (zoomed() ? goTo(Math.min(idx() + 1, panels().length - 1)) : goTo(entry()));
  const prev = () => (zoomed() ? goTo(Math.max(idx() - 1, 0)) : goTo(entry()));

  const onStageClick = (e: MouseEvent) => {
    if (!strip() || !panels().length) return;
    const r = stage.getBoundingClientRect();
    if (zoomed()) return e.clientX - r.left < r.width / 3 ? prev() : next();
    const f = scale();
    const fr = frame.getBoundingClientRect();
    const px = (e.clientX - fr.left) / f;
    const py = (e.clientY - fr.top) / f;
    const i = panels().findIndex(({ bbox: [x, y, w, h] }) => px >= x && px <= x + w && py >= y && py <= y + h);
    if (i >= 0) goTo(i);
  };

  const onKey = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement).closest("input,textarea,select,.lang-picker.open") || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    if (k === "ArrowRight" || k === "PageDown" || k === "j" || k === " " || (zoomed() && k === "ArrowDown")) next();
    else if (k === "ArrowLeft" || k === "PageUp" || k === "k" || (zoomed() && k === "ArrowUp")) prev();
    else if (k === "Escape" && zoomed()) whole();
    else if (k === "o" || k === "t") setShowOriginal((v) => !v);
    else return;
    e.preventDefault();
  };
  const onResize = () => {
    const p = panels()[idx()];
    if (!p) return;
    setAnimate(false);
    setCam(target(p));
  };
  window.addEventListener("keydown", onKey);
  window.addEventListener("resize", onResize);
  onCleanup(() => {
    window.removeEventListener("keydown", onKey);
    window.removeEventListener("resize", onResize);
  });

  const camStyle = () => {
    const c = cam();
    return c ? { transform: `translate(${c.x}px, ${c.y}px) scale(${c.k})` } : {};
  };

  return (
    <div class="viewer">
      <header class="topbar">
        <Brand />
        <span class="strip-name" title={strip()?.rec.name}>
          {strip()?.rec.name ?? ""}
        </span>
        <div class="spacer" />
        <ViewToggle original={showOriginal() || untranslated()} onChange={setShowOriginal} disabled={untranslated()} />
        <LangPicker
          value={lang()}
          translated={langs()}
          onSelect={(l) => (langs().includes(l) ? setSearch({ lang: l }) : navigate(`/s/${encodeURIComponent(props.id)}?lang=${l}`))}
        />
        <A class="button edit-link" href={`/s/${encodeURIComponent(props.id)}?lang=${lang()}`}>
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="M13.5 3.5l3 3L7 16H4v-3z" />
          </svg>
          <span>Edit</span>
        </A>
      </header>

      <main class="viewer-stage" classList={{ zoomed: zoomed() }} ref={stage} onClick={onStageClick} onWheel={() => zoomed() && whole()}>
        <Show when={strip()} fallback={<div class="strip-placeholder">{strip.error ? `Could not load strip (${strip.error.message})` : <><i class="spinner" /> loading strip…</>}</div>}>
          {(st) => (
            <div class="cam" classList={{ animate: animate() }} ref={frame} style={camStyle()}>
              <Strip
                width={st().rec.width}
                height={st().rec.height}
                name={st().rec.name}
                panels={panels()}
                regions={st().regions}
                translation={translation()}
                lang={lang()}
                font={fontFamily(chosenFont(settings.font(), st().rec.font))}
                imageUrl={st().imageUrl}
                cleanUrl={st().cleanUrl}
                showOriginal={showOriginal() || untranslated()}
                fontsReady={fontsReady()}
              />
              <Show when={panels()[idx()]}>
                {(p) => (
                  <div
                    class="spot"
                    style={{
                      left: `${(p().bbox[0] / st().rec.width) * 100}%`,
                      top: `${(p().bbox[1] / st().rec.height) * 100}%`,
                      width: `${(p().bbox[2] / st().rec.width) * 100}%`,
                      height: `${(p().bbox[3] / st().rec.height) * 100}%`,
                    }}
                  />
                )}
              </Show>
            </div>
          )}
        </Show>
      </main>

      <Show when={untranslated()}>
        <p class="viewer-note">Not translated yet. Pick a language above to translate it.</p>
      </Show>

      <Show when={panels().length > 1}>
        <nav class="cell-bar" aria-label="Panels">
          <button type="button" class="ghost" aria-label="Previous panel" disabled={!zoomed() || idx() === 0} onClick={prev}>
            <i class="arrow left" />
          </button>
          <span class="cell-count">
            <Show when={zoomed()} fallback={<>{panels().length} panels</>}>
              <b>{idx() + 1}</b> / {panels().length}
            </Show>
          </span>
          <button type="button" class="primary" aria-label="Next panel" disabled={zoomed() && idx() === panels().length - 1} onClick={next}>
            <span>{zoomed() ? "Next" : "Read panel by panel"}</span>
            <i class="arrow right" />
          </button>
          <Show when={zoomed()}>
            <button type="button" class="ghost" onClick={whole}>
              Whole strip
            </button>
          </Show>
        </nav>
      </Show>
    </div>
  );
}

export default function Viewer() {
  const params = useParams();
  return (
    <Show when={params.id} keyed>
      {(id) => <ViewerView id={id} />}
    </Show>
  );
}
