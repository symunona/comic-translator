"""Blind per-bubble judge for free-path runs.

python3 -I bench/free/judge.py <run.json> <out.json> sys1 sys2 ... [--model opus]

Per strip one claude-cli call. Each candidate system gets 0/1/2 per bubble:
2 usable (meaning right, a reader follows the strip), 1 gist (partly right or
needs effort), 0 wrong (nonsense, wrong meaning, empty, untranslated).
"""
import json
import random
import string
import subprocess
import sys

args = [a for a in sys.argv[1:] if not a.startswith("--")]
model = sys.argv[sys.argv.index("--model") + 1] if "--model" in sys.argv else "opus"
if "--model" in sys.argv:
    args.remove(model)
run_path, out_path, systems = args[0], args[1], args[2:]
run = json.load(open(run_path))["result"]
NAMES = {"hu": "Hungarian", "en": "English", "de": "German"}

PROMPT = """You grade machine translations of comic-strip speech bubbles, one bubble at a time.

Source language: {src}. Target language: {tgt}.
For each bubble you get the original text (ground truth), a reference translation written by a strong model (for orientation only: candidates do not need to match its wording), and {n} anonymous candidates {labels}.

Score every candidate on every bubble:
- 2 = usable: the meaning is right and a reader of the comic would follow the story. Wording may be clumsy, a pun may be lost.
- 1 = gist: partly right, or understandable only with effort, or one key detail is wrong.
- 0 = wrong: wrong meaning, nonsense, empty, or left untranslated.

Judge each bubble in context of the whole strip. Be strict and consistent.

Bubbles:
{bubbles}

Reply with JSON only, no prose:
{{"scores": {{"<bubble id>": {{{example}}}}}, "notes": "one or two sentences on the main failure modes"}}"""

results = []
for s in run:
    ids = list(s["gt"].keys())
    if not ids:
        continue
    rng = random.Random(s["id"])
    order = systems[:]
    rng.shuffle(order)
    labels = dict(zip(string.ascii_uppercase, order))
    lines = []
    for rid in ids:
        lines.append(f"[{rid}] original: {json.dumps(s['gt'][rid], ensure_ascii=False)}")
        lines.append(f"     reference: {json.dumps(s['ref'].get(rid, ''), ensure_ascii=False)}")
        for lab, sysname in labels.items():
            c = s.get(sysname, {})
            t = c.get(rid, "") if isinstance(c, dict) else ""
            lines.append(f"     {lab}: {json.dumps(t, ensure_ascii=False)}")
    prompt = PROMPT.format(src=NAMES.get(s["src"], s["src"]), tgt=NAMES.get(s["lang"], s["lang"]), n=len(labels), labels=", ".join(labels),
                           bubbles="\n".join(lines), example=", ".join(f'"{l}": 0' for l in labels))
    for attempt in range(3):
        p = subprocess.run(["claude", "-p", "--model", model], input=prompt, capture_output=True, text=True, timeout=900)
        txt = p.stdout.strip()
        try:
            ans = json.loads(txt[txt.index("{"): txt.rindex("}") + 1])
            break
        except ValueError:
            print("retry", s["id"], txt[:200], file=sys.stderr)
    else:
        raise SystemExit(f"judge failed on {s['id']}")
    per = {sysname: {} for sysname in systems}
    for rid, sc in ans["scores"].items():
        for lab, v in sc.items():
            if lab in labels:
                per[labels[lab]][rid] = int(v)
    results.append({"id": s["id"], "src": s["src"], "lang": s["lang"], "labels": labels, "scores": per, "notes": ans.get("notes", "")})
    print(s["id"], {k: f"{sum(v.values())}/{2 * len(ids)}" for k, v in per.items()}, file=sys.stderr)
    json.dump({"run": run_path, "model": model, "systems": systems, "strips": results}, open(out_path, "w"), ensure_ascii=False, indent=1)

def summary(filter_fn, label):
    for sysname in systems:
        vals = [v for r in results if filter_fn(r) for v in r["scores"][sysname].values()]
        if not vals:
            continue
        print(f"{label:8} {sysname:22} score {100 * sum(vals) / (2 * len(vals)):5.1f}%  usable {100 * vals.count(2) / len(vals):5.1f}%  wrong {100 * vals.count(0) / len(vals):5.1f}%  n={len(vals)}")

summary(lambda r: True, "all")
summary(lambda r: r["src"] == "hu", "hu->en")
summary(lambda r: r["src"] == "en", "en->hu")
