import type { Api } from "./api";
import { FONT_FAMILY } from "./layout";
import type { Box, DataEvent, Kind, LLMCall, Panel, Region, Scene, StageEvent, StageUsage, Strip, StripSummary, Translation } from "./types";

type Line = { hu: string; en: string; kind: Kind; speaker: string };

const SCRIPT: Line[] = [
  { hu: "NÉZD, MEGJÖTT A KRISTÁLYHOLOGRAM!", en: "LOOK, THE CRYSTAL HOLOGRAM IS HERE!", kind: "speech", speaker: "Feri" },
  { hu: "ELJÖTTÉ? ÉS MIT TUD?", en: "IT CAME? AND WHAT DOES IT DO?", kind: "speech", speaker: "Pisti" },
  { hu: "Eközben a szomszédban...", en: "Meanwhile, next door...", kind: "caption", speaker: "" },
  { hu: "HÁROMSZÁZ FORINTÉRT ŐSZINTÉN SEMMIT.", en: "FOR THREE HUNDRED FORINTS, HONESTLY NOTHING.", kind: "speech", speaker: "Feri" },
  { hu: "DE LEGALÁBB SZÉP FÉNYE VAN, NEM?", en: "BUT AT LEAST IT GLOWS NICELY, RIGHT?", kind: "speech", speaker: "Pisti" },
  { hu: "BOLT", en: "SHOP", kind: "sign", speaker: "" },
  { hu: "hmm... vajon működik?", en: "hmm... does it even work?", kind: "thought", speaker: "Pisti" },
  { hu: "TÜNDÉRI. MOST MÁR CSAK A FŰTÉS KÉNE.", en: "LOVELY. NOW WE JUST NEED SOME HEATING.", kind: "speech", speaker: "Feri" },
  { hu: "A KRISTÁLY MAJD MEGOLDJA!", en: "THE CRYSTAL WILL SORT IT OUT!", kind: "speech", speaker: "Pisti" },
  { hu: "Három nappal később.", en: "Three days later.", kind: "caption", speaker: "" },
  { hu: "NEM OLDOTTA MEG.", en: "IT DID NOT SORT IT OUT.", kind: "speech", speaker: "Feri" },
  { hu: "DE GYÖNYÖRŰEN NEM OLDOTTA MEG!", en: "BUT IT FAILED BEAUTIFULLY!", kind: "speech", speaker: "Pisti" },
];

const W = 620;
const H = 5738;
const DEFAULT_ID = "mock-demo";

type Assets = { imageUrl: string; width: number; height: number; panels: Panel[]; regions: Region[] };

const uploads = new Map<string, { file: File; name: string; createdAt: string }>();
const assets = new Map<string, Promise<Assets>>();
const edits = new Map<string, Translation>();
const outputs = new Map<string, string>();
const completed = new Set<string>([`${DEFAULT_ID}:en`]);

const blobUrl = (c: HTMLCanvasElement) =>
  new Promise<string>((res) => c.toBlob((b) => res(URL.createObjectURL(b!)), "image/png"));

function panelBoxes(width: number, height: number): Box[] {
  const n = Math.max(1, Math.round(height / (width * 1.1)));
  const gap = 22;
  const h = (height - gap * (n + 1)) / n;
  return Array.from({ length: n }, (_, i) => [20, Math.round(gap + i * (h + gap)), width - 40, Math.round(h)] as Box);
}

function layoutRegions(panels: Box[]): Region[] {
  const regions: Region[] = [];
  let k = 0;
  panels.forEach((p, pi) => {
    const [px, py, pw, ph] = p;
    const slots: Box[] =
      pi % 3 === 1
        ? [[px + pw * 0.05, py + ph * 0.03, pw * 0.55, ph * 0.09], [px + pw * 0.08, py + ph * 0.15, pw * 0.42, ph * 0.2], [px + pw * 0.52, py + ph * 0.26, pw * 0.43, ph * 0.2]]
        : [[px + pw * 0.06, py + ph * 0.05, pw * 0.48, ph * 0.22], [px + pw * 0.48, py + ph * 0.22, pw * 0.46, ph * 0.2]];
    slots.forEach((s) => {
      const line = SCRIPT[k % SCRIPT.length];
      const isCaption = line.kind === "caption";
      const isSign = line.kind === "sign";
      const bubble = s.map(Math.round) as Box;
      const box = isSign ? ([px + pw * 0.62, py + ph * 0.62, pw * 0.26, ph * 0.09].map(Math.round) as Box) : bubble;
      const [bx, by, bw, bh] = box;
      const shrinkX = isCaption || isSign ? 0.06 : 0.17;
      const shrinkY = isCaption || isSign ? 0.12 : 0.2;
      const textBox = [bx + bw * shrinkX, by + bh * shrinkY, bw * (1 - 2 * shrinkX), bh * (1 - 2 * shrinkY)].map(Math.round) as Box;
      regions.push({
        id: `r${k}`,
        panelId: `p${pi}`,
        order: k,
        detClass: isSign ? "text_free" : "text_bubble",
        score: 0.8 + ((k * 7) % 19) / 100,
        textBox,
        bubbleBox: isSign ? undefined : box,
        kind: line.kind,
        replace: !(isSign || line.kind === "sfx" || line.kind === "none"),
        speaker: line.speaker || undefined,
        source: {
          text: line.hu,
          lines: [line.hu],
          align: isCaption ? "left" : "center",
          caps: line.hu === line.hu.toUpperCase(),
        },
      });
      k++;
    });
  });
  return regions;
}

function drawBubble(c: CanvasRenderingContext2D, r: Region) {
  const [x, y, w, h] = r.bubbleBox ?? r.textBox;
  c.save();
  c.lineWidth = 3;
  c.strokeStyle = "#111";
  c.fillStyle = "#fff";
  if (r.kind === "caption" || r.kind === "sign") {
    c.fillStyle = r.kind === "sign" ? "#ddd" : "#fff";
    c.fillRect(x, y, w, h);
    c.strokeRect(x, y, w, h);
  } else {
    c.beginPath();
    c.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    if (r.kind === "thought") c.setLineDash([6, 5]);
    c.fill();
    c.stroke();
    c.setLineDash([]);
    c.beginPath();
    c.moveTo(x + w * 0.4, y + h * 0.95);
    c.lineTo(x + w * 0.35, y + h * 1.25);
    c.lineTo(x + w * 0.52, y + h * 0.97);
    c.fill();
    c.stroke();
  }
  c.restore();
}

function drawText(c: CanvasRenderingContext2D, r: Region) {
  const [x, y, w, h] = r.textBox;
  const words = r.source!.text.split(" ");
  let size = 30;
  let lines: string[] = [];
  for (; size > 10; size--) {
    c.font = `${size}px ${FONT_FAMILY}`;
    lines = [];
    let cur = "";
    for (const wd of words) {
      const next = cur ? `${cur} ${wd}` : wd;
      if (cur && c.measureText(next).width > w) {
        lines.push(cur);
        cur = wd;
      } else cur = next;
    }
    lines.push(cur);
    if (lines.length * size * 1.1 <= h && lines.every((l) => c.measureText(l).width <= w)) break;
  }
  c.fillStyle = "#111";
  c.textAlign = "center";
  c.textBaseline = "middle";
  const top = y + (h - lines.length * size * 1.1) / 2;
  lines.forEach((l, i) => c.fillText(l, x + w / 2, top + (i + 0.5) * size * 1.1));
}

function drawArt(c: CanvasRenderingContext2D, p: Box, i: number) {
  const [x, y, w, h] = p;
  c.save();
  c.strokeStyle = "#222";
  c.lineWidth = 2.5;
  c.beginPath();
  c.moveTo(x, y + h * 0.82);
  c.lineTo(x + w, y + h * 0.8);
  c.stroke();
  for (const fx of [0.3, 0.7]) {
    const cx = x + w * fx + ((i * 13) % 20) - 10;
    const top = y + h * 0.48;
    c.beginPath();
    c.arc(cx, top, 26, 0, Math.PI * 2);
    c.moveTo(cx, top + 26);
    c.lineTo(cx, top + 110);
    c.moveTo(cx - 40, top + 60);
    c.lineTo(cx + 40, top + 52);
    c.moveTo(cx, top + 110);
    c.lineTo(cx - 28, y + h * 0.81);
    c.moveTo(cx, top + 110);
    c.lineTo(cx + 28, y + h * 0.81);
    c.stroke();
  }
  c.restore();
}

async function generate(file?: File): Promise<Assets> {
  await document.fonts.load(`24px ${FONT_FAMILY}`, "ŐŰ");
  let width = W;
  let height = H;
  let base: CanvasImageSource | null = null;
  if (file) {
    const bmp = await createImageBitmap(file);
    width = bmp.width;
    height = bmp.height;
    base = bmp;
  }
  const boxes = panelBoxes(width, height);
  const panels: Panel[] = boxes.map((bbox, i) => ({ id: `p${i}`, order: i, bbox }));
  const regions = layoutRegions(boxes);
  const canvas = Object.assign(document.createElement("canvas"), { width, height });
  const c = canvas.getContext("2d")!;
  const clean = Object.assign(document.createElement("canvas"), { width, height });
  const cc = clean.getContext("2d")!;
  if (base) {
    c.drawImage(base, 0, 0);
    cc.drawImage(base, 0, 0);
    cc.fillStyle = "#fff";
    for (const r of regions) cc.fillRect(...r.textBox);
  } else {
    for (const ctx of [c, cc]) {
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, width, height);
      boxes.forEach((p, i) => {
        ctx.lineWidth = 4;
        ctx.strokeStyle = "#111";
        ctx.strokeRect(...p);
        drawArt(ctx, p, i);
      });
      regions.forEach((r) => drawBubble(ctx, r));
    }
    regions.forEach((r) => drawText(c, r));
    regions.filter((r) => !r.replace).forEach((r) => drawText(cc, r));
  }
  for (const r of regions) {
    const ob = (r.bubbleBox ?? r.textBox).map((v, i) => (i < 2 ? v + 4 : v - 8)) as Box;
    const [x, y, w, h] = [r.textBox[0] - 6, r.textBox[1] - 6, r.textBox[2] + 12, r.textBox[3] + 12];
    const a: Box = [Math.max(x, ob[0]), Math.max(y, ob[1]), 0, 0];
    a[2] = Math.min(x + w, ob[0] + ob[2]) - a[0];
    a[3] = Math.min(y + h, ob[1] + ob[3]) - a[1];
    const crop = Object.assign(document.createElement("canvas"), { width: a[2], height: a[3] });
    crop.getContext("2d")!.drawImage(clean, a[0], a[1], a[2], a[3], 0, 0, a[2], a[3]);
    r.overlayBox = a;
    r.overlayUrl = await blobUrl(crop);
  }
  return { imageUrl: await blobUrl(canvas), width, height, panels, regions };
}

const getAssets = (id: string) => {
  if (!assets.has(id)) assets.set(id, generate(uploads.get(id)?.file));
  return assets.get(id)!;
};

const nameOf = (id: string) => uploads.get(id)?.name ?? "kristalyhologram-mock.png";

function translationFor(id: string, lang: string, regions: Region[], final: boolean): Translation {
  const key = `${id}:${lang}`;
  if (final && edits.has(key)) return structuredClone(edits.get(key)!);
  const out: Translation["regions"] = {};
  regions.forEach((r, i) => {
    const line = SCRIPT[i % SCRIPT.length];
    const base = lang === "hu" ? line.hu : line.en;
    const text = lang === "en" || lang === "hu" ? base : `[${lang}] ${base}`;
    const src = r.source?.text ?? "";
    out[r.id] = {
      text: final ? text : text.toLowerCase(),
      literal: line.en,
      notes: i === 1 ? "\"ELJÖTTÉ\" is dialectal; keep it colloquial." : undefined,
      maxChars: Math.ceil(src.length * 1.2),
      maxLines: Math.max(r.source?.lines.length ?? 1, 1) + 1,
    };
  });
  return { lang, final, edited: false, updatedAt: new Date().toISOString(), regions: out };
}

const scene: Scene = {
  summary: "Two flatmates unbox a cheap 'crystal hologram' that promises everything and does nothing, beautifully.",
  characters: [
    { name: "Feri", description: "Deadpan, wears a beanie" },
    { name: "Pisti", description: "Optimist, believes in crystals" },
  ],
  panels: [],
  speakers: {},
  notes: ["\"ELJÖTTÉ\" is a deliberate dialect spelling.", "The 'BOLT' sign is background only."],
};

const strip = (id: string, a: Assets): Strip => {
  const langs = [...completed].filter((k) => k.startsWith(`${id}:`)).map((k) => k.slice(id.length + 1));
  return {
    meta: { id, origName: nameOf(id), createdAt: new Date().toISOString(), width: a.width, height: a.height, mime: "image/png", imageUrl: a.imageUrl },
    panels: langs.length ? a.panels : [],
    regions: langs.length ? structuredClone(a.regions) : [],
    stages: Object.fromEntries(langs.map((l) => [`review:${l}`, "done"])),
    imageUrl: a.imageUrl,
  };
};

function stream(id: string, lang: string, h: Parameters<Api["stream"]>[2]) {
  const timers: number[] = [];
  let t = 0;
  const speed = Number(new URLSearchParams(location.search).get("speed") ?? 1) || 1;
  const stripCached = [...completed].some((k) => k.startsWith(`${id}:`));
  const trCached = completed.has(`${id}:${lang}`);
  const at = (ms: number, fn: () => void, cached: boolean) => {
    t += cached ? 0 : ms / speed;
    timers.push(window.setTimeout(fn, t));
  };
  const stage = (e: StageEvent) => h.stage(e);
  const data = (e: DataEvent) => h.data(e);
  getAssets(id).then((a) => {
    const c = stripCached;
    const st = (_stage: string, cached: boolean): StageEvent["status"] => (cached ? "cached" : "done");
    const regionsBare = a.regions.map(({ source, overlayBox, overlayUrl, kind, speaker, ...r }) => r as Region);
    at(150, () => stage({ stage: "ingest", status: c ? "cached" : "running" }), c);
    at(300, () => {
      data({ kind: "meta", payload: { ...strip(id, a).meta } });
      stage({ stage: "ingest", status: st("ingest", c) });
      stage({ stage: "panels", status: "running" });
    }, c);
    at(700, () => {
      data({ kind: "panels", payload: a.panels });
      stage({ stage: "panels", status: st("panels", c), message: `${a.panels.length} panels` });
    }, c);
    a.panels.forEach((_, i) =>
      at(260, () => stage({ stage: "detect", status: "running", progress: { done: i + 1, total: a.panels.length } }), c),
    );
    at(200, () => {
      data({ kind: "regions", payload: regionsBare });
      stage({ stage: "detect", status: st("detect", c), message: `${a.regions.length} regions` });
      stage({ stage: "order", status: st("order", c) });
      stage({ stage: "ocr", status: "running", progress: { done: 0, total: a.regions.length } });
    }, c);
    a.regions.forEach((r, i) =>
      at(330, () => {
        data({ kind: "region", payload: { ...regionsBare[i], source: r.source, kind: r.kind, replace: r.replace } });
        stage({ stage: "ocr", status: "running", progress: { done: i + 1, total: a.regions.length } });
      }, c),
    );
    at(200, () => {
      stage({ stage: "ocr", status: st("ocr", c) });
      stage({ stage: "scene", status: "running", message: "reading the whole strip" });
    }, c);
    at(1400, () => {
      const speakers = Object.fromEntries(a.regions.filter((r) => r.speaker).map((r) => [r.id, r.speaker!]));
      data({ kind: "scene", payload: { ...scene, speakers } });
      a.regions.forEach((r) => r.speaker && data({ kind: "region", payload: { ...regionsBare[r.order], source: r.source, kind: r.kind, speaker: r.speaker, replace: r.replace } }));
      stage({ stage: "scene", status: st("scene", c) });
      stage({ stage: "clean", status: "running" });
    }, c);
    at(900, () => {
      data({ kind: "overlays", payload: a.regions.filter((r) => r.replace).map((r) => ({ ...regionsBare[r.order], overlayBox: r.overlayBox, overlayUrl: r.overlayUrl })) });
      stage({ stage: "clean", status: st("clean", c) });
      stage({ stage: `translate:${lang}`, status: trCached ? "cached" : "running" });
    }, c);
    at(1600, () => {
      data({ kind: "translation", payload: translationFor(id, lang, a.regions, false) });
      stage({ stage: `translate:${lang}`, status: trCached ? "cached" : "done" });
      stage({ stage: `review:${lang}`, status: trCached ? "cached" : "running", message: "checking the jokes land" });
    }, trCached);
    at(1500, () => {
      data({ kind: "translation", payload: translationFor(id, lang, a.regions, true) });
      stage({ stage: `review:${lang}`, status: trCached ? "cached" : "done" });
    }, trCached);
    at(100, () => {
      completed.add(`${id}:${lang}`);
      h.done();
    }, trCached);
  });
  return () => timers.forEach(clearTimeout);
}

export const mockApi: Api = {
  config: async () => ({ clientDetect: false, debug: true, detector: "detector.onnx", llm: { ocr: "claude-cli:opus", scene: "claude-cli:opus", translate: "claude-cli:opus", review: "claude-cli:opus" } }),
  panels: async (id) => ({ panels: (await getAssets(id)).panels, detected: true }),
  putDetect: async (id) => (await getAssets(id)).regions,
  async listStrips(limit) {
    const items: StripSummary[] = [...uploads.entries()].reverse().map(([id, u]) => ({
      id, origName: u.name, createdAt: u.createdAt, width: 0, height: 0, thumbUrl: "", langs: [],
    }));
    const demo = await getAssets(DEFAULT_ID);
    items.push({ id: DEFAULT_ID, origName: nameOf(DEFAULT_ID), createdAt: "2026-10-19T08:00:00Z", width: W, height: H, thumbUrl: demo.imageUrl, langs: [...completed].filter((k) => k.startsWith(`${DEFAULT_ID}:`)).map((k) => k.slice(DEFAULT_ID.length + 1)) });
    for (const it of items) if (!it.thumbUrl) it.thumbUrl = (await getAssets(it.id)).imageUrl;
    return items.slice(0, limit);
  },
  async upload(file) {
    const id = `mock-${Date.now().toString(36)}`;
    uploads.set(id, { file, name: file.name, createdAt: new Date().toISOString() });
    return { id, existing: false };
  },
  getStrip: async (id) => strip(id, await getAssets(id)),
  async getTranslation(id, lang) {
    const a = await getAssets(id);
    return completed.has(`${id}:${lang}`) ? translationFor(id, lang, a.regions, true) : null;
  },
  async putTranslation(id, lang, t) {
    const saved = { ...structuredClone(t), edited: true, updatedAt: new Date().toISOString() };
    edits.set(`${id}:${lang}`, saved);
    await new Promise((r) => setTimeout(r, 250));
    return saved;
  },
  async retranslate(id, lang, body) {
    await new Promise((r) => setTimeout(r, 1200));
    const a = await getAssets(id);
    const t = translationFor(id, lang, a.regions, true);
    for (const rid of body.regionIds ?? []) if (t.regions[rid]) t.regions[rid].text = `${t.regions[rid].text.replace(/[.!?]+$/, "")}, yeah?`;
    return t;
  },
  async render(id, lang, png) {
    const prev = outputs.get(`${id}:${lang}`);
    if (prev) URL.revokeObjectURL(prev);
    const url = URL.createObjectURL(png);
    outputs.set(`${id}:${lang}`, url);
    return { url };
  },
  async patchRegion(id, rid, body) {
    const a = await getAssets(id);
    const r = a.regions.find((x) => x.id === rid)!;
    if (body.replace !== undefined) r.replace = body.replace;
    return structuredClone(r);
  },
  async usage() {
    const call = (stage: string, label: string, costUsd: number, out: number): LLMCall => ({
      name: `${stage}-${label}`, stage, label, backend: "claude-cli", model: "opus", attempt: 0, local: false,
      tokens: { input_tokens: 4, cache_creation_input_tokens: 4000, cache_read_input_tokens: 4800, output_tokens: out },
      turns: 2, costUsd, credits: Math.ceil((costUsd * 2) / 0.01), durationMs: 12000, time: "2026-10-19T08:00:00Z",
    });
    const calls = [
      ...Array.from({ length: 10 }, (_, i) => call("ocr", `p${i}`, 0.049, 770)),
      call("scene", "scene", 0.25, 12000),
      call("translate:en", "translate", 0.3, 9000),
      call("review:en", "review", 0.39, 10200),
    ];
    const sum = (stage: string, cs: LLMCall[]): StageUsage => ({
      stage, calls: cs.length, errors: 0, untracked: 0, turns: cs.length * 2, models: ["claude-cli:opus"],
      costUsd: cs.reduce((n, c) => n + c.costUsd, 0), durationMs: cs.length * 12000,
      paid: cs.filter((c) => c.credits > 0).length, credits: cs.reduce((n, c) => n + c.credits, 0),
      tokens: {
        input_tokens: cs.length * 4, cache_creation_input_tokens: cs.length * 4000, cache_read_input_tokens: cs.length * 4800,
        output_tokens: cs.reduce((n, c) => n + (c.tokens?.output_tokens ?? 0), 0),
      },
    });
    const stages = [...new Set(calls.map((c) => c.stage))].map((st) => sum(st, calls.filter((c) => c.stage === st)));
    return { stages, total: sum("total", calls), calls };
  },
  stream,
  imageUrl: (id, name) => (name === "orig.png" ? "" : `/mock/${id}/${name}`),
};
