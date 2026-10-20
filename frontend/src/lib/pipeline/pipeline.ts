/*
 * comic-translator pipeline, browser edition: the whole run on one page.
 *
 * Read top to bottom: every stage has a box (what goes in, what comes out,
 * where it runs, which model), and the LLM stages carry their prompt right
 * below the box. Prompts here are the source of truth; the Go templates in
 * backend/internal/pipeline/prompts/ are archived on branch
 * go-pipeline-archive and must render byte-identical until that pipeline is
 * retired (parity check: docs/byok-plan.md, phase 2).
 *
 *   orig.png
 *      │
 *      ▼
 *  ┌────────┐   ┌────────┐   ┌────────┐   ┌───────┐   ┌───────┐   ┌───────┐
 *  │ ingest │──►│ panels │──►│ detect │──►│ order │──►│  ocr  │──►│ scene │
 *  └────────┘   └────────┘   └────────┘   └───────┘   └───────┘   └───────┘
 *     CV           CV          ONNX          CV          LLM          LLM
 *                                                         │            │
 *            ┌────────────────────────────────────────────┘            │
 *            ▼                                                         ▼
 *        ┌───────┐          ┌──────────────────┐   ┌───────────────┐
 *        │ clean │          │ translate:<lang> │──►│ review:<lang> │
 *        └───────┘          └──────────────────┘   └───────────────┘
 *           CV                     LLM                    LLM
 *            │                                             │
 *            └───────────────────┬─────────────────────────┘
 *                                ▼
 *                     ┌──────────────────────┐    ┌──────────────┐
 *                     │ editor (layout.ts)   │──► │ export PNG   │
 *                     │ fit text into fitBox │    │ (render.ts)  │
 *                     └──────────────────────┘    └──────────────┘
 *
 *  Everything runs in the browser. CV + ONNX stages cost nothing; the four LLM
 *  stages go straight from the page to the user's provider (BYOK, OpenRouter).
 *
 *  Cost per strip, picks from docs/cost-opt.md (2026-10-20, 8-strip bench):
 *
 *    stage              model                                  $/strip
 *    ─────────────────  ─────────────────────────────────────  ───────
 *    ocr                Paddle v5 draft + gemini-3.1-flash-lite  0.007
 *    scene              gemini-3.8-flash                         0.017
 *    translate+review   gemini-3.8-flash                         0.055
 *    ─────────────────  ─────────────────────────────────────  ───────
 *    first language                                             ~0.08
 *    each extra lang    translate+review only                   ~0.055
 *
 *    vs Sonnet ~0.23, Opus ~1.45. Gemini 3.8 Flash list price doubles
 *    2027-01-01: re-check then.
 *
 *  Every stage result is cached as stages/<name>@v<STAGE_VERSIONS[name]>.json
 *  under the strip's sha256. Bump a version to force a rerun of that stage.
 */

import type { Panel, Region, RegionTranslation, Scene, Source } from "../types";

export const STAGE_VERSIONS = {
  panels: 1,
  detect: 2,
  order: 1,
  ocr: 1,
  scene: 1,
  clean: 5,
  translate: 1,
  review: 1,
} as const;

/*
 * ┌──────────────────────────────── ingest ────────────────────────────────┐
 * │ in : uploaded bytes (png / jpg / webp)                                 │
 * │ out: meta {id = sha256(bytes), origName, width, height, mime, srcLang} │
 * │      orig.png (normalized RGB)                                         │
 * │ runs: browser, createImageBitmap + canvas                              │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * ┌──────────────────────────────── panels ────────────────────────────────┐
 * │ in : orig.png                                                          │
 * │ out: Panel[] {id "p0".., order, bbox}                                  │
 * │ how: XY-cut on ink projection. ink = luma < 128, row blank if <= 3 ink │
 * │      px, gap >= 12 px splits, panel >= 60 px, trim to ink bbox + 4 px  │
 * │ runs: browser worker (port of imgproc/panels.go)                       │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * ┌──────────────────────────────── detect ────────────────────────────────┐
 * │ in : each panel crop, resized 640x640, RGB/255 CHW                     │
 * │ out: Region[] {detClass bubble|text_bubble|text_free, score, textBox,  │
 * │      bubbleBox}                                                        │
 * │ how: detector-v4-s_int8.onnx (11.1 MB, Apache-2.0), score >= 0.35,     │
 * │      class NMS IoU 0.5, text paired with smallest bubble around it,    │
 * │      empty bubble -> textBox = bubble shrunk 12%                       │
 * │ runs: browser worker, onnxruntime-web WASM (detect/worker.ts)          │
 * │ perf: ~0.3-0.8 s / panel WASM x4 threads                               │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * ┌──────────────────────────────── order ─────────────────────────────────┐
 * │ in : Region[] per panel                                                │
 * │ out: Region[] with global ids r0..rN in reading order                  │
 * │ how: sort by top y, rows = y overlap > 50%, left -> right in a row     │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * Before the LLM stages the worker draws one debug image per panel: the
 * panel crop with a red outline and a red number tag per region (number =
 * region order). Every LLM stage below sees these, in reading order.
 */

export type LangInfo = { src: string; srcName: string; napirajz: boolean };

const LANG_NAMES: Record<string, string> = {
  en: "English", de: "German", fr: "French", es: "Spanish",
  it: "Italian", pl: "Polish", hu: "Hungarian", nl: "Dutch",
  pt: "Portuguese", cs: "Czech", sk: "Slovak", ro: "Romanian",
};

export const langName = (code: string) => LANG_NAMES[code] ?? code;

export function langInfo(src: string | undefined): LangInfo {
  const s = src || "hu";
  return { src: s, srcName: langName(s), napirajz: s === "hu" };
}

const goQuote = (s: string) => JSON.stringify(s);

const goJSON = (v: unknown) =>
  JSON.stringify(v, null, 2).replace(/[<>&\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);

export const quoteLines = (lines: string[]) => lines.map(goQuote).join(" / ");

export function budget(s: Source): { maxChars: number; maxLines: number } {
  return { maxChars: Math.ceil([...s.text].length * 1.2), maxLines: Math.max(s.lines.length, 1) + 1 };
}

export const withSchema = (prompt: string, schema: string) =>
  `${prompt}\n\nReturn ONLY one JSON object matching this shape, no prose and no code fences:\n${schema}`;

/*
 * ┌────────────────────────────────── ocr ─────────────────────────────────┐
 * │ in : N panel debug images (red numbered boxes)                         │
 * │      + 1 clean close-up per region (no red marks, enlarged)            │
 * │      + optional draft per region from PaddleOCR v5 latin (browser)     │
 * │ out: per region {kind, lines[], align, caps} -> Region.source          │
 * │      + unboxed[]: lettering the detector missed                        │
 * │ calls: 1 per strip                                                     │
 * │ replace default: speech / thought / caption = true, sfx / sign = false │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 *   104 boxes, 8 strips, GT = Opus audited by eye   (bench/results/ocr-v2-*)
 *
 *   model                         method                      CER    accents  $/strip
 *   ────────────────────────────  ──────────────────────────  ─────  ───────  ───────
 *   Opus                          whole strip                 0.002   98%     0.146
 *   Sonnet                        per panel (old prod)        0.008   97%     0.096
 *   gemini-3.1-flash-lite  ◄ pick Paddle draft + crops, 1 call 0.009  98%     0.007
 *   gemini-3.8-flash (effort low) whole strip                 0.009   99%     0.022
 *   Haiku                         whole strip                 0.010   98%     0.006
 *   PaddleOCR v5 latin alone      browser WASM, per crop      0.165   33%     0
 *   Tesseract.js hun              browser, per crop           0.447   70%     0
 *
 *   Paddle alone loses accents (ő -> ö). Paddle as a draft + one cheap LLM
 *   call with close-ups = Sonnet quality at 1/14 the price. Weak models skip
 *   boxes in long lists without the draft (lite: 0.070 -> 0.009 with it).
 */

export const OCR_SCHEMA = `{"regions":[{"n":<box number>,"kind":"speech|thought|caption|sfx|sign|none","lines":["LINE 1","LINE 2"],"align":"left|center|right","caps":true}],"unboxed":["text seen outside every box"]}`;

const CLASS_HINTS: Record<Region["detClass"], string> = {
  text_bubble: "text inside a bubble",
  text_free: "text outside bubbles",
  bubble: "a bubble where no text was detected; it may be empty or hold small text",
};

export type OCRBox = { n: number; panel: number; image: number; detClass: Region["detClass"]; draft?: string };

function ocrRules(l: LangInfo): string {
  return `Transcribe every box. These rules matter more than anything else:

1. COPY, NEVER CORRECT. Write the letters exactly as drawn. Keep dialect, slang, colloquial contractions, dropped letters, odd spellings and typos.${l.napirajz ? ` Hungarian casual speech often drops a final consonant: "ELJÖTTÉ" stays "ELJÖTTÉ" (do NOT write "ELJÖTTÉL"); "DEJÓ" stays one word if it is lettered as one word.` : ""} If you notice you are "fixing" a word towards standard ${l.srcName}, undo it. The translators need the exact form because the deviation is often the joke or the voice of the character.
${l.src === "hu" ? `2. ACCENTS. Hungarian has Á É Í Ó Ö Ő Ú Ü Ű. Check each vowel in the close-up: two dots (Ö Ü), double acute strokes (Ő Ű), one acute stroke (Á É Í Ó Ú), or nothing. Hand-drawn accents are small and slanted; do not drop them and do not add ones that are not there.` : `2. ACCENTS AND SPECIAL LETTERS. Copy every diacritic and special character exactly as drawn; do not drop them and do not add ones that are not there.`}
3. PUNCTUATION exactly as drawn: commas (often a small tick at the baseline), periods, "...", "!", "?", "„" and "”" quotes, hyphens, dashes.
4. LINE BREAKS exactly as lettered: one entry in "lines" per lettered line, top to bottom. Do not re-flow.
5. CASE: copy the case as lettered. If a box is lettered in capitals, transcribe it in capitals and set "caps": true. If it is mixed or lower case, write it so and set "caps": false.
6. SCOPE: transcribe the text that sits inside that box. If a box clips a bubble's text, include the whole lines that belong to that bubble and are mostly inside the box. Never copy text from a neighbouring box.
7. NO TEXT: if a box holds no readable lettering (art, an empty bubble, a window, a wheel, hatching, a stray mark), use kind "none" and empty lines.
8. SIGNS: brand names, plates, name boards and labels drawn on objects are kind "sign". Spell them letter by letter as drawn even if they look misspelled or scrambled: scrambled signs are usually intentional jokes.

kind values:
- "speech": spoken words in a bubble or a lettered block attached to a speaker by a tail line
- "thought": thought bubble (cloud outline or trail of small circles)
- "caption": narration or a text box not spoken by anyone in the scene
- "sfx": sound effects, onomatopoeia, or shouts drawn as large stylised or outlined lettering that is part of the art
- "sign": text that exists physically in the scene (signs, plates, labels, screens, logos)
- "none": no readable text

align: "center" when the lines are centred on each other, "left" when they share a left edge, "right" when they share a right edge.

Also list in "unboxed" any lettering you can see in the panel image that is NOT inside any red box (for example a tiny bubble the detector missed), transcribed with the same rules. Use [] if there is none.

Reply with JSON only.`;
}

export function ocrBoxes(panels: Panel[], regions: Region[], drafts?: Record<string, string>): { boxes: OCRBox[]; nPanels: number } {
  const boxes: OCRBox[] = [];
  let nPanels = 0;
  for (const p of panels) {
    const inPanel = regions.filter((r) => r.panelId === p.id);
    if (!inPanel.length) continue;
    nPanels++;
    for (const r of inPanel) boxes.push({ n: r.order, panel: nPanels, image: 0, detClass: r.detClass, draft: drafts?.[r.id] });
  }
  boxes.forEach((b, i) => (b.image = nPanels + i + 1));
  return { boxes, nPanels };
}

export function ocrPrompt(l: LangInfo, boxes: OCRBox[], nPanels: number, opts: { crops: boolean; draft: boolean }): string {
  const style = l.napirajz
    ? " The style is Napirajz: black ink, hand-lettered ALL CAPS text, white speech bubbles with long wavy tails, signs and plates drawn into the art."
    : "";
  const crops = opts.crops
    ? "The other images are clean close-ups of each box (no red marks), enlarged. Use them to read letters and accents; use the panel images for layout and context."
    : "";
  const draft = opts.draft
    ? `\n\nA fast OCR engine already read every box; its reading is listed with each box as "draft". Treat it as a rough draft only. It is often right on plain words, but it drops or confuses accents, glues or splits words at line ends, misses punctuation and adds junk from bubble outlines, tails and the art. ${opts.crops ? "The close-up image always decides." : "The panel image always decides."}`
    : "";
  const lines = boxes
    .map((b) => {
      const hint = CLASS_HINTS[b.detClass];
      return `- box ${b.n}: in panel image ${b.panel}${opts.crops ? `, close-up is image ${b.image}` : ""}; detector class ${b.detClass}${hint ? ` (${hint})` : ""}${opts.draft ? `; draft: ${goQuote(b.draft ?? "")}` : ""}\n`;
    })
    .join("");
  return `You are transcribing the lettering of a ${l.srcName} comic for a translation team.${style}

Images 1-${nPanels} are the panels in reading order. Every detected text area has a red outline and a red tag with its box number. The red marks are ours, not part of the comic.
${crops}${draft}

Boxes:
${lines}
${ocrRules(l)}
`;
}

export type OCRReply = {
  regions?: { n: number; kind?: string; lines?: string[]; align?: string; caps?: boolean | null }[];
  unboxed?: string[];
};

const KINDS = new Set(["speech", "thought", "caption", "sfx", "sign", "none"]);

export const defaultReplace = (kind: string) => kind === "speech" || kind === "thought" || kind === "caption";

export function applyOCR(reply: OCRReply, reg: Region): Region {
  const out: Region = { ...reg, kind: "none", source: undefined };
  const box = reply.regions?.find((b) => b.n === reg.order);
  if (box) {
    const lines = (box.lines ?? []).map((s) => s.trim()).filter(Boolean);
    if (box.kind && KINDS.has(box.kind)) out.kind = box.kind as Region["kind"];
    if (!lines.length) out.kind = "none";
    else
      out.source = {
        text: lines.join(" "),
        lines,
        align: box.align === "left" || box.align === "right" ? box.align : "center",
        caps: box.caps == null || box.caps,
      };
  }
  out.replace = defaultReplace(out.kind!);
  return out;
}

/*
 * Transcript: the OCR result as text, fed to every later stage.
 *
 *   Panel p0:
 *     r0 [speech, detector text_bubble]: "MI EZ?" / "KRISTÁLY?"      ◄ scene
 *     r1 [none, detector bubble]: (no text)
 *     (lettering outside any box, not editable: "HÍREK")
 *
 *   Panel p0:
 *     r0 [speech, speaker: bald man, maxChars 18, maxLines 3]: "MI EZ?" / ...
 *                                                         ◄ translate, review
 *
 * withBudget = translate/review form: only ids in `ids`, with speaker from the
 * scene and the fit budget (maxChars = ceil(len * 1.2), maxLines = lines + 1).
 */

export function transcript(
  panels: Panel[],
  regions: Region[],
  opts: { ids?: Set<string>; withBudget: boolean; scene?: Scene; unboxed?: Record<string, string[]> },
): string {
  let b = "";
  for (const p of panels) {
    b += `Panel ${p.id}:\n`;
    for (const r of regions) {
      if (r.panelId !== p.id || (opts.ids && !opts.ids.has(r.id))) continue;
      if (!r.source) {
        if (!opts.withBudget) b += `  ${r.id} [${r.kind ?? ""}, detector ${r.detClass}]: (no text)\n`;
        continue;
      }
      b += `  ${r.id} [${r.kind ?? ""}`;
      if (opts.withBudget) {
        const sp = opts.scene?.speakers[r.id];
        if (sp) b += `, speaker: ${sp}`;
        const { maxChars, maxLines } = budget(r.source);
        b += `, maxChars ${maxChars}, maxLines ${maxLines}`;
      } else b += `, detector ${r.detClass}`;
      b += `]: ${quoteLines(r.source.lines)}\n`;
    }
    const extra = opts.unboxed?.[p.id];
    if (!opts.withBudget && extra?.length) b += `  (lettering outside any box, not editable: ${quoteLines(extra)})\n`;
  }
  return b;
}

/*
 * ┌───────────────────────────────── scene ────────────────────────────────┐
 * │ in : N panel debug images + transcript (no budget)                     │
 * │ out: Scene {summary, characters[{name, description}],                  │
 * │      panels[{panelId, description}], speakers{rid: label}, notes[]}    │
 * │ calls: 1 per strip, shared by every target language                    │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 *   Judged 1-10 by Opus + gemini-3.8-flash, blind, 7 strips:
 *
 *   model                     $/strip  opus judge  gemini judge
 *   ────────────────────────  ───────  ──────────  ────────────
 *   Opus                       0.150      10.0         10.0
 *   gemini-3.8-flash  ◄ pick   0.017       8.0          9.9
 *   Sonnet                     0.037       4.7          7.2
 *   deepseek-v4.1-flash        0.025       4.7          6.2
 *   gpt-5.6-luna / Haiku       0.005 / 0.009  2.3 / 1.7  3.0 / 3.7
 *
 *   Scene is where cheap models break: wrong speaker (bubble tails are long
 *   and wavy). Every translation downstream inherits a wrong speaker.
 */

export const SCENE_SCHEMA = `{"summary":"...","characters":[{"name":"label","description":"..."}],"panels":[{"panelId":"p0","description":"..."}],"speakers":{"r0":"label"},"notes":["..."]}`;

export function scenePrompt(l: LangInfo, panels: Panel[], transcriptText: string): string {
  const flavour = l.napirajz
    ? " (Napirajz: absurd, dry, slang-heavy humour about everyday Hungarian life; the drawings are deliberately simple, the jokes live in the dialogue, the wordplay and in background details)"
    : "";
  const list = panels.map((p, i) => `- image ${i + 1} = panel ${p.id}\n`).join("");
  return `You are the story editor on a team localizing a ${l.srcName} comic${flavour}.

The images are the panels of the strip in reading order:
${list}
Red boxes with number N mark text region rN (the red marks are ours, not part of the comic).

Exact transcript (the spelling is deliberate, do not correct it):
${transcriptText}
Study the panels and the transcript together, then produce the reference sheet the translators will work from.

characters:
- Everyone who speaks or matters to the joke, including off-panel voices.
- Use descriptive labels ("young woman with a portfolio", "truck driver"). Never invent proper names. If the art itself shows a name for a character (a name plate, a sign on their vehicle, a label), you may add it with a question mark, e.g. "truck driver (Faszi bácsi?)".
- Use exactly the same label everywhere in this answer.
- description: appearance, role, and how they talk (register, slang, swearing level, dialect spellings, verbal tics such as an interjection they keep repeating).

speakers: map EVERY region id from the transcript to a label.
- speech/thought: the character who says it. Follow the bubble tail to the speaker's mouth; tails can be long wavy lines that can run far across the panel and between bubbles, so trace them carefully instead of guessing from position. When several bubbles chain on one tail, they belong to the same speaker. Alternate speakers in a dialogue only if the tails say so.
- caption: "narrator". sfx: what makes the sound, e.g. "sfx: truck horn". sign: "sign". none: "none".

panels: one entry per panel, 1-3 sentences: what is visible, who does what, where the tails point, anything in the background that matters to a joke.

notes: everything a translator who does not speak ${l.srcName} needs in order to keep the humour. One note per item, each self-contained:
- the jokes and punchlines and what makes them funny;
- wordplay, puns, double meanings, idioms, slang and swear words (give the literal meaning and the tone);
- dialect or clipped spellings and what they say about the speaker (e.g. a dropped final consonant marks casual, rural or uneducated speech);
- verbal tics and running gags, with every region id where they occur;
- background signs: say what each sign spells in each panel. Compare signs across panels: a sign that changes between panels is a running gag (for example a brand name that is scrambled differently in every panel and only spelled correctly in the last one). Say whether each sign is a joke, whether it should be kept as drawn, and whether it needs explaining;
- cultural references (brands, places, people, historical styles, ${l.srcName} customs).

summary: 3-6 sentences: what happens, who these people are to each other, and why the strip is funny.

Reply with JSON only.
`;
}

export function sceneText(s: Scene): string {
  const speakers = Object.fromEntries(Object.keys(s.speakers ?? {}).sort().map((k) => [k, s.speakers[k]]));
  return goJSON({
    summary: s.summary ?? "",
    characters: s.characters?.map((c) => ({ name: c.name ?? "", description: c.description ?? "" })) ?? null,
    panels: s.panels?.map((p) => ({ panelId: p.panelId ?? "", description: p.description ?? "" })) ?? null,
    speakers,
    notes: s.notes ?? null,
  });
}

/*
 * ┌───────────────────────────────── clean ────────────────────────────────┐
 * │ in : orig.png + regions with replace = true                            │
 * │ out: clean bitmap (text erased), per region overlayBox + overlay crop, │
 * │      fitBox (where new text may go), glyphHeight (lettering size)      │
 * │ how: work area = textBox + 6 px inside bubbleBox; ink = luma < 160;    │
 * │      8-conn components; drop ones touching the area border (outline,   │
 * │      tail) or > 3x median height; paint the rest paper colour.         │
 * │      fitBox = largest rect in the flood-filled paper around the erased │
 * │      text.                                                             │
 * │ runs: browser worker (port of imgproc/erase.go + interior.go). Editor  │
 * │       replace toggle re-erases one region in place.                    │
 * │ cost: 0. Text over art (non-bubble) needs AOT-GAN later (23 MB).       │
 * └────────────────────────────────────────────────────────────────────────┘
 */

/*
 * ┌─────────────────────────────── translate:<lang> ───────────────────────┐
 * │ in : N panel debug images + scene sheet + transcript with speakers +   │
 * │      budgets (+ current translations of other regions, + editor hint   │
 * │      when retranslating one region)                                    │
 * │ out: per region {literal, text, notes}, budget attached                │
 * │ calls: 1 per strip per language (all bubbles together: jokes span      │
 * │        bubbles, tics repeat; splitting would resend images N times)    │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * ┌──────────────────────────────── review:<lang> ─────────────────────────┐
 * │ in : same as translate + the draft as JSON                             │
 * │ out: critique (region: problem -> fix) + final {text, notes}; an empty │
 * │      reply for a region keeps the draft                                │
 * │ calls: 1 per strip per language                                        │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 *   translate + review, judged 1-10, 7 strips:
 *
 *   model                     $/strip  opus judge  gemini judge
 *   ────────────────────────  ───────  ──────────  ────────────
 *   gemini-3.8-flash  ◄ pick   0.055       7.9          7.9
 *   Opus                       0.239       8.3          7.0
 *   deepseek-v4.1-flash        0.016       7.6          6.4   slow, broke JSON once
 *   gpt-5.6-luna      budget   0.008       7.0          6.4
 *   Sonnet                     0.092       6.9          6.4
 *   qwen3.7-plus               0.009       6.2          5.6   aborts on profanity
 *   Haiku                      0.009       5.9          5.0
 *
 *   Review pass gain (draft -> final, mean of judges): gemini +0.7, Sonnet
 *   +0.8, deepseek +0.7, Opus +0.2, luna -0.3, Haiku -0.3. Worth it for strong
 *   models only. Known miss: gemini left invented parody names untranslated
 *   (vodorre: SZAKADT PATENT) and killed the joke.
 */

export const TRANSLATE_SCHEMA = `{"regions":{"r0":{"literal":"...","text":"...","notes":"..."}}}`;

export const REVIEW_SCHEMA = `{"critique":"...","regions":{"r0":{"text":"...","notes":"..."}}}`;

export type TrPromptData = {
  lang: string;
  scene: string;
  transcript: string;
  current: string;
  hint: string;
};

export function currentText(regions: Region[], current: Record<string, RegionTranslation>, ids: Set<string>): string {
  return regions
    .filter((r) => current[r.id] && !ids.has(r.id))
    .map((r) => `  ${r.id}: ${goQuote(current[r.id].text)}`)
    .join("\n");
}

function trContext(d: TrPromptData, currentLabel: string): string {
  return `${d.current ? `\n\n${currentLabel} translations of the other regions, for consistency (do not return these):\n${d.current}` : ""}${
    d.hint ? `\n\nInstruction from the editor for this pass, follow it: ${d.hint}` : ""
  }`;
}

export function translatePrompt(l: LangInfo, d: TrPromptData): string {
  const t = langName(d.lang);
  return `You are a professional comic localizer translating a ${l.srcName} comic into ${t}. You have localized humour comics for years. Your lettering reads as if it had been written in ${t} in the first place: natural, punchy, speakable, funny in the same places as the original.

The images are the panels in reading order; red box N marks region rN (the red marks are ours).

Reference sheet from the story editor:
${d.scene}

Regions to translate (exact source; the spelling is deliberate). Budget = maxChars / maxLines the translation has to fit in the same bubble:
${d.transcript}${trContext(d, "Current")}

How to translate:
1. Voice first. Each character keeps one consistent voice. Match register, slang and swearing level: do not soften crude words, do not add swearing that is not there. Clipped or dialect spellings in the source mean casual speech: render that with natural ${t} colloquial forms, not with standard grammar and not with fake phonetic spelling.
2. Verbal tics: if a character repeats an interjection or filler, choose one ${t} equivalent that sounds natural as a tic and use it identically every time it occurs.
3. Jokes over words. Puns, double meanings and idioms must be adapted: find a ${t} line that gets the same laugh at the same moment, even if the words change. A literal translation of a joke that no longer works is a failure. Keep every piece of plot information other panels rely on.
4. Signs, brand names, plates and names: keep them exactly as drawn unless the reference sheet says the sign carries meaning that a ${t} reader would miss. Scrambled-brand gags work in any language: keep them as drawn. Translate a sign only if the joke needs it.
5. Sound effects: use the sound a ${t} comic would letter; keep it if it already works.
6. Fit: the text must fit the bubble. At most maxChars characters and settable in at most maxLines lines of about the original line length. Shorter is better than cramped; cut filler, never cut the joke. Do not insert line breaks, the letterer fits the text.
7. Case: if the source is capitals, write the translation in capitals (keep accents and umlauts).
8. Punctuation and rhythm: comics use "...", "!", "?!" and dashes for timing. Keep the timing of the original beats.

For every region return:
- "literal": a faithful, plain ${t} rendering of what the source literally says (for the editor; ignore the budget)
- "text": the final adapted lettering
- "notes": one short sentence if "text" departs from "literal" or a pun/tic/sign decision was made; otherwise ""

Return every region listed above, keyed by region id. Reply with JSON only.
`;
}

export function draftText(draft: Record<string, RegionTranslation>): string {
  const num = (id: string) => parseInt(id.slice(1), 10) || 0;
  const entries = Object.entries(draft)
    .sort(([a], [b]) => num(a) - num(b))
    .map(([id, t]) => ({ id, literal: t.literal ?? "", text: t.text ?? "", ...(t.notes ? { notes: t.notes } : {}) }));
  return goJSON(entries.length ? entries : null);
}

export function reviewPrompt(l: LangInfo, d: TrPromptData & { draft: string }): string {
  const t = langName(d.lang);
  return `You are the senior localization editor for a ${t} edition of a ${l.srcName} comic. A translator has delivered a draft. Your job: find what is wrong with it, then deliver the final lettering yourself.

The images are the panels in reading order; red box N marks region rN (the red marks are ours).

Reference sheet from the story editor:
${d.scene}

Source regions (exact; the spelling is deliberate) with their budget:
${d.transcript}${trContext(d, "Final")}

Draft (literal = plain meaning, text = adapted lettering):
${d.draft}

Step 1, critique. Go region by region and be harsh. Check:
- Meaning: is any plot information lost or changed that later panels depend on?
- Voice: does each character sound like one consistent person? Register, slang and swearing level matching the source (not softened, not exaggerated)? Is a repeated verbal tic rendered with the same word every time?
- Jokes: read the strip as a ${t} reader who has never seen the original. Does each joke land at the same moment? Is wordplay adapted into a real ${t} joke, or is it a literal translation that falls flat? Is the punchline sharp?
- Naturalness: would a native ${t} comic writer letter it this way? Flag translationese, stiff word order, calques, wrong idioms.
- Signs and names: kept as drawn unless the joke needs a translation; consistent across panels.
- Fit: count the characters of "text". Over maxChars, or too long to set in maxLines lines, must be shortened.
- Case and punctuation: capitals if the source is capitals; timing punctuation preserved.

Step 2, rewrite. Produce the final "text" for every region listed in the source, fixing every problem you found. Keep what already works; do not change for the sake of change. "notes": one short sentence on a decision the letterer or editor should know about (pun adaptation, tic choice, kept sign), else "".

"critique" is your step 1 as a compact list of findings (region id: problem -> fix). Then "regions" keyed by region id. Reply with JSON only.
`;
}

export function translatable(regions: Region[], only?: string[]): Set<string> {
  const want = new Set(only ?? []);
  return new Set(regions.filter((r) => r.source && r.kind !== "none" && (!want.size || want.has(r.id))).map((r) => r.id));
}

/*
 * After review: the final translation becomes a version (tr/<lang>.versions),
 * the editor lays each region's text into its fitBox at glyphHeight
 * (layout.ts), and export composites clean + overlays + text (render.ts).
 */
