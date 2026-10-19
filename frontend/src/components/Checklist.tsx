import { For, Show } from "solid-js";
import { STAGES, type StageName } from "../lib/types";
import type { StageState } from "../lib/work";

const LABELS: Record<StageName, string> = {
  ingest: "Ingest",
  panels: "Find panels",
  detect: "Detect bubbles",
  order: "Reading order",
  ocr: "Read text",
  scene: "Understand scene",
  clean: "Erase text",
  translate: "Translate",
  review: "Review jokes & fit",
};

export default function Checklist(p: { stages: Record<StageName, StageState>; collapsed: boolean; error: string }) {
  return (
    <div class="checklist-wrap" classList={{ collapsed: p.collapsed }}>
      <ol class="checklist">
        <For each={STAGES}>
          {(name) => {
            const st = () => p.stages[name];
            return (
              <li class={`step ${st().status}`}>
                <span class="step-icon" />
                <span class="step-label">{LABELS[name]}</span>
                <Show when={st().progress}>
                  {(pr) => (
                    <span class="step-progress">
                      <span>
                        <b style={{ width: `${(pr().done / Math.max(pr().total, 1)) * 100}%` }} />
                      </span>
                      <em>
                        {pr().done}/{pr().total}
                      </em>
                    </span>
                  )}
                </Show>
                <Show when={st().message}>
                  <span class="step-msg">{st().message}</span>
                </Show>
              </li>
            );
          }}
        </For>
      </ol>
      <Show when={p.error}>
        <p class="fatal">{p.error}</p>
      </Show>
    </div>
  );
}
