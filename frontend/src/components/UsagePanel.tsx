import { For, Show, createResource } from "solid-js";
import { api } from "../lib/api";
import type { StageUsage } from "../lib/types";

const usd = (n: number) => `$${n.toFixed(n < 1 ? 3 : 2)}`;

const kTok = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

const tokens = (s: StageUsage, n: number) => (s.untracked === s.calls ? "–" : kTok(n) + (s.untracked ? "*" : ""));

const inTokens = (s: StageUsage) =>
  s.tokens.input_tokens + s.tokens.cache_creation_input_tokens + s.tokens.cache_read_input_tokens;

export default function UsagePanel(p: { id: string; refresh: unknown }) {
  const [report] = createResource(
    () => ({ id: p.id, key: p.refresh }),
    ({ id }) => api.usage(id),
  );
  return (
    <Show when={report.latest?.total.calls}>
      <details class="usage">
        <summary>
          LLM cost <b>{usd(report.latest!.total.costUsd)}</b>
          <span>
            {report.latest!.total.calls} calls · {report.latest!.total.models.join(", ")}
          </span>
        </summary>
        <table>
          <thead>
            <tr>
              <th>stage</th>
              <th>calls</th>
              <th title="input + cache write + cache read">in</th>
              <th title="cache write">write</th>
              <th title="output incl. thinking">out</th>
              <th>cost</th>
            </tr>
          </thead>
          <tbody>
            <For each={[...report.latest!.stages, report.latest!.total]}>
              {(s) => (
                <tr classList={{ total: s.stage === "total" }}>
                  <td>{s.stage}</td>
                  <td>{s.calls}</td>
                  <td>{tokens(s, inTokens(s))}</td>
                  <td>{tokens(s, s.tokens.cache_creation_input_tokens)}</td>
                  <td>{tokens(s, s.tokens.output_tokens)}</td>
                  <td>{usd(s.costUsd)}</td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
        <Show when={report.latest!.total.untracked}>
          <p class="usage-note">* {report.latest!.total.untracked} calls logged before token capture: cost only.</p>
        </Show>
        <p class="usage-note">List price (claude-cli: subscription equivalent). All calls incl. reruns.</p>
      </details>
    </Show>
  );
}
