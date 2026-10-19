import { createWorker } from "tesseract.js";
import { run } from "./harness.js";

let worker;

run({
  name: "tesseract-hun",
  async load() {
    worker = await createWorker("hun", 1, {
      workerPath: "/tess/worker.min.js",
      corePath: "/tess-core/",
      langPath: "/models/tesseract",
      gzip: true,
      cacheMethod: "none",
    });
    return { lang: "hun", oem: "LSTM" };
  },
  async recognize(canvas) {
    const { data } = await worker.recognize(canvas);
    return { text: data.text.trim(), confidence: data.confidence / 100 };
  },
});
