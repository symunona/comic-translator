"""Blind LLM-judge prompts for translation versions and scene sheets.

    python3 -I bench/llm/judge.py build  <strip-id> [--lang en] [--ref page.jpg ...]
    python3 -I bench/llm/judge.py collect

build writes bench/llm/judge/<id>/llm/judge-tr-<lang>.json and judge-scene.json
(call-log shape) plus a key file mapping blind labels to candidates. Run them
with llmbench -spec claude-cli:opus. collect unblinds the answers into
bench/results/judge-<date>.json.
"""
import glob
import json
import os
import random
import re
import string
import sys
from datetime import date

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
DATA = os.path.join(ROOT, "data")
OUT = os.path.join(HERE, "judge")
ANSWERS = os.path.join(HERE, "answers")

SCHEMA_TR = '{"candidates":{"A":{"accuracy":1,"naturalness":1,"humour":1,"voice":1,"fit":1,"overall":1,"worst":"the single worst problem, quote the region id"}},"ranking":["A","B"],"notes":"what separates the best from the rest"}'
SCHEMA_SCENE = '{"candidates":{"A":{"speakers":1,"jokes":1,"notes":1,"overall":1,"errors":"wrong speaker attributions or misread jokes, with region ids"}},"ranking":["A","B"],"notes":"..."}'


def strip_dir(prefix):
    return glob.glob(os.path.join(DATA, prefix + "*"))[0]


def load(path, default=None):
    try:
        return json.load(open(path))
    except FileNotFoundError:
        return default


def regions(sd):
    return [r for r in load(os.path.join(sd, "stages", "ocr@v1.json"), []) if (r.get("source") or {}).get("text")]


def panels(sd):
    return [os.path.join(sd, "debug", f"{p['id']}.png") for p in sorted(load(os.path.join(sd, "stages", "panels@v1.json")), key=lambda p: p["order"])]


def drafts(sd, lang):
    """Unreviewed translate output per backend: the latest translate log of each model."""
    out = {}
    for f in sorted(glob.glob(os.path.join(sd, "llm", f"translate-{lang}-*.json")), key=lambda f: int(re.search(r"-(\d+)\.json$", f).group(1))):
        log = json.load(open(f))
        if log.get("error") or not log.get("result"):
            continue
        m = re.search(r"\{.*\}", log["result"], re.S)
        try:
            regs = json.loads(m.group(0))["regions"]
        except Exception:
            continue
        model = log.get("model", "?")
        if ":" not in model:
            model = "claude-cli:" + model
        out[model] = {k: v.get("text", "") for k, v in regs.items()}
    return out


def transcript(regs, scene):
    sp = (scene or {}).get("speakers", {})
    lines = []
    for r in regs:
        src = r["source"]
        budget = f"max {int(len(src['text']) * 1.2 + 0.999)} chars"
        lines.append(f"{r['id']} [{r.get('kind','')}; {sp.get(r['id'], r.get('speaker',''))}; {budget}]: {' / '.join(src['lines'])}")
    return "\n".join(lines)


def build(prefix, lang, refs):
    sd = strip_dir(prefix)
    sid = os.path.basename(sd)
    meta = load(os.path.join(sd, "meta.json"))
    src = meta.get("srcLang") or "hu"
    names = {"hu": "Hungarian", "en": "English"}
    regs = regions(sd)
    scene = load(os.path.join(sd, "stages", "scene@v1.json"))
    imgs = panels(sd)
    rng = random.Random(sid + lang)
    os.makedirs(os.path.join(OUT, sid, "llm"), exist_ok=True)
    key = {}

    vers = load(os.path.join(sd, "tr", f"{lang}.versions.json"), {"versions": []})["versions"]
    cands = [(f"{v['id']} {v['label']}", {k: (v["regions"].get(k) or {}).get("text", "") for k in [r["id"] for r in regs]}) for v in vers if v["source"] != "user" or v["label"].startswith("e2e ")]
    for model, d in drafts(sd, lang).items():
        cands.append((f"draft {model}", d))
    rng.shuffle(cands)
    labels = list(string.ascii_uppercase)
    blocks = []
    for lab, (name, texts) in zip(labels, cands):
        key[f"tr-{lang}:{lab}"] = name
        body = "\n".join(f"  {r['id']}: {texts.get(r['id'], '') or '(missing)'}" for r in regs)
        blocks.append(f"Candidate {lab}:\n{body}")
    ref_note = ""
    if refs:
        ref_note = (f"\nThe last {len(refs)} image(s) show the publisher's official {names.get(lang, lang)} edition of the same pages, made by a human translator. "
                    "Use it as a reference for meaning and tone, not as the only correct answer.\n")
    prompt = f"""You are judging comic translations from {names.get(src, src)} into {names.get(lang, lang)}. Images 1-{len(imgs)} are the panels in reading order; red box N marks region rN (the red marks are not part of the comic).
{ref_note}
Source lettering with region id, kind, speaker and the space budget of each bubble:
{transcript(regs, scene)}

Story notes from the editor (may help with jokes and references):
{chr(10).join('- ' + n for n in (scene or {}).get('notes', []))}

{len(cands)} candidate translations of every region follow. They come from different translators; the order is random.

{chr(10).join(blocks)}

Score every candidate from 1 (unusable) to 10 (publishable as is) on:
- accuracy: meaning kept, nothing invented, nothing missing (a missing region is a severe error)
- naturalness: reads as if written in {names.get(lang, lang)}, idiomatic, speakable
- humour: the jokes, puns and punchlines still land
- voice: each character's register, slang and verbal tics carried over consistently
- fit: stays within the bubble budgets
- overall: would you print it

Be strict and consistent across candidates; use the full scale. Rank all candidates best first."""
    out = {"name": f"judge-tr-{lang}", "prompt": prompt + "\n\nReturn ONLY one JSON object matching this shape, no prose and no code fences:\n" + SCHEMA_TR, "images": imgs + refs}
    json.dump(out, open(os.path.join(OUT, sid, "llm", f"judge-tr-{lang}.json"), "w"), ensure_ascii=False, indent=1)

    scenes = []
    prefix8 = sid[:8]
    for f in glob.glob(os.path.join(ANSWERS, "*", prefix8, "scene-0.json")):
        a = json.load(open(f))
        if a.get("json"):
            scenes.append((a["spec"], a["json"] if isinstance(a["json"], dict) else json.loads(a["json"])))
    if scenes:
        rng.shuffle(scenes)
        blocks = []
        for lab, (spec, sc) in zip(labels, scenes):
            key[f"scene:{lab}"] = spec
            sp = "\n".join(f"    {k}: {v}" for k, v in sorted((sc.get("speakers") or {}).items(), key=lambda kv: int(re.sub(r'\D', '', kv[0]) or 0)))
            notes = "\n".join(f"    - {n}" for n in (sc.get("notes") or []))
            blocks.append(f"Candidate {lab}:\n  summary: {sc.get('summary','')}\n  speakers:\n{sp}\n  notes:\n{notes}")
        sprompt = f"""You are checking reference sheets that story editors wrote for translators of a {names.get(src, src)} comic. Images 1-{len(imgs)} are the panels in reading order; red box N marks region rN.

Source lettering:
{transcript(regs, None)}

{len(scenes)} candidate sheets follow, in random order.

{chr(10).join(blocks)}

Look at the panels yourself: follow every bubble tail to its speaker and work out each joke. Then score every candidate from 1 to 10 on:
- speakers: every region attributed to the right character (count the wrong ones)
- jokes: punchlines, wordplay and references explained correctly
- notes: useful to a translator who does not speak {names.get(src, src)}, nothing invented
- overall
Rank all candidates best first."""
        out = {"name": "judge-scene", "prompt": sprompt + "\n\nReturn ONLY one JSON object matching this shape, no prose and no code fences:\n" + SCHEMA_SCENE, "images": imgs}
        json.dump(out, open(os.path.join(OUT, sid, "llm", "judge-scene.json"), "w"), ensure_ascii=False, indent=1)

    keyfile = os.path.join(OUT, sid, "key.json")
    allkeys = load(keyfile, {})
    allkeys.update(key)
    json.dump(allkeys, open(keyfile, "w"), ensure_ascii=False, indent=1)
    print(sid[:8], len(cands), "translations", len(scenes), "scenes")


def collect():
    res = []
    for keyfile in glob.glob(os.path.join(OUT, "*", "key.json")):
        sid = os.path.basename(os.path.dirname(keyfile))
        key = json.load(open(keyfile))
        for f in glob.glob(os.path.join(ANSWERS, "*", sid[:8], "judge-*.json")):
            a = json.load(open(f))
            judge = a.get("spec", "?")
            j = a.get("json")
            if isinstance(j, str):
                j = json.loads(j)
            if not j:
                continue
            kind = os.path.basename(f)[len("judge-"):-5]
            kp = kind.replace("tr-", "tr-") if kind.startswith("tr-") else "scene"
            for lab, s in (j.get("candidates") or {}).items():
                name = key.get(f"{kp}:{lab}")
                rank = (j.get("ranking") or []).index(lab) + 1 if lab in (j.get("ranking") or []) else None
                res.append({"judge": judge, "strip": sid[:8], "kind": kind, "label": lab, "candidate": name, "rank": rank, **s})
            res.append({"judge": judge, "strip": sid[:8], "kind": kind, "notes": j.get("notes")})
    out = os.path.join(ROOT, "bench", "results", f"judge-{date.today()}.json")
    json.dump(res, open(out, "w"), ensure_ascii=False, indent=1)
    agg = {}
    for r in res:
        if not r.get("candidate"):
            continue
        name = r["candidate"]
        kind = "scene" if r["kind"] == "scene" else ("draft" if name.startswith("draft ") else "reviewed")
        backend = name.split(" ", 1)[1] if name.startswith(("draft ", "v")) else name
        a = agg.setdefault((kind, backend, r["judge"]), [])
        a.append(r.get("overall") or 0)
    print(f"{'kind':9} {'backend':42} {'judge':38} n  mean")
    for (kind, backend, judge), v in sorted(agg.items(), key=lambda kv: (kv[0][0], kv[0][2], -sum(kv[1]) / len(kv[1]))):
        print(f"{kind:9} {backend:42} {judge:38} {len(v)} {sum(v)/len(v):5.2f}")
    print("wrote", out)


if __name__ == "__main__":
    if sys.argv[1] == "build":
        args = sys.argv[2:]
        lang = "en"
        refs = []
        if "--lang" in args:
            i = args.index("--lang")
            lang = args[i + 1]
            del args[i:i + 2]
        if "--ref" in args:
            i = args.index("--ref")
            refs = [os.path.abspath(p) for p in args[i + 1:]]
            args = args[:i]
        for p in args:
            build(p, lang, refs)
    else:
        collect()
