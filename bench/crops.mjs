import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PNG } from "pngjs";

const PAD = 4;

export async function findStrip(dataDir, prefix = "2afc78b4") {
  const id = (await readdir(dataDir)).find((d) => d.startsWith(prefix));
  if (!id) throw new Error(`no strip ${prefix}* in ${dataDir}`);
  return join(dataDir, id);
}

export async function extractCrops(stripDir, outDir, tag = "") {
  const read = async (f) => JSON.parse(await readFile(join(stripDir, "stages", f), "utf8"));
  const ocr = await read("ocr@v1.json").catch(() => []);
  const gtById = Object.fromEntries(ocr.map((r) => [r.id, r]));
  const regions = tag ? (await read("order@v1.json")).map((r) => ({ ...r, ...(gtById[r.id] ?? {}) })) : ocr;
  const img = PNG.sync.read(await readFile(join(stripDir, "orig.png")));
  await mkdir(join(outDir, tag), { recursive: true });
  const crops = [];
  for (const r of regions) {
    const text = r.source?.text?.trim() ?? "";
    if (!text && !tag) continue;
    const [bx, by, bw, bh] = r.textBox;
    const x = Math.max(0, bx - PAD), y = Math.max(0, by - PAD);
    const w = Math.min(img.width, bx + bw + PAD) - x, h = Math.min(img.height, by + bh + PAD) - y;
    const out = new PNG({ width: w, height: h });
    PNG.bitblt(img, out, x, y, w, h, 0, 0);
    const file = tag ? `${tag}/${r.id}.png` : `${r.id}.png`;
    await writeFile(join(outDir, file), PNG.sync.write(out));
    crops.push({ id: tag ? `${tag}/${r.id}` : r.id, strip: tag || undefined, panelId: r.panelId, kind: r.kind, box: [x, y, w, h], file, gt: text, gtLines: r.source?.lines ?? [text] });
  }
  if (!tag) await writeFile(join(outDir, "crops.json"), JSON.stringify(crops, null, 1));
  return crops;
}
