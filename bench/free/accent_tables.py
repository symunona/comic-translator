"""Build per-language accent tables from FrequencyWords (OpenSubtitles 2018) and score them.

python3 -I bench/free/accent_tables.py <cache-dir> <out-dir> [--top 500000] [--langs hu,cs,...]

A table lists, per unaccented word, its most frequent accented spelling when that
spelling has >= SHARE of the uses. One accented word per line; the app folds
each line to get the key. Score (in-sample, word tokens weighted by frequency
over the whole list, so the tail beyond --top counts as misses):
  baseline = tokens already right with all accents stripped
  restored = tokens right after restoring from the table
  recall   = share of accented tokens the table gets right
Writes <out-dir>/<lang>.txt and <out-dir>/stats.json.
"""
import gzip
import json
import os
import re
import sys
import unicodedata
import urllib.request
from collections import defaultdict

SHARE = 0.7
URL = "https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/{0}/{0}_full.txt"
# Latin-script languages with letters beyond a-z. FrequencyWords code -> app code.
LANGS = {
    "hu": "hu", "cs": "cs", "sk": "sk", "pl": "pl", "de": "de", "fr": "fr", "es": "es", "pt": "pt", "pt_br": "pt-BR",
    "it": "it", "ro": "ro", "hr": "hr", "bs": "bs", "sr": "sr", "sl": "sl", "tr": "tr", "vi": "vi", "lt": "lt", "lv": "lv",
    "et": "et", "fi": "fi", "is": "is", "ca": "ca", "gl": "gl", "da": "da", "sv": "sv", "no": "nb", "nl": "nl", "sq": "sq",
    "eo": "eo", "af": "af", "eu": "eu",
}
# Letters NFD does not split into base + mark. Must match FOLD in frontend/src/lib/free/accents.ts.
FOLD = {"ł": "l", "đ": "d", "ø": "o", "ß": "ss", "æ": "ae", "œ": "oe", "ı": "i", "ħ": "h", "ŀ": "l"}
WORD = re.compile(r"[^\W\d_]+")


def fold(w):
    w = "".join(FOLD.get(c, c) for c in w.lower())
    return "".join(c for c in unicodedata.normalize("NFD", w) if unicodedata.category(c) != "Mn")


def download(lang, cache):
    path = os.path.join(cache, f"{lang}_full.txt")
    if not os.path.exists(path):
        urllib.request.urlretrieve(URL.format(lang), path + ".part")
        os.rename(path + ".part", path)
    return path


def counts(path):
    for line in open(path, encoding="utf-8"):
        w, _, n = line.rstrip("\n").rpartition(" ")
        if w and n.isdigit() and WORD.fullmatch(w):
            yield w.lower(), int(n)


def build(lang, cache, out, top):
    path = download(lang, cache)
    groups = defaultdict(lambda: defaultdict(int))
    for i, (w, n) in enumerate(counts(path)):
        if i >= top:
            break
        groups[fold(w)][w] += n
    table = {}
    for f, vs in groups.items():
        best, n = max(vs.items(), key=lambda x: x[1])
        if best != f and n / sum(vs.values()) >= SHARE:
            table[f] = best
    total = base = restored = accented = hit = 0
    for w, n in counts(path):
        f = fold(w)
        total += n
        base += n * (w == f)
        restored += n * (table.get(f, f) == w)
        if w != f:
            accented += n
            hit += n * (table.get(f) == w)
    body = "\n".join(table[f] for f in sorted(table))
    code = LANGS[lang]
    head = (
        f"# {code} accent table: most frequent accented spelling per unaccented word (>= {SHARE:.0%} of uses), top {top} words.\n"
        "# Derived from FrequencyWords (OpenSubtitles 2018) by Hermit Dave, CC BY-SA 4.0: https://github.com/hermitdave/FrequencyWords. This file is CC BY-SA 4.0 too.\n"
    )
    data = (head + body).encode()
    open(os.path.join(out, f"{code}.txt"), "wb").write(data)
    return {
        "lang": code, "entries": len(table), "bytes": len(data), "gzip": len(gzip.compress(data, 9)),
        "accented": accented / total, "baseline": base / total, "restored": restored / total, "recall": hit / max(accented, 1),
    }


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    opt = lambda k, d: sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d
    cache, out = args[0], args[1]
    top = int(opt("--top", "500000"))
    langs = opt("--langs", ",".join(LANGS)).split(",")
    os.makedirs(cache, exist_ok=True)
    os.makedirs(out, exist_ok=True)
    stats = []
    for lang in langs:
        try:
            s = build(lang, cache, out, top)
        except Exception as e:
            print(f"{lang}: {e}", file=sys.stderr)
            continue
        stats.append(s)
        print(f"{s['lang']:6} accented {s['accented']:6.1%}  words right: {s['baseline']:6.1%} -> {s['restored']:6.1%}  accent recall {s['recall']:6.1%}  {s['entries']:7} entries  {s['gzip'] / 1e6:5.2f} MB gz", flush=True)
    json.dump(stats, open(os.path.join(out, "stats.json"), "w"), indent=1)


main()
