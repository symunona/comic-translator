import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PNG } from "pngjs";

const PAD = 4;

export async function findStrip(dataDir, prefix = "2afc78b4") {
  const id = (await readdir(dataDir)).find((d) => d.startsWith(prefix));
  if (!id) throw new Error(`no strip ${prefix}* in ${dataDir}`);
  return join(dataDir, id);
}

export async function extractCrops(stripDir, outDir) {
  const regions = JSON.parse(await readFile(join(stripDir, "stages", "ocr@v1.json"), "utf8"));
  const img = PNG.sync.read(await readFile(join(stripDir, "orig.png")));
  await mkdir(outDir, { recursive: true });
  const crops = [];
  for (const r of regions) {
    const text = r.source?.text?.trim();
    if (!text) continue;
    const [bx, by, bw, bh] = r.textBox;
    const x = Math.max(0, bx - PAD), y = Math.max(0, by - PAD);
    const w = Math.min(img.width, bx + bw + PAD) - x, h = Math.min(img.height, by + bh + PAD) - y;
    const out = new PNG({ width: w, height: h });
    PNG.bitblt(img, out, x, y, w, h, 0, 0);
    const file = `${r.id}.png`;
    await writeFile(join(outDir, file), PNG.sync.write(out));
    crops.push({ id: r.id, panelId: r.panelId, kind: r.kind, box: [x, y, w, h], file, gt: text, gtLines: r.source.lines ?? [text] });
  }
  await writeFile(join(outDir, "crops.json"), JSON.stringify(crops, null, 1));
  return crops;
}
