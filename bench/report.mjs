import { readdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const dir = join(HERE, "results");
const file = process.argv[2] ?? join(dir, (await readdir(dir)).filter((f) => /^ocr-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().at(-1));
const data = JSON.parse(await readFile(file, "utf8"));
const SAMPLES = (process.env.SAMPLES ?? "r1,r2,r12,r15,r17,r20,r34,r46").split(",");

const f = (x, d = 0) => (x == null ? "–" : x.toFixed(d));
console.log(`results: ${file}\n`);
console.log("| model | threads | MB | load ms | ms/crop median | ms/crop mean | CER | CER no punct | WER | exact | accent acc | speech CER | mem Δ MB |");
console.log("|---|---|---|---|---|---|---|---|---|---|---|---|---|");
for (const s of data.summary) {
  if (s.fatal) {
    console.log(`| ${s.model} | ${s.threads} | ${f(s.sizeMB, 1)} | FAIL: ${s.fatal.slice(0, 80)} |||||||||`);
    continue;
  }
  console.log(`| ${s.model} | ${s.threads} | ${f(s.sizeMB, 1)} | ${f(s.loadMs)} | ${f(s.msPerCropMedian)} | ${f(s.msPerCropMean)} | ${f(s.cer, 3)} | ${f(s.cerNoPunct, 3)} | ${f(s.wer, 3)} | ${s.exact}/${s.crops} | ${f(s.accentAcc, 2)} (${s.accentTotal}) | ${f(s.speechOnly?.cer, 3)} | ${f(s.pssDeltaMB)} |`);
}
const runs = data.runs.filter((r) => r.summary.threads === 1);
console.log("\n## samples\n");
for (const id of SAMPLES) {
  const gt = runs[0]?.preds.find((p) => p.id === id)?.gt;
  if (gt == null) continue;
  console.log(`### ${id}  (bench/results/crops/${id}.png)\n- GT: ${JSON.stringify(gt)}`);
  for (const r of runs) {
    const p = r.preds.find((x) => x.id === id);
    console.log(`- ${r.summary.model}: ${JSON.stringify(p?.text ?? p?.error ?? null)}`);
  }
  console.log();
}
