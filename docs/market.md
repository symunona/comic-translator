# Market: who uses + pays for comic-translator (2026-10-21)

Numbers from web search 2026-10-21, sources at bottom. Most are company claims or secondhand: treat as order of magnitude. `unknown` = searched, not found. `did not check` = not searched. Opinion sections labeled.

Product recap: browser-only. Detect bubbles (ONNX) -> OCR (Paddle + cheap LLM) -> scene/context LLM (speakers, jokes) -> translate + review -> erase -> re-letter -> editor -> PNG. ~$0.08/strip. BYOK, AGPL-3.0 (see `byok-plan.md` O1-O4).

## TL;DR

- Manga readers = crowded, free tools, pirate-adjacent. Not the payer.
- Payers = people who **own or license the text** and need **finished pages**: creators, pro translators/letterers, small publishers, syndicated cartoonists, marketing teams.
- Surprise segment with reach: **language teachers**. Same pipeline (OCR + erase + re-letter) makes cloze worksheets. Huge, findable audience (TPT, ISLCollective, FB groups). Low price, high volume.
- Bigger version (§3.4): teachers + **private tutors** adapt **any page**, not just comics: textbook pages, worksheets, menus, ads, signs. "Keep the picture, change the words." AI worksheet tools (MagicSchool, Diffit, Twee) generate new text; none edits an existing visual page in place. Gap = ours. Needs printed-text detection + PDF input.
- Top 3 to test: **1. webcomic creators**, **2. pro comic translators/letterers**, **3. ESL / foreign-language teachers**.
- Biggest risk across creator segments: **anti-AI sentiment among artists**. Pitch = "we touch text only, never art; you review every line".

## 1. Estimating audience size

### Method: TAM -> SAM -> SOM from proxies

- **TAM** = everyone with the problem (e.g. all comic creators, all language teachers).
- **SAM** = reachable + fits product today (English-speaking online, digital files, wants another language, browser ok).
- **SOM** = realistic year-1 users/payers = SAM x reach rate x try rate x pay rate.
- Funnel defaults for a solo FOSS tool with no ad budget (opinion): reach 1-5% of SAM, try 10-30% of reached, pay 2-5% of tried.
- Always compute low/high. Ratio > 10x = proxy is weak, run a smoke test instead.

### Proxies (what to count, where)

| proxy | measures | how | cost |
|---|---|---|---|
| platform creator counts | creator TAM | investor pages, press releases, Wikipedia | free |
| subreddit / Discord / FB group members | reachable community, activity | subreddit sidebar; posts/day better than members | free |
| Google Trends | relative interest, country split, seasonality | compare "comic translator" vs "manga translator" vs "esl worksheet" | free |
| keyword volumes | search demand | Google Ads Keyword Planner (free w/ account), Ubersuggest | free-ish |
| marketplace listing counts | supply = demand signal | TPT / ISLCollective search "comic", "cloze comic" -> result count, sort by sales | free |
| competitor traffic | money already spent | Similarweb free tier (top countries, monthly visits) for comic-translate, Koharu, Storyboard That, Mantra | free |
| GitHub stars/forks of competitors | dev/hobby interest | `gh api repos/X` (manga-image-translator 10.5k, Koharu 6.4k: see `prior-art.md`) | free |
| Patreon/Graphtreon category | creators with paying fans = can pay | Graphtreon comics category ranking | free |
| official stats | teachers, learners | British Council, UNESCO, national edu stats | free |
| price anchors | willingness to pay | competitor price pages, freelance rate surveys | free |
| smoke test | **actual** intent | landing page per segment + fake "Buy" / waitlist; ads $20-50 | $0-50 |
| survey | stated intent (inflated, x0.3) | post in community, 5 questions, ask current spend | free |

- Rule: members != buyers. Weight: smoke-test signups > marketplace sales > search volume > community size.
- Demography: Google Trends country split, Similarweb country split, subreddit-tied surveys, Patreon creator census (13k respondents, 4/5 work alone). Platform demos (Webtoon = young, Gen Z heavy) = did not check exact figures.

### Numbers found

| proxy | value | date | note |
|---|---|---|---|
| WEBTOON "total creators" | 27M+ | Q1 2026 | includes anyone who uploaded; inflated |
| WEBTOON MAU | ~145M | Q1 2026 | down 5.9% |
| WEBTOON paid to creators | $2.7B | 2021-2025 | |
| WEBTOON CANVAS | unified intl, 7 langs (EN ES FR ID TH zh-TW DE) | 2026 | **platform itself pushes multilingual creators** |
| Tapas creators | ~75,000 / 100k titles | 2026 | Kakao reportedly shutting Tapas down -> creators migrating |
| Patreon creators with >= 1 patron | 243k-286k | 2024 | comics = "popular category", share unknown |
| Pepper&Carrot | 28 langs full/mostly, +40 partial; ~68 contributors | 2017-2023 | CC-BY, hand-translated |
| comics market (all) | ~$18B | 2025 | Ken Research; APAC 59.6% |
| webtoon/webcomics market | $8-11B | 2025 | vendor estimates disagree wildly |
| Franco-Belgian output | 5,305 books/yr, 1,519 original | 2016 | old; translation rights totals unknown |
| English teachers worldwide | ~10.2M | ~2013 | British Council via Guardian, unverified |
| native-speaker TEFL abroad | 250k-1M | various | marketing/forum, weak |
| English learners | ~1.5B | 2014 | TESOL / British Council |
| TPT active users | 2.6M+ | year unclear | IXL-owned since 2023 |
| TPT sellers | 208,748; 81% sales to top 1% | 2020 | |
| r/languagelearning | ~3.4M members | pre-2025-11 | |
| r/EnglishLearning | ~550-700k | pre-2025-11 | |
| r/webcomics, r/manga | unknown | | read sidebar directly |
| Duolingo MAU | 135.3M | Q3 2025 | learner proxy |
| keyword volumes | did not check | | Keyword Planner needs account |

### Price anchors

| what | price | source note |
|---|---|---|
| Storyboard That teacher | $13.99/mo; $149.99/teacher/yr; $3.49/student/yr | edu comic maker, closest edu comp |
| comic lettering (human) | $10-50/page (newcomer floor $10, GAG list $40-50) | anecdotal |
| comic translation (human) | no per-page standard; lump sum per book | ProZ forum |
| manga letterer (exploitative low end) | ~$1/page | secondhand, ANN forum |
| Mantra Engine (AI manga) | promo 800 JPY / 16 pages (2022) | no current rate card |
| Orange (JP startup) | target "90% cheaper" than human | no price |
| our cost | ~$0.08/strip LLM | `byok-plan.md` |

Opinion: human lettering $10-50/page vs our $0.08 = 100x+ gap. Price on time saved, not on LLM cost. $1-3/page or $15-30/mo for pros is cheap to them.

### Worked example: webcomic creators (opinion, rough)

- TAM: Tapas 75k + Webtoon CANVAS (active, not "total") unknown, guess 200k-1M serious active -> use 100k-500k English-language active creators.
- SAM: wants another language + digital files + not anti-AI: 5-15% -> 5k-75k.
- SOM yr1: reach 2% -> 100-1,500; try 20% -> 20-300; pay 5% -> **1-15 payers**. At $10/mo -> $10-150/mo.
- Conclusion: matches `byok-plan.md` O1 ("$0-50/mo first year"). Volume needs a segment with more reach -> teachers.

### Worked example: ESL teachers (opinion, rough)

- TAM: 10.2M English teachers (+ other-language teachers, did not check).
- SAM: online, makes own worksheets, uses comics: TPT 2.6M users as proxy; 5-10% use comics -> 130k-260k.
- SOM yr1: reach 0.5% (marketplace + FB groups) -> 650-1,300; try 30% -> 200-400; pay 3% -> **6-12 payers** direct. Plus TPT-style resale of generated worksheets (passive, see §3.3).
- Conclusion: same order of payers as creators, but **10x more free users** = word of mouth + FOSS visibility.

## 2. Use cases ranked

Scores 1-5 (5 = best). WTP = willingness to pay. Reach = how cheap to find them. Legal = how clean (5 = they own/license the text). Fit = works with current features. Opinion.

| # | segment | use | WTP | reach | legal | fit | sum | main missing feature |
|---|---|---|---|---|---|---|---|---|
| 1 | webcomic creators (own work) | publish in 2nd/3rd language, CANVAS multi-lang, Kickstarter stretch goal | 4 | 4 | 5 | 4 | **17** | multi-page project, series glossary, own handwriting font, hi-res export |
| 2 | pro comic translators / letterers | speed up cleanup + lettering, draft translation to post-edit | 4 | 3 | 5 | 4 | **16** | text export/import (CSV/XLIFF), glossary/TM, PSD/layered export, keep their translation |
| 3 | syndicated cartoonists / strip authors (Napirajz-type) | sell strips to foreign papers/sites | 4 | 2 | 5 | 5 | **16** | batch series, consistent lettering font, partner-share links |
| 4 | small publishers / indie imprints | backlist into new language, pitch rights abroad (sample chapter) | 5 | 2 | 5 | 3 | **15** | print res, CMYK/PDF, bleed, project review workflow, font licensing |
| 5 | marketing / corporate comics | localize brand comics, HR/compliance comics, onboarding strips | 4 | 2 | 5 | 3 | **14** | batch to N languages, brand font upload, SVG/PDF, team account, invoice |
| 6 | ESL / foreign-language teachers | cloze worksheets, vocab lists, graded reading, "write the dialogue" tasks | 3 | 4 | 3 | 3 | **13** | blank-bubble mode, cloze generator, answer key, PDF A4/Letter, level control |
| 6b | teachers + private tutors: **page adapter** (any image/PDF page) | rewrite/level-down/localize/blank text in place on textbook pages, worksheets, authentic materials | 3 | 4 | 2 | 2 | **11** now, **14** once printed text works | printed-text detection, PDF in/out, printed font matching, tables/columns |
| 7 | language learners (self-study) | read comic in target lang with gloss, side-by-side, tap to reveal | 2 | 4 | 3 | 3 | **12** | bilingual toggle, word gloss, Anki export, keep original text visible |
| 8 | accessibility | alt text / transcript for screen readers; re-letter same language in dyslexia-friendly font, larger text | 2 | 2 | 4 | 4 | **12** | same-language re-letter, alt-text/transcript export (OCR + scene already = 80% there) |
| 9 | kids' / picture books | bilingual editions, heritage-language kids | 3 | 2 | 4 | 2 | **11** | non-bubble text blocks, long text layout, print |
| 10 | museums / exhibitions / festivals | translated panels for comics exhibitions, festival catalogues | 3 | 1 | 4 | 3 | **11** | large-format print, high-res infill |
| 11 | family / heritage | grandparents' old comics/letters for diaspora kids, family zines | 2 | 2 | 3 | 4 | **11** | none major; needs gentle UX + free tier |
| 12 | fan translator groups (scanlation) | speed pipeline | 1 | 4 | 1 | 4 | **10** | n/a: **do not target** (infringement, reputation) |
| 13 | archives / researchers | OCR + translate old comics for study, searchable text | 2 | 2 | 3 | 3 | **10** | text-only export, batch, metadata |
| 14 | libraries | community-language editions of local comics, ESL programs | 2 | 2 | 3 | 2 | **9** | procurement (invoice, DPA), shared accounts |

Notes:
- Rows 1-4 overlap: same buyer type (rights holder, wants finished page). One "Pro" feature set serves all four.
- Row 6 is the only high-reach segment with real budget habits (teachers already buy on TPT, Storyboard That).
- Row 8: OCR + scene call already produce speaker + text = transcript. Cheapest new feature, good PR, good for FOSS grants (NLnet, Prototype Fund: did not check current calls).

### Creative education use cases (detail)

All reuse: detect -> OCR -> erase -> re-letter.

- **Cloze dialogue**: erase every Nth word or target-grammar words (past tense, phrasal verbs) in bubbles, leave blank line, answer key page.
- **Empty bubbles**: erase all text -> students write dialogue. Speaking/writing prompt. Already possible today (erase only).
- **Scrambled bubbles**: list bubble texts in random order, students match to bubbles.
- **Vocab sheet**: OCR text -> LLM picks 10 words at CEFR level -> glossary with panel thumbnail.
- **Graded reader**: re-letter same comic with simplified text at A2/B1 (translate en->en "simplify").
- **Bilingual strip**: original + translation side by side, or L1 under L2 in each bubble.
- **Joke explanation**: scene call already explains wordplay -> "why is this funny" teacher notes. Unique vs competitors.
- **Pronunciation**: TTS per bubble with speaker voices (later, did not check costs).
- **Translation class**: students translate, tool shows LLM draft + review pass for comparison (university translation studies).
- Legal for teachers (from memory, not checked today): EU DSM Directive Art. 5 allows digital teaching use of works in class under conditions; selling worksheets built on someone else's comic = infringement. Seed with CC-BY (Pepper&Carrot), public domain (Digital Comic Museum golden-age), or teacher's own drawings.

## 3. Top 3 segments

### 3.1 Webcomic creators (own work)

- **Who**: solo artists, 18-35 (opinion, did not check demographics), on Webtoon CANVAS, Tapas (shutting down -> migrating), Patreon, Kickstarter, own sites. 4/5 Patreon creators work alone.
- **Where to find**:
  - r/webcomics, r/comics, r/ComicBookCollabs; Webtoon CANVAS forums; Bluesky/Instagram art circles.
  - Discords: Webtoon creator servers, Clip Studio Paint communities.
  - Tapas migration threads (2026): creators re-homing comics = moment to add languages.
  - Pepper&Carrot translators (framagit).
  - Hungarian scene: Napirajz authors, Képregényfesztivál.
- **Consumption habits**:
  - Draw in Clip Studio Paint, Procreate, Krita. Export PNG/PSD. Long-strip (Webtoon) or page format.
  - Pay for: CSP license/sub, fonts, Patreon tools, Kickstarter fulfilment. Price-sensitive. Prefer one-time or small monthly.
  - Distrust AI. Many publicly anti-gen-AI. Any "AI" label risks pile-on.
  - Value: control, keeping own lettering style, not losing pixel quality.
- **Pitch**: "Your comic in Spanish this weekend. Text only. You review every line. Art untouched. Runs in your browser, nothing uploaded to us."
- **First experiment (cheap)**:
  1. Translate one Pepper&Carrot episode EN->HU and FR->EN; compare with community human translation; publish side-by-side (CC-BY, attribution).
  2. Post in r/webcomics: "Free: I'll translate your first chapter into one language. Feedback wanted." Cap 10.
  3. Ask each: "Would you pay $X/mo or $Y/chapter?" + "Would you disclose AI-assisted?"
  - Go if >= 3 of 10 say yes to a price and >= 1 publishes the result. Kill if backlash dominates.
- **Missing features**: multi-page project, series glossary (names, catchphrases), custom font upload (own handwriting), long-strip (Webtoon vertical) support, hi-res + PSD export, per-character voice consistency.

### 3.2 Pro comic translators / letterers

- **Who**: freelance translators doing comics/manga/BD for publishers; letterers paid $10-50/page; often same person on small books. Paid lump sum per book (ProZ).
- **Where to find**:
  - ProZ.com forums (graphic novels threads), translator associations (ATA, ITI, MFE in Hungary: did not check comics sections).
  - Letterer Twitter/Bluesky, Aditya Bidikar-type newsletters, Comics Experience lettering courses.
  - Manga/BD publisher localization teams (Viz, Kodansha, Europe Comics, Hungarian: Fumax, Vad Virágok, Pesti Könyv).
  - Conferences: Angoulême, Frankfurt Book Fair comics rights area, Lucca.
- **Consumption habits**:
  - Tools: Photoshop / InDesign / Illustrator for lettering, CAT tools (Trados, memoQ, Phrase) for text. Already pay $100s/yr for software.
  - Buy on: time saved per page. Cleanup (erasing text over art) = most hated grunt work.
  - Fear: "AI replaces translators". Want tool, not competitor.
- **Pitch**: "Cleanup + first-pass lettering in minutes. Your translation, your fonts. Export layers back to Photoshop."
- **First experiment (cheap)**:
  1. Timed test: 5 pages, manual cleanup+lettering vs tool+fix. Record minutes. Publish numbers.
  2. DM 10 letterers/translators with the video + free access. Ask what they'd pay per page / per month.
  - Go if median time saved >= 50% and >= 3 say $15+/mo.
- **Missing features**: import own translation (CSV/XLIFF per bubble), text export for CAT, glossary/TM, layered PSD or SVG export (text as editable layer), font upload, erase-only mode with better infill, batch over a chapter.

### 3.3 ESL / foreign-language teachers

- **Who**: 10.2M English teachers (unverified) + other languages. Primary/secondary + private tutors + online tutors (italki, Preply). Make worksheets weekly. Mostly women (opinion from teaching workforce stats, did not check).
- **Where to find**:
  - Marketplaces: TPT (2.6M users), ISLCollective, BusyTeacher, Twinkl, Liveworksheets (did not check sizes).
  - Facebook groups: "ESL teachers", "TEFL teachers worldwide", country-specific (Hungarian: angoltanárok groups, did not check names).
  - Pinterest (worksheet discovery), YouTube teacher channels, r/TEFL, r/ESL_Teachers, r/Teachers.
  - Conferences: IATEFL, TESOL, local (IATEFL-Hungary).
- **Consumption habits**:
  - Prep evenings/Sunday. Want printable A4/Letter PDF in < 5 min.
  - Free first. Pay $2-10 per resource on TPT, or ~$14/mo (Storyboard That) when school pays.
  - Love comics for motivation + context (18-study review: comprehension, motivation, vocab, speaking gains; skepticism + low visual literacy = challenge).
  - Share heavily inside groups -> viral if free + good.
- **Pitch**: "Turn any comic page into a fill-in-the-blank worksheet with answer key. 1 minute."
- **First experiment (cheap)**:
  1. Make 5 worksheets by hand-ish (current tool: erase + re-letter blanks) from Pepper&Carrot (CC-BY) or public-domain comics. Cloze, empty bubbles, vocab.
  2. List free on ISLCollective + TPT; 1 paid at $3. Post in 3 FB groups.
  3. Fake-door on the site: "Make your own worksheet" button -> waitlist email.
  - Measure: downloads/week, waitlist signups, paid sales. Go if > 100 downloads in 4 weeks or > 30 signups.
- **Missing features**: worksheet mode (choose words to blank, by POS/CEFR level), answer key page, PDF export with header (name/date lines), empty-bubble mode one-click, vocab list, simplify-text (graded), CC/public-domain comic library to pick from (teachers lack source material), classroom-safe filter.

### 3.4 Teachers + private tutors: page adapter (beyond bubbles)

User insight (2026-10-21): teachers grab whatever pages they find (textbooks, other teachers' sheets, scans, screenshots), then rewrite them into handouts. They change **all** text, not just speech bubbles. That is a far bigger job-to-be-done than comic worksheets.

- **What they do to a page** (opinion, from practice + Malaysian ESL study: teachers "add, modify, simplify" textbook content, extra workload):
  - level down / level up text (CEFR A2 -> B1).
  - localize: swap names, places, prices, currency, culture refs (UK textbook -> Hungarian kid's town).
  - personalize for one student: tutor's student loves football -> rewrite reading text around football, keep the picture.
  - blank out: cloze, remove answers from an answer-filled sheet, remove instructions to make a speaking task.
  - translate instructions to L1 for beginners, or remove L1.
  - fix: typos, outdated content (prices, tech), US <-> UK spelling.
  - reuse visuals: menus, ads, timetables, signs, infographics = "authentic materials" with new text.
- **Why we fit**: pipeline = detect text -> OCR -> LLM rewrite with context -> erase -> re-letter. Same as comics. Scene call = "what is on this page" context for the rewrite.
- **Why private tutors > school teachers** (opinion):
  - Pay out of own pocket, no procurement. Decide alone, same day.
  - 1:1 lessons -> material must be personalized per student -> many adaptations/week.
  - Prep time unpaid -> time saved = money.
  - Online lessons: share PNG on screen / whiteboard -> PNG export already enough. Print PDF second.

#### Size

| proxy | value | note |
|---|---|---|
| Preply tutors | 32k (own profile) vs 100k+ (Wikipedia, 2026) | sources disagree; English tutors 25k+ |
| italki English tutors | ~8,000 | one review; platform total unknown |
| Twee (AI ESL lesson tool) | "500k+ teachers" claim; ~170k visits/mo, 93k unique (Dec 2025) | marketing claim vs traffic |
| ISLCollective | "2M+ ESL teachers" claim; ~3.65M visits/mo (Mar 2025, Semrush) | |
| Wordwall | ~46M visits/mo (Mar 2025, Semrush) | interactive activities, huge |
| ESL Printables (Liveworksheets parent) | 1.11M registered (2025-10) | |
| online language tutoring market | ~$5.9B (2025) | Meticulous Research, internally inconsistent |
| US language instruction businesses | 13,732 (2025) | IBISWorld, US only |
| freelance tutors worldwide | unknown | no source found |
| % teachers adapting copied pages | unknown | no survey found; HK EDB runs biennial copying survey (results not found) |

- Rough SAM (opinion): online platform tutors ~50k-150k (Preply + italki + Cambly, did not check Cambly) + offline private tutors (unknown, likely several x) + school teachers who self-make materials (ISLCollective/Wordwall user base, millions). Even 0.1% paying at $5-10/mo = 50-150+ payers from tutors alone: better than creators.

#### Where they hang out

| place | what | size | note |
|---|---|---|---|
| Preply Tutor Community | official, approved tutors only | unknown | need a tutor account to post |
| r/Preply | unofficial | ~5k | |
| r/PreplyTutors | tutors vent anonymously | ~2k | |
| r/iTalki | teachers + students | ~10k | |
| r/TEFL, r/ESL_Teachers, r/Teachers | classroom + TEFL | did not check | |
| r/EnglishLearning, r/languagelearning | learners (tutors lurk to find students) | 550-700k, 3.4M | |
| Facebook groups | main teacher hangout | only small ones found (3-17k); big ones unknown | search FB directly: "ESL teachers", "online English teachers", "Preply tutors" |
| ISLCollective, Liveworksheets, TPT | share/sell worksheets | millions (claims) | upload free adapted sheets = discovery channel |
| YouTube / Instagram / TikTok teacher creators | lesson-hack videos, "teacher tools" reviews | did not check | 1 demo short "adapt any textbook page in 30 s" = test |
| educatorstechnology.com, weareteachers.com, chalkie/monsha blog lists | "best AI tools for teachers" listicles | | get listed: free backlinks, teachers read these |
| IATEFL, IATEFL-Hungary (conferences, webinars, newsletter) | PD | | workshop talk = credibility |
| Hungarian | no angoltanár/magántanár FB group found by search | unknown | search FB with "angol magántanár", "nyelvtanárok"; érettségi FB groups have tutors offering lessons |

#### What they use otherwise (competitors + habits)

| tool | does | price | edits existing page in place? |
|---|---|---|---|
| Canva (Edu free) | design handouts, flashcards, templates | free edu / Pro | no (rebuild from scratch; "Magic" edit on photos, did not check text) |
| Google Docs / Slides / Forms | plain sheets, quizzes | free | no |
| MagicSchool | 60+ AI tools, worksheet gen (cloze, MCQ) | ~$8-10/mo, $99/yr | no, text only |
| Diffit | rewrite text at reading levels + questions | ~$14.99/mo | no, text only |
| Twee | AI ESL lessons from YouTube/text | freemium | no |
| Chalkie | AI worksheets | ~$6.65/mo yearly | no |
| Wordwall, Quizlet, Kahoot, Liveworksheets | interactive activities | freemium | no |
| ChatGPT / Claude / Gemini | rewrite text, make tasks | free-$20/mo | partly: image gen can redraw, but mangles layout/text |
| WPS Office AI text edit, PDF Reader Pro | edit text in scanned image/PDF | freemium | **yes, generic** (no level/rewrite, no LLM context) |
| Fiverr "edit text in scan" | human | per job | yes, slow |

- Habits: free first; pay $5-15/mo if it saves prep hours; share tools inside groups fast; prep evenings/weekends; mix of print (school) and screen share (online tutors).
- Positioning gap: "AI worksheet generators" make **new text with no visuals**. Generic PDF editors swap text **without understanding** (no level, no localization). Ours: keep visual, rewrite meaningfully, re-letter to fit.

#### Legal (from memory, not checked today)

- Teachers copying textbook pages: often infringement (HK EDB explicitly excludes workbooks/worksheets from school licence). In-class use may fall under EU DSM Art. 5 teaching exception under conditions; sharing adapted textbook pages on ISLCollective/TPT = infringement.
- Tool stays neutral (like a photocopier, PDF editor). We host nothing in local mode.
- **Market "adapt your materials / authentic materials / your own sheets"**. Never "copy any textbook". Demos with own or CC/public-domain pages.

#### First experiment (cheap)

1. Concierge: post in r/PreplyTutors, r/iTalki, r/TEFL, 2-3 FB groups: "Send me one page you'd like adapted (level, topic, blanks). I'll do it free with a tool I'm building." Cap 20.
   - Do it with current pipeline + manual fixes. Log what text types break (dense print, tables).
   - Ask: "How long would this take you? Would you pay $5/mo / $1/page?"
2. 30 s screen recording: textbook-style page (own-made) -> A2 football version. Post as YouTube Short / TikTok / Reel. Measure views + comments asking "where".
3. Fake door on site: "Adapt a worksheet (beta)" -> email waitlist.
- Go if >= 10 of 20 requests come in within 2 weeks, >= 5 say they'd pay, or > 50 waitlist.

#### Missing features

- printed-text detection for dense pages (current detector = comic bubbles + `text_free`; did not check how it does on textbook pages. Likely add PaddleOCR text-det for print).
- PDF input (multi-page) + PDF output (A4/Letter).
- printed font matching (sans/serif/weight) instead of comic hand font.
- block-level rewrite with length budget (text must fit original box).
- rewrite presets: level (CEFR), localize (country), personalize (topic), cloze, remove answers, translate instructions.
- tables / columns / numbered lists layout.
- image-region keep-out (don't erase text in photos unless chosen).

## 3.5 Pricing shape: free browser tool, paid automation (user idea 2026-10-21)

Rule: **everything that runs in the browser without an LLM = free forever**. Costs us $0 (static host, user's CPU/GPU). **Anything that calls an LLM = paid** (credits) or BYOK.

| tier | what | runs | cost to us | price |
|---|---|---|---|---|
| Free | detect text/bubbles (ONNX), OCR (Paddle), erase/infill, manual edit + re-letter, click-a-word-to-blank, empty-bubble mode, font pick, PNG/PDF export | browser | $0 | free |
| BYOK | all LLM features with user's own OpenRouter key | browser -> provider | $0 | free |
| Credits | same LLM features, no key setup | browser -> our proxy | ~$0.08/strip-page | ~2x cost (see `byok-plan.md` O1) |
| Pro (later) | batch "auto make X for printing": whole chapter/worksheet pack, presets, glossary, series memory | proxy | per job | $5-15/mo or per pack |

Paid automation examples ("auto make X"):

- **Teachers/tutors**: "make A2 cloze worksheet + answer key from this page", "level this page down to B1", "rewrite reading around football", "5-page vocab pack from this comic", "print-ready class set (A4, name/date header)".
- **Creators**: "translate chapter 3 into ES/FR/DE, keep glossary", "print-ready PDF with bleed".
- **Accessibility**: "alt text + transcript for whole archive".
- **Marketing**: "this comic in 8 languages, brand font".

Why this split works (opinion):

- Free tier is genuinely useful alone: manual cloze + erase + re-letter = worksheet tool with no account, no key. Teachers share free tools -> reach. FOSS stars.
- Free tier has zero marginal cost -> no abuse/cost risk. Passive (`byok-plan.md` O4).
- Paid = time saved (one click vs 20 min of manual edits). Easy upsell: button "Do this automatically (3 credits)" right next to the manual tool.
- **Teachers will not set up an OpenRouter key.** BYOK covers devs/nerds; teachers/tutors need credits (or school-paid). So teacher segment is the main reason to build the credit proxy (stage 3 in `byok-plan.md` O2).
- Open question: free LLM taster (e.g. 3 auto pages on signup) needs accounts + abuse control. Alternative: no taster, show before/after demos instead.

Missing for free tier: printed-text detection, click-to-blank UI, PDF export, print fonts. All non-LLM.

## 4. Segments not to target (opinion)

- **Scanlation groups / manga readers**: free competitors (manga-image-translator 10.5k stars, Koharu), infringement, hosting liability, bad press with creators (= our real payers).
- **Libraries / museums first**: slow procurement, need invoices + DPA. Revisit after creator tier exists.

## 5. Missing features, merged by priority (opinion)

| feature | serves | effort guess |
|---|---|---|
| multi-page project + glossary | creators, translators, publishers, cartoonists | M |
| custom font upload | creators, translators, marketing | S |
| blank/cloze worksheet mode + PDF + answer key | teachers | M |
| empty-bubble one-click (erase only) | teachers, translators | S |
| import/export bubble text (CSV, XLIFF) | translators, publishers | S |
| alt-text / transcript export | accessibility, archives, learners | S |
| same-language re-letter (dyslexia font, simplify) | accessibility, teachers | S |
| layered PSD/SVG export | translators, creators | M-L |
| long-strip (vertical Webtoon) support | creators | M |
| print export (CMYK, bleed, PDF) | publishers, museums, kids' books | L |
| batch to N languages | marketing, cartoonists | M |
| printed-text detection + PDF in/out + print font match | teachers/tutors page adapter | M-L |
| rewrite presets (level, localize, personalize, cloze) | teachers/tutors | S (prompts) |

## Sources

- WEBTOON IR (27M+ creators, ~145M MAU, Q1 2026): https://ir.webtoon.com/
- WEBTOON Q1 2026 call (MAU -5.9%): https://www.marketbeat.com/instant-alerts/webtoon-entertainment-q1-earnings-call-highlights-2026-05-11/
- WEBTOON unified CANVAS, 7 langs: https://www.businesswire.com/news/home/20260326392552/en/WEBTOON-Entertainment-Announces-Unified-International-CANVAS-Platform-Helping-Creators-Grow-Their-Audience-and-Earnings
- WEBTOON 24M creators / 155M MAU Q2 2025: https://careers.werecruit.io/en/naver-france-paris/webtoon
- Tapas creators + shutdown: https://en.wikipedia.org/wiki/Tapas_(website), https://kotaku.com/comics-creators-and-readers-are-reeling-after-the-news-that-tapas-is-shutting-down-2000736552
- Patreon creators: https://influencermarketinghub.com/patreon-stats-revenue-users/, https://backlinko.com/patreon-users
- Pepper&Carrot: https://en.wikipedia.org/wiki/Pepper%26Carrot, https://www.davidrevoy.com/article796/decentralizing-the-book-publishing-of-translations, https://www.peppercarrot.com/en/documentation/010_Translate_the_comic.html
- Comics market: https://www.kenresearch.com/global-comic-books-market, https://www.imarcgroup.com/webtoons-market, https://www.fortunebusinessinsights.com/index.php/webcomics-market-105731
- Franco-Belgian production 2016: https://www.livreshebdo.fr/article/un-marche-de-la-bd-stabilise-selon-le-rapport-ratieracbd-2016
- English teachers / learners: https://forums.eslcafe.com/job/viewtopic.php?p=921481, https://www.internationalteflacademy.com/blog/how-large-is-the-job-market-for-english-teachers-abroad, https://www.internationalteflacademy.com/blog/report-from-tesol-2-billion-english-learners-worldwide
- TPT: https://en.wikipedia.org/wiki/Teachers_Pay_Teachers, https://spencergreenhalgh.com/research/2020-koehler-et-al-tpt/, https://edsurge.com/news/2022-11-28-why-did-we-stop-hearing-about-the-teachers-making-millions-on-teachers-pay-teachers
- Subreddit sizes: https://thehiveindex.com/communities/r-languagelearning/, https://gummysearch.com/r/EnglishLearning
- Duolingo Q3 2025: https://www.boardroomalpha.com/sec/duol-8-k-2025-11-05-0001628280-25-049514/q3fy25duolingo9-30x25share.htm
- Comics in ESL, systematic review: https://hrmars.com/papers_submitted/16910/advantages-and-challenges-of-teaching-graphic-novels-in-english-classrooms-a-systematic-review.pdf
- Storyboard That pricing: https://www.storyboardthat.com/education-plans, https://help.storyboardthat.com/subscription-types/account-types-education-edition
- Lettering rates: https://jimkeefe.com/?p=3644, https://adityab.substack.com/p/strange-animals-27jun2020-money-matters, https://www.animenewsnetwork.com/bbs/phpBB2/viewtopic.php?p=5267550
- Comic translation pricing: https://bel.proz.com/forum/money_matters/358087-translating_graphic_novels.html
- Preply / italki tutors: https://en.wikipedia.org/wiki/Preply, https://www.leonardoenglish.com/blog/italki-vs-preply-vs-cambly-vs-verbling-review, https://storylearning.com/blog/italki-vs-preply
- Tutor subreddits + Preply community: https://gummysearch.com/r/PreplyTutors/, https://gummysearch.com/r/Preply, https://gummysearch.com/r/iTalki, https://preply.com/en/blog/how-the-preply-tutor-community-powers-learner-progress
- Twee: https://twee.com/about, https://aitools-main-fajlzj.laravel.cloud/tools/twee/statistics
- ISLCollective / Wordwall / ESL Printables: https://pdu.itu.edu.tr/educational-technologies/SFL-picks/islcollective, https://fr.semrush.com/website/liveworksheets.com/competitors, https://www.eslprintables.com/?page=18
- AI worksheet tools pricing: https://chalkie.ai/en/blog/ai-worksheet-generator-tools, https://chalkie.ai/en/blog/diffit-alternatives-teachers, https://www.weareteachers.com/ai-worksheet-generators/, https://www.educatorstechnology.com/2026/02/ai-worksheet-generators.html, https://monsha.ai/blog/7-best-ai-worksheet-generator-tools-for-teachers
- Canva for tutors: https://brendacadman.com/how-language-tutors-can-use-canva/
- Edit text in scans: https://www.wps.com/academy/edit-text-in-image-wps-guide-quick-tutorials-1898060/, https://www.pdfreaderpro.com/blog/edit-scanned-pdf, https://www.fiverr.com/hadouch/edit-text-in-scanned-documents-and-screenshots
- Teachers adapting textbooks (Malaysia 2024): https://repo.uum.edu.my/id/eprint/32236/
- HK EDB copying policy: https://www.edb.gov.hk/attachment/en/edu-system/primary-secondary/applicable-to-primary-secondary/it-in-edu/CM/EDBCM18019E-Copyright.pdf
- Teacher FB groups / forums: https://thehiveindex.com/communities/teacher-discussion-forums/, https://thehiveindex.com/communities/foreign-language-teaching/, https://callej.org/index.php/journal/article/view/316
- IATEFL-Hungary: https://digital-skills-jobs.europa.eu/en/community/networking/organisations/angoltanarok-nemzetkozi-egyesulete-magyarorszag
- Language tutoring market: https://meticulousresearch.com/reports/online-language-tutoring-market-5691, https://www.ibisworld.com/united-states/industry/language-instruction/1543/
- Mantra / Orange: https://www.pixivision.net/en/a/7427, https://www.afpbb.com/articles/-/3518256
- Corporate comics (vendor content): https://www.adobe.com/express/learn/blog/comic-strip-maker
