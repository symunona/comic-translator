import { loadStrip, putImage, saveStrip, sha256 } from "./local";

const TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif"];
const MAX_BYTES = 30 * 1024 * 1024;

// ingest stores the image under its content hash; the same bytes always land on the same strip.
export async function ingest(blob: Blob, name: string): Promise<string> {
  if (blob.type && !TYPES.includes(blob.type)) throw new Error("That is not a PNG, JPG, WebP, GIF or AVIF image.");
  if (blob.size > MAX_BYTES) throw new Error("That image is over 30 MB.");
  const id = await sha256(await blob.arrayBuffer());
  if (loadStrip(id)) return id;
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(blob);
  } catch {
    throw new Error("Could not decode that image.");
  }
  const { width, height } = bmp;
  bmp.close();
  await putImage(id, blob);
  saveStrip({
    id,
    name: name || "comic",
    createdAt: new Date().toISOString(),
    width,
    height,
    panels: [],
    regions: [],
    detected: false,
    ocr: false,
    drafts: {},
    translations: {},
    calls: [],
    shared: {},
  });
  return id;
}

export function nameFromUrl(url: string): string {
  try {
    const last = decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).pop() ?? "");
    return last || "comic";
  } catch {
    return "comic";
  }
}
