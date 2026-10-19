import { DETECTOR_URL, type ClientDetect, type DetectMessage, type DetectTiming } from "./protocol";
import type { Panel } from "../types";

export type { ClientDetect } from "./protocol";

export type DetectRun = { result: ClientDetect; timing: DetectTiming };

export async function detectInBrowser(imageUrl: string, panels: Panel[], onProgress: (done: number, total: number, device: string) => void): Promise<DetectRun> {
  const image = await fetch(imageUrl).then((r) => {
    if (!r.ok) throw new Error(`image ${r.status}`);
    return r.blob();
  });
  const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  try {
    return await new Promise<DetectRun>((resolve, reject) => {
      worker.onerror = (e) => reject(new Error(e.message || "detector worker failed"));
      worker.onmessage = (e: MessageEvent<DetectMessage>) => {
        const m = e.data;
        if (m.type === "progress") onProgress(m.done, m.total, m.device);
        else if (m.type === "result") resolve({ result: m.result, timing: m.timing });
        else reject(new Error(m.message));
      };
      worker.postMessage({ image, panels: panels.map((p) => ({ id: p.id, bbox: p.bbox })), modelUrl: DETECTOR_URL });
    });
  } finally {
    worker.terminate();
  }
}
