import { langEnglishName } from "../langs";
import { FONTS } from "../layout";

export const OCR_SCHEMA = `{"lang":"<ISO 639-1 code of the comic's language, e.g. hu, ja, zh-Hant>","direction":"ltr|rtl","regions":[{"n":<box number>,"kind":"speech|thought|caption|sfx|sign|none","lines":["LINE 1","LINE 2"],"align":"left|center|right","caps":true}],"unboxed":["text seen outside every box"],"font":"<name from the font list>"}`;
export const SCENE_SCHEMA = `{"summary":"...","characters":[{"name":"label","description":"..."}],"panels":[{"panelId":"p0","description":"..."}],"speakers":{"r0":"label"},"notes":["..."]}`;
export const TRANSLATE_SCHEMA = `{"regions":{"r0":{"literal":"...","text":"...","notes":"..."}}}`;
export const REVIEW_SCHEMA = `{"critique":"...","regions":{"r0":{"text":"...","notes":"..."}}}`;

const STYLE =
  " The comic can be in any language and script, hand-lettered or typeset, written horizontally or in vertical columns. Copy the text in its own script: never transliterate, romanize or translate it.";

const SOURCE_NOTES: Record<string, string> = {
  hu: " (if it is Napirajz: absurd, dry, slang-heavy humour about everyday Hungarian life; the drawings are deliberately simple, the jokes live in the dialogue, the wordplay and in background details)",
  ja: " (manga conventions: honorifics, sentence-final particles and sound effects carry tone and relationships; furigana are reading aids, not separate text)",
};

const known = (src: string) => !!src && src !== "und";
const article = (w: string) => (/^[AEIOU]/.test(w) ? "an" : "a");
const comicOf = (src: string) => (known(src) ? `${article(langEnglishName(src))} ${langEnglishName(src)} comic${SOURCE_NOTES[src.split("-")[0]] ?? ""}` : "a comic");
const srcLangName = (src: string) => (known(src) ? langEnglishName(src) : "the original language");

export type OcrBox = { n: number; panel: number; image: number; cls: string; hint: string };

export const CLASS_HINTS: Record<string, string> = {
  text_bubble: "text inside a bubble",
  text_free: "text outside bubbles",
  bubble: "a bubble where no text was detected; it may be empty or hold small text",
};

export function ocrPrompt(nPanels: number, boxes: OcrBox[]): string {
  return `You are transcribing the lettering of a comic for a translation team.${STYLE}

Images 1-${nPanels} are the panels, numbered left to right, top to bottom. Every detected text area has a red outline and a red tag with its box number. The red marks are ours, not part of the comic.
The other images are clean close-ups of each box (no red marks), enlarged. Use them to read letters and accents; use the panel images for layout and context.

Boxes:
${boxes.map((b) => `- box ${b.n}: in panel image ${b.panel}, close-up is image ${b.image}; detector class ${b.cls}${b.hint ? ` (${b.hint})` : ""}`).join("\n")}

First decide which language the comic is written in and put its ISO 639-1 code in "lang" (add a script subtag only when it matters, e.g. zh-Hans or zh-Hant). Set "direction" to the order the panels and bubbles are read in: "rtl" for layouts read right to left (Japanese manga, comics drawn for Arabic, Hebrew or Persian readers), otherwise "ltr". Judge it from the layout and the flow of the story, not from the script alone: a Western comic translated into Arabic or Hebrew usually keeps its left-to-right layout.

Transcribe every box. These rules matter more than anything else:

1. COPY, NEVER CORRECT. Write the letters exactly as drawn. Keep dialect, slang, colloquial contractions, dropped letters, odd spellings and typos. Hungarian casual speech, for example, often drops a final consonant: "ELJÖTTÉ" stays "ELJÖTTÉ" (do NOT write "ELJÖTTÉL"). If you notice you are "fixing" a word towards the standard language, undo it. The translators need the exact form because the deviation is often the joke or the voice of the character.
2. ACCENTS AND SPECIAL LETTERS. Copy every diacritic and special character exactly as drawn; do not drop them and do not add ones that are not there. Hand-drawn accents are small and slanted: check each letter in the close-up. For example Hungarian Ő Ű (double acute) vs Ö Ü (two dots) vs Ó Ú (one stroke); Czech and Slovak carons (Č Ř Š Ž); Polish Ą Ę Ł Ż; Vietnamese stacked tone marks. In Chinese and Japanese copy kanji and kana exactly, simplified or traditional as drawn; skip furigana (tiny readings beside kanji).
3. PUNCTUATION exactly as drawn: commas (often a small tick at the baseline), periods, "...", "!", "?", "¿", "¡", quotes of any style („” «» 「」), "。", "、", hyphens, dashes.
4. LINE BREAKS exactly as lettered: one entry in "lines" per lettered line, top to bottom. Vertical lettering: one entry per column, in the order the columns are read. Do not re-flow.
5. CASE: copy the case as lettered. If a box is lettered in capitals, transcribe it in capitals and set "caps": true. If it is mixed or lower case, or the script has no capitals (Chinese, Japanese, Korean, Arabic, Hebrew, Thai, Devanagari…), set "caps": false.
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

Also list in "unboxed" any lettering you can see in the panel images that is NOT inside any red box (for example a tiny bubble the detector missed), transcribed with the same rules. Use [] if there is none.

Pick the "font" the translation will be lettered in: the one from this list that looks most like the comic's dialogue lettering (hand-drawn or typeset, stroke weight, serif or not): ${Object.keys(FONTS).join(", ")}.

Reply with JSON only.`;
}

export function scenePrompt(src: string, panels: { id: string; image: number }[], transcript: string): string {
  const srcName = srcLangName(src);
  return `You are the story editor on a team localizing ${comicOf(src)}.

The images are the panels of the strip in reading order:
${panels.map((p) => `- image ${p.image} = panel ${p.id}`).join("\n")}

Red boxes with number N mark text region rN (the red marks are ours, not part of the comic).

Exact transcript (the spelling is deliberate, do not correct it):
${transcript}
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

notes: everything a translator who does not speak ${srcName} needs in order to keep the humour. One note per item, each self-contained:
- the jokes and punchlines and what makes them funny;
- wordplay, puns, double meanings, idioms, slang and swear words (give the literal meaning and the tone);
- dialect or clipped spellings and what they say about the speaker (e.g. a dropped final consonant marks casual, rural or uneducated speech);
- verbal tics and running gags, with every region id where they occur;
- background signs: say what each sign spells in each panel. Compare signs across panels: a sign that changes between panels is a running gag (for example a brand name that is scrambled differently in every panel and only spelled correctly in the last one). Say whether each sign is a joke, whether it should be kept as drawn, and whether it needs explaining;
- cultural references (brands, places, people, historical styles, local customs).

summary: 3-6 sentences: what happens, who these people are to each other, and why the strip is funny.

Reply with JSON only.`;
}

export type TrPromptData = { src: string; lang: string; scene: string; transcript: string; current: string; hint: string };

const extras = (d: TrPromptData, currentLabel: string) =>
  `${d.current ? `\n\n${currentLabel}, for consistency (do not return these):\n${d.current}` : ""}${d.hint ? `\n\nInstruction from the editor for this pass, follow it: ${d.hint}` : ""}`;

export function translatePrompt(d: TrPromptData): string {
  const L = langEnglishName(d.lang);
  return `You are a professional comic localizer translating ${comicOf(d.src)} into ${L}. You have localized humour comics for years. Your lettering reads as if it had been written in ${L} in the first place: natural, punchy, speakable, funny in the same places as the original.

The images are the panels in reading order; red box N marks region rN (the red marks are ours).

Reference sheet from the story editor:
${d.scene}

Regions to translate (exact source; the spelling is deliberate). Budget = maxChars / maxLines the translation has to fit in the same bubble:
${d.transcript}${extras(d, "Current translations of the other regions")}

How to translate:
1. Voice first. Each character keeps one consistent voice. Match register, slang and swearing level: do not soften crude words, do not add swearing that is not there. Clipped or dialect spellings in the source mean casual speech: render that with natural ${L} colloquial forms, not with standard grammar and not with fake phonetic spelling.
2. Verbal tics: if a character repeats an interjection or filler, choose one ${L} equivalent that sounds natural as a tic and use it identically every time it occurs.
3. Jokes over words. Puns, double meanings and idioms must be adapted: find a ${L} line that gets the same laugh at the same moment, even if the words change. A literal translation of a joke that no longer works is a failure. Keep every piece of plot information other panels rely on.
4. Signs, brand names, plates and names: keep them exactly as drawn unless the reference sheet says the sign carries meaning that a ${L} reader would miss. Scrambled-brand gags work in any language: keep them as drawn. Translate a sign only if the joke needs it. Invented or parody names that read as words (made-up band, brand or character names built from real words) are part of the joke: localize them into ${L} names that land the same way.
5. Sound effects: use the sound a ${L} comic would letter; keep it if it already works.
6. Fit: the text must fit the bubble. At most maxChars characters and settable in at most maxLines lines of about the original line length. Shorter is better than cramped; cut filler, never cut the joke. Do not insert line breaks, the letterer fits the text.
7. Case: if the source is capitals and ${L} has capital letters, write the translation in capitals (keep accents and umlauts). Write ${L} in its usual script.
8. Punctuation and rhythm: comics use "...", "!", "?!" and dashes for timing. Keep the timing of the original beats.

For every region return:
- "literal": a faithful, plain ${L} rendering of what the source literally says (for the editor; ignore the budget)
- "text": the final adapted lettering
- "notes": one short sentence if "text" departs from "literal" or a pun/tic/sign decision was made; otherwise ""

Return every region listed above, keyed by region id. Reply with JSON only.`;
}

export function reviewPrompt(d: TrPromptData & { draft: string }): string {
  const L = langEnglishName(d.lang);
  return `You are the senior localization editor for a ${L} edition of ${comicOf(d.src)}. A translator has delivered a draft. Your job: find what is wrong with it, then deliver the final lettering yourself.

The images are the panels in reading order; red box N marks region rN (the red marks are ours).

Reference sheet from the story editor:
${d.scene}

Source regions (exact; the spelling is deliberate) with their budget:
${d.transcript}${extras(d, "Final translations of the other regions")}

Draft (literal = plain meaning, text = adapted lettering):
${d.draft}

Step 1, critique. Go region by region and be harsh. Check:
- Meaning: is any plot information lost or changed that later panels depend on?
- Voice: does each character sound like one consistent person? Register, slang and swearing level matching the source (not softened, not exaggerated)? Is a repeated verbal tic rendered with the same word every time?
- Jokes: read the strip as a ${L} reader who has never seen the original. Does each joke land at the same moment? Is wordplay adapted into a real ${L} joke, or is it a literal translation that falls flat? Is the punchline sharp?
- Naturalness: would a native ${L} comic writer letter it this way? Flag translationese, stiff word order, calques, wrong idioms.
- Signs and names: kept as drawn unless the joke needs a translation; consistent across panels.
- Fit: count the characters of "text". Over maxChars, or too long to set in maxLines lines, must be shortened.
- Case and punctuation: capitals if the source is capitals; timing punctuation preserved.

Step 2, rewrite. Produce the final "text" for every region listed in the source, fixing every problem you found. Keep what already works; do not change for the sake of change. "notes": one short sentence on a decision the letterer or editor should know about (pun adaptation, tic choice, kept sign), else "".

"critique" is your step 1 as a compact list of findings (region id: problem -> fix). Then "regions" keyed by region id. Reply with JSON only.`;
}
