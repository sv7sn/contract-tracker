// Frazionamento: più ordini o RDA ravvicinati, ciascuno sotto la soglia del confronto tra offerte, che insieme la superano.
// Il confronto tra offerte vale per l'acquisto nel suo insieme: dividerlo in più ordini è il modo più comune per evitarlo.
export const SPLIT_WINDOW_DAYS = 30;

export interface SplitItem { id: string; date: string; value: number; label: string }

const day = (d: string) => Date.parse(`${d}T00:00:00Z`) / 864e5;

/** Gruppi (stesso fornitore e categoria, oppure stesso richiedente e internal order) con almeno due elementi entro la finestra,
 *  tutti sotto soglia, per un totale oltre la soglia. */
export function findSplits(groups: Map<string, SplitItem[]>, threshold: number, windowDays = SPLIT_WINDOW_DAYS): { key: string; total: number; from: string; to: string; items: SplitItem[] }[] {
  const out: { key: string; total: number; from: string; to: string; items: SplitItem[] }[] = [];
  for (const [key, all] of groups) {
    const items = all.filter(i => i.value > 0 && i.value <= threshold).sort((a, b) => a.date.localeCompare(b.date));
    let i = 0;
    while (i < items.length) {
      let j = i;
      while (j + 1 < items.length && day(items[j + 1].date) - day(items[i].date) <= windowDays) j++;
      const win = items.slice(i, j + 1), total = win.reduce((a, x) => a + x.value, 0);
      if (win.length >= 2 && total > threshold) { out.push({ key, total: Math.round(total * 100) / 100, from: win[0].date, to: win[win.length - 1].date, items: win }); i = j + 1; }
      else i++;
    }
  }
  return out.sort((a, b) => b.total - a.total);
}
