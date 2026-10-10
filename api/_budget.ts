// Master Plan (MP26, MP27…): budget annuale per internal order, caricato da Finance in più versioni durante l'anno.
// La prima versione dell'anno resta il riferimento per il "saving verso budget"; l'ultima dà il budget corrente.
import type { BudgetItem, BudgetLine, BudgetView, MpVersion, User } from "../src/types.ts";
import { getPool, inTransaction } from "./_db.js";
import { HttpError } from "./_http.js";
import { parseSheet } from "./_sap-files.js";
import { isXlsx, parseCsvRows, parseXlsx } from "./_xlsx.js";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const bad = (msg: string): never => { throw new HttpError(400, msg); };
const r2 = (n: number) => Math.round(n * 100) / 100;
export const canSeeBudget = (u: User) => u.role === "manager" || u.role === "buyer" || u.role === "finance";
export const canUploadBudget = (u: User) => u.role === "manager" || u.role === "finance";

// ─── Lettura del file di Finance ─────────────────────────────
const norm = (s: string | null | undefined) => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const HEADERS: Record<string, string[]> = {
  io: ["internalorder", "io", "ordineinterno", "order", "ordine", "codiceio", "internalordercode", "ordernumber", "rowlabels", "etichettediriga"],
  amount: ["budget", "importo", "amount", "valore", "value", "totale", "total", "budgetannuale", "importobudget", "budgeteur", "importoeur"],
  description: ["descrizione", "description", "desc", "oggetto", "descrizioneio", "iodescription", "name", "nome"],
  function: ["funzione", "function", "area", "dipartimento", "department", "direzione", "ente", "cdcname", "costcentername", "nomecdc"],
  costCenter: ["centrodicosto", "costcenter", "cdc", "costctr", "centrocosto"],
  glAccount: ["conto", "glaccount", "gl", "contocontabile", "account", "glacct", "natura"],
  category: ["categoria", "category", "famiglia", "categoriamerceologica"],
};
/** Colonne che sono versioni del Master Plan: "MP26" (prima versione) e le revisioni "R3", "R5", "Rev 2", "FC1"… */
const VERSION_COL = /^(mp\d{2}(\d{2})?|r\d{1,2}|rev\d{1,2}|fc\d{0,2}|forecast\d{0,2})$/;
/** Importi italiani o internazionali: "1.234,56", "1,234.56", "61,000", "1234.56", "€ 1.000". */
export function parseAmount(v: string | null): number | null {
  if (!v) return null;
  let s = v.replace(/[€\s]/g, "").replace(/^EUR|EUR$/i, "");
  if (!s || s === "-") return null;
  const neg = /^\(.*\)$/.test(s) || s.startsWith("-"); s = s.replace(/[()-]/g, "");
  if (s.includes(",") && s.includes(".")) s = s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  else if (/^\d{1,3}(,\d{3})+$/.test(s)) s = s.replace(/,/g, ""); // 61,000 = sessantunomila (separatore delle migliaia)
  else if (s.includes(",")) s = s.replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  const n = Number(s);
  return Number.isFinite(n) ? (neg ? -n : n) : null;
}
export interface ParsedLine { io: string; description: string; function: string; costCenter: string; glAccount: string; category: string; amount: number }
export interface ParsedBudget { versions: { label: string; lines: ParsedLine[] }[]; year: number | null }
const TOTAL_ROW = /^(totale|total|grandtotal|totalegenerale|totalecomplessivo)/;
/**
 * Trova l'intestazione (entro le prime 20 righe) e legge le righe; più righe con lo stesso internal order si sommano.
 * Se ci sono colonne di versione (MP26, R3, R5…) ognuna diventa una versione; altrimenti si usa la colonna "Budget".
 */
export function parseBudget(rows: (string | null)[][]): ParsedBudget {
  let h = -1, cols: Record<string, number> = {}, vcols: { label: string; i: number }[] = [];
  for (let i = 0; i < Math.min(rows.length, 20) && h < 0; i++) {
    const c: Record<string, number> = {}, vc: { label: string; i: number }[] = [];
    rows[i].forEach((cell, j) => {
      const k = norm(cell);
      if (VERSION_COL.test(k)) { vc.push({ label: (cell ?? "").trim().toUpperCase().replace(/\s+/g, " "), i: j }); return; }
      for (const [key, names] of Object.entries(HEADERS)) if (c[key] === undefined && names.includes(k)) c[key] = j;
    });
    if (c.io !== undefined && (vc.length || c.amount !== undefined)) { h = i; cols = c; vcols = vc; }
  }
  if (h < 0) bad("Non trovo le colonne: servono l'internal order (\"Internal order\" o \"Row Labels\") e il budget (\"Budget\", oppure le colonne MP26, R3, R5…). Scarica il modello per vedere il formato");
  const get = (r: (string | null)[], i: number | undefined) => (i === undefined ? "" : (r[i] ?? "").trim());
  const amountCols = vcols.length ? vcols : [{ label: "", i: cols.amount }];
  const by = amountCols.map(() => new Map<string, ParsedLine>());
  for (const r of rows.slice(h + 1)) {
    const io = get(r, cols.io).replace(/\s+/g, "");
    if (!io || TOTAL_ROW.test(norm(io))) continue;
    const base = { io: io.slice(0, 40), description: get(r, cols.description).slice(0, 300), function: get(r, cols.function).slice(0, 120), costCenter: get(r, cols.costCenter).slice(0, 40), glAccount: get(r, cols.glAccount).slice(0, 40), category: get(r, cols.category).slice(0, 120) };
    amountCols.forEach((c, k) => {
      const amount = parseAmount(get(r, c.i));
      if (amount === null) return;
      const cur = by[k].get(io);
      if (cur) cur.amount = r2(cur.amount + amount); else by[k].set(io, { ...base, amount: r2(amount) });
    });
  }
  const mp = vcols.find(v => /^MP\d/.test(v.label));
  const yy = mp ? Number(mp.label.replace(/\D/g, "")) : NaN;
  return {
    versions: amountCols.map((c, k) => ({ label: c.label, lines: [...by[k].values()] })).filter(v => v.lines.length),
    year: Number.isFinite(yy) ? (yy < 100 ? 2000 + yy : yy) : null,
  };
}
/** Compatibilità: righe della sola colonna di budget (o della prima versione). */
export function parseBudgetRows(rows: (string | null)[][]): ParsedLine[] { return parseBudget(rows).versions[0]?.lines ?? []; }
function readRows(data: Uint8Array): (string | null)[][] {
  if (isXlsx(data)) return parseXlsx(data);
  const head = new TextDecoder("utf-8").decode(data.subarray(0, 400));
  if (/<\?xml|<Workbook/.test(head) || data.subarray(0, 400).includes(0)) return parseSheet(data);
  if (data[0] === 0xd0 && data[1] === 0xcf) bad("Il file è nel vecchio formato Excel .xls: salvalo come .xlsx (o CSV) e ricaricalo");
  return parseCsvRows(new TextDecoder("utf-8").decode(data).replace(/^\uFEFF/, ""));
}

export interface BudgetImport { year: number; created: MpVersion[]; updated: MpVersion[] }
/**
 * Carica il file di Finance. Con le colonne di versione (MP26, R3, R5…) ogni colonna è una versione: quelle già presenti
 * si aggiornano, le nuove si aggiungono in ordine. Con una sola colonna "Budget" si aggiunge una nuova versione.
 */
export async function importBudget(user: User, yearIn: number, label: string, fileName: string, data: Uint8Array): Promise<BudgetImport> {
  if (!canUploadBudget(user)) throw new HttpError(403, "Il Master Plan lo caricano Manager e Finance");
  if (!data.length) bad("Il file è vuoto");
  if (data.length > 8 * 1024 * 1024) bad("Il file è troppo grande");
  const parsed = parseBudget(readRows(data));
  if (!parsed.versions.length) bad("Nessuna riga di budget trovata nel file");
  const year = parsed.year ?? yearIn;
  if (!Number.isInteger(year) || year < 2020 || year > 2100) bad("Anno non valido");
  const multi = parsed.versions.some(v => v.label);
  if (fileName !== "simulazione-master-plan.csv" && (await getPool().query("select 1 from mp_versions where year = $1 and file_name = 'simulazione-master-plan.csv' limit 1", [year])).rows.length)
    throw new HttpError(409, `Per il ${year} è caricata la simulazione: eliminala (pulsante in alto) prima di caricare il Master Plan vero`);
  return inTransaction(async db => {
    const out: BudgetImport = { year, created: [], updated: [] };
    for (const pv of parsed.versions) {
      const lab = (multi ? pv.label : label.trim()).slice(0, 60);
      const existing = multi ? (await db.query("select * from mp_versions where year = $1 and upper(label) = upper($2)", [year, lab])).rows[0] : undefined;
      let v: Row;
      if (existing) {
        v = (await db.query("update mp_versions set file_name = $2, uploaded_by = $3, uploaded_at = now() where id = $1 returning *", [existing.id, fileName.slice(0, 200), user.name])).rows[0];
        await db.query("delete from mp_lines where version_id = $1", [v.id]);
      } else {
        const n = ((await db.query("select coalesce(max(version), 0)::int as n from mp_versions where year = $1", [year])).rows[0].n as number) + 1;
        v = (await db.query("insert into mp_versions (year, version, label, file_name, uploaded_by) values ($1,$2,$3,$4,$5) returning *", [year, n, lab || `MP${String(year).slice(2)} v${n}`, fileName.slice(0, 200), user.name])).rows[0];
      }
      for (let i = 0; i < pv.lines.length; i += 1000) {
        const p = pv.lines.slice(i, i + 1000);
        await db.query(`insert into mp_lines (version_id, io, description, function, cost_center, gl_account, category, amount)
          select $1, * from unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::numeric[])`,
          [v.id, p.map(l => l.io), p.map(l => l.description), p.map(l => l.function), p.map(l => l.costCenter), p.map(l => l.glAccount), p.map(l => l.category), p.map(l => l.amount)]);
      }
      const total = r2(pv.lines.reduce((a, l) => a + l.amount, 0));
      const info: MpVersion = { id: v.id, year, version: v.version, label: v.label, fileName: v.file_name, uploadedBy: user.name, uploadedAt: new Date(v.uploaded_at).toISOString(), lines: pv.lines.length, total };
      (existing ? out.updated : out.created).push(info);
      await db.query("insert into config_audit (actor, area, action, subject, detail) values ($1,'budget',$2,$3,$4)", [user.name, existing ? "update" : "create", v.label, `${existing ? "Aggiornata" : "Caricata"} la versione ${v.label} del Master Plan ${year} (n. ${v.version}): ${pv.lines.length} internal order, totale ${Math.round(total).toLocaleString("it-IT")} €`]);
    }
    return out;
  });
}

export async function deleteBudgetVersion(user: User, id: number): Promise<void> {
  if (!canUploadBudget(user)) throw new HttpError(403, "Operazione non consentita");
  const v = (await getPool().query("select * from mp_versions where id = $1", [id])).rows[0];
  if (!v) throw new HttpError(404, "Versione non trovata");
  const last = (await getPool().query("select max(version)::int as n from mp_versions where year = $1", [v.year])).rows[0].n;
  if (v.version !== last) throw new HttpError(409, "Si può eliminare solo l'ultima versione caricata");
  await getPool().query("delete from mp_versions where id = $1", [id]);
  await getPool().query("insert into config_audit (actor, area, action, subject, detail) values ($1,'budget','delete',$2,$3)", [user.name, v.label, `Eliminata la versione ${v.version} del Master Plan ${v.year}`]);
}

// ─── Impegni ─────────────────────────────────────────────────
const yearOf = (d: unknown) => { const t = d ? new Date(d as string) : null; return t && !Number.isNaN(t.getTime()) ? t.getUTCFullYear() : null; };
/** Valore della pratica per internal order: dalle righe SAP, oppure dall'internal order indicato a mano. */
const ioSplit = (t: Row): Record<string, number> => {
  const m = t.meta ?? {};
  if (m.io && Object.keys(m.io).length) return m.io;
  return m.internalOrder ? { [m.internalOrder]: Number(m.value ?? 0) } : {};
};
/** Quota di un contratto che cade nell'anno, in proporzione ai giorni. */
function contractQuota(c: Row, year: number): number {
  const end = new Date(`${c.end_date}T00:00:00Z`);
  const start = c.start_date ? new Date(`${c.start_date}T00:00:00Z`) : new Date(end.getTime() - 365 * 864e5);
  const total = (end.getTime() - start.getTime()) / 864e5 + 1;
  if (!(total > 0)) return 0;
  const ys = Date.UTC(year, 0, 1), ye = Date.UTC(year, 11, 31);
  const days = (Math.min(end.getTime(), ye) - Math.max(start.getTime(), ys)) / 864e5 + 1;
  return days > 0 ? r2(Number(c.value) * days / total) : 0;
}

interface Load { tasks: Row[]; rdaKeys: Set<string>; contracts: Row[] }
async function loadCommitments(): Promise<Load> {
  const db = getPool();
  const tasks = (await db.query("select id, source, kind, source_key, title, status, done_reason, meta, rda_numbers, due, created_at, new_contract_id from tasks where source in ('rda','manual') and not (source = 'manual' and kind <> 'purchase')")).rows;
  const contracts = (await db.query("select id, supplier, object, value, start_date, end_date, internal_order, status from contracts where internal_order <> '' and status = 'active'")).rows;
  return { tasks, rdaKeys: new Set(tasks.filter(t => t.source === "rda").map(t => t.source_key as string)), contracts };
}
/** Classifica una pratica: impegnata (RDA approvata o acquisto chiuso), in previsione (acquisto aperto senza RDA) o da escludere. */
function classify(t: Row, rdaKeys: Set<string>): "committed" | "pipeline" | null {
  if (t.source === "rda") return t.done_reason === "removed_from_sap" ? null : "committed";
  // Acquisto manuale: se la sua RDA è arrivata da SAP conta già la RDA.
  if ((t.rda_numbers ?? []).some((k: string) => rdaKeys.has(k))) return null;
  if (t.new_contract_id) return null; // il contratto firmato conta tramite il registro contratti
  return t.status === "done" ? "committed" : "pipeline";
}
const taskYear = (t: Row) => (t.source === "rda" ? yearOf(t.meta?.releaseDate) ?? yearOf(t.created_at) : yearOf(t.due) ?? yearOf(t.created_at));

export async function budgetView(user: User, yearIn?: number): Promise<BudgetView> {
  if (!canSeeBudget(user)) throw new HttpError(403, "Operazione non consentita");
  const db = getPool();
  const currentYear = new Date().getUTCFullYear();
  const versionsRows = (await db.query(`select v.*, count(l.id)::int as n, coalesce(sum(l.amount), 0) as total from mp_versions v left join mp_lines l on l.version_id = v.id group by v.id order by v.year desc, v.version`)).rows;
  const years = [...new Set([currentYear, ...versionsRows.map(v => v.year as number)])].sort((a, b) => b - a);
  const year = yearIn && Number.isInteger(yearIn) ? yearIn : (versionsRows.some(v => v.year === currentYear) ? currentYear : versionsRows[0]?.year ?? currentYear);
  const versions: MpVersion[] = versionsRows.filter(v => v.year === year).map(v => ({ id: v.id, year: v.year, version: v.version, label: v.label, fileName: v.file_name, uploadedBy: v.uploaded_by, uploadedAt: new Date(v.uploaded_at).toISOString(), lines: v.n, total: r2(Number(v.total)) }));
  const base = versions[0], cur = versions[versions.length - 1];
  const linesOf = async (id?: number) => (id ? (await db.query("select * from mp_lines where version_id = $1", [id])).rows : []);
  const [bl, cl] = await Promise.all([linesOf(base?.id), linesOf(cur?.id)]);
  const map = new Map<string, BudgetLine>();
  const line = (io: string): BudgetLine => {
    let l = map.get(io);
    if (!l) { l = { io, description: "", function: "", costCenter: "", glAccount: "", category: "", baseline: null, current: null, committed: 0, pipeline: 0, contracts: 0, residual: null, vsBaseline: null, items: 0 }; map.set(io, l); }
    return l;
  };
  for (const r of bl) { const l = line(r.io); l.baseline = r2(Number(r.amount)); Object.assign(l, { description: r.description, function: r.function, costCenter: r.cost_center, glAccount: r.gl_account, category: r.category }); }
  for (const r of cl) { const l = line(r.io); l.current = r2(Number(r.amount)); if (r.description) Object.assign(l, { description: r.description, function: r.function || l.function, costCenter: r.cost_center || l.costCenter, glAccount: r.gl_account || l.glAccount, category: r.category || l.category }); }

  const { tasks, rdaKeys, contracts } = await loadCommitments();
  const unassigned: BudgetView["unassigned"] = [];
  for (const t of tasks) {
    if (taskYear(t) !== year) continue;
    const kind = classify(t, rdaKeys); if (!kind) continue;
    const split = ioSplit(t);
    if (!Object.keys(split).length) {
      if (t.source === "rda" || t.status === "open") unassigned.push({ taskId: t.id, title: t.title, value: Number(t.meta?.value ?? 0), costCenter: t.meta?.costCenter ?? "", sourceKey: t.source_key });
      continue;
    }
    for (const [io, v] of Object.entries(split)) { const l = line(io); l[kind] = r2(l[kind] + Number(v)); l.items++; }
  }
  for (const c of contracts) { const q = contractQuota(c, year); if (q > 0) { const l = line(c.internal_order); l.contracts = r2(l.contracts + q); l.items++; } }
  // Residuo: budget corrente meno impegnato e in previsione; per gli anni futuri contano anche le quote dei contratti.
  for (const l of map.values()) {
    const used = l.committed + l.pipeline + (year > currentYear ? l.contracts : 0);
    l.residual = l.current === null ? null : r2(l.current - used);
    l.vsBaseline = l.baseline === null ? null : r2(l.baseline - used);
  }
  // Prima le righe del Master Plan (per funzione), poi gli internal order impegnati ma non a budget.
  const lines = [...map.values()].sort((a, b) => Number(a.current === null) - Number(b.current === null) || (a.function || "~").localeCompare(b.function || "~") || a.io.localeCompare(b.io));
  const demo = (await db.query("select 1 from mp_versions where file_name = 'simulazione-master-plan.csv' limit 1")).rows.length > 0;
  return { demo, year, currentYear, years, versions, baselineId: base?.id ?? null, currentId: cur?.id ?? null, lines, unassigned: unassigned.sort((a, b) => b.value - a.value), canUpload: canUploadBudget(user) };
}

/** Dettaglio di un internal order: budget e pratiche/contratti che lo impegnano. */
export async function budgetIo(user: User, io: string, yearIn?: number): Promise<{ line: BudgetLine | null; items: BudgetItem[]; year: number }> {
  const view = await budgetView(user, yearIn);
  const { tasks, rdaKeys, contracts } = await loadCommitments();
  const items: BudgetItem[] = [];
  for (const t of tasks) {
    if (taskYear(t) !== view.year) continue;
    const kind = classify(t, rdaKeys); if (!kind) continue;
    const v = ioSplit(t)[io]; if (v === undefined) continue;
    items.push({ kind: t.source === "rda" ? "rda" : "purchase", id: t.id, title: t.title, value: r2(Number(v)), status: kind === "pipeline" ? "In previsione" : t.status === "open" ? "Approvata, in lavorazione" : "Ordinata / chiusa", date: t.meta?.releaseDate ?? (t.due ? new Date(t.due).toISOString().slice(0, 10) : null) });
  }
  for (const c of contracts) if (c.internal_order === io) { const q = contractQuota(c, view.year); if (q > 0) items.push({ kind: "contract", id: c.id, title: `${c.supplier} · ${c.object}`, value: q, status: `Quota ${view.year} del contratto (scad. ${c.end_date})`, date: c.end_date }); }
  return { line: view.lines.find(l => l.io === io) ?? null, items: items.sort((a, b) => b.value - a.value), year: view.year };
}

/** Modello da compilare (CSV con ";", si apre con Excel). */
export const BUDGET_TEMPLATE = "\uFEFFRow Labels;CDC;CDC NAME;NAME;CATEGORIA;MP26;R3;R5\nHQ2505245001;5245;R&D Agro;MARTANI - CONTRATTO;OTHERS;61000;61000;58000\n";
