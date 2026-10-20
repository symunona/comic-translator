"""Per-step cost and quality per backend, for the cost-optimization report.

    python3 -I bench/llm/costs.py   -> bench/results/cost-<date>.json
"""
import glob
import json
import os
import statistics
from datetime import date

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
DATA = os.path.join(ROOT, "data")
STRIPS_TR = {"6cbd56cd": "en", "3b343686": "en", "0c0bd5d5": "en", "89371298": "hu", "35ce81ab": "hu", "8f3737ae": "hu", "246d3aa3": "hu"}
SCENE_STRIPS = ["6cbd56cd", "3b343686", "0c0bd5d5"]


def latest(pattern):
    files = sorted(glob.glob(os.path.join(ROOT, "bench", "results", pattern)))
    return json.load(open(files[-1])) if files else None


def mean(xs):
    xs = [x for x in xs if x is not None]
    return statistics.mean(xs) if xs else None


def spec_backend(spec):
    return spec.split("?")[0]


def main():
    judge = latest("judge-*.json") or []
    scores = {}
    for r in judge:
        if not r.get("candidate"):
            continue
        name = r["candidate"]
        if r["kind"] == "scene":
            kind, backend = "scene", spec_backend(name)
        elif name.startswith("draft "):
            kind, backend = "draft", name[6:]
        else:
            kind, backend = "translate+review", name.split(" ", 1)[1]
        scores.setdefault((kind, backend), {}).setdefault(r["judge"], []).append(r.get("overall"))

    costs = {}
    for prefix, lang in STRIPS_TR.items():
        sd = glob.glob(os.path.join(DATA, prefix + "*"))[0]
        vs = json.load(open(os.path.join(sd, "tr", f"{lang}.versions.json")))
        for v in vs["versions"]:
            if v["source"] == "user" or not v.get("usage"):
                continue
            c = costs.setdefault(("translate+review", v["model"]), {"usd": [], "ms": [], "out": [], "errors": 0})
            c["usd"].append(v["usage"]["costUsd"])
            c["ms"].append(v["usage"]["durationMs"])
            c["out"].append(v["usage"]["tokens"]["output_tokens"])
            if v.get("reviewError"):
                c["errors"] += 1
        for f in glob.glob(os.path.join(sd, "llm", f"translate-{lang}-*.json")):
            log = json.load(open(f))
            model = log.get("model", "")
            model = model if ":" in model else "claude-cli:" + model
            if log.get("error"):
                costs.setdefault(("draft", model), {"usd": [], "ms": [], "out": [], "errors": 0})["errors"] += 1
                continue
            c = costs.setdefault(("draft", model), {"usd": [], "ms": [], "out": [], "errors": 0})
            c["usd"].append(log.get("costUsd") or 0)
            c["out"].append(((log.get("usage") or {}).get("output_tokens")))
    for prefix in SCENE_STRIPS:
        for f in glob.glob(os.path.join(HERE, "answers", "*", prefix, "scene-0.json")):
            a = json.load(open(f))
            c = costs.setdefault(("scene", spec_backend(a["spec"])), {"usd": [], "ms": [], "out": [], "errors": 0})
            if a.get("error"):
                c["errors"] += 1
                continue
            c["usd"].append(a.get("costUsd") or 0)
            c["ms"].append(a.get("ms"))
            c["out"].append((a.get("usage") or {}).get("output_tokens"))

    rows = []
    for key in sorted(set(scores) | set(costs)):
        kind, backend = key
        c = costs.get(key, {"usd": [], "ms": [], "out": [], "errors": 0})
        s = scores.get(key, {})
        rows.append({
            "step": kind, "backend": backend,
            "usdPerStrip": mean(c["usd"]), "sPerStrip": (mean(c["ms"]) or 0) / 1000 if c["ms"] else None,
            "outTokens": mean(c["out"]), "runs": len(c["usd"]), "errors": c["errors"],
            "judges": {j: {"mean": mean(v), "n": len(v)} for j, v in s.items()},
            "score": mean([mean(v) for v in s.values()]),
        })
    out = os.path.join(ROOT, "bench", "results", f"cost-{date.today()}.json")
    json.dump(rows, open(out, "w"), indent=1)
    for r in sorted(rows, key=lambda r: (r["step"], -(r["score"] or 0))):
        usd = f"{r['usdPerStrip']:.4f}" if r["usdPerStrip"] is not None else "   -  "
        sc = f"{r['score']:.2f}" if r["score"] is not None else "  - "
        js = " ".join(f"{j.split(':')[-1][:14]}={v['mean']:.2f}" for j, v in r["judges"].items())
        print(f"{r['step']:17} {r['backend']:42} ${usd} {sc} runs={r['runs']} err={r['errors']} {js}")
    print("wrote", out)


if __name__ == "__main__":
    main()
