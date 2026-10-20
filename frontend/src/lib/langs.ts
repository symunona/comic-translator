import { LANGS } from "./types";

export const langName = (code: string) => LANGS.find((l) => l.code === code)?.name ?? code.toUpperCase();

export const translatedLangs = (stages: Record<string, string> | undefined) =>
  Object.entries(stages ?? {})
    .filter(([k, v]) => k.startsWith("review:") && v === "done")
    .map(([k]) => k.slice("review:".length));
