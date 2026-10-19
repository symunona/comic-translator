import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import { langName } from "../lib/langs";
import { LANGS } from "../lib/types";

type Props = {
  value: string;
  translated: string[];
  credits: number;
  onSelect: (code: string) => void;
  onTranslate?: (code: string) => void;
  translatedTitle?: string;
  align?: "left" | "right";
  disabled?: boolean;
};

export default function LangPicker(p: Props) {
  const [open, setOpen] = createSignal(false);
  const [pending, setPending] = createSignal<string | null>(null);
  let root!: HTMLDivElement;

  const others = () => LANGS.filter((l) => !p.translated.includes(l.code));
  const close = () => {
    setOpen(false);
    setPending(null);
  };
  const pick = (code: string) => {
    close();
    if (code !== p.value) p.onSelect(code);
  };
  const translate = (code: string) => {
    close();
    p.onTranslate?.(code);
  };

  onMount(() => {
    const onDown = (e: PointerEvent) => open() && !root.contains(e.target as Node) && close();
    const onKey = (e: KeyboardEvent) => open() && e.key === "Escape" && close();
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    onCleanup(() => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    });
  });

  return (
    <div class="lang-picker" classList={{ open: open() }} ref={root}>
      <button type="button" class="lang-trigger" disabled={p.disabled} aria-haspopup="listbox" aria-expanded={open()} onClick={() => (open() ? close() : setOpen(true))}>
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <circle cx="10" cy="10" r="7.5" />
          <path d="M2.5 10h15M10 2.5c2.2 2.2 3.2 4.7 3.2 7.5s-1 5.3-3.2 7.5c-2.2-2.2-3.2-4.7-3.2-7.5s1-5.3 3.2-7.5z" />
        </svg>
        <span>{langName(p.value)}</span>
        <i class="chev" />
      </button>
      <Show when={open()}>
        <div class="lang-menu" classList={{ left: p.align === "left" }} role="listbox">
          <Show when={p.translated.length}>
            <h4>{p.translatedTitle ?? "Translated"}</h4>
            <For each={LANGS.filter((l) => p.translated.includes(l.code))}>
              {(l) => (
                <button type="button" role="option" class="lang-item" aria-selected={l.code === p.value} onClick={() => pick(l.code)}>
                  <span class="lang-code">{l.code}</span>
                  <span class="lang-name">{l.name}</span>
                  <Show when={l.code === p.value}>
                    <i class="tick" />
                  </Show>
                </button>
              )}
            </For>
          </Show>
          <Show when={p.onTranslate && others().length}>
            <h4>Translate to another language</h4>
            <For each={others()}>
              {(l) => (
                <Show
                  when={pending() === l.code}
                  fallback={
                    <button type="button" role="option" class="lang-item new" onClick={() => setPending(l.code)}>
                      <span class="lang-code">{l.code}</span>
                      <span class="lang-name">{l.name}</span>
                      <span class="credits">{p.credits} credits</span>
                    </button>
                  }
                >
                  <div class="lang-confirm">
                    <span>
                      Translate to <b>{l.name}</b>?
                    </span>
                    <button type="button" class="primary small" onClick={() => translate(l.code)}>
                      Translate · {p.credits} credits
                    </button>
                    <button type="button" class="ghost small" onClick={() => setPending(null)}>
                      Cancel
                    </button>
                  </div>
                </Show>
              )}
            </For>
          </Show>
        </div>
      </Show>
    </div>
  );
}
