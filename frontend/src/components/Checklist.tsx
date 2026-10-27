import { For, Show, createMemo, createSignal } from "solid-js";
import { STAGES, type CallStat, type StageName, type StageState } from "../lib/types";

const LABELS: Record<StageName, string> = {
  panels: "Find panels",
  detect: "Detect bubbles",
  clean: "Erase text",
  shared: "Look for shared translations",
  ocr: "Read text",
  scene: "Understand scene",
  translate: "Translate",
  review: "Review jokes & fit",
};

const WHERE: Record<StageName, string> = {
  panels: "your browser",
  detect: "your browser",
  clean: "your browser",
  shared: "comic hub",
  ocr: "OpenRouter",
  scene: "OpenRouter",
  translate: "OpenRouter",
  review: "OpenRouter",
};

export const usd = (n: number) => (n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(3)}`);

export default function Checklist(p: { stages: Record<StageName, StageState>; collapsed: boolean; error: string; lang: string; calls: CallStat[] }) {
  const [expanded, setExpanded] = createSignal(false);
  const cost = (name: StageName) =>
    p.calls.filter((c) => c.stage === name || c.stage === `${name}:${p.lang}`).reduce((n, c) => n + c.costUsd, 0);
  const total = createMemo(() => p.calls.reduce((n, c) => n + c.costUsd, 0));
  const open = () => !p.collapsed || expanded();
  return (
    <div class="pipeline">
      <Show when={p.collapsed}>
        <button type="button" class="pipeline-toggle" aria-expanded={expanded()} onClick={() => setExpanded((v) => !v)}>
          <i class="chev" />
          Pipeline
          <Show when={total() > 0}>
            <span>{usd(total())} spent on this strip</span>
          </Show>
        </button>
      </Show>
      <div class="checklist-wrap" classList={{ collapsed: !open() }}>
        <div>
          <ol class="checklist">
            <For each={STAGES}>
              {(name) => {
                const st = () => p.stages[name];
                return (
                  <li class={`step ${st().status}`}>
                    <span class="step-icon" />
                    <span class="step-label">{LABELS[name]}</span>
                    <span class="step-right">
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
                      <Show when={cost(name) > 0}>
                        <span class="credit">{usd(cost(name))}</span>
                      </Show>
                    </span>
                    <span class="step-where">{WHERE[name]}</span>
                    <Show when={st().message}>
                      <span class="step-msg">{st().message}</span>
                    </Show>
                  </li>
                );
              }}
            </For>
          </ol>
        </div>
      </div>
      <Show when={p.error}>
        <p class="fatal">{p.error}</p>
      </Show>
    </div>
  );
}
