import type { ClientDetect } from "./detect";
import type { Config, Panel, Region, Strip, StripSummary, StreamHandlers, Translation, UsageReport } from "./types";

export type Api = {
  config(): Promise<Config>;
  panels(id: string): Promise<{ panels: Panel[]; detected: boolean }>;
  putDetect(id: string, body: ClientDetect): Promise<Region[]>;
  listStrips(limit: number): Promise<StripSummary[]>;
  upload(file: File): Promise<{ id: string; existing: boolean }>;
  getStrip(id: string): Promise<Strip>;
  getTranslation(id: string, lang: string): Promise<Translation | null>;
  putTranslation(id: string, lang: string, t: Translation): Promise<Translation>;
  retranslate(id: string, lang: string, body: { regionIds?: string[]; hint?: string }): Promise<Translation>;
  render(id: string, lang: string, png: Blob): Promise<{ url: string }>;
  patchRegion(id: string, rid: string, body: { replace?: boolean; source?: { text: string; lines: string[] } }): Promise<Region>;
  usage(id: string): Promise<UsageReport>;
  stream(id: string, lang: string, h: StreamHandlers): () => void;
  imageUrl(id: string, name: string): string;
};

let configP: Promise<Config> | undefined;

const base = (id: string) => `/api/strips/${encodeURIComponent(id)}`;

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200) || res.statusText}`);
  return res.json() as Promise<T>;
}

const send = (method: string, body: unknown) => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

export const httpApi: Api = {
  config: () => (configP ??= fetch("/api/config").then((r) => json<Config>(r)).catch((e) => {
    configP = undefined;
    throw e;
  })),
  panels: (id) => fetch(`${base(id)}/panels`).then((r) => json<{ panels: Panel[]; detected: boolean }>(r)),
  putDetect: (id, body) => fetch(`${base(id)}/stages/detect`, send("PUT", body)).then((r) => json<Region[]>(r)),
  listStrips: (limit) => fetch(`/api/strips?limit=${limit}`).then((r) => json<StripSummary[]>(r)),
  upload(file) {
    const fd = new FormData();
    fd.append("file", file);
    return fetch("/api/strips", { method: "POST", body: fd }).then((r) => json(r));
  },
  getStrip: (id) => fetch(base(id)).then((r) => json<Strip>(r)),
  async getTranslation(id, lang) {
    const r = await fetch(`${base(id)}/translations/${lang}`);
    return r.status === 404 ? null : json<Translation>(r);
  },
  putTranslation: (id, lang, t) => fetch(`${base(id)}/translations/${lang}`, send("PUT", t)).then((r) => json<Translation>(r)),
  retranslate: (id, lang, body) => fetch(`${base(id)}/retranslate/${lang}`, send("POST", body)).then((r) => json<Translation>(r)),
  render: (id, lang, png) =>
    fetch(`${base(id)}/render/${lang}`, { method: "POST", headers: { "content-type": "image/png" }, body: png }).then((r) =>
      json<{ url: string }>(r),
    ),
  patchRegion: (id, rid, body) => fetch(`${base(id)}/regions/${rid}`, send("PATCH", body)).then((r) => json<Region>(r)),
  usage: (id) => fetch(`${base(id)}/usage`).then((r) => json<UsageReport>(r)),
  stream(id, lang, h) {
    const es = new EventSource(`${base(id)}/events?lang=${encodeURIComponent(lang)}`);
    const parse = (e: MessageEvent) => JSON.parse(e.data);
    es.addEventListener("stage", (e) => h.stage(parse(e as MessageEvent)));
    es.addEventListener("data", (e) => h.data(parse(e as MessageEvent)));
    es.addEventListener("done", () => {
      es.close();
      h.done();
    });
    es.addEventListener("fatal", (e) => {
      es.close();
      h.fatal(parse(e as MessageEvent).message ?? "pipeline failed");
    });
    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) h.fatal("lost connection to the backend");
    };
    return () => es.close();
  },
  imageUrl: (id, name) => `${base(id)}/image/${name}`,
};

function mockEnabled(): boolean {
  if (!import.meta.env.DEV) return false;
  const q = new URLSearchParams(location.search).get("mock");
  try {
    if (q === "0") sessionStorage.removeItem("mock");
    if (q === "1") sessionStorage.setItem("mock", "1");
    return sessionStorage.getItem("mock") === "1";
  } catch {
    return q === "1";
  }
}

export const isMock = mockEnabled();

let impl: Api = httpApi;
export const ready: Promise<void> = import.meta.env.DEV && isMock ? import("./mock").then((m) => void (impl = m.mockApi)) : Promise.resolve();

export const api: Api = new Proxy({} as Api, {
  get: (_, key: keyof Api) => impl[key],
});
