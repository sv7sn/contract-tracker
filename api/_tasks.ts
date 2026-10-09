import type { ImportResult, RdaConfig, RdaMeta, Sourcing, SourcingMode, SourcingQuote, SourcingStatus, Task, TaskDetail, TaskLine, TaskPo, TaskSummary, User } from "../src/types.ts";
import { getPool, inTransaction, type Queryable } from "./_db.js";
import { HttpError } from "./_http.js";
import { detectKind, parsePoLines, parsePrLines, parseSheet, type PrLine } from "./_sap-files.js";

const bad = (msg: string): never => { throw new HttpError(400, msg); };
const str = (v: unknown, max = 300) => (typeof v === "string" ? v.trim().slice(0, max) : "");
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const day = (d: unknown) => (d ? new Date(d as string).toISOString().slice(0, 10) : null);
const iso = (d: unknown) => (d ? new Date(d as string).toISOString() : "");
const addDays = (d: string, n: number) => new Date(new Date(d).getTime() + n * 864e5).toISOString().slice(0, 10);

interface RdaSettings { slaDays: number; sourcingThreshold: number }
export async function loadRdaSettings(db: Queryable): Promise<RdaSettings> {
  const v = (await db.query("select value from settings where key = 'rda'")).rows[0]?.value as Partial<RdaSettings> | undefined;
  return { slaDays: v?.slaDays && v.slaDays > 0 ? v.slaDays : 7, sourcingThreshold: typeof v?.sourcingThreshold === "number" && v.sourcingThreshold >= 0 ? v.sourcingThreshold : 10000 };
}
export async function loadSla(db: Queryable): Promise<number> { return (await loadRdaSettings(db)).slaDays; }

// ─── Scelta del fornitore (RDA sopra soglia) ─────────────────
// Sopra soglia serve il confronto con almeno un altro fornitore, salvo fornitura strategica, single source o eccezione approvata dal Manager.
const SOURCING_MODES: SourcingMode[] = ["comparison", "strategic", "single_source", "exception"];
const needsSourcing = (r: Row, threshold: number) => r.source === "rda" && Number(r.meta?.value ?? 0) > threshold;
function sourcingStatusOf(required: boolean, s: Sourcing | null): SourcingStatus {
  if (!required) return "na";
  if (!s) return "missing";
  if (s.mode === "exception") return s.approval === "approved" ? "ok" : s.approval === "pending" ? "pending" : "missing";
  return "ok";
}
/** Condizione SQL: sourcing non ancora valido (manca, o eccezione non approvata). */
const SOURCING_MISSING_SQL = "(t.sourcing is null or (t.sourcing->>'mode' = 'exception' and coalesce(t.sourcing->>'approval','') <> 'approved'))";

// ─── Importazione dei file SAP ───────────────────────────────
const IMPORT_MAX_BYTES = 8 * 1024 * 1024;

/** Importa un file inviato da SAP (elenco RDA aperte oppure ordini degli ultimi 7 giorni): il tipo si riconosce dalle colonne. */
export async function importSapFile(actor: string, fileName: string, data: Uint8Array, force = false): Promise<ImportResult> {
  if (!data.length) bad("Il file è vuoto");
  if (data.length > IMPORT_MAX_BYTES) bad("Il file è troppo grande");
  const rows = parseSheet(data);
  const kind = detectKind(rows[0] ?? []);
  if (!kind) throw new HttpError(400, "File non riconosciuto: servono l'elenco delle RDA aperte (OPEN_PR) o gli ordini degli ultimi 7 giorni (PO_LAST_7D) esportati da SAP");
  const res: ImportResult = { kind, fileName, rows: 0, prs: 0, created: 0, updated: 0, reopened: 0, closedPo: 0, closedGone: 0, linked: 0 };
  await inTransaction(async db => {
    if (kind === "pr") await importPr(db, parsePrLines(rows), res, force);
    else await importPo(db, rows, res);
    await db.query("insert into sap_imports (kind, file_name, rows, result, by) values ($1,$2,$3,$4,$5)", [kind, fileName.slice(0, 200), res.rows, JSON.stringify(res), actor]);
  });
  return res;
}

async function importPr(db: Queryable, lines: PrLine[], res: ImportResult, force: boolean) {
  if (!lines.length) bad("Il file non contiene nessuna RDA: controlla di aver scelto quello giusto");
  const prev = (await db.query("select count(distinct pr)::int as n from rda_lines")).rows[0].n as number;
  const prs = new Map<string, PrLine[]>();
  for (const l of lines) { const a = prs.get(l.pr) ?? []; a.push(l); prs.set(l.pr, a); }
  if (!force && prev >= 20 && prs.size < prev * 0.4) throw new HttpError(409, `Il file contiene ${prs.size} RDA contro le ${prev} dell'ultimo aggiornamento: potrebbe essere incompleto. Se è corretto, importalo comunque.`, { needsForce: true });
  res.rows = lines.length; res.prs = prs.size;
  const sla = await loadSla(db);
  // L'elenco è la fotografia completa delle RDA aperte: si sostituisce tutto.
  await db.query("delete from rda_lines");
  for (const l of lines) {
    await db.query("insert into rda_lines (pr, item, pgr, short_text, qty, unit, price, per, currency, req_date, deliv_date, release_date, requested_by, created_by, plant, cost_center, gl_account, value) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)",
      [l.pr, l.item, l.pgr, l.shortText, l.qty, l.unit, l.price, l.per, l.currency, l.reqDate, l.delivDate, l.releaseDate, l.requestedBy, l.createdBy, l.plant, l.costCenter, l.glAccount, l.value]);
  }
  const maps = new Map((await db.query("select pgr, user_id from pgr_assignments where user_id is not null")).rows.map(r => [r.pgr as string, r.user_id as number]));
  for (const [pr, ls] of prs) {
    const first = ls[0];
    const release = ls.map(l => l.releaseDate).filter(Boolean).sort()[0] ?? ls.map(l => l.reqDate).filter(Boolean).sort()[0] ?? null;
    const deliv = ls.map(l => l.delivDate).filter(Boolean).sort()[0] ?? null;
    const currencies = [...new Set(ls.map(l => l.currency))];
    const meta: RdaMeta = { pgr: first.pgr, requestedBy: first.requestedBy, createdBy: first.createdBy, value: Math.round(ls.reduce((a, l) => a + l.value, 0) * 100) / 100, currency: currencies.length === 1 ? currencies[0] : "EUR", lines: ls.length, releaseDate: release, delivDate: deliv, plant: first.plant };
    const title = `RDA ${pr} · ${first.shortText || "senza descrizione"}${ls.length > 1 ? ` (+${ls.length - 1})` : ""}`.slice(0, 200);
    const due = release ? addDays(release, sla) : null;
    const cur = (await db.query("select * from tasks where source = 'rda' and source_key = $1 for update", [pr])).rows[0];
    if (!cur) {
      const assignee = maps.get(first.pgr) ?? null;
      await db.query("insert into tasks (source, source_key, title, due, assignee_id, assignee_auto, group_key, meta, created_by) values ('rda',$1,$2,$3,$4,$5,$6,$7,'SAP')", [pr, title, due, assignee, assignee !== null, first.pgr, JSON.stringify({ ...meta, firstSeen: new Date().toISOString() })]);
      res.created++;
    } else if (cur.status === "done") {
      await db.query("update tasks set status = 'open', done_at = null, done_reason = '', done_by = '', title = $2, due = $3, meta = $4, updated_at = now() where id = $1", [cur.id, title, due, JSON.stringify({ ...cur.meta, ...meta })]);
      res.reopened++;
    } else {
      await db.query("update tasks set title = $2, due = $3, group_key = $4, meta = $5, updated_at = now() where id = $1", [cur.id, title, due, first.pgr, JSON.stringify({ ...cur.meta, ...meta })]);
      res.updated++;
    }
  }
  await reconcile(db, res);
}

async function importPo(db: Queryable, rows: (string | null)[][], res: ImportResult) {
  const lines = parsePoLines(rows);
  res.rows = lines.length;
  const withPr = lines.filter(l => l.pr);
  const seen = new Set<string>();
  for (const l of withPr) {
    const k = `${l.po}|${l.pr}`; if (seen.has(k)) continue; seen.add(k);
    await db.query(`insert into sap_pos (po, pr, supplier_code, supplier_name, doc_date, pgr, created_by) values ($1,$2,$3,$4,$5,$6,$7)
      on conflict (po, pr) do update set supplier_code = excluded.supplier_code, supplier_name = excluded.supplier_name, doc_date = excluded.doc_date, seen_at = now()`, [l.po, l.pr, l.supplierCode, l.supplierName, l.docDate, l.pgr, l.createdBy]);
  }
  res.linked = seen.size; res.prs = new Set(withPr.map(l => l.pr)).size;
  // Se la RDA era stata chiusa come "non più aperta" prima che arrivasse l'elenco ordini, ora si sa che è diventata un ordine.
  const up = await db.query(`update tasks t set done_reason = 'po_created', done_at = coalesce((select min(p.doc_date)::timestamptz from sap_pos p where p.pr = t.source_key), t.done_at), updated_at = now()
    where t.source = 'rda' and t.status = 'done' and t.done_reason = 'removed_from_sap' and exists (select 1 from sap_pos p where p.pr = t.source_key)`);
  res.closedPo += up.rowCount ?? 0;
  await reconcile(db, res);
}

/** Chiude i task delle RDA che non risultano più aperte in SAP: "PO creato" se l'ordine è noto, altrimenti "non più aperta". */
async function reconcile(db: Queryable, res: ImportResult) {
  const hasSnapshot = (await db.query("select 1 from rda_lines limit 1")).rows.length > 0;
  if (!hasSnapshot) return;
  const po = await db.query(`update tasks t set status = 'done', done_reason = 'po_created', done_by = 'SAP', updated_at = now(),
      done_at = coalesce((select min(p.doc_date)::timestamptz from sap_pos p where p.pr = t.source_key), now())
    where t.source = 'rda' and t.status = 'open' and not exists (select 1 from rda_lines l where l.pr = t.source_key)
      and exists (select 1 from sap_pos p where p.pr = t.source_key)`);
  const gone = await db.query(`update tasks t set status = 'done', done_reason = 'removed_from_sap', done_by = 'SAP', done_at = now(), updated_at = now()
    where t.source = 'rda' and t.status = 'open' and not exists (select 1 from rda_lines l where l.pr = t.source_key)`);
  res.closedPo += po.rowCount ?? 0; res.closedGone += gone.rowCount ?? 0;
}

// ─── Lettura ─────────────────────────────────────────────────
function visibleSql(user: User): string {
  const id = Number(user.id);
  if (user.role === "manager") return "true";
  if (user.role === "buyer") return `(t.assignee_id = ${id} or (t.source = 'manual' and t.created_by = '${user.name.replace(/'/g, "''")}'))`;
  return "false";
}

function mapTask(r: Row, pos: Row[], threshold: number): Task {
  const required = needsSourcing(r, threshold);
  return {
    sourcing: r.sourcing ?? null, sourcingRequired: required, sourcingStatus: sourcingStatusOf(required, r.sourcing ?? null),
    id: r.id, source: r.source, sourceKey: r.source_key, title: r.title, detail: r.detail, due: day(r.due), priority: r.priority, assigneeId: r.assignee_id, assigneeName: r.assignee_name ?? "",
    status: r.status, doneAt: r.done_at ? iso(r.done_at) : null, doneReason: r.done_reason, doneBy: r.done_by, meta: r.meta ?? {},
    pos: pos.filter(p => p.pr === r.source_key).map((p): TaskPo => ({ po: p.po, supplierName: p.supplier_name, docDate: day(p.doc_date) })),
    createdBy: r.created_by, createdAt: iso(r.created_at), updatedAt: iso(r.updated_at),
  };
}
const SELECT = "select t.*, u.name as assignee_name from tasks t left join users u on u.id = t.assignee_id";

export async function listTasks(user: User): Promise<{ tasks: Task[]; sapUpdatedAt: { pr: string | null; po: string | null } }> {
  const db = getPool();
  // I task chiusi restano visibili per 30 giorni.
  const rows = (await db.query(`${SELECT} where ${visibleSql(user)} and (t.status = 'open' or t.done_at > now() - interval '30 days') order by t.status, t.due nulls last, t.id`)).rows;
  const prs = rows.filter(r => r.source === "rda").map(r => r.source_key);
  const pos = prs.length ? (await db.query("select * from sap_pos where pr = any($1) order by doc_date", [prs])).rows : [];
  const last = (await db.query("select kind, max(at) as at from sap_imports group by kind")).rows;
  const at = (k: string) => { const r = last.find(x => x.kind === k); return r ? iso(r.at) : null; };
  const { sourcingThreshold } = await loadRdaSettings(db);
  return { tasks: rows.map(r => mapTask(r, pos, sourcingThreshold)), sapUpdatedAt: { pr: at("pr"), po: at("po") } };
}

export async function taskSummary(user: User): Promise<TaskSummary> {
  const db = getPool();
  const { sourcingThreshold } = await loadRdaSettings(db);
  const r = (await db.query(`select count(*)::int as open, count(*) filter (where t.due < current_date)::int as overdue, count(*) filter (where t.due >= current_date and t.due <= current_date + 7)::int as due_soon,
    count(*) filter (where t.assignee_id is null)::int as unassigned,
    count(*) filter (where t.source = 'rda' and coalesce((t.meta->>'value')::numeric, 0) > $1 and ${SOURCING_MISSING_SQL})::int as sourcing_missing
    from tasks t where t.status = 'open' and ${visibleSql(user)}`, [sourcingThreshold])).rows[0];
  const p = (await db.query(`select count(*)::int as n from tasks t where t.sourcing->>'approval' = 'pending' and ${visibleSql(user)}`)).rows[0];
  return { open: r.open, overdue: r.overdue, dueSoon: r.due_soon, unassigned: r.unassigned, sourcingMissing: r.sourcing_missing, exceptionsPending: p.n };
}

export async function getTask(user: User, id: number): Promise<TaskDetail> {
  const db = getPool();
  const r = (await db.query(`${SELECT} where t.id = $1 and ${visibleSql(user)}`, [id])).rows[0];
  if (!r) throw new HttpError(404, "Task non trovato");
  const pos = r.source === "rda" ? (await db.query("select * from sap_pos where pr = $1 order by doc_date", [r.source_key])).rows : [];
  const lines: TaskLine[] = r.source === "rda" ? (await db.query("select * from rda_lines where pr = $1 order by item, id", [r.source_key])).rows.map(l => ({
    item: l.item, shortText: l.short_text, qty: Number(l.qty), unit: l.unit, price: Number(l.price), per: Number(l.per), currency: l.currency, delivDate: day(l.deliv_date), costCenter: l.cost_center, glAccount: l.gl_account, value: Number(l.value) })) : [];
  return { ...mapTask(r, pos, (await loadRdaSettings(db)).sourcingThreshold), lines };
}

// ─── Scrittura ───────────────────────────────────────────────
const PRIORITIES = ["low", "normal", "high"];
export async function createManualTask(user: User, input: Row): Promise<Task> {
  const title = str(input?.title, 200); if (title.length < 3) bad("Scrivi un titolo per il task");
  const due = typeof input?.due === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.due) ? input.due : null;
  const priority = PRIORITIES.includes(input?.priority) ? input.priority : "normal";
  let assignee: number = user.id;
  if (user.role === "manager" && input?.assigneeId !== undefined && input.assigneeId !== null) assignee = Number(input.assigneeId);
  if (!(await getPool().query("select 1 from users where id = $1 and active and role in ('buyer','manager')", [assignee])).rows.length) bad("Assegnatario non valido");
  const r = (await getPool().query("insert into tasks (source, title, detail, due, priority, assignee_id, created_by) values ('manual',$1,$2,$3,$4,$5,$6) returning id", [title, str(input?.detail, 2000), due, priority, assignee, user.name])).rows[0];
  return (await getTask(user, r.id)) as Task;
}

/** Aggiorna un task: stato, assegnatario (solo Manager), scadenza e priorità (solo task manuali). */
export async function updateTask(user: User, id: number, input: Row): Promise<TaskDetail> {
  const cur = await getTask(user, id);
  const sets: string[] = []; const vals: unknown[] = [];
  const set = (col: string, v: unknown) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
  if (input?.status === "done" && cur.status === "open" && cur.sourcingRequired && cur.sourcingStatus !== "ok") {
    throw new HttpError(409, cur.sourcingStatus === "pending"
      ? "L'eccezione per questa RDA è in attesa di approvazione del Manager: potrai chiuderla dopo l'approvazione"
      : `RDA sopra soglia (${fmtEur((await loadRdaSettings(getPool())).sourcingThreshold)}): prima di chiuderla registra il confronto con almeno un altro fornitore, oppure indica che è strategica o single source, o chiedi un'eccezione`, { needsSourcing: true });
  }
  if (input?.status === "done" && cur.status === "open") { set("status", "done"); set("done_at", new Date()); set("done_reason", "manual"); set("done_by", user.name); }
  else if (input?.status === "open" && cur.status === "done") {
    if (cur.source === "rda" && cur.doneReason !== "manual") throw new HttpError(409, "Questa RDA si è chiusa da sola perché non è più aperta in SAP: si riaprirà se riappare nell'elenco");
    set("status", "open"); set("done_at", null); set("done_reason", ""); set("done_by", "");
  }
  if (input?.assigneeId !== undefined) {
    if (user.role !== "manager") throw new HttpError(403, "Solo il Manager assegna i task");
    const a = input.assigneeId === null ? null : Number(input.assigneeId);
    if (a !== null && !(await getPool().query("select 1 from users where id = $1 and active and role in ('buyer','manager')", [a])).rows.length) bad("Assegnatario non valido");
    set("assignee_id", a); set("assignee_auto", false);
  }
  if (cur.source === "manual") {
    if (typeof input?.title === "string") { const t = str(input.title, 200); if (t.length < 3) bad("Scrivi un titolo per il task"); set("title", t); }
    if (typeof input?.detail === "string") set("detail", str(input.detail, 2000));
    if (input?.due !== undefined) set("due", typeof input.due === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.due) ? input.due : null);
    if (PRIORITIES.includes(input?.priority)) set("priority", input.priority);
  }
  if (!sets.length) return cur;
  vals.push(id);
  await getPool().query(`update tasks set ${sets.join(", ")}, updated_at = now() where id = $${vals.length}`, vals);
  return getTask(user, id);
}

const fmtEur = (n: number) => `${n.toLocaleString("it-IT")} €`;

/** Registra come è stato scelto il fornitore: confronto offerte, fornitura strategica, single source o eccezione. */
export async function saveSourcing(user: User, id: number, input: Row): Promise<TaskDetail> {
  const cur = await getTask(user, id);
  if (cur.source !== "rda") bad("La scelta del fornitore si registra solo sulle RDA");
  const mode = input?.mode as SourcingMode;
  if (!SOURCING_MODES.includes(mode)) bad("Scegli come è stato individuato il fornitore");
  const justification = str(input?.justification, 2000);
  let quotes: SourcingQuote[] = [];
  if (mode === "comparison") {
    if (!Array.isArray(input?.quotes) || input.quotes.length < 2 || input.quotes.length > 10) bad("Inserisci il fornitore scelto e almeno un'altra offerta");
    quotes = (input.quotes as Row[]).map(q => ({ supplier: str(q?.supplier, 200), amount: Number(q?.amount), chosen: q?.chosen === true }));
    if (quotes.some(q => q.supplier.length < 2)) bad("Indica il nome di ogni fornitore");
    if (quotes.some(q => !Number.isFinite(q.amount) || q.amount <= 0)) bad("Indica l'importo di ogni offerta");
    if (quotes.filter(q => q.chosen).length !== 1) bad("Indica quale offerta è stata scelta");
    if (new Set(quotes.map(q => q.supplier.toLowerCase().replace(/[^a-z0-9]/g, ""))).size !== quotes.length) bad("Le offerte devono essere di fornitori diversi");
    const chosen = quotes.find(q => q.chosen)!;
    if (quotes.some(q => q.amount < chosen.amount) && justification.length < 10) bad("Non è stata scelta l'offerta più bassa: spiega il motivo");
  } else if (justification.length < 10) bad(mode === "exception" ? "Spiega il motivo dell'eccezione" : "Spiega perché la fornitura è " + (mode === "strategic" ? "strategica" : "single source"));
  const now = new Date().toISOString();
  const manager = user.role === "manager";
  const sourcing: Sourcing = {
    mode, quotes, justification, recordedBy: user.name, recordedAt: now,
    approval: mode === "exception" ? (manager ? "approved" : "pending") : null,
    approvedBy: mode === "exception" && manager ? user.name : "", approvedAt: mode === "exception" && manager ? now : null, approvalNote: "",
  };
  await getPool().query("update tasks set sourcing = $2, updated_at = now() where id = $1", [id, JSON.stringify(sourcing)]);
  return getTask(user, id);
}

/** Il Manager approva o respinge un'eccezione al confronto tra fornitori. */
export async function decideSourcingException(user: User, id: number, input: Row): Promise<TaskDetail> {
  if (user.role !== "manager") throw new HttpError(403, "Solo il Manager approva le eccezioni");
  const cur = await getTask(user, id);
  if (cur.sourcing?.mode !== "exception" || cur.sourcing.approval !== "pending") bad("Non c'è nessuna eccezione da approvare");
  const approve = input?.approve === true;
  const note = str(input?.note, 1000);
  if (!approve && note.length < 5) bad("Indica il motivo del rifiuto");
  const sourcing: Sourcing = { ...cur.sourcing!, approval: approve ? "approved" : "rejected", approvedBy: user.name, approvedAt: new Date().toISOString(), approvalNote: note };
  await getPool().query("update tasks set sourcing = $2, updated_at = now() where id = $1", [id, JSON.stringify(sourcing)]);
  return getTask(user, id);
}

export async function deleteManualTask(user: User, id: number): Promise<void> {
  const cur = await getTask(user, id);
  if (cur.source !== "manual") throw new HttpError(400, "Si possono eliminare solo i task creati a mano");
  await getPool().query("delete from tasks where id = $1", [id]);
}

// ─── Configurazione RDA ──────────────────────────────────────
export async function loadRdaConfig(db: Queryable): Promise<RdaConfig> {
  const [m, seen, open, imps] = await Promise.all([
    db.query("select * from pgr_assignments"),
    db.query("select distinct group_key as pgr from tasks where source = 'rda' and group_key <> ''"),
    db.query("select group_key as pgr, count(*)::int as n from tasks where source = 'rda' and status = 'open' group by 1"),
    db.query("select kind, file_name, rows, at, by from sap_imports order by id desc limit 6"),
  ]);
  const pgrs = [...new Set([...m.rows.map(r => r.pgr as string), ...seen.rows.map(r => r.pgr as string)])].sort();
  const st = await loadRdaSettings(db);
  return {
    slaDays: st.slaDays, sourcingThreshold: st.sourcingThreshold,
    groups: pgrs.map(p => ({ pgr: p, userId: m.rows.find(r => r.pgr === p)?.user_id ?? null, note: m.rows.find(r => r.pgr === p)?.note ?? "", openTasks: open.rows.find(r => r.pgr === p)?.n ?? 0 })),
    ingestConfigured: !!process.env.RDA_INGEST_SECRET,
    lastImports: imps.rows.map(r => ({ kind: r.kind, fileName: r.file_name, rows: r.rows, at: iso(r.at), by: r.by })),
  };
}

export async function saveRda(entity: "rda" | "pgr", item: Row): Promise<void> {
  const db = getPool();
  if (entity === "rda") {
    const prev = await loadRdaSettings(db);
    const d = item?.slaDays === undefined ? prev.slaDays : Number(item.slaDays);
    if (!Number.isInteger(d) || d < 1 || d > 90) bad("I giorni di lavorazione devono essere tra 1 e 90");
    const th = item?.sourcingThreshold === undefined ? prev.sourcingThreshold : Number(item.sourcingThreshold);
    if (!Number.isFinite(th) || th < 0 || th > 100_000_000) bad("Soglia per il confronto tra fornitori non valida");
    await db.query("insert into settings (key, value) values ('rda', $1) on conflict (key) do update set value = excluded.value", [JSON.stringify({ slaDays: d, sourcingThreshold: th })]);
    // Le scadenze delle RDA aperte seguono il nuovo valore.
    await db.query("update tasks set due = ((meta->>'releaseDate')::date + $1::int) where source = 'rda' and status = 'open' and meta->>'releaseDate' is not null", [d]);
    return;
  }
  const pgr = str(item?.pgr, 20); if (!/^[A-Za-z0-9_.-]{1,20}$/.test(pgr)) bad("Gruppo di acquisto non valido");
  const uid = item?.userId === null || item?.userId === undefined || item?.userId === "" ? null : Number(item.userId);
  if (uid !== null && !(await db.query("select 1 from users where id = $1 and active and role in ('buyer','manager')", [uid])).rows.length) bad("Buyer non valido");
  await inTransaction(async tx => {
    await tx.query("insert into pgr_assignments (pgr, user_id, note) values ($1,$2,$3) on conflict (pgr) do update set user_id = excluded.user_id, note = excluded.note", [pgr, uid, str(item?.note, 200)]);
    // I task già aperti di quel gruppo, non assegnati a mano, passano al nuovo buyer.
    await tx.query("update tasks set assignee_id = $2::int, assignee_auto = ($2::int is not null), updated_at = now() where source = 'rda' and status = 'open' and group_key = $1 and (assignee_auto or assignee_id is null)", [pgr, uid]);
  });
}
