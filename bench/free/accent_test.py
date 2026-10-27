import json, re, sys, unicodedata
from collections import defaultdict
D = sys.argv[1]; RUN = sys.argv[2]
def fold(w): return ''.join(c for c in unicodedata.normalize('NFD', w) if unicodedata.category(c) != 'Mn').lower()
def build(path, limit=None):
    cand = defaultdict(dict)
    for i, line in enumerate(open(path, encoding='utf-8')):
        if limit and i >= limit: break
        w, n = line.rsplit(' ', 1); n = int(n)
        if not re.fullmatch(r'[a-záéíóöőúüű]+', w): continue
        cand[fold(w)][w] = cand[fold(w)].get(w, 0) + n
    return cand
def lev(a, b):
    p = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        c = [i]
        for j, cb in enumerate(b, 1): c.append(min(p[j] + 1, c[j - 1] + 1, p[j - 1] + (ca != cb)))
        p = c
    return p[-1]
ACC = set('ŐŰÁÉÖÜÍÓÚ')
norm = lambda s: ' '.join(s.upper().replace('\n', ' ').split())
def fix(text, cand, share):
    def sub(m):
        w = m.group(0); f = fold(w)
        vs = cand.get(f)
        if not vs: return w
        best, n = max(vs.items(), key=lambda x: x[1])
        if n / sum(vs.values()) < share: return w
        return best.upper() if w.isupper() else best
    return re.sub(r'[^\W\d_]+', sub, text)
def score(rows):
    E = N = ka = na = 0
    for t, g in rows:
        t, g = norm(t), norm(g); E += lev(t, g); N += len(g)
        a = sum(c in ACC for c in g); na += a; ka += min(a, sum(c in ACC for c in t))
    return E / N, ka / max(na, 1)
r = json.load(open(RUN))['result']
hu = [s for s in r if s['src'] == 'hu']
pairs = lambda field: [(s[field].get(k, '') or '', g) for s in hu for k, g in s['gt'].items()]
for name, path, lim in [(str(l), f'{D}/hu_full.txt', l) for l in (100000, 200000, 500000)]:
    cand = build(path, lim)
    for field in ['paddle', 'vlmRaw']:
        base = score(pairs(field))
        print(f'{field:7} base           CER {base[0]:.3f} accents {base[1]:.2f}')
        for share in [0.7]:
            s = score([(fix(t, cand, share), g) for t, g in pairs(field)])
            print(f'{field:7} +freq {name:4} {share}  CER {s[0]:.3f} accents {s[1]:.2f}')
