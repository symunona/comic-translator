import type { LLMCall, UsageReport } from "./types";

// The billing rule lives on the server (backend/internal/llm/credits.go):
// credits = ceil(costUsd x 2 / $0.01) per paid call. The UI only sums them.

// Fallback when this strip has no translated language yet. docs/llm.md: one
// extra language (translate + review, lean CLI opus) ~= $0.70 for 53 regions
// -> 140 credits -> ~2.6 per region.
const CREDITS_PER_REGION_GUESS = 2.6;

export const creditLabel = (n: number) => `${n} credit${n === 1 ? "" : "s"}`;

export const isPaid = (c: LLMCall) => c.credits > 0;

export function langCredits(report: UsageReport | undefined, regionCount: number): number {
  const perLang = new Map<string, number>();
  for (const s of report?.stages ?? []) {
    const [base, lang] = s.stage.split(":");
    if (lang && (base === "translate" || base === "review")) perLang.set(lang, (perLang.get(lang) ?? 0) + s.credits);
  }
  const measured = [...perLang.values()].filter((n) => n > 0);
  if (measured.length) return Math.ceil(measured.reduce((a, b) => a + b, 0) / measured.length);
  return Math.max(1, Math.ceil(regionCount * CREDITS_PER_REGION_GUESS));
}
