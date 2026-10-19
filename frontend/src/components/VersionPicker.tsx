import { For, Show, createSignal } from "solid-js";
import type { TrVersion, TrVersions } from "../lib/types";

const usd = (n: number) => `$${n.toFixed(n < 1 ? 3 : 2)}`;
const kTok = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
const secs = (ms: number) => (ms >= 60000 ? `${Math.floor(ms / 60000)}m${Math.round((ms % 60000) / 1000)}s` : `${Math.round(ms / 1000)}s`);

export const versionTitle = (v: TrVersion) => `${v.id} · ${v.label}${v.source === "user" ? " (you)" : ""}`;

function Facts(p: { v: TrVersion }) {
  const u = () => p.v.usage;
  return (
    <p class="version-facts">
      <span class={`chip ${p.v.source === "user" ? "user" : "llm"}`}>{p.v.source === "user" ? "user" : "LLM"}</span>
      <Show when={p.v.model && p.v.model !== p.v.label}>
        <span title="backend:model">{p.v.model}</span>
      </Show>
      <Show when={p.v.from}>
        <span>from {p.v.from}</span>
      </Show>
      <Show when={u()}>
        <span title="list price (claude-cli: subscription equivalent)">{usd(u()!.costUsd)}</span>
        <span title="input + cache / output tokens">
          {kTok(u()!.tokens.input_tokens + u()!.tokens.cache_creation_input_tokens + u()!.tokens.cache_read_input_tokens)} in / {kTok(u()!.tokens.output_tokens)} out
        </span>
        <span>{secs(u()!.durationMs)}</span>
      </Show>
      <Show when={p.v.reviewError}>
        <span class="chip sfx" title={p.v.reviewError}>unreviewed draft</span>
      </Show>
    </p>
  );
}

export default function VersionPicker(p: {
  versions: TrVersions;
  value: string;
  editable?: boolean;
  onSelect: (vid: string) => void;
  onCopy?: () => void;
  onRename?: (vid: string, label: string) => void;
  onDelete?: (vid: string) => void;
}) {
  const current = () => p.versions.versions.find((v) => v.id === p.value);
  const [busy, setBusy] = createSignal(false);
  const run = async (fn?: () => unknown) => {
    if (!fn || busy()) return;
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };
  const rename = (label: string) => {
    const v = current();
    if (v && label.trim() && label.trim() !== v.label) run(() => p.onRename?.(v.id, label.trim()));
  };

  return (
    <div class="versions" classList={{ compact: !p.editable }}>
      <label class="version-row">
        <Show when={p.editable}>
          <span class="version-head">Version</span>
        </Show>
        <select value={p.value} disabled={busy()} onChange={(e) => run(() => p.onSelect(e.currentTarget.value))} aria-label="Translation version">
          <For each={p.versions.versions}>{(v) => (
            <option value={v.id} selected={v.id === p.value}>
              {versionTitle(v)}
            </option>
          )}</For>
        </select>
      </label>
      <Show when={p.editable && current()}>
        {(v) => (
          <>
            <Facts v={v()} />
            <div class="version-actions">
              <input
                class="version-label"
                value={v().label}
                aria-label="Version name"
                onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                onBlur={(e) => rename(e.currentTarget.value)}
              />
              <button type="button" class="ghost" disabled={busy()} onClick={() => run(p.onCopy)} title="Save a copy of this version as your own">
                Copy as mine
              </button>
              <button
                type="button"
                class="ghost"
                disabled={busy() || p.versions.versions.length < 2}
                onClick={() => confirm(`Delete ${v().id} · ${v().label}?`) && run(() => p.onDelete?.(v().id))}
              >
                Delete
              </button>
            </div>
            <Show when={v().source !== "user"}>
              <p class="version-note">Edits save as a new version of your own. This one stays as generated.</p>
            </Show>
          </>
        )}
      </Show>
    </div>
  );
}
