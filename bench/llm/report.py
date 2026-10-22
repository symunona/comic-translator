"""Build the model-bench artifact page from bench results.

    python3 -I bench/llm/report.py <template.html> <out.html>
"""
import base64
import difflib
import glob
import html
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from score_ocr import norm  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
RES = os.path.join(ROOT, "bench", "results")
esc = html.escape


def latest(p):
    return json.load(open(sorted(glob.glob(os.path.join(RES, p)))[-1]))


ocr = latest("ocr-v2-*.json")
cost = latest("cost-*.json")
judge = latest("judge-*.json")
gt = json.load(open(os.path.join(HERE, "gt.json")))

NICE = {
    "claude-cli_opus": ("Claude Opus 5.5", "claude-cli"),
    "claude-cli_sonnet": ("Claude Sonnet 5.5", "claude-cli"),
    "claude-cli_haiku": ("Claude Haiku 5.5", "claude-cli"),
    "openrouter_google_gemini-3.8-flash_effort_low": ("Gemini 3.8 Flash", "OpenRouter"),
    "openrouter_google_gemini-3.1-flash-lite": ("Gemini 3.1 Flash-Lite", "OpenRouter"),
    "openrouter_z-ai_glm-5.3-flash": ("GLM-5.3 Flash", "OpenRouter"),
    "openrouter_qwen_qwen3.8-flash": ("Qwen3.8 Flash", "OpenRouter"),
    "ollama_bench-gemma4-12b-it-qat-32k_effort_none_json_1_timeout_30m": ("Gemma 4 12B", "ollama on devbox"),
    "paddle-v5-latin": ("PaddleOCR v5 latin", ""),
    "paddle-v6-small": ("PaddleOCR v6 small", ""),
    "paddle-v6-medium": ("PaddleOCR v6 medium", ""),
    "tesseract-hun": ("Tesseract.js hun", ""),
}
METHOD = {
    "per panel": "1 call per panel",
    "whole strip": "1 call per strip",
    "fix paddle": "Paddle draft + crops, 1 call",
    "fix paddle-nocrops": "Paddle draft, no crops, 1 call",
}


def where(model, method):
    if method.startswith("browser"):
        return "browser", method.replace("browser ", "")
    if method == "devbox native":
        return "devbox", "onnxruntime-node"
    n = NICE.get(model, (model, ""))[1]
    return ("devbox", "ollama") if n.startswith("ollama") else ("API", n)


def bar(v, mx, cls, log=False):
    if v is None:
        return ""
    if log:
        w = 0 if v <= 0 else max(2, 100 * (math.log10(v) + 3.5) / (math.log10(mx) + 3.5))
    else:
        w = max(1.5, 100 * v / mx) if mx else 0
    return f'<span class="bar {cls}"><i style="width:{min(w,100):.1f}%"></i></span>'


def ocr_rows():
    rows = [r for r in ocr["rows"] if not (r["model"] == "claude-cli_opus" and r["method"].startswith("fix"))]
    rows = [r for r in rows if not (r["model"].startswith("paddle") and "wasm×1" in r["method"])]
    mx_cer = 0.5
    mx_usd = max(r["costPerStrip"] for r in rows)
    out = []
    for r in sorted(rows, key=lambda r: r["cer"]):
        name, _ = NICE.get(r["model"], (r["model"], ""))
        w, sub = where(r["model"], r["method"])
        meth = METHOD.get(r["method"], "per crop")
        partial = f' <em class="dim">({r["strips"]} of 8 strips)</em>' if r["strips"] < 8 else ""
        hl = ' class="pick"' if (r["model"], r["method"]) in {("openrouter_google_gemini-3.1-flash-lite", "fix paddle"), ("openrouter_google_gemini-3.8-flash_effort_low", "whole strip")} else ""
        cur = ' class="now"' if (r["model"], r["method"]) == ("claude-cli_sonnet", "per panel") else hl
        acc = f"{r['accent']*100:.0f}%" if r.get("accent") is not None else "–"
        usd = "free" if r["costPerStrip"] == 0 else f"${r['costPerStrip']:.4f}"
        out.append(f"""<tr{cur}><th scope="row"><b>{esc(name)}</b><small>{esc(meth)}{partial}</small></th>
<td><span class="where w-{w.lower()}">{esc(w)}</span><small>{esc(sub)}</small></td>
<td class="n">{min(r['cer'],9):.3f}{bar(min(r['cer'], mx_cer), mx_cer, 'cer')}</td>
<td class="n">{acc}</td><td class="n">{r['exact']}/{r['n']}</td><td class="n">{r['missed']}</td>
<td class="n">{usd}{bar(r['costPerStrip'], mx_usd, 'usd', log=True)}</td>
<td class="n">{r['msPerStrip']/1000:.0f} s</td></tr>""")
    return "\n".join(out)


def batch_rows():
    by = {}
    for r in ocr["rows"]:
        if r["strips"] < 8:
            continue
        by.setdefault(r["model"], {})[r["method"]] = r
    out = []
    for m, d in by.items():
        if "per panel" not in d or "whole strip" not in d:
            continue
        p, w = d["per panel"], d["whole strip"]
        better = "whole" if w["cer"] < p["cer"] else ("per panel" if w["cer"] > p["cer"] else "tie")
        out.append(f"""<tr><th scope="row">{esc(NICE[m][0])}</th><td class="n">{p['cer']:.3f}</td><td class="n">{w['cer']:.3f}</td>
<td class="n">${p['costPerStrip']:.4f}</td><td class="n">${w['costPerStrip']:.4f}</td><td class="n">{p['msPerStrip']/1000:.0f} s → {w['msPerStrip']/1000:.0f} s</td><td>{'<b>whole strip</b>' if better=='whole' else ('per panel' if better=='per panel' else 'tie')}</td></tr>""")
    return "\n".join(out)


def diff(g, p):
    a, b = norm(g), norm(p)
    if not b:
        return '<span class="dim">(nothing)</span>'
    out = []
    for op, i1, i2, j1, j2 in difflib.SequenceMatcher(None, a, b, autojunk=False).get_opcodes():
        if op == "equal":
            out.append(esc(b[j1:j2]))
            continue
        if j2 > j1:
            lost = any(c in "ŐŰÁÉÖÜÍÓÚ" for c in a[i1:i2])
            out.append(f'<mark class="{"acc" if lost else "bad"}">{esc(b[j1:j2])}</mark>')
        if op == "delete":
            out.append('<mark class="miss">·</mark>')
    return "".join(out)


def preds(model, method):
    for r in ocr["rows"]:
        if r["model"] == model and r["method"] == method:
            return {k: v["pred"] for k, v in r["per"].items()}
    return {}


def samples():
    picks = ["2afc78b4/r20", "6cbd56cd/r0", "3b343686/r15", "0c0bd5d5/r5", "2afc78b4/r30", "35ce81ab/r0"]
    readers = [("PaddleOCR v5, browser", "paddle-v5-latin", "browser wasm×4"),
               ("Paddle + Flash-Lite fix", "openrouter_google_gemini-3.1-flash-lite", "fix paddle"),
               ("Gemini 3.8 Flash, 1 call", "openrouter_google_gemini-3.8-flash_effort_low", "whole strip"),
               ("Haiku, 1 call", "claude-cli_haiku", "whole strip"),
               ("Sonnet, per panel (now)", "claude-cli_sonnet", "per panel")]
    P = {r[1:]: preds(*r[1:]) for r in readers}
    out = []
    for k in picks:
        prefix, rid = k.split("/")
        crop = glob.glob(os.path.join(ROOT, "data", prefix + "*", "debug", "crops", rid + ".png"))[0]
        b64 = base64.b64encode(open(crop, "rb").read()).decode()
        lines = "".join(f'<li><span class="who">{esc(n)}</span><span class="txt">{diff(gt[k], P[(m, me)].get(k, ""))}</span></li>' for n, m, me in readers)
        out.append(f"""<figure class="sample"><div class="crop"><img src="data:image/png;base64,{b64}" alt="bubble {esc(k)}"></div>
<figcaption><p class="gt"><span class="who">Truth</span><span class="txt">{esc(norm(gt[k]))}</span></p><ol>{lines}</ol></figcaption></figure>""")
    return "\n".join(out)


LABEL = {
    "openrouter:google/gemini-3.8-flash": "Gemini 3.8 Flash", "claude-cli:opus": "Opus 5.5", "claude-cli:sonnet": "Sonnet 5.5",
    "claude-cli:haiku": "Haiku 5.5", "openrouter:deepseek/deepseek-v4.1-flash": "DeepSeek V4.1 Flash",
    "openrouter:openai/gpt-5.6-luna": "GPT-5.6 Luna", "openrouter:qwen/qwen3.7-plus": "Qwen3.7-Plus",
}


def scatter(step, title):
    pts = [r for r in cost if r["step"] == step and r["usdPerStrip"] and r["score"] is not None]
    W, H, L, R, T, B = 560, 300, 46, 20, 16, 40
    xs = [math.log10(r["usdPerStrip"]) for r in pts]
    x0, x1 = math.floor(min(xs) * 2) / 2, math.ceil(max(xs) * 2) / 2
    X = lambda v: L + (math.log10(v) - x0) / (x1 - x0) * (W - L - R)
    Y = lambda s: T + (10 - s) / 10 * (H - T - B)
    g = []
    for s in (0, 2, 4, 6, 8, 10):
        g.append(f'<line x1="{L}" x2="{W-R}" y1="{Y(s):.1f}" y2="{Y(s):.1f}" class="grid"/><text x="{L-8}" y="{Y(s)+4:.1f}" class="tick" text-anchor="end">{s}</text>')
    v = x0
    while v <= x1 + 1e-9:
        usd = 10 ** v
        if abs(v - round(v)) < 1e-9 or abs(v * 2 - round(v * 2)) < 1e-9:
            lab = f"${usd:.3f}" if usd < 0.01 else f"${usd:.2f}"
            g.append(f'<text x="{X(usd):.1f}" y="{H-B+18}" class="tick" text-anchor="middle">{lab}</text>')
        v += 0.5
    marks = []
    placed = []
    for r in sorted(pts, key=lambda r: -r["score"]):
        lab = LABEL.get(r["backend"], r["backend"])
        pick = r["backend"] == "openrouter:google/gemini-3.8-flash"
        now = r["backend"] == "claude-cli:sonnet"
        cls = "pt pick" if pick else ("pt now" if now else "pt")
        cx, cy = X(r["usdPerStrip"]), Y(r["score"])
        anchor = "end" if cx > W - 140 else "start"
        dx = -10 if anchor == "end" else 10
        ly = cy + 4
        width = 7 * len(lab)
        x0b = cx + dx - (width if anchor == "end" else 0)
        while any(abs(ly - py) < 13 and x0b < px1 and x0b + width > px0 for px0, px1, py in placed):
            ly += 13
        placed.append((x0b, x0b + width, ly))
        js = "; ".join(f"{j.split(':')[-1].split('/')[-1]} judge {v['mean']:.1f}" for j, v in r["judges"].items())
        marks.append(f'<g class="{cls}" tabindex="0"><circle cx="{cx:.1f}" cy="{cy:.1f}" r="6"/><text x="{cx+dx:.1f}" y="{ly:.1f}" text-anchor="{anchor}" class="lab">{esc(lab)}</text>'
                     f'<title>{esc(lab)}: ${r["usdPerStrip"]:.4f}/strip, score {r["score"]:.2f} ({esc(js)})</title></g>')
    return f"""<figure class="chart"><svg viewBox="0 0 {W} {H}" role="img" aria-label="{esc(title)}">{''.join(g)}
<text x="{(W+L)/2}" y="{H-4}" class="axis" text-anchor="middle">cost per strip (log scale)</text>
<text x="12" y="{(H-B)/2}" class="axis" transform="rotate(-90 12 {(H-B)/2})" text-anchor="middle">judged quality, 1–10</text>
{''.join(marks)}</svg></figure>"""


def step_rows(step):
    rows = [r for r in cost if r["step"] == step]
    out = []
    for r in sorted(rows, key=lambda r: -(r["score"] or 0)):
        lab = LABEL.get(r["backend"], r["backend"])
        j = r["judges"]
        oj = j.get("claude-cli:opus", {}).get("mean")
        gj = j.get("openrouter:google/gemini-3.8-flash", {}).get("mean")
        note = ""
        if r["errors"]:
            note = f'<small class="warnc">{r["errors"]} failed</small>'
        pick = ' class="pick"' if r["backend"] == "openrouter:google/gemini-3.8-flash" else (' class="now"' if r["backend"] == "claude-cli:sonnet" else "")
        out.append(f"""<tr{pick}><th scope="row">{esc(lab)}{note}</th><td class="n">${r['usdPerStrip']:.4f}</td>
<td class="n">{(oj or 0):.1f}</td><td class="n">{(gj or 0):.1f}</td><td class="n"><b>{r['score']:.2f}</b></td><td class="n">{(r['sPerStrip'] or 0):.0f} s</td></tr>""")
    return "\n".join(out)


def review_rows():
    by = {}
    for r in cost:
        if r["step"] in ("draft", "translate+review") and r["score"] is not None:
            by.setdefault(r["backend"], {})[r["step"]] = r
    out = []
    for b, d in sorted(by.items(), key=lambda kv: -(kv[1].get("translate+review", {}).get("score") or 0)):
        if "draft" not in d or "translate+review" not in d:
            continue
        dd, rr = d["draft"], d["translate+review"]
        delta = rr["score"] - dd["score"]
        out.append(f"""<tr><th scope="row">{esc(LABEL.get(b, b))}</th><td class="n">{dd['score']:.2f}</td><td class="n">{rr['score']:.2f}</td>
<td class="n {'up' if delta > 0.1 else ('down' if delta < -0.1 else '')}">{delta:+.2f}</td><td class="n">${dd['usdPerStrip']:.4f} → ${rr['usdPerStrip']:.4f}</td></tr>""")
    return "\n".join(out)


OFFICIAL = {
    "r0": "Sárgarépa! Nagyon édes vagy, hogy eszedbe jutott elvinni a versenyre!",
    "r1": "Fan-tasz-ti-kus!",
    "r2": "Itt vannak a ruháim, a sapkám… még egy bájitalt is bekészítettél!",
    "r3": "…lássuk, melyiket…",
}


def tr_samples():
    def versions(prefix, lang):
        f = glob.glob(os.path.join(ROOT, "data", prefix + "*", "tr", f"{lang}.versions.json"))[0]
        return {v["label"]: v["regions"] for v in json.load(open(f))["versions"]}

    def ocr_src(prefix):
        f = glob.glob(os.path.join(ROOT, "data", prefix + "*", "stages", "ocr@v1.json"))[0]
        return {r["id"]: r["source"]["text"] for r in json.load(open(f)) if r.get("source")}

    cols = ["claude-cli:sonnet", "openrouter:google/gemini-3.8-flash", "claude-cli:opus", "openrouter:deepseek/deepseek-v4.1-flash", "openrouter:openai/gpt-5.6-luna"]
    blocks = []
    for prefix, lang, rids, title, ref in [
        ("35ce81ab", "hu", ["r0", "r2", "r3"], "Pepper&Carrot E06 p2, English → Hungarian", OFFICIAL),
        ("3b343686", "en", ["r13", "r16", "r17"], "Napirajz “Hatos csavar”, Hungarian → English (pun on ötös / öt)", None),
    ]:
        vs, src = versions(prefix, lang), ocr_src(prefix)
        head = "".join(f"<th scope=\"col\">{esc(LABEL[c])}</th>" for c in cols)
        if ref:
            head = '<th scope="col">Official edition</th>' + head
        rows = []
        for rid in rids:
            cells = "".join(f"<td>{esc((vs.get(c, {}).get(rid) or {}).get('text', '–'))}</td>" for c in cols)
            if ref:
                cells = f'<td class="ref">{esc(ref[rid])}</td>' + cells
            rows.append(f'<tr><th scope="row" class="src">{esc(src.get(rid, ""))}</th>{cells}</tr>')
        blocks.append(f"""<h3>{esc(title)}</h3><div class="scroll"><table class="tr"><thead><tr><th scope="col">source</th>{head}</tr></thead><tbody>{''.join(rows)}</tbody></table></div>""")
    return "\n".join(blocks)


def e2e_rows():
    data = {"7f454423": ("Az izzó liget", 0.0781, 0.3634), "e3d568ca": ("Vödörre", 0.0534, 0.1984)}
    out = []
    for prefix, (name, gc, sc) in data.items():
        rs = [r for r in judge if r.get("strip") == prefix and r.get("candidate")]
        g = [r for r in rs if "e2e" in r["candidate"]]
        s = [r for r in rs if r["candidate"].startswith("v1 ")]
        gj = " / ".join(str(r["overall"]) for r in sorted(g, key=lambda r: r["judge"]))
        sj = " / ".join(str(r["overall"]) for r in sorted(s, key=lambda r: r["judge"]))
        out.append(f'<tr><th scope="row">{esc(name)}</th><td class="n">${gc:.3f}</td><td class="n">{gj}</td><td class="n">${sc:.3f}</td><td class="n">{sj}</td></tr>')
    return "\n".join(out)


def main(tpl, out):
    s = open(tpl).read()
    rep = {
        "{{OCR_ROWS}}": ocr_rows(), "{{BATCH_ROWS}}": batch_rows(), "{{SAMPLES}}": samples(),
        "{{SCENE_CHART}}": scatter("scene", "Scene sheet: quality vs cost"), "{{TR_CHART}}": scatter("translate+review", "Translation: quality vs cost"),
        "{{SCENE_ROWS}}": step_rows("scene"), "{{TR_ROWS}}": step_rows("translate+review"), "{{REVIEW_ROWS}}": review_rows(),
        "{{TR_SAMPLES}}": tr_samples(), "{{E2E_ROWS}}": e2e_rows(), "{{NBOX}}": str(max(r["n"] for r in ocr["rows"])),
    }
    for k, v in rep.items():
        s = s.replace(k, v)
    open(out, "w").write(s)
    print("ok", len(s) // 1024, "KB")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
