# Market: who uses + pays for comic-translator (2026-10-21)

Numbers from web search 2026-10-21, sources at bottom. Most are company claims or secondhand: treat as order of magnitude. `unknown` = searched, not found. `did not check` = not searched. Opinion sections labeled.

Product recap: browser-only. Detect bubbles (ONNX) -> OCR (Paddle + cheap LLM) -> scene/context LLM (speakers, jokes) -> translate + review -> erase -> re-letter -> editor -> PNG. ~$0.08/strip. BYOK, AGPL-3.0 (see `byok-plan.md` O1-O4).

## TL;DR

- Manga readers = crowded, free tools, pirate-adjacent. Not the payer.
- Payers = people who **own or license the text** and need **finished pages**: creators, pro translators/letterers, small publishers, syndicated cartoonists, marketing teams.
- Surprise segment with reach: **language teachers**. Same pipeline (OCR + erase + re-letter) makes cloze worksheets. Huge, findable audience (TPT, ISLCollective, FB groups). Low price, high volume.
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
- Mantra / Orange: https://www.pixivision.net/en/a/7427, https://www.afpbb.com/articles/-/3518256
- Corporate comics (vendor content): https://www.adobe.com/express/learn/blog/comic-strip-maker
