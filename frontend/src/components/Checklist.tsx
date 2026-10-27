import { For, Show, createMemo, createSignal } from "solid-js";
import { settings } from "../lib/settings";
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

const LLM = new Set<StageName>(["ocr", "scene", "translate", "review"]);

const HOW: Record<StageName, string> = {
  panels: "your browser · XY-cut on the ink projection",
  detect: "your browser · comic-text-and-bubble-detector v4-s int8 (RT-DETR v2, ONNX on WASM)",
  clean: "your browser · lettering ink inside each bubble painted with the paper colour",
  shared: "comic hub · lookup by the image's SHA-256",
  ocr: "whole strip + close-up per box, 1 call, reasoning low",
  scene: "all panels + transcript, 1 call",
  translate: "all bubbles at once, 1 call",
  review: "critique + rewrite, 1 call",
};

const FREE_HOW: Partial<Record<StageName, string>> = {
  ocr: "your browser · PaddleOCR v5 latin (ONNX on WASM) + language guess",
  scene: "skipped in free mode",
  translate: "your browser · Chrome's built-in translator, or opus-mt",
  review: "skipped in free mode",
};

const modelLink = (m: string) => (
  <a href={`https://openrouter.ai/${m}`} target="_blank" rel="noopener">
    {m}
  </a>
);

export const usd = (n: number) => (n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(3)}`);

type Props = {
  stages: Record<StageName, StageState>;
  collapsed: boolean;
  error: string;
  lang: string;
  calls: CallStat[];
  model: string;
  freeRead?: boolean;
  freeTranslate?: boolean;
  freeGpu?: boolean;
  hasKey: boolean;
  onAddKey: () => void;
  onNewVersion?: () => void;
  onDownloadEmpty?: () => void;
  onEditEmpty?: () => void;
};

export default function Checklist(p: Props) {
  const [expanded, setExpanded] = createSignal(false);
  const callsOf = (name: StageName) => p.calls.filter((c) => c.stage === name || c.stage === `${name}:${p.lang}`);
  const cost = (name: StageName) => callsOf(name).reduce((n, c) => n + c.costUsd, 0);
  const models = (name: StageName) => {
    const used = [...new Set(callsOf(name).map((c) => c.model))];
    return used.length ? used : [p.model];
  };
  const total = createMemo(() => p.calls.reduce((n, c) => n + c.costUsd, 0));
  const open = () => !p.collapsed || expanded();
  const free = (name: StageName) => (name === "ocr" ? p.freeRead : name !== "panels" && name !== "detect" && name !== "clean" && name !== "shared" && p.freeTranslate);
  const freeHow = (name: StageName) => (name === "ocr" && p.freeGpu ? `${FREE_HOW.ocr} + Qwen3.5-0.8B re-read on WebGPU` : FREE_HOW[name]);
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
                    <span class="step-where">
                      <Show when={LLM.has(name) && !free(name)} fallback={(free(name) && freeHow(name)) || HOW[name]}>
                        OpenRouter · <For each={models(name)}>{(m, i) => <>{i() ? ", " : ""}{modelLink(m)}</>}</For>
                        <Show when={!callsOf(name).length}> (planned)</Show> · {HOW[name]}
                      </Show>
                    </span>
                    <Show when={st().message}>
                      <span class="step-msg">{st().message}</span>
                    </Show>
                    <Show when={name === "clean" && (p.onDownloadEmpty || p.onEditEmpty)}>
                      <span class="step-actions">
                        <Show when={p.onDownloadEmpty}>
                          <button type="button" class="ghost small" onClick={p.onDownloadEmpty}>
                            Download empty
                          </button>
                        </Show>
                        <Show when={p.onEditEmpty}>
                          <button type="button" class="ghost small" title="Open the editor with every bubble blank, letter it yourself" onClick={p.onEditEmpty}>
                            Edit empty
                          </button>
                        </Show>
                      </span>
                    </Show>
                  </li>
                );
              }}
            </For>
          </ol>
          <div class="pipeline-opts">
            <label class="toggle" classList={{ off: !p.hasKey }}>
              <input type="checkbox" disabled={!p.hasKey} checked={p.hasKey && settings.sotaRead()} onChange={(e) => settings.setSotaRead(e.currentTarget.checked)} />
              <span>Use SOTA models to read the text</span>
            </label>
            <label class="toggle" classList={{ off: !p.hasKey }}>
              <input type="checkbox" disabled={!p.hasKey} checked={p.hasKey && settings.sotaTranslate()} onChange={(e) => settings.setSotaTranslate(e.currentTarget.checked)} />
              <span>Use SOTA models to translate and review</span>
            </label>
            <p class="muted">
              <Show when={p.hasKey} fallback={<>SOTA models need an OpenRouter key. <button type="button" class="ghost small" onClick={p.onAddKey}>Add key</button></>}>
                Off: done on this computer, free, rougher.
              </Show>
            </p>
            <Show when={p.onNewVersion}>
              <button type="button" class="ghost small" title="Read and translate again with these settings. The current translation is kept as an older version." onClick={p.onNewVersion}>
                New version
              </button>
            </Show>
          </div>
          <a class="why-link" href="/research.html" target="_blank" rel="noopener">
            Why these models? The benchmarks →
          </a>
        </div>
      </div>
      <Show when={p.error}>
        <p class="fatal">{p.error}</p>
      </Show>
    </div>
  );
}
