import { For, Show, createMemo, createSignal } from "solid-js";
import { creditLabel, isPaid } from "../lib/credits";
import { STAGES, type Config, type LLMCall, type StageName, type StageStat, type UsageReport } from "../lib/types";
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

const LLM_STAGES = new Set<string>(["ocr", "scene", "translate", "review"]);

const CV_WHAT: Partial<Record<StageName, string>> = {
  ingest: "decode",
  panels: "CV · XY-cut",
  order: "CV",
  clean: "CV",
};

type Where = { where: string; what: string; local: boolean };

type Row = { key: string; label: string; state: StageState; calls: LLMCall[]; where?: Where; stat?: StageStat };

const COUNT_LABEL: Record<string, string> = { text_bubble: "text in bubble", text_free: "free text", bubble: "bubble only" };

const countText = (c: Record<string, number>) =>
  Object.entries(c)
    .filter(([k]) => k !== "width" && k !== "height")
    .map(([k, v]) => `${v} ${COUNT_LABEL[k] ?? k}`)
    .join(" · ");

function StatLine(p: { stat: StageStat; calls: LLMCall[] }) {
  const c = () => p.stat.counts ?? {};
  const llmMs = () => p.calls.reduce((n, x) => n + x.durationMs, 0);
  return (
    <span class="step-stat">
      <span>
        <b>{secs(p.stat.ms)}</b> wall
        <Show when={p.calls.length > 1}> · {secs(llmMs())} in {p.calls.length} calls</Show>
        <Show when={c().width}> · {c().width}×{c().height} px</Show>
        <Show when={countText(c())}> · {countText(c())}</Show>
      </span>
      <Show when={p.stat.detail}>
        <span class="step-detail">{p.stat.detail}</span>
      </Show>
    </span>
  );
}

const kTok = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
const secs = (ms: number) => (ms >= 60000 ? `${Math.floor(ms / 60000)}m${Math.round((ms % 60000) / 1000)}s` : `${(ms / 1000).toFixed(1)}s`);
const usd = (n: number) => `$${n.toFixed(n < 1 ? 3 : 2)}`;
const mb = (b: number) => `${(b / 1e6).toFixed(1)} MB`;

const usageStage = (name: StageName, lang: string) => (name === "translate" || name === "review" ? `${name}:${lang}` : name);

function llmWhere(stage: string, calls: LLMCall[], cfg?: Config): Where | undefined {
  const used = [...new Map(calls.map((c) => [`${c.backend}:${c.model}`, c])).values()];
  if (used.length) return { where: used.every((c) => c.local) ? "local LLM" : "LLM", what: used.map((c) => `${c.backend} ${c.model}`).join(", "), local: used.every((c) => c.local) };
  const spec = cfg?.llm?.[stage];
  if (!spec) return undefined;
  const [backend, model] = spec.split(/:(.*)/s);
  const local = backend === "ollama";
  return { where: local ? "local LLM" : "LLM", what: `${backend} ${model ?? ""} (planned)`, local };
}

function detectWhere(report: UsageReport | undefined, cfg: Config): Where {
  const d = report?.detect;
  if (d) {
    const parts = [d.model.endsWith(".onnx") ? d.model : `${d.model}.onnx`];
    if (d.bytes) parts.push(mb(d.bytes));
    parts.push(d.device, secs(d.ms));
    return { where: "browser", what: parts.join(" · "), local: true };
  }
  if (cfg.clientDetect) return { where: "browser", what: "onnxruntime-web", local: true };
  return { where: "server", what: `ONNX ${cfg.detector ?? ""}`.trim(), local: true };
}

const callName = (c: LLMCall, i: number, all: LLMCall[]) => {
  if (/^p\d+$/.test(c.label)) return `panel ${Number(c.label.slice(1)) + 1}`;
  return all.filter((x) => x.label === c.label).length > 1 ? `${c.label} #${i + 1}` : c.label;
};

function CallLine(p: { call: LLMCall; name: string; debug: boolean }) {
  const c = p.call;
  const t = c.tokens;
  return (
    <li class="substep" classList={{ failed: !!c.error, local: c.local }}>
      <span class="substep-label">
        {p.name}
        <Show when={c.attempt > 0}>
          <em> retry</em>
        </Show>
        <Show when={c.error}>
          <em class="err"> failed</em>
        </Show>
      </span>
      <span class="credit" classList={{ free: !isPaid(c) }}>{isPaid(c) ? creditLabel(c.credits) : c.error ? "no charge" : "free"}</span>
      <Show when={p.debug}>
        <span class="substep-debug">
          {c.backend}:{c.model}
          <Show when={t} fallback={<> · tokens n/a</>}>
            {" "}· in {kTok(t!.input_tokens)} · out {kTok(t!.output_tokens)} · cache w {kTok(t!.cache_creation_input_tokens)} r {kTok(t!.cache_read_input_tokens)}
          </Show>
          {" "}· {secs(c.durationMs)} · {usd(c.costUsd)}
        </span>
      </Show>
    </li>
  );
}

function StepRow(p: { row: Row; debug: boolean }) {
  const [open, setOpen] = createSignal(false);
  const st = () => p.row.state;
  const paid = () => p.row.calls.filter(isPaid);
  const failed = () => p.row.calls.filter((c) => !isPaid(c) && c.error).length;
  const free = () => p.row.calls.length - paid().length - failed();
  const credits = () => p.row.calls.reduce((n, c) => n + c.credits, 0);
  const cost = () => p.row.calls.reduce((n, c) => n + c.costUsd, 0);
  return (
    <li class={`step ${st().status}`}>
      <span class="step-icon" />
      <span class="step-label">{p.row.label}</span>
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
        <Show when={credits() > 0}>
          <span class="credit">{creditLabel(credits())}</span>
        </Show>
      </span>
      <Show when={p.debug && p.row.where}>
        {(w) => (
          <span class="step-where">
            <b>{w().where}</b> · {w().what}
            <Show when={w().local}>
              <i class="tag-free">local · free</i>
            </Show>
          </span>
        )}
      </Show>
      <Show when={p.debug && p.row.stat}>{(stat) => <StatLine stat={stat()} calls={p.row.calls} />}</Show>
      <Show when={st().message && !(p.debug && p.row.stat)}>
        <span class="step-msg">{st().message}</span>
      </Show>
      <Show when={p.row.calls.length}>
        <button type="button" class="substep-toggle" aria-expanded={open()} onClick={() => setOpen((v) => !v)}>
          <i class="chev" />
          {paid().length} paid call{paid().length === 1 ? "" : "s"}
          <Show when={failed()}>
            <span> · {failed()} failed</span>
          </Show>
          <Show when={free()}>
            <span> · {free()} free</span>
          </Show>
          <Show when={p.debug}>
            <span> · {usd(cost())}</span>
          </Show>
        </button>
        <Show when={open()}>
          <ol class="substeps">
            <For each={p.row.calls}>{(c, i) => <CallLine call={c} name={callName(c, i(), p.row.calls)} debug={p.debug} />}</For>
          </ol>
        </Show>
      </Show>
    </li>
  );
}

export default function Checklist(p: {
  stages: Record<StageName, StageState>;
  collapsed: boolean;
  error: string;
  lang: string;
  usage?: UsageReport;
  config?: Config;
}) {
  const [expanded, setExpanded] = createSignal(false);
  const debug = () => !!p.config?.debug;
  const callsBy = createMemo(() => {
    const m = new Map<string, LLMCall[]>();
    for (const c of p.usage?.calls ?? []) m.set(c.stage, [...(m.get(c.stage) ?? []), c]);
    return m;
  });
  const rows = createMemo<Row[]>(() => {
    const out: Row[] = STAGES.map((name) => {
      const key = usageStage(name, p.lang);
      const calls = LLM_STAGES.has(name) ? (callsBy().get(key) ?? []) : [];
      let where: Where | undefined;
      if (p.config) {
        if (name === "detect") where = detectWhere(p.usage, p.config);
        else if (LLM_STAGES.has(name)) where = llmWhere(name, calls, p.config);
        else where = { where: "server", what: CV_WHAT[name] ?? "", local: true };
      }
      return { key, label: LABELS[name], state: p.stages[name], calls, where, stat: p.usage?.stats?.[key] };
    });
    const re = callsBy().get(`retranslate:${p.lang}`);
    if (re?.length) out.push({ key: `retranslate:${p.lang}`, label: "Retranslate (editor)", state: { status: "done" }, calls: re, where: llmWhere("translate", re, p.config) });
    return out;
  });
  const total = () => p.usage?.total;
  const open = () => !p.collapsed || expanded();
  return (
    <div class="pipeline">
      <Show when={p.collapsed}>
        <button type="button" class="pipeline-toggle" aria-expanded={expanded()} onClick={() => setExpanded((v) => !v)}>
          <i class="chev" />
          Pipeline
          <Show when={total()}>
            {(t) => (
              <span>
                {t().paid} paid LLM call{t().paid === 1 ? "" : "s"} · <b>{creditLabel(t().credits)}</b>
              </span>
            )}
          </Show>
        </button>
      </Show>
      <div class="checklist-wrap" classList={{ collapsed: !open() }}>
        <div>
          <ol class="checklist">
            <For each={rows()}>{(r) => <StepRow row={r} debug={debug()} />}</For>
          </ol>
          <Show when={total()?.calls}>
            <p class="pipeline-total">
              <span>
                Strip total, all languages · {total()!.paid} paid LLM call{total()!.paid === 1 ? "" : "s"}
              </span>
              <b>{creditLabel(total()!.credits)}</b>
              <Show when={debug()}>
                <em>{usd(total()!.costUsd)} provider cost</em>
              </Show>
            </p>
          </Show>
        </div>
      </div>
      <Show when={p.error}>
        <p class="fatal">{p.error}</p>
      </Show>
    </div>
  );
}
