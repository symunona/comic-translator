import type { StripRecord } from "./types";

const P = "ct.";

export function lsGet<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(P + key);
    return raw == null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function lsSet(key: string, value: unknown) {
  try {
    if (value === undefined) localStorage.removeItem(P + key);
    else localStorage.setItem(P + key, JSON.stringify(value));
  } catch (e) {
    console.warn("localStorage write failed", key, e);
    throw new Error("Browser storage is full. Delete a few strips from the home page.");
  }
}

export type StripSummary = { id: string; name: string; createdAt: string; width: number; height: number; langs: string[] };

export const listStrips = () => lsGet<StripSummary[]>("strips", []);

export const loadStrip = (id: string) => lsGet<StripRecord | null>(`strip.${id}`, null);

export function saveStrip(rec: StripRecord) {
  lsSet(`strip.${rec.id}`, rec);
  const list = listStrips().filter((s) => s.id !== rec.id);
  const old = listStrips().find((s) => s.id === rec.id);
  list.unshift({ id: rec.id, name: rec.name, createdAt: old?.createdAt ?? rec.createdAt, width: rec.width, height: rec.height, langs: Object.keys(rec.translations) });
  list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  lsSet("strips", list);
}

export async function deleteStrip(id: string) {
  lsSet(`strip.${id}`, undefined);
  lsSet(
    "strips",
    listStrips().filter((s) => s.id !== id),
  );
  const db = await openDB();
  await tx(db, "readwrite", (s) => s.delete(id));
}

let dbP: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  dbP ??= new Promise((resolve, reject) => {
    const req = indexedDB.open("comic-translator", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("images");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbP;
}

function tx<T>(db: IDBDatabase, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction("images", mode).objectStore("images"));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function putImage(id: string, blob: Blob) {
  await tx(await openDB(), "readwrite", (s) => s.put(blob, id));
}

export async function getImage(id: string): Promise<Blob | null> {
  return (await tx<Blob | undefined>(await openDB(), "readonly", (s) => s.get(id))) ?? null;
}

export async function sha256(buf: ArrayBuffer): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", buf));
  return [...d].map((b) => b.toString(16).padStart(2, "0")).join("");
}
