// Spesa reale dai file ordini SAP: per fornitore, categoria e funzione, concentrazione, coda lunga,
// copertura contrattuale (accordo quadro SAP o contratto del registro) e ordini senza RDA.
import type { SpendCoverage, SplitCase, SpendGroup, SpendPo, SpendSupplier, SpendView, User } from "../src/types.ts";
import { canSeeBudget } from "./_budget.js";
import { getPool } from "./_db.js";
import { HttpError } from "./_http.js";
import { findSplits, SPLIT_WINDOW_DAYS, type SplitItem } from "./_splits.js";
import { loadRdaSettings } from "./_tasks.js";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const r2 = (n: number) => Math.round(n * 100) / 100;
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);
const ISO = "'^[0-9]{4}-[0-9]{2}-[0-9]{2}'";

/** Funzione dal Master Plan: prima per internal order, poi per centro di costo (versione più recente). */
const FUNC = (col: string) => `(select m.function from mp_lines m join mp_versions v on v.id = m.version_id where m.${col} = l.${col === "io" ? "internal_order" : "cost_center"} and m.function <> '' order by v.year desc, v.version desc limit 1)`;

export async function spendView(user: User, yearIn?: number): Promise<SpendView> {
  if (!canSeeBudget(user)) throw new HttpError(403, "Operazione non consentita");
  const db = getPool();
  const { sourcingThreshold: threshold } = await loadRdaSettings(db);
  const years = (await db.query("select distinct extract(year from doc_date)::int as y from po_lines where doc_date is not null order by 1 desc")).rows.map(r => r.y as number);
  const year = yearIn && years.includes(yearIn) ? yearIn : years[0] ?? null;
  const [range] = (await db.query("select min(doc_date)::text as \"from\", max(doc_date)::text as \"to\", min(first_seen) as first from po_lines")).rows;
  const rows: Row[] = year === null ? [] : (await db.query(`
    select l.*, l.doc_date::text as day,
      case when l.agreement <> '' then 'agreement'
        when l.supplier_code <> '' and exists (select 1 from contracts c join suppliers s on s.id = c.supplier_id where s.sap_code = l.supplier_code
          and c.end_date ~ ${ISO} and c.end_date::date >= l.doc_date and (c.start_date !~ ${ISO} or c.start_date::date <= l.doc_date)) then 'contract'
        else 'none' end as coverage,
      coalesce(case when l.internal_order <> '' then ${FUNC("io")} end, case when l.cost_center <> '' then ${FUNC("cost_center")} end, '') as func,
      (select c.name from category_map cm join categories c on c.id = cm.category_id where cm.kind = 'sap' and cm.key = l.matl_group) as cat_name,
      (select s.id from suppliers s where s.sap_code = l.supplier_code and l.supplier_code <> '' limit 1) as supplier_id
    from po_lines l where extract(year from l.doc_date) = $1`, [year])).rows;

  const eur = rows.filter(r => (r.currency || "EUR") === "EUR");
  const other = rows.filter(r => (r.currency || "EUR") !== "EUR");
  const val = (r: Row) => Number(r.value) || 0;
  const category = (r: Row) => r.cat_name || r.matl_group_desc || r.matl_group || "Non indicata";
  const total = r2(eur.reduce((a, r) => a + val(r), 0));
  const poSet = (rs: Row[]) => new Set(rs.map(r => r.po)).size;

  // Fornitori
  const sup = new Map<string, Row[]>();
  for (const r of eur) { const k = r.supplier_code || r.supplier_name || "—"; const a = sup.get(k) ?? []; a.push(r); sup.set(k, a); }
  const cov = (rs: Row[], c: SpendCoverage) => r2(rs.filter(r => r.coverage === c).reduce((a, r) => a + val(r), 0));
  const bySupplier: SpendSupplier[] = [...sup.entries()].map(([code, rs]) => {
    const value = r2(rs.reduce((a, r) => a + val(r), 0));
    return { code: rs[0].supplier_code, name: rs.find(r => r.supplier_name)?.supplier_name ?? code, supplierId: rs[0].supplier_id ?? null, value, pos: poSet(rs), share: pct(value, total),
      agreement: cov(rs, "agreement"), contract: cov(rs, "contract"), none: cov(rs, "none") };
  }).sort((a, b) => b.value - a.value);
  // Concentrazione e coda lunga: i fornitori oltre l'80% cumulato della spesa.
  let cum = 0, core = 0;
  for (const s of bySupplier) { if (cum < total * 0.8) { core++; cum += s.value; } }
  const tail = bySupplier.slice(core);
  const top = (n: number) => pct(bySupplier.slice(0, n).reduce((a, s) => a + s.value, 0), total);
  const tailValue = r2(tail.reduce((a, s) => a + s.value, 0));

  const group = (key: (r: Row) => string): SpendGroup[] => {
    const m = new Map<string, Row[]>();
    for (const r of eur) { const k = key(r); const a = m.get(k) ?? []; a.push(r); m.set(k, a); }
    return [...m.entries()].map(([label, rs]) => ({ label, value: r2(rs.reduce((a, r) => a + val(r), 0)), pos: poSet(rs), suppliers: new Set(rs.map(r => r.supplier_code || r.supplier_name)).size })).sort((a, b) => b.value - a.value);
  };
  const toPo = (r: Row): SpendPo => ({ po: r.po, item: r.item, docDate: r.day ?? null, supplierCode: r.supplier_code, supplierName: r.supplier_name, value: val(r), valueSource: r.value_source, prValue: Number(r.pr_value) || 0,
    netValue: r.net_value === null ? null : Number(r.net_value), shortText: r.short_text, category: category(r), internalOrder: r.internal_order, costCenter: r.cost_center, pr: r.pr });

  const noRda = eur.filter(r => !r.pr && r.coverage === "none");
  const hasNet = eur.some(r => r.net_value !== null);
  const coverage = { agreement: cov(eur, "agreement"), contract: cov(eur, "contract"), none: cov(eur, "none"), coveredShare: 0 };
  coverage.coveredShare = pct(coverage.agreement + coverage.contract, total);
  const monthly = year === null ? [] : Array.from({ length: 12 }, (_, i) => {
    const month = `${year}-${String(i + 1).padStart(2, "0")}`;
    const rs = eur.filter(r => (r.day ?? "").startsWith(month));
    return { month, value: r2(rs.reduce((a, r) => a + val(r), 0)), pos: poSet(rs) };
  });
  // Frazionamento. Ordini: righe dello stesso PO sommate, poi per fornitore e categoria; le righe già coperte da contratto o accordo non contano.
  const poGroups = new Map<string, SplitItem[]>(), poNames = new Map<string, string>();
  const perPo = new Map<string, Row>();
  for (const r of eur) {
    if (r.coverage !== "none" || !r.day || !r.supplier_code) continue;
    const k = `${r.po}|${r.supplier_code}|${r.matl_group}`; const cur = perPo.get(k);
    if (cur) cur.value = val(cur) + val(r); else perPo.set(k, { ...r, value: val(r) });
  }
  for (const r of perPo.values()) {
    const k = `${r.supplier_code}|${r.matl_group}`; poNames.set(k, `${r.supplier_name || r.supplier_code} · ${category(r)}`);
    const a = poGroups.get(k) ?? []; a.push({ id: r.po, date: r.day, value: val(r), label: r.short_text }); poGroups.set(k, a);
  }
  const cases: SplitCase[] = findSplits(poGroups, threshold).map(c => ({ kind: "po", who: poNames.get(c.key) ?? c.key, detail: "Ordini dello stesso fornitore e categoria", total: c.total, from: c.from, to: c.to, items: c.items }));
  // RDA: per richiedente e internal order (o centro di costo), nell'anno scelto.
  const rdas = (await db.query(`select source_key, title, meta, coalesce(meta->>'releaseDate', created_at::date::text) as d from tasks
    where source = 'rda' and coalesce(done_reason, '') <> 'merged' and extract(year from coalesce((meta->>'releaseDate')::date, created_at::date)) = $1`, [year ?? 0])).rows;
  const rdaGroups = new Map<string, SplitItem[]>();
  for (const t of rdas) {
    const m = t.meta ?? {}; const who = m.requestedBy; const where = Object.keys(m.io ?? {})[0] || m.internalOrder || m.costCenter;
    if (!who || !where) continue;
    const k = `${who}|${where}`; const a = rdaGroups.get(k) ?? []; a.push({ id: t.source_key, date: String(t.d).slice(0, 10), value: Number(m.value) || 0, label: String(t.title ?? "").replace(/^RDA \S+ · /, "") }); rdaGroups.set(k, a);
  }
  for (const c of findSplits(rdaGroups, threshold)) { const [who, where] = c.key.split("|"); cases.push({ kind: "rda", who: `${who} · ${where}`, detail: "RDA dello stesso richiedente e internal order", total: c.total, from: c.from, to: c.to, items: c.items }); }
  cases.sort((a, b) => b.total - a.total);
  // Categorie unificate: budget del Master Plan (versione in uso) contro spesa.
  const cats = (await db.query("select id, name from categories order by name")).rows;
  const categoryBudget = !cats.length || year === null ? [] : await (async () => {
    const mp = (await db.query(`select c.name, sum(m.amount)::float as budget from mp_lines m join mp_versions v on v.id = m.version_id join category_map cm on cm.kind = 'mp' and cm.key = m.category join categories c on c.id = cm.category_id
      where v.year = $1 and v.version = (select max(version) from mp_versions where year = $1) group by c.name`, [year])).rows;
    const spendBy = new Map<string, number>();
    for (const r of eur) if (r.cat_name) spendBy.set(r.cat_name, (spendBy.get(r.cat_name) ?? 0) + val(r));
    return cats.map(c => ({ label: c.name as string, budget: r2(mp.find(m => m.name === c.name)?.budget ?? 0), spend: r2(spendBy.get(c.name) ?? 0) })).filter(c => c.budget || c.spend).sort((a, b) => b.spend - a.spend);
  })();
  const unclassifiedRows = eur.filter(r => !r.cat_name && val(r) > 0);
  const unclassified = { value: r2(unclassifiedRows.reduce((a, r) => a + val(r), 0)), groups: new Set(unclassifiedRows.map(r => r.matl_group || "—")).size };
  const count = (src: string) => eur.filter(r => r.value_source === src).length;

  return {
    year, years, from: range?.from ?? null, to: range?.to ?? null, firstImport: range?.first ? new Date(range.first).toISOString() : null, threshold,
    total, lines: eur.length, pos: poSet(eur), suppliers: bySupplier.length,
    valued: { net: count("net"), pr: count("pr"), gr: count("gr"), none: count("none") },
    otherCurrency: { lines: other.length, currencies: [...new Set(other.map(r => r.currency as string))].sort() },
    concentration: { top1: top(1), top5: top(5), top10: top(10), coreSuppliers: core, tailSuppliers: tail.length, tailValue, tailShare: pct(tailValue, total) },
    coverage, monthly, bySupplier, splits: { windowDays: SPLIT_WINDOW_DAYS, cases }, unclassified, categoryBudget,
    byCategory: group(category),
    byFunction: group(r => r.func || "Non attribuita"),
    noRda: { lines: noRda.length, value: r2(noRda.reduce((a, r) => a + val(r), 0)), items: [...noRda].sort((a, b) => val(b) - val(a)).slice(0, 50).map(toPo) },
    candidates: bySupplier.filter(s => s.none > threshold),
    overRda: { available: hasNet, items: eur.filter(r => r.net_value !== null && Number(r.pr_value) > 0 && Number(r.net_value) > Number(r.pr_value) * 1.01).sort((a, b) => (Number(b.net_value) - Number(b.pr_value)) - (Number(a.net_value) - Number(a.pr_value))).slice(0, 50).map(toPo) },
  };
}

/** Righe d'ordine di un fornitore nell'anno (dettaglio dalla tabella fornitori). */
export async function spendLines(user: User, year: number, supplier: string): Promise<SpendPo[]> {
  if (!canSeeBudget(user)) throw new HttpError(403, "Operazione non consentita");
  const rows = (await getPool().query(`select l.*, l.doc_date::text as day from po_lines l where extract(year from l.doc_date) = $1 and (l.supplier_code = $2 or (l.supplier_code = '' and l.supplier_name = $2))
    order by l.doc_date desc, l.po, l.item limit 500`, [year, supplier])).rows;
  return rows.map(r => ({ po: r.po, item: r.item, docDate: r.day ?? null, supplierCode: r.supplier_code, supplierName: r.supplier_name, value: Number(r.value) || 0, valueSource: r.value_source, prValue: Number(r.pr_value) || 0,
    netValue: r.net_value === null ? null : Number(r.net_value), shortText: r.short_text, category: r.matl_group_desc || r.matl_group || "Non indicata", internalOrder: r.internal_order, costCenter: r.cost_center, pr: r.pr }));
}
