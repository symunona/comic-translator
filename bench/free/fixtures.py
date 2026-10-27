"""Build frontend/.bench/fixtures.json + images for the free-path bench.

python3 -I bench/free/fixtures.py [data-dir]
"""
import json
import os
import shutil
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DATA = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(ROOT), "ocr", "data")
OUT = os.path.join(ROOT, "frontend", ".bench")
GT = json.load(open(os.path.join(ROOT, "bench", "llm", "gt.json")))

os.makedirs(OUT, exist_ok=True)
strips = []
for sid in sorted(os.listdir(DATA)):
    d = os.path.join(DATA, sid)
    trs = [f for f in os.listdir(os.path.join(d, "tr")) if f.endswith("@v1.json")]
    tgt = "en" if "en@v1.json" in trs else trs[0].split("@")[0]
    src = "hu" if tgt == "en" else "en"
    ref = json.load(open(os.path.join(d, "tr", f"{tgt}@v1.json")))["regions"]
    regions = json.load(open(os.path.join(d, "stages", "ocr@v1.json")))
    panels = json.load(open(os.path.join(d, "stages", "panels@v1.json")))
    for r in regions:
        g = GT.get(f"{sid[:8]}/{r['id']}")
        if g is not None and r.get("source"):
            r["source"]["text"] = g
    img = "orig.png"
    shutil.copy(os.path.join(d, img), os.path.join(OUT, f"{sid[:8]}.png"))
    strips.append({"id": sid[:8], "src": src, "lang": tgt, "image": f"{sid[:8]}.png", "panels": panels, "regions": regions,
                   "ref": {k: v["text"] for k, v in ref.items()}})
json.dump(strips, open(os.path.join(OUT, "fixtures.json"), "w"), ensure_ascii=False)
for s in strips:
    n = sum(1 for r in s["regions"] if r.get("source") and r.get("kind") != "none")
    print(s["id"], s["src"], "->", s["lang"], n, "text regions,", len(s["ref"]), "ref")
