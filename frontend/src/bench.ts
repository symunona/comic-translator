import { api } from "./lib/api";
import { detectInBrowser, type DetectOptions, type DetectRun } from "./lib/detect";
import type { DetectEP } from "./lib/detect/protocol";

type Result = { mode: string; run: number; device?: string; totalMs?: number; timing?: DetectRun["timing"]; panels?: DetectRun["result"]["panels"]; error?: string };

const out = document.getElementById("out")!;
const q = new URLSearchParams(location.search);

async function gpuInfo() {
  const gpu = (navigator as unknown as { gpu?: { requestAdapter(o?: object): Promise<{ info?: object; isFallbackAdapter?: boolean } | null> } }).gpu;
  if (!gpu) return { webgpu: false };
  const a = await gpu.requestAdapter({ powerPreference: "high-performance" }).catch(() => null);
  return { webgpu: true, adapter: a ? { ...JSON.parse(JSON.stringify(a.info ?? {}, ["vendor", "architecture", "device", "description"])), fallback: !!a.isFallbackAdapter } : null };
}

function parseMode(m: string): DetectOptions {
  const [ep, threads] = m.split(":");
  return { ep: ep as DetectEP, threads: threads ? Number(threads) : undefined };
}

async function main() {
  const id = q.get("id") ?? "";
  const modes = (q.get("modes") ?? "wasm:1,wasm:4,webgpu").split(",");
  const runs = Number(q.get("runs") ?? 2);
  const env = { ua: navigator.userAgent, cores: navigator.hardwareConcurrency, isolated: crossOriginIsolated, ...(await gpuInfo()) };
  const { panels } = await api.panels(id);
  const results: Result[] = [];
  const show = () => (out.textContent = JSON.stringify({ env, results: results.map(({ panels: _, ...r }) => r) }, null, 1));
  for (const mode of modes) {
    for (let run = 0; run < runs; run++) {
      const t = performance.now();
      try {
        const r = await detectInBrowser(api.imageUrl(id, "orig.png"), panels, () => {}, parseMode(mode));
        results.push({ mode, run, device: r.result.device, totalMs: Math.round(performance.now() - t), timing: r.timing, panels: r.result.panels });
      } catch (e) {
        results.push({ mode, run, error: String((e as Error)?.message ?? e) });
      }
      show();
    }
  }
  (window as unknown as { __bench: unknown }).__bench = { env, results };
  show();
  document.title = "bench done";
}

main().catch((e) => (out.textContent = `error: ${e?.message ?? e}`));
