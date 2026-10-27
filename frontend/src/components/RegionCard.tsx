import { Show, createSignal } from "solid-js";
import type { Region, RegionTranslation } from "../lib/types";

type Props = {
  region: Region;
  tr?: RegionTranslation;
  editing: boolean;
  hovered: boolean;
  active: boolean;
  ref: (el: HTMLElement) => void;
  onHover: (on: boolean) => void;
  onPick: () => void;
  onText: (text: string) => void;
  onReplace: (on: boolean) => void;
  onRetranslate?: () => Promise<void>;
};

export default function RegionCard(p: Props) {
  const [busy, setBusy] = createSignal(false);
  const overBudget = () => !!p.tr?.maxChars && (p.tr.text?.length ?? 0) > p.tr.maxChars;
  const retranslate = async () => {
    setBusy(true);
    try {
      await p.onRetranslate?.();
    } finally {
      setBusy(false);
    }
  };
  return (
    <li
      ref={p.ref}
      class="card"
      classList={{ hovered: p.hovered, active: p.active, editing: p.editing, keep: !p.region.replace }}
      onMouseEnter={() => p.onHover(true)}
      onMouseLeave={() => p.onHover(false)}
      onClick={(e) => {
        if (!(e.target as HTMLElement).closest("textarea,button,label")) p.onPick();
      }}
    >
      <header>
        <span class="num">#{p.region.order + 1}</span>
        <Show when={p.region.speaker}>
          <span class="speaker">{p.region.speaker}</span>
        </Show>
        <Show when={p.region.kind}>
          <span class={`chip ${p.region.kind}`}>{p.region.kind}</span>
        </Show>
      </header>
      <Show when={p.region.source}>
      <p class="source">{p.region.source?.lines?.length ? p.region.source.lines.join("\n") : p.region.source?.text}</p>
      </Show>
      <div class="edit">
        <div class="edit-inner">
          <Show when={p.tr?.literal}>
            <p class="literal">{p.tr!.literal}</p>
          </Show>
          <Show when={p.tr} fallback={<p class="muted">waiting for translation…</p>}>
            <textarea
              rows={Math.min(5, Math.max(2, (p.tr!.text ?? "").split("\n").length))}
              value={p.tr!.text ?? ""}
              onInput={(e) => p.onText(e.currentTarget.value)}
              onFocus={p.onPick}
              spellcheck
            />
          </Show>
          <Show when={p.tr?.notes}>
            <p class="notes">{p.tr!.notes}</p>
          </Show>
          <footer>
            <label class="toggle" title="Erase the original lettering and draw the translation">
              <input type="checkbox" checked={p.region.replace} onChange={(e) => p.onReplace(e.currentTarget.checked)} />
              <span>replace</span>
            </label>
            <Show when={p.tr?.maxChars}>
              <span class="budget" classList={{ over: overBudget() }}>
                {p.tr!.text?.length ?? 0}/{p.tr!.maxChars}
              </span>
            </Show>
            <Show when={p.onRetranslate}>
              <button class="ghost small" disabled={busy()} onClick={retranslate}>
                {busy() ? "translating…" : "retranslate"}
              </button>
            </Show>
          </footer>
        </div>
      </div>
    </li>
  );
}
