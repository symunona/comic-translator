"""Score OCR predictions against bench/llm/gt.json.

Sources: llmbench answers (per panel = ocr-p*, whole strip = ocr-strip, with
drafts = ocr-strip-<engine>), browser bench results, native Paddle results.
Writes bench/results/ocr-v2-<date>.json and prints a table.

    python3 -I bench/llm/score_ocr.py
"""
import glob
import json
import os
import re
import sys
import unicodedata
from datetime import date

HERE = os.path.dirname(os.path.abspath(__file__))
BENCH = os.path.dirname(HERE)
ACCENTS = set("ŐŰÁÉÖÜÍÓÚ")


def norm(s):
    s = unicodedata.normalize("NFC", s or "").upper()
    s = re.sub(r"[“”„\"]", '"', s)
    s = re.sub(r"[‘’`]", "'", s).replace("…", "...").replace("•", "·")
    s = " ".join(s.split())
    return re.sub(r" (?=[!?.,;:])", "", s)


def table(a, b):
    d = [[0] * (len(b) + 1) for _ in range(len(a) + 1)]
    for i in range(len(a) + 1):
        d[i][0] = i
    for j in range(len(b) + 1):
        d[0][j] = j
    for i in range(1, len(a) + 1):
        for j in range(1, len(b) + 1):
            d[i][j] = min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] != b[j - 1]))
    return d


def accent_hits(a, b, d):
    i, j, tot, hit = len(a), len(b), 0, 0
    while i > 0 or j > 0:
        if i > 0 and j > 0 and d[i][j] == d[i - 1][j - 1] + (a[i - 1] != b[j - 1]):
            if a[i - 1] in ACCENTS:
                tot += 1
                hit += a[i - 1] == b[j - 1]
            i, j = i - 1, j - 1
        elif i > 0 and d[i][j] == d[i - 1][j] + 1:
            tot += a[i - 1] in ACCENTS
            i -= 1
        else:
            j -= 1
    return tot, hit


def score(gt, pred):
    a, b = norm(gt), norm(pred)
    d = table(a, b)
    tot, hit = accent_hits(a, b, d)
    return {"chars": len(a), "err": d[len(a)][len(b)], "exact": a == b, "acc_tot": tot, "acc_hit": hit}


def answer_texts(path):
    a = json.load(open(path))
    out = {}
    try:
        j = json.loads(a.get("json") or "null") if isinstance(a.get("json"), str) else a.get("json")
    except Exception:
        j = None
    for r in (j or {}).get("regions", []) if isinstance(j, dict) else []:
        try:
            n = int(r.get("n"))
        except Exception:
            continue
        lines = [l.strip() for l in (r.get("lines") or []) if l and l.strip()]
        out[f"r{n}"] = " ".join(lines) if r.get("kind") != "none" else ""
    return out, a


def collect_llm(gt):
    runs = {}
    strips = {k.split("/")[0] for k in gt}
    for spec_dir in sorted(glob.glob(os.path.join(HERE, "answers", "*"))):
        spec = os.path.basename(spec_dir)
        for strip_dir in glob.glob(os.path.join(spec_dir, "*")):
            prefix = os.path.basename(strip_dir)
            if prefix not in strips:
                continue
            for f in glob.glob(os.path.join(strip_dir, "ocr-*.json")):
                name = os.path.basename(f)[:-5]
                method = "per panel" if re.match(r"ocr-p\d+$", name) else ("whole strip" if name == "ocr-strip" else "fix " + name[len("ocr-strip-"):])
                texts, a = answer_texts(f)
                run = runs.setdefault((spec, method), {"preds": {}, "cost": 0.0, "ms": 0, "calls": 0, "errors": 0, "strips": set()})
                run["cost"] += a.get("costUsd") or 0
                run["ms"] += a.get("ms") or 0
                run["calls"] += 1
                run["errors"] += bool(a.get("error"))
                run["strips"].add(prefix)
                for rid, t in texts.items():
                    run["preds"][f"{prefix}/{rid}"] = t
    return runs


def collect_local(gt):
    runs = {}
    for f in sorted(glob.glob(os.path.join(BENCH, "results", "ocr-*-strips-*.json"))):
        data = json.load(open(f))
        for r in data["runs"]:
            s = r["summary"]
            key = (s["model"], f"browser wasm×{s['threads']}")
            runs[key] = {"preds": {p["id"][:8] + "/" + p["id"].split("/")[1]: p.get("text", "") for p in r["preds"]},
                         "cost": 0.0, "ms": sum(p["ms"] for p in r["preds"]), "calls": 0, "errors": 0, "load": s.get("loadMs"), "mb": s.get("sizeMB")}
    for f in sorted(glob.glob(os.path.join(BENCH, "results", "ocr-native-*.json"))):
        data = json.load(open(f))
        if "crops-multi" not in data.get("cropsDir", ""):
            continue
        for r in data["runs"]:
            runs[(r["model"], "devbox native")] = {"preds": {p["id"][:8] + "/" + p["id"].split("/")[1]: p["text"] for p in r["preds"]},
                                                  "cost": 0.0, "ms": r["msSum"], "calls": 0, "errors": 0, "load": r["loadMs"]}
    return runs


def evaluate(gt, run):
    tot = {"chars": 0, "err": 0, "exact": 0, "acc_tot": 0, "acc_hit": 0, "n": 0, "missed": 0, "invented": 0}
    per = {}
    strips = run.get("strips")
    for k, g in gt.items():
        if g is None or (strips and k.split("/")[0] not in strips):
            continue
        p = run["preds"].get(k)
        if p is None:
            p = ""
        if not g.strip():
            if norm(p):
                tot["invented"] += 1
                tot["err"] += len(norm(p))
            continue
        s = score(g, p)
        per[k] = {"pred": p, **s}
        tot["n"] += 1
        tot["missed"] += not norm(p)
        for f in ("chars", "err", "acc_tot", "acc_hit"):
            tot[f] += s[f]
        tot["exact"] += s["exact"]
    tot["cer"] = tot["err"] / max(tot["chars"], 1)
    tot["accent"] = tot["acc_hit"] / tot["acc_tot"] if tot["acc_tot"] else None
    return tot, per


def main():
    gt = json.load(open(os.path.join(HERE, "gt.json")))
    only = set(sys.argv[1:])
    if only:
        gt = {k: v for k, v in gt.items() if k.split("/")[0] in only}
    runs = {**collect_llm(gt), **collect_local(gt)}
    rows = []
    for (model, method), run in runs.items():
        t, per = evaluate(gt, run)
        ns = len(run.get("strips") or {k.split("/")[0] for k in gt})
        rows.append({"model": model, "method": method, "strips": ns, "costPerStrip": run["cost"] / ns, "msPerStrip": run["ms"] / ns, "cost": run["cost"], "ms": run["ms"], "calls": run["calls"],
                     "errors": run["errors"], "load": run.get("load"), "mb": run.get("mb"), **t, "per": per})
    rows.sort(key=lambda r: r["cer"])
    print(f"{'model':48} {'method':22} {'n':>2} {'CER':>6} {'acc':>5} {'exact':>7} {'miss':>4} {'inv':>4} {'$/strip':>8} {'s/strip':>7} err")
    for r in rows:
        acc = f"{r['accent']*100:4.0f}%" if r["accent"] is not None else "   - "
        print(f"{r['model'][:48]:48} {r['method'][:22]:22} {r['strips']:2} {r['cer']:6.3f} {acc} {r['exact']:3}/{r['n']:<3} {r['missed']:4} {r['invented']:4} {r['costPerStrip']:8.4f} {r['msPerStrip']/1000:7.1f} {r['errors']}")
    out = os.path.join(BENCH, "results", f"ocr-v2-{date.today()}.json")
    json.dump({"date": str(date.today()), "regions": len(gt), "strips": sorted({k.split('/')[0] for k in gt}), "rows": rows}, open(out, "w"), ensure_ascii=False, indent=1)
    print("wrote", out)


if __name__ == "__main__":
    main()
