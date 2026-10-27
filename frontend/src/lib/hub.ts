import { settings } from "./settings";
import type { SharedListing, SharedTranslation } from "./types";

export type HubConfig = { turnstileSiteKey: string };

export type Demo = { name: string; title: string; image: string; hash: string; width: number; height: number; translations: Record<string, string> };

export class HubError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = (await res.text()).trim();
    throw new HubError(text.slice(0, 200) || res.statusText, res.status);
  }
  return res.json() as Promise<T>;
}

const authed = (init: RequestInit = {}): RequestInit => ({
  ...init,
  headers: { ...(init.headers ?? {}), "X-Session": settings.validSession() },
});

let configP: Promise<HubConfig> | null = null;
export const hubConfig = () => (configP ??= fetch("/api/config").then((r) => json<HubConfig>(r)).catch(() => ({ turnstileSiteKey: "" })));

export async function startSession(turnstileToken: string) {
  const s = await fetch("/api/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: turnstileToken }),
  }).then((r) => json<{ token: string; exp: number }>(r));
  settings.setSession(s);
  return s;
}

let demosP: Promise<Demo[]> | null = null;
export const demos = () => (demosP ??= fetch("/demos/index.json").then((r) => json<Demo[]>(r)).catch(() => []));

export type Listing = SharedListing & { demo?: string };

// listings returns every shared translation of the image: bundled demos first,
// then the hub when the user shares and has a session.
export async function listings(hash: string): Promise<Listing[]> {
  const out: Listing[] = [];
  const demo = (await demos()).find((d) => d.hash === hash);
  if (demo) for (const [lang, file] of Object.entries(demo.translations)) out.push({ id: file, lang, srcLang: "", nick: "napirajz demo", createdAt: "", demo: file });
  if (settings.share() && settings.validSession()) {
    try {
      const res = await fetch(`/api/comics/${hash}`, authed()).then((r) => json<{ translations: SharedListing[] }>(r));
      out.push(...res.translations);
    } catch (e) {
      if (e instanceof HubError && e.status === 401) settings.setSession(null);
      else console.warn("hub lookup failed", e);
    }
  }
  return out;
}

export async function fetchShared(l: Listing): Promise<SharedTranslation> {
  if (l.demo) return fetch(`/demos/${l.demo}`).then((r) => json<SharedTranslation>(r));
  return fetch(`/api/translations/${l.id}`, authed()).then((r) => json<SharedTranslation>(r));
}

export async function contribute(file: SharedTranslation): Promise<number> {
  const nick = settings.nick().trim();
  const res = await fetch(
    `/api/comics/${file.hash}/translations`,
    authed({
      method: "POST",
      headers: { "content-type": "application/json", ...(nick ? { "X-Nick": nick, "X-Nick-Secret": settings.secret() } : {}) },
      body: JSON.stringify(nick ? { ...file, nick } : { ...file, nick: undefined }),
    }),
  ).then((r) => json<{ id: number }>(r));
  return res.id;
}

export type NickInfo = { nick: string; translations: { id: number; hash: string; lang: string; createdAt: string }[] };

export const nickInfo = (nick: string) => fetch(`/api/nicks/${encodeURIComponent(nick)}`).then((r) => json<NickInfo>(r));

export async function fetchImage(url: string): Promise<Blob> {
  try {
    const direct = await fetch(url, { mode: "cors" });
    if (direct.ok && (direct.headers.get("content-type") ?? "").startsWith("image/")) return await direct.blob();
  } catch {}
  const res = await fetch(`/api/fetch?url=${encodeURIComponent(url)}`);
  if (!res.ok) throw new HubError((await res.text()).trim() || `could not fetch the image (${res.status})`, res.status);
  return res.blob();
}
