import { OPENROUTER } from "./openrouter";

export type ModelInfo = { id: string; name: string };

let list: Promise<ModelInfo[]> | null = null;

// visionModels lists OpenRouter models that take images: every AI step sends the strip.
export function visionModels(): Promise<ModelInfo[]> {
  list ??= fetch(`${OPENROUTER}/models`)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .then((d: { data: { id: string; name: string; architecture?: { input_modalities?: string[] } }[] }) =>
      d.data
        .filter((m) => m.architecture?.input_modalities?.includes("image") && !m.id.endsWith(":batch"))
        .map((m) => ({ id: m.id, name: m.name }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    )
    .catch(() => {
      list = null;
      return [];
    });
  return list;
}
