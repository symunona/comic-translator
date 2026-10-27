import { For, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { allLangs, findLang, matchLang, type Lang } from "../lib/langs";
import { settings } from "../lib/settings";

type Props = {
  value: string;
  onSelect: (code: string) => void;
  translated?: string[];
  shared?: string[];
  align?: "left" | "right";
  disabled?: boolean;
};

type Section = { title: string; langs: Lang[] };

export default function LangPicker(p: Props) {
  const [open, setOpen] = createSignal(false);
  const [q, setQ] = createSignal("");
  const [cursor, setCursor] = createSignal(0);
  let root!: HTMLDivElement;
  let input!: HTMLInputElement;

  const sections = createMemo<Section[]>(() => {
    const seen = new Set<string>();
    const take = (codes: string[]) =>
      codes
        .filter((c) => !seen.has(c) && (seen.add(c), true))
        .map(findLang)
        .filter((l) => matchLang(l, q()));
    const out: Section[] = [
      { title: "Translated", langs: take(p.translated ?? []) },
      { title: "Shared by others", langs: take(p.shared ?? []) },
      { title: "Your languages", langs: take(settings.langs()) },
      { title: q() ? "Matches" : "All languages", langs: take(allLangs().map((l) => l.code)) },
    ];
    return out.filter((s) => s.langs.length);
  });
  const flat = createMemo(() => sections().flatMap((s) => s.langs));

  const close = () => {
    setOpen(false);
    setQ("");
  };
  const show = () => {
    setOpen(true);
    setCursor(0);
    queueMicrotask(() => input?.focus());
  };
  const pick = (code: string) => {
    close();
    settings.useLang(code);
    if (code !== p.value) p.onSelect(code);
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") setCursor((c) => Math.min(c + 1, flat().length - 1));
    else if (e.key === "ArrowUp") setCursor((c) => Math.max(c - 1, 0));
    else if (e.key === "Enter") {
      const l = flat()[cursor()];
      if (l) pick(l.code);
    } else return;
    e.preventDefault();
    root.querySelector(`[data-i="${cursor()}"]`)?.scrollIntoView({ block: "nearest" });
  };

  onMount(() => {
    const onDown = (e: PointerEvent) => open() && !root.contains(e.target as Node) && close();
    const onEsc = (e: KeyboardEvent) => open() && e.key === "Escape" && close();
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onEsc);
    onCleanup(() => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onEsc);
    });
  });

  const index = (l: Lang) => flat().indexOf(l);

  return (
    <div class="lang-picker" classList={{ open: open() }} ref={root}>
      <button type="button" class="lang-trigger" disabled={p.disabled} aria-haspopup="listbox" aria-expanded={open()} onClick={() => (open() ? close() : show())}>
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <circle cx="10" cy="10" r="7.5" />
          <path d="M2.5 10h15M10 2.5c2.2 2.2 3.2 4.7 3.2 7.5s-1 5.3-3.2 7.5c-2.2-2.2-3.2-4.7-3.2-7.5s1-5.3 3.2-7.5z" />
        </svg>
        <span>{findLang(p.value).name}</span>
        <i class="chev" />
      </button>
      <Show when={open()}>
        <div class="lang-menu" classList={{ left: p.align === "left" }} role="listbox">
          <input
            ref={input}
            class="lang-search"
            placeholder="Search any language…"
            value={q()}
            onInput={(e) => {
              setQ(e.currentTarget.value);
              setCursor(0);
            }}
            onKeyDown={onKey}
          />
          <div class="lang-list">
            <For each={sections()}>
              {(s) => (
                <>
                  <h4>{s.title}</h4>
                  <For each={s.langs}>
                    {(l) => (
                      <button
                        type="button"
                        role="option"
                        class="lang-item"
                        classList={{ cursor: index(l) === cursor() }}
                        data-i={index(l)}
                        aria-selected={l.code === p.value}
                        onMouseEnter={() => setCursor(index(l))}
                        onClick={() => pick(l.code)}
                      >
                        <span class="lang-code">{l.code}</span>
                        <span class="lang-name">
                          {l.name}
                          <Show when={l.native && l.native.toLowerCase() !== l.name.toLowerCase()}>
                            <em> · {l.native}</em>
                          </Show>
                        </span>
                        <Show when={l.code === p.value}>
                          <i class="tick" />
                        </Show>
                      </button>
                    )}
                  </For>
                </>
              )}
            </For>
            <Show when={!flat().length}>
              <p class="muted lang-empty">No language matches “{q()}”.</p>
            </Show>
          </div>
        </div>
      </Show>
    </div>
  );
}
