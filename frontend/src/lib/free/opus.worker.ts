import { env, pipeline, type TranslationPipeline } from "@huggingface/transformers";

export type OpusRequest = { repo: string; texts: string[] };
export type OpusMessage =
  | { type: "loading"; loaded: number; total: number }
  | { type: "progress"; done: number; total: number }
  | { type: "result"; texts: string[] }
  | { type: "error"; message: string };

type Scope = { postMessage(m: OpusMessage): void; onmessage: ((e: MessageEvent<OpusRequest>) => void) | null };
const scope = self as unknown as Scope;

env.allowLocalModels = false;
env.useBrowserCache = true;
env.backends.onnx.wasm!.numThreads = 1;

const pipes = new Map<string, Promise<TranslationPipeline>>();

function load(repo: string) {
  let p = pipes.get(repo);
  if (!p) {
    const files = new Map<string, [number, number]>();
    p = pipeline("translation", repo, {
      device: "wasm",
      dtype: "q8",
      progress_callback: (e: { status: string; file?: string; loaded?: number; total?: number }) => {
        if (e.status !== "progress" || !e.file) return;
        files.set(e.file, [e.loaded ?? 0, e.total ?? 0]);
        let loaded = 0;
        let total = 0;
        for (const [l, t] of files.values()) {
          loaded += l;
          total += t;
        }
        scope.postMessage({ type: "loading", loaded, total });
      },
    }) as Promise<TranslationPipeline>;
    p.catch(() => pipes.delete(repo));
    pipes.set(repo, p);
  }
  return p;
}

scope.onmessage = async (e) => {
  try {
    const pipe = await load(e.data.repo);
    const out: string[] = [];
    for (const [i, t] of e.data.texts.entries()) {
      const r = (await pipe(t, { max_new_tokens: 256 })) as { translation_text: string }[];
      out.push(r[0]?.translation_text ?? "");
      scope.postMessage({ type: "progress", done: i + 1, total: e.data.texts.length });
    }
    scope.postMessage({ type: "result", texts: out });
  } catch (err) {
    scope.postMessage({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
