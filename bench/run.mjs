import { createReadStream } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, join, normalize as normPath } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright-core";
import { extractCrops, findStrip } from "./crops.mjs";
import { download, MODELS_DIR } from "./download.mjs";
import { score, summarize } from "./metrics.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.OCR_BENCH_PORT ?? 4750);
const CHROMIUM = process.env.CHROMIUM ?? "/data/cache/playwright/chromium-1234/chrome-linux64/chrome";
const MULTI = Number(process.env.OCR_BENCH_THREADS ?? 4);
const LIMIT = Number(process.env.OCR_BENCH_LIMIT ?? 0);
const TIMEOUT = 30 * 60 * 1000;
const VERBOSE = !!process.env.OCR_BENCH_VERBOSE;

const RUNS = [
  { engine: "paddle", label: "paddle-v5-latin", files: ["paddle"] },
  { engine: "transformers", model: "trocr-handwritten", label: "trocr-small-handwritten", files: ["trocr-handwritten"] },
  { engine: "transformers", model: "trocr-printed", label: "trocr-small-printed", files: ["trocr-printed"], singleOnly: true },
  { engine: "transformers", model: "florence", label: "florence-2-base-ft", files: ["florence"] },
  { engine: "tesseract", label: "tesseract-hun", files: ["tesseract"], singleOnly: true },
];

const only = process.argv.slice(2);
const runs = only.length ? RUNS.filter((r) => only.includes(r.label) || only.includes(r.engine)) : RUNS;

function pkgDist(...parts) {
  return join(HERE, "node_modules", ...parts);
}

async function ortTfDist() {
  const pnpm = join(HERE, "node_modules", ".pnpm");
  const tfPkg = JSON.parse(await readFile(pkgDist("@huggingface", "transformers", "package.json"), "utf8"));
  const v = tfPkg.dependencies["onnxruntime-web"];
  const dir = (await readdir(pnpm)).find((d) => d === `onnxruntime-web@${v}`);
  return join(pnpm, dir, "node_modules", "onnxruntime-web", "dist");
}

async function tessCoreDir() {
  const pnpm = join(HERE, "node_modules", ".pnpm");
  const dir = (await readdir(pnpm)).find((d) => d.startsWith("tesseract.js-core@"));
  return join(pnpm, dir, "node_modules", "tesseract.js-core");
}

const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm", ".json": "application/json", ".png": "image/png", ".txt": "text/plain" };

function serve(routes) {
  return createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const prefix = Object.keys(routes).filter((p) => path.startsWith(p)).sort((a, b) => b.length - a.length)[0];
    let file = prefix === "/" && path === "/" ? join(routes["/"], "index.html") : prefix && normPath(join(routes[prefix], path.slice(prefix.length)));
    if (!file || !file.startsWith(routes[prefix])) file = null;
    const headers = {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Cache-Control": "no-store",
    };
    try {
      const st = file && (await stat(file));
      if (!st?.isFile()) throw new Error("404");
      res.writeHead(200, { ...headers, "Content-Type": MIME[extname(file)] ?? "application/octet-stream", "Content-Length": st.size });
      createReadStream(file).pipe(res);
    } catch {
      res.writeHead(404, headers);
      res.end("not found");
    }
  });
}

async function pss(rootPid) {
  const procs = [];
  for (const d of await readdir("/proc")) {
    if (!/^\d+$/.test(d)) continue;
    try {
      const st = await readFile(`/proc/${d}/stat`, "utf8");
      procs.push({ pid: Number(d), ppid: Number(st.slice(st.lastIndexOf(")") + 2).split(" ")[1]) });
    } catch {}
  }
  const tree = new Set([rootPid]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const p of procs) if (!tree.has(p.pid) && tree.has(p.ppid)) { tree.add(p.pid); grew = true; }
  }
  tree.delete(rootPid);
  let kb = 0;
  for (const pid of tree) {
    try {
      const m = (await readFile(`/proc/${pid}/smaps_rollup`, "utf8")).match(/^Pss:\s+(\d+)/m);
      if (m) kb += Number(m[1]);
    } catch {}
  }
  return kb / 1024;
}

async function runOne(browserType, run, threads) {
  const browser = await browserType.launch({
    executablePath: CHROMIUM,
    headless: true,
    args: ["--no-sandbox", "--disable-gpu", "--disable-features=WebGPU,Vulkan", "--enable-features=SharedArrayBuffer"],
  });
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log(`  pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning" || VERBOSE) console.log(`  console.${m.type()}: ${m.text().slice(0, 300)}`);
  });
  page.on("response", (r) => { if (r.status() >= 400 && !r.url().endsWith("/favicon.ico")) console.log(`  http ${r.status()} ${r.url()}`); });
  const baseline = await pss(process.pid);
  let peak = baseline;
  const timer = setInterval(async () => { peak = Math.max(peak, await pss(process.pid)); }, 250);
  const qs = new URLSearchParams({ engine: run.engine, threads: String(threads), ...(run.model ? { model: run.model } : {}), ...(LIMIT ? { limit: String(LIMIT) } : {}) });
  const t0 = Date.now();
  await page.goto(`http://127.0.0.1:${PORT}/?${qs}`);
  await page.waitForFunction(() => window.__result, null, { timeout: TIMEOUT, polling: 1000 });
  const result = await page.evaluate(() => window.__result);
  clearInterval(timer);
  peak = Math.max(peak, await pss(process.pid));
  await browser.close();
  return { ...result, wallMs: Date.now() - t0, pssBaselineMB: baseline, pssPeakMB: peak };
}

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : null;
}

const strip = await findStrip(join(HERE, "..", "data"));
const cropsDir = join(HERE, "results", "crops");
const crops = await extractCrops(strip, cropsDir);
const sizes = await download([...new Set(runs.flatMap((r) => r.files))]);

await build({
  entryPoints: { paddle: "src/paddle.js", transformers: "src/transformers.js", tesseract: "src/tesseract.js" },
  absWorkingDir: HERE,
  outdir: join(HERE, ".dist"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  logLevel: "warning",
  external: ["onnxruntime-node", "sharp", "fs", "path", "url", "node:*"],
  define: { "process.env.NODE_ENV": '"production"' },
});

const server = serve({
  "/": join(HERE, "page"),
  "/dist/": join(HERE, ".dist"),
  "/crops/": cropsDir,
  "/models/": MODELS_DIR,
  "/ort/": pkgDist("onnxruntime-web", "dist"),
  "/ort-tf/": await ortTfDist(),
  "/tess/": pkgDist("tesseract.js", "dist"),
  "/tess-core/": await tessCoreDir(),
});
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));
console.log(`serving http://127.0.0.1:${PORT}  models=${MODELS_DIR}`);

const gt = Object.fromEntries(crops.map((c) => [c.id, c]));
const results = [];
for (const run of runs) {
  for (const threads of run.singleOnly ? [1] : [1, MULTI]) {
    console.log(`== ${run.label} threads=${threads}`);
    let r;
    try {
      r = await runOne(chromium, run, threads);
    } catch (e) {
      r = { fatal: String(e?.message ?? e), preds: [] };
    }
    const scored = r.preds.map((p) => ({ ...p, gt: gt[p.id].gt, kind: gt[p.id].kind, score: score(gt[p.id].gt, p.text ?? "") }));
    const ms = scored.map((p) => p.ms);
    const summary = {
      model: run.label,
      threads,
      sizeMB: sizes[run.files[0]] / 1e6,
      loadMs: r.loadMs ?? null,
      msPerCropMean: ms.length ? ms.reduce((a, b) => a + b, 0) / ms.length : null,
      msPerCropMedian: median(ms),
      msPerCropWarmMean: ms.length > 1 ? ms.slice(1).reduce((a, b) => a + b, 0) / (ms.length - 1) : null,
      crops: scored.length,
      errors: scored.filter((p) => p.error).length,
      ...(scored.length ? summarize(scored.map((p) => p.score)) : {}),
      speechOnly: scored.some((p) => p.kind === "speech") ? summarize(scored.filter((p) => p.kind === "speech").map((p) => p.score)) : null,
      pssPeakMB: r.pssPeakMB ?? null,
      pssDeltaMB: r.pssPeakMB != null ? r.pssPeakMB - r.pssBaselineMB : null,
      uaMemAfterLoadMB: r.memAfterLoad != null ? r.memAfterLoad / 1e6 : null,
      uaMemEndMB: r.memEnd != null ? r.memEnd / 1e6 : null,
      crossOriginIsolated: r.crossOriginIsolated ?? null,
      webgpu: r.webgpu ?? null,
      info: r.info ?? null,
      fatal: r.fatal ?? null,
    };
    console.log(JSON.stringify(summary));
    results.push({ summary, preds: scored });
  }
}
server.close();

const date = new Date().toISOString().slice(0, 10);
const partial = only.length || LIMIT ? `-partial-${[...only, LIMIT ? `n${LIMIT}` : ""].filter(Boolean).join("-")}` : "";
const outFile = join(HERE, "results", `ocr-${date}${partial}.json`);
await mkdir(dirname(outFile), { recursive: true });
await writeFile(outFile, JSON.stringify({
  date: new Date().toISOString(),
  strip: strip.split("/").at(-1),
  groundTruth: "stages/ocr@v1.json source.text (Claude Opus via claude CLI)",
  chromium: CHROMIUM,
  execution: "onnxruntime-web WASM EP only, WebGPU disabled; threads=1 vs threads=" + MULTI + " (COOP/COEP served)",
  crops: crops.length,
  summary: results.map((r) => r.summary),
  runs: results,
}, null, 1));
console.log(`wrote ${outFile}`);
console.table(results.map(({ summary: s }) => ({
  model: s.model, thr: s.threads, MB: s.sizeMB.toFixed(1), loadMs: s.loadMs?.toFixed(0), msCrop: s.msPerCropMedian?.toFixed(0),
  CER: s.cer?.toFixed(3), WER: s.wer?.toFixed(3), acc: s.accentAcc?.toFixed(2), memMB: s.pssDeltaMB?.toFixed(0), fatal: s.fatal?.slice(0, 40),
})));
