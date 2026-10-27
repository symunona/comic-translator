import { decode, toBlob } from "./cv/image";
import { cleanStrip } from "./cv/regions";
import { getImage, loadStrip } from "./local";
import type { Region, StripRecord } from "./types";

export type StripView = { rec: StripRecord; regions: Region[]; imageUrl: string; cleanUrl: string };

// loadView reads a translated strip from this browser and erases its bubbles again.
export async function loadView(id: string): Promise<StripView> {
  const rec = loadStrip(id);
  const blob = await getImage(id);
  if (!rec || !blob) throw new Error("This strip is not in this browser.");
  const orig = await decode(blob);
  const { clean, regions } = cleanStrip(orig, rec.regions);
  return { rec, regions, imageUrl: URL.createObjectURL(blob), cleanUrl: URL.createObjectURL(await toBlob(clean)) };
}
