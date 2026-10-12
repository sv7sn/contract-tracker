// Confronto tra due versioni di una bozza: paragrafi aggiunti, tolti e modificati, con le parole cambiate dentro i paragrafi modificati.
export type DiffOp =
  | { type: "same"; a: number; b: number; text: string }
  | { type: "add"; b: number; text: string }
  | { type: "del"; a: number; text: string }
  | { type: "mod"; a: number; b: number; from: string; to: string; words: { t: string; k: "same" | "add" | "del" }[] };

/** Sottosequenza comune più lunga: restituisce le coppie di indici (i, j) uguali. */
function lcs<T>(a: T[], b: T[], eq: (x: T, y: T) => boolean): [number, number][] {
  let lo = 0; while (lo < a.length && lo < b.length && eq(a[lo], b[lo])) lo++;
  let ea = a.length, eb = b.length; while (ea > lo && eb > lo && eq(a[ea - 1], b[eb - 1])) { ea--; eb--; }
  const n = ea - lo, m = eb - lo, out: [number, number][] = [];
  for (let i = 0; i < lo; i++) out.push([i, i]);
  if (n && m) {
    const w = m + 1, dp = new Uint16Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i * w + j] = eq(a[lo + i], b[lo + j]) ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
    let i = 0, j = 0;
    while (i < n && j < m) { if (eq(a[lo + i], b[lo + j])) { out.push([lo + i, lo + j]); i++; j++; } else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) i++; else j++; }
  }
  for (let k = 0; k < a.length - ea; k++) out.push([ea + k, eb + k]);
  return out;
}

const words = (s: string) => s.split(/(\s+)/).filter(Boolean);
const bag = (s: string) => new Set(s.toLowerCase().split(/\W+/).filter(w => w.length > 2));
/** Somiglianza tra due testi (0-1): serve a decidere se un paragrafo tolto e uno aggiunto sono lo stesso paragrafo modificato. */
export function similarity(x: string, y: string): number {
  const a = bag(x), b = bag(y);
  if (!a.size || !b.size) return x.trim() === y.trim() ? 1 : 0;
  let k = 0; for (const w of a) if (b.has(w)) k++;
  return (2 * k) / (a.size + b.size);
}

export function wordDiff(from: string, to: string): { t: string; k: "same" | "add" | "del" }[] {
  const a = words(from), b = words(to), pairs = lcs(a, b, (x, y) => x === y), out: { t: string; k: "same" | "add" | "del" }[] = [];
  let i = 0, j = 0;
  for (const [pi, pj] of pairs) {
    while (i < pi) out.push({ t: a[i++], k: "del" });
    while (j < pj) out.push({ t: b[j++], k: "add" });
    out.push({ t: a[pi], k: "same" }); i = pi + 1; j = pj + 1;
  }
  while (i < a.length) out.push({ t: a[i++], k: "del" });
  while (j < b.length) out.push({ t: b[j++], k: "add" });
  return out;
}

export function diffParas(a: string[], b: string[]): { ops: DiffOp[]; added: number; removed: number; modified: number } {
  const pairs = lcs(a, b, (x, y) => x === y), ops: DiffOp[] = [];
  let i = 0, j = 0, added = 0, removed = 0, modified = 0;
  const flush = (ei: number, ej: number) => {
    const dels: number[] = [], adds: number[] = [];
    while (i < ei) dels.push(i++);
    while (j < ej) adds.push(j++);
    // Un paragrafo tolto e uno aggiunto nello stesso punto, se simili, sono lo stesso paragrafo modificato.
    const used = new Set<number>();
    const mods = new Map<number, number>();
    for (const d of dels) {
      let best = -1, score = 0.4;
      for (const ad of adds) { if (used.has(ad)) continue; const s = similarity(a[d], b[ad]); if (s > score) { score = s; best = ad; } }
      if (best >= 0) { used.add(best); mods.set(d, best); }
    }
    const modTo = new Set(mods.values());
    for (const d of dels) {
      const m = mods.get(d);
      if (m !== undefined) { ops.push({ type: "mod", a: d, b: m, from: a[d], to: b[m], words: wordDiff(a[d], b[m]) }); modified++; }
      else { ops.push({ type: "del", a: d, text: a[d] }); removed++; }
    }
    for (const ad of adds) if (!modTo.has(ad)) { ops.push({ type: "add", b: ad, text: b[ad] }); added++; }
  };
  for (const [pi, pj] of pairs) { flush(pi, pj); ops.push({ type: "same", a: pi, b: pj, text: a[pi] }); i = pi + 1; j = pj + 1; }
  flush(a.length, b.length);
  return { ops, added, removed, modified };
}
