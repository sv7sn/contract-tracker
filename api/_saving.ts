import type { Saving, Sourcing } from "../src/types.ts";

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Saving di una scelta del fornitore. Base di calcolo, in ordine di preferenza:
 * 1. prezzo di riferimento (es. valore del contratto precedente) → saving rispetto allo storico;
 * 2. media delle offerte alternative → saving da confronto;
 * 3. prima offerta del fornitore scelto → saving di negoziazione.
 */
export function computeSaving(s: Pick<Sourcing, "quotes" | "baseline" | "finalAmount"> | null | undefined): Saving | null {
  if (!s) return null;
  const chosen = s.quotes.find(q => q.chosen);
  const final = s.finalAmount && s.finalAmount > 0 ? s.finalAmount : chosen?.amount;
  if (!final || final <= 0) return null;
  const others = s.quotes.filter(q => !q.chosen && q.amount > 0);
  const avg = others.length ? others.reduce((a, q) => a + q.amount, 0) / others.length : null;
  const vsBaseline = s.baseline && s.baseline > 0 ? r2(s.baseline - final) : null;
  const vsAverage = avg !== null ? r2(avg - final) : null;
  const negotiation = chosen && s.finalAmount && s.finalAmount > 0 ? r2(chosen.amount - s.finalAmount) : null;
  const [basis, amount, ref] = vsBaseline !== null ? ["baseline", vsBaseline, s.baseline!] as const
    : vsAverage !== null ? ["average", vsAverage, avg!] as const
    : negotiation !== null ? ["negotiation", negotiation, chosen!.amount] as const : [null, 0, 0] as const;
  if (!basis) return null;
  return { finalAmount: r2(final), vsBaseline, vsAverage, negotiation, amount, pct: ref ? Math.round((amount / ref) * 1000) / 10 : 0, basis };
}
