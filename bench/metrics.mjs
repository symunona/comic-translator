export const ACCENTS = new Set([..."ŐŰÁÉÖÜÍÓÚ"]);

export function normalize(s) {
  return (s ?? "")
    .toLocaleUpperCase("hu")
    .replace(/[“”„"]/g, '"')
    .replace(/[‘’`]/g, "'")
    .replace(/…/g, "...")
    .replace(/\s+/g, " ")
    .trim();
}

export function stripPunct(s) {
  return s.replace(/[^\p{L}\p{N} ]/gu, "").replace(/\s+/g, " ").trim();
}

function table(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => {
    const row = new Uint32Array(b.length + 1);
    row[0] = i;
    return row;
  });
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d;
}

export function distance(a, b) {
  return table(a, b)[a.length][b.length];
}

export function accentHits(gt, pred) {
  const a = [...gt], b = [...pred];
  const d = table(a, b);
  let i = a.length, j = b.length, total = 0, hit = 0;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)) {
      if (ACCENTS.has(a[i - 1])) { total++; if (a[i - 1] === b[j - 1]) hit++; }
      i--; j--;
    } else if (i > 0 && d[i][j] === d[i - 1][j] + 1) {
      if (ACCENTS.has(a[i - 1])) total++;
      i--;
    } else j--;
  }
  return { total, hit };
}

export function score(gtRaw, predRaw) {
  const gt = normalize(gtRaw), pred = normalize(predRaw);
  const gc = [...gt], pc = [...pred];
  const gw = gt.split(" ").filter(Boolean), pw = pred.split(" ").filter(Boolean);
  const gn = [...stripPunct(gt)], pn = [...stripPunct(pred)];
  return {
    chars: gc.length,
    charErr: distance(gc, pc),
    words: gw.length,
    wordErr: distance(gw, pw),
    charsNoPunct: gn.length,
    charErrNoPunct: distance(gn, pn),
    exact: gt === pred,
    accents: accentHits(gt, pred),
  };
}

export function summarize(scores) {
  const sum = (k) => scores.reduce((n, s) => n + s[k], 0);
  const acc = scores.reduce((n, s) => ({ total: n.total + s.accents.total, hit: n.hit + s.accents.hit }), { total: 0, hit: 0 });
  return {
    cer: sum("charErr") / sum("chars"),
    wer: sum("wordErr") / sum("words"),
    cerNoPunct: sum("charErrNoPunct") / sum("charsNoPunct"),
    exact: scores.filter((s) => s.exact).length,
    accentAcc: acc.total ? acc.hit / acc.total : null,
    accentTotal: acc.total,
  };
}
