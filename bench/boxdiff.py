import json, sys, statistics as st
def load(p):
    return json.load(open(p))
def iou(a, b):
    x1, y1 = max(a[0], b[0]), max(a[1], b[1]); x2, y2 = min(a[2], b[2]), min(a[3], b[3])
    i = max(0, x2 - x1) * max(0, y2 - y1)
    u = (a[2]-a[0])*(a[3]-a[1]) + (b[2]-b[0])*(b[3]-b[1]) - i
    return i / u if u else 0
def dets(r, minscore):
    return {p['panelId']: [d for d in p['detections'] if d['score'] >= minscore] for p in r['panels']}
def compare(ref, oth, minscore=0.35):
    A, B = dets(ref, minscore), dets(oth, minscore)
    na = sum(map(len, A.values())); nb = sum(map(len, B.values()))
    matched, ious, dpx, dsc, unmatched = 0, [], [], [], 0
    for pid, la in A.items():
        lb = list(B.get(pid, []))
        for d in la:
            best = max(lb, key=lambda e: iou(d['box'], e['box']) if e['class'] == d['class'] else -1, default=None)
            if best and best['class'] == d['class'] and iou(d['box'], best['box']) >= 0.5:
                matched += 1; ious.append(iou(d['box'], best['box']))
                dpx.append(max(abs(x - y) for x, y in zip(d['box'], best['box']))); dsc.append(abs(d['score'] - best['score']))
                lb.remove(best)
            else:
                unmatched += 1
    return dict(ref=na, other=nb, matched=matched, unmatchedRef=unmatched,
                minIoU=round(min(ious), 4) if ious else None, maxBoxDiffPx=round(max(dpx), 2) if dpx else None,
                maxScoreDiff=round(max(dsc), 4) if dsc else None)
out = {}
for path in sys.argv[1:]:
    d = load(path)
    runs = [r for r in d['results'] if 'panels' in r]
    ref = next(r for r in runs if r['mode'] == 'wasm:4')
    for r in runs:
        if r is ref: continue
        out[f"{path.split('/')[-1]} {r['mode']}#{r['run']} vs wasm:4#0"] = compare(ref, r)
for k, v in out.items(): print(k, v)
