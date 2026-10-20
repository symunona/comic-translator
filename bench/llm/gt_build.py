"""Draft OCR ground truth: Opus per-panel reading, plus a list of boxes where
other strong readers disagree, for manual review. Manual fixes live in
gt-fixes.json ({"<prefix>/rN": "text"}) and win.

    python3 -I bench/llm/gt_build.py <prefix8> ...
"""
import glob, json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from score_ocr import answer_texts, norm

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
REF = "claude-cli_opus"
OTHERS = ["claude-cli_opus:strip", "claude-cli_sonnet", "openrouter_google_gemini-3.8-flash_effort_low", "claude-cli_sonnet:strip"]

def readings(spec, prefix, strip=False):
    out = {}
    pat = "ocr-strip.json" if strip else "ocr-p*.json"
    for f in glob.glob(os.path.join(HERE, "answers", spec, prefix, pat)):
        t, _ = answer_texts(f)
        out.update(t)
    return out

gt, review = {}, []
fixes = json.load(open(os.path.join(HERE, "gt-fixes.json"))) if os.path.exists(os.path.join(HERE, "gt-fixes.json")) else {}
for prefix in sys.argv[1:]:
    sd = glob.glob(os.path.join(ROOT, "data", prefix + "*"))[0]
    order = json.load(open(os.path.join(sd, "stages", "order@v1.json")))
    ref = readings(REF, prefix)
    others = {o: readings(o.split(":")[0], prefix, o.endswith(":strip")) for o in OTHERS}
    for r in order:
        k = f"{prefix}/{r['id']}"
        g = ref.get(r["id"], "")
        gt[k] = fixes.get(k, g)
        alts = {o: v.get(r["id"], "") for o, v in others.items()}
        if k not in fixes and any(norm(a) != norm(g) for a in alts.values()):
            review.append({"key": k, "crop": os.path.join(sd, "debug", "crops", r["id"] + ".png"), "opus": g, **alts})
json.dump(gt, open(os.path.join(HERE, "gt.json"), "w"), ensure_ascii=False, indent=1)
json.dump(review, open(os.path.join(HERE, "gt-review.json"), "w"), ensure_ascii=False, indent=1)
print(len(gt), "boxes,", sum(1 for v in gt.values() if v and v.strip()), "with text,", sum(v is None for v in gt.values()), "skipped,", len(review), "to review")
