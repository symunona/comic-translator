import { AutoProcessor, Qwen3_5ForConditionalGeneration, RawImage, env, type PreTrainedModel, type Processor, type Tensor } from "@huggingface/transformers";
import type { VlmMessage, VlmRequest } from "./vlm";

type Scope = { postMessage(m: VlmMessage): void; onmessage: ((e: MessageEvent<VlmRequest>) => void) | null };
const scope = self as unknown as Scope;

env.allowLocalModels = false;
env.useBrowserCache = true;

type Loaded = { model: PreTrainedModel; processor: Processor; device: string };
let loaded: Promise<Loaded> | null = null;

function load(repo: string): Promise<Loaded> {
  loaded ??= (async () => {
    const adapter = await (navigator as Navigator & { gpu?: { requestAdapter(): Promise<{ features: Set<string>; info?: { description?: string; vendor?: string } } | null> } }).gpu?.requestAdapter();
    if (!adapter) throw new Error("no WebGPU adapter");
    const f16 = adapter.features.has("shader-f16");
    const files = new Map<string, [number, number]>();
    const progress_callback = (e: { status: string; file?: string; loaded?: number; total?: number }) => {
      if (e.status !== "progress" || !e.file) return;
      files.set(e.file, [e.loaded ?? 0, e.total ?? 0]);
      let l = 0;
      let t = 0;
      for (const [a, b] of files.values()) {
        l += a;
        t += b;
      }
      scope.postMessage({ type: "loading", loaded: l, total: t });
    };
    const q = f16 ? "q4f16" : "q4";
    const model = await Qwen3_5ForConditionalGeneration.from_pretrained(repo, {
      device: "webgpu",
      dtype: { embed_tokens: q, vision_encoder: q, decoder_model_merged: q },
      progress_callback,
    });
    const processor = await AutoProcessor.from_pretrained(repo, { progress_callback });
    return { model, processor, device: `webgpu ${q} · ${adapter.info?.description || adapter.info?.vendor || "gpu"}` };
  })();
  const p = loaded;
  p.catch(() => (loaded = null));
  return p;
}

async function generate(l: Loaded, prompt: string, image: ImageBitmap | undefined, maxTokens: number): Promise<string> {
  const content = image ? [{ type: "image" }, { type: "text", text: prompt }] : [{ type: "text", text: prompt }];
  const text = l.processor.apply_chat_template([{ role: "user", content }], { add_generation_prompt: true }) as string;
  let raw: RawImage | undefined;
  if (image) {
    const c = new OffscreenCanvas(image.width, image.height);
    c.getContext("2d")!.drawImage(image, 0, 0);
    image.close();
    raw = RawImage.fromCanvas(c);
  }
  const inputs = await l.processor(text, raw);
  const out = (await l.model.generate({ ...inputs, max_new_tokens: maxTokens, do_sample: false, repetition_penalty: 1.05 })) as Tensor;
  const [decoded] = l.processor.batch_decode(out.slice(null, [inputs.input_ids.dims.at(-1), null]), { skip_special_tokens: true }) as string[];
  return decoded.trim();
}

scope.onmessage = async (e) => {
  try {
    const l = await load(e.data.repo);
    scope.postMessage({ type: "ready", device: l.device });
    const out: Record<string, string> = {};
    const t0 = performance.now();
    for (const [i, job] of e.data.jobs.entries()) {
      out[job.id] = await generate(l, job.prompt, job.image, job.maxTokens);
      scope.postMessage({ type: "progress", done: i + 1, total: e.data.jobs.length });
    }
    scope.postMessage({ type: "result", texts: out, ms: performance.now() - t0 });
  } catch (err) {
    scope.postMessage({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
