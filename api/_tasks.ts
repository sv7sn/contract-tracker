import type { ContractOutcome, ImportResult, RdaConfig, RdaMeta, Sourcing, SourcingMode, SourcingQuote, SourcingStatus, Task, TaskDetail, TaskDocKind, TaskLine, TaskPo, TaskSummary, User } from "../src/types.ts";
import { computeSaving } from "./_saving.js";
import { makePlan, reschedulePlan } from "./_plan-rules.js";
import { FILE_PATH_RE } from "./_blob.js";
import { getPool, inTransaction, type Queryable } from "./_db.js";
import { HttpError } from "./_http.js";
import { detectKind, parsePoLines, parsePrLines, parseSheet, type PrLine } from "./_sap-files.js";

const bad = (msg: string): never => { throw new HttpError(400, msg); };
const str = (v: unknown, max = 300) => (typeof v === "string" ? v.trim().slice(0, max) : "");
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const day = (d: unknown) => (d ? new Date(d as string).toISOString().slice(0, 10) : null);
const iso = (d: unknown) => (d ? new Date(d as string).toISOString() : "");
const addDays = (d: string, n: number) => new Date(new Date(d).getTime() + n * 864e5).toISOString().slice(0, 10);

interface RdaSettings { slaDays: number; sourcingThreshold: number; renewalLeadDays: number }
export async function loadRdaSettings(db: Queryable): Promise<RdaSettings> {
  const v = (await db.query("select value from settings where key = 'rda'")).rows[0]?.value as Partial<RdaSettings> | undefined;
  return { slaDays: v?.slaDays && v.slaDays > 0 ? v.slaDays : 7, sourcingThreshold: typeof v?.sourcingThreshold === "number" && v.sourcingThreshold >= 0 ? v.sourcingThreshold : 10000,
    renewalLeadDays: typeof v?.renewalLeadDays === "number" && v.renewalLeadDays > 0 ? v.renewalLeadDays : 90 };
}
export async function loadSla(db: Queryable): Promise<number> { return (await loadRdaSettings(db)).slaDays; }

// ─── Scelta del fornitore (RDA sopra soglia) ─────────────────
// Sopra soglia serve il confronto con almeno un altro fornitore, salvo fornitura strategica, single source o eccezione approvata dal Manager.
const SOURCING_MODES: SourcingMode[] = ["comparison", "strategic", "single_source", "exception"];
// Per i rinnovi il confronto serve solo se si firma un nuovo contratto (non per proroghe o cessazioni).
const isPurchase = (r: Row) => r.source === "manual" && r.kind === "purchase";
const needsSourcing = (r: Row, threshold: number) => (r.source === "rda" || isPurchase(r) || (r.source === "contract" && !["extended", "ceased"].includes(r.outcome ?? ""))) && Number(r.meta?.value ?? 0) > threshold;
function sourcingStatusOf(required: boolean, s: Sourcing | null): SourcingStatus {
  if (!required) return "na";
  if (!s) return "missing";
  if (s.mode === "exception") return s.approval === "approved" ? "ok" : s.approval === "pending" ? "pending" : "missing";
  return "ok";
}
/** Condizione SQL: sourcing non ancora valido (manca, o eccezione non approvata). */
const SOURCING_MISSING_SQL = "(t.outcome not in ('extended','ceased') and (t.sourcing is null or (t.sourcing->>'mode' = 'exception' and coalesce(t.sourcing->>'approval','') <> 'approved')))";

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
    await db.query("insert into rda_lines (pr, item, pgr, short_text, qty, unit, price, per, currency, req_date, deliv_date, release_date, requested_by, created_by, plant, cost_center, gl_account, value, internal_order) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)",
      [l.pr, l.item, l.pgr, l.shortText, l.qty, l.unit, l.price, l.per, l.currency, l.reqDate, l.delivDate, l.releaseDate, l.requestedBy, l.createdBy, l.plant, l.costCenter, l.glAccount, l.value, l.internalOrder]);
  }
  const maps = new Map((await db.query("select pgr, user_id from pgr_assignments where user_id is not null")).rows.map(r => [r.pgr as string, r.user_id as number]));
  for (const [pr, ls] of prs) {
    const first = ls[0];
    const release = ls.map(l => l.releaseDate).filter(Boolean).sort()[0] ?? ls.map(l => l.reqDate).filter(Boolean).sort()[0] ?? null;
    const deliv = ls.map(l => l.delivDate).filter(Boolean).sort()[0] ?? null;
    const currencies = [...new Set(ls.map(l => l.currency))];
    // Valore per internal order: resta sul task anche quando la RDA esce dall'elenco SAP (serve al Master Plan).
    const io: Record<string, number> = {};
    for (const l of ls) if (l.internalOrder) io[l.internalOrder] = Math.round(((io[l.internalOrder] ?? 0) + l.value) * 100) / 100;
    const meta: RdaMeta = { io, costCenter: first.costCenter, pgr: first.pgr, requestedBy: first.requestedBy, createdBy: first.createdBy, value: Math.round(ls.reduce((a, l) => a + l.value, 0) * 100) / 100, currency: currencies.length === 1 ? currencies[0] : "EUR", lines: ls.length, releaseDate: release, delivDate: deliv, plant: first.plant };
    const title = `RDA ${pr} · ${first.shortText || "senza descrizione"}${ls.length > 1 ? ` (+${ls.length - 1})` : ""}`.slice(0, 200);
    const due = release ? addDays(release, sla) : null;
    const cur = (await db.query("select * from tasks where source = 'rda' and source_key = $1 for update", [pr])).rows[0];
    // RDA già seguita in una pratica (acquisto manuale o rinnovo): niente secondo task.
    if (cur?.done_reason === "merged") continue;
    if (!cur && (await db.query("select 1 from tasks where source in ('manual','contract') and status = 'open' and $1 = any(rda_numbers)", [pr])).rows.length) { res.updated++; continue; }
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
  // Valore della riga: netto del PO se l'estrazione lo ha, altrimenti quello della RDA collegata, altrimenti l'importo già ricevuto.
  // Si scrive a blocchi (un'estrazione storica può avere decine di migliaia di righe); a parità di PO e posizione vale l'ultima riga.
  const recs = [...new Map(lines.map(l => {
    const [value, source] = l.netValue !== null && l.netValue > 0 ? [l.netValue, "net"] : l.prValue > 0 ? [l.prValue, "pr"] : l.grAmount > 0 ? [l.grAmount, "gr"] : [0, "none"];
    return [`${l.po}|${l.item}`, { ...l, shortText: l.shortText.slice(0, 200), value: Math.round(value * 100) / 100, source }];
  })).values()];
  for (let i = 0; i < recs.length; i += 500) {
    await db.query(`insert into po_lines (po, item, doc_date, created_on, doc_type, supplier_code, supplier_name, pr, pr_value, net_value, gr_amount, ir_amount, value, value_source, currency,
        matl_group, matl_group_desc, agreement, internal_order, cost_center, gl_account, short_text, pgr, created_by, requested_by)
      select x.po, x.item, x."docDate"::date, x."createdOn"::date, x."docType", x."supplierCode", x."supplierName", x.pr, x."prValue", x."netValue", x."grAmount", x."irAmount", x.value, x.source, x.currency,
        x."matlGroup", x."matlGroupDesc", x.agreement, x."internalOrder", x."costCenter", x."glAccount", x."shortText", x.pgr, x."createdBy", x."requestedBy"
      from jsonb_to_recordset($1::jsonb) as x(po text, item text, "docDate" text, "createdOn" text, "docType" text, "supplierCode" text, "supplierName" text, pr text, "prValue" numeric, "netValue" numeric,
        "grAmount" numeric, "irAmount" numeric, value numeric, source text, currency text, "matlGroup" text, "matlGroupDesc" text, agreement text, "internalOrder" text, "costCenter" text,
        "glAccount" text, "shortText" text, pgr text, "createdBy" text, "requestedBy" text)
      on conflict (po, item) do update set doc_date = excluded.doc_date, created_on = excluded.created_on, doc_type = excluded.doc_type, supplier_code = excluded.supplier_code, supplier_name = excluded.supplier_name,
        pr = excluded.pr, pr_value = excluded.pr_value, net_value = excluded.net_value, gr_amount = excluded.gr_amount, ir_amount = excluded.ir_amount, value = excluded.value, value_source = excluded.value_source,
        currency = excluded.currency, matl_group = excluded.matl_group, matl_group_desc = excluded.matl_group_desc, agreement = excluded.agreement, internal_order = excluded.internal_order,
        cost_center = excluded.cost_center, gl_account = excluded.gl_account, short_text = excluded.short_text, pgr = excluded.pgr, created_by = excluded.created_by, requested_by = excluded.requested_by, seen_at = now()`,
      [JSON.stringify(recs.slice(i, i + 500))]);
  }
  res.poLines = recs.length;
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
  res.closedPo += await autoLinkPos(db);
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
  if (user.role === "buyer") {
    // Anche le pratiche dei colleghi che sta sostituendo (assenze registrate).
    const ids = (user.acting?.ids ?? [id]).map(Number).filter(Number.isInteger), names = user.acting?.names ?? [user.name];
    return `(t.assignee_id in (${ids.join(",")}) or (t.source = 'manual' and t.created_by in (${names.map(n => `'${n.replace(/'/g, "''")}'`).join(",")})))`;
  }
  return "false";
}

function mapTask(r: Row, pos: Row[], threshold: number, docs: Row[] = []): Task {
  const required = needsSourcing(r, threshold);
  return {
    sourcing: r.sourcing ?? null, sourcingRequired: required, sourcingStatus: sourcingStatusOf(required, r.sourcing ?? null), saving: computeSaving(r.sourcing),
    contractId: r.contract_id ?? null, outcome: r.outcome ?? "", newContractId: r.new_contract_id ?? null, kind: r.kind === "purchase" ? "purchase" : "activity",
    rdaNumbers: r.source === "rda" ? [r.source_key, ...(r.rda_numbers ?? []).filter((x: string) => x !== r.source_key)] : (r.rda_numbers ?? []),
    poNumbers: r.po_numbers ?? [], noPoReason: r.no_po_reason ?? "",
    documents: docs.filter(d => d.task_id === r.id).map(d => ({ id: d.id, kind: d.kind, fileName: d.file_name, size: d.size, uploadedBy: d.uploaded_by, uploadedAt: iso(d.uploaded_at) })),
    id: r.id, source: r.source, sourceKey: r.source_key, title: r.title, detail: r.detail, due: day(r.due), priority: r.priority, assigneeId: r.assignee_id, assigneeName: r.assignee_name ?? "",
    status: r.status, doneAt: r.done_at ? iso(r.done_at) : null, doneReason: r.done_reason, doneBy: r.done_by, meta: r.meta ?? {},
    pos: pos.filter(p => p.pr === r.source_key).map((p): TaskPo => ({ po: p.po, supplierName: p.supplier_name, docDate: day(p.doc_date) })),
    createdBy: r.created_by, createdAt: iso(r.created_at), updatedAt: iso(r.updated_at),
  };
}
const SELECT = "select t.*, u.name as assignee_name from tasks t left join users u on u.id = t.assignee_id";

export async function listTasks(user: User): Promise<{ tasks: Task[]; sapUpdatedAt: { pr: string | null; po: string | null } }> {
  const db = getPool();
  await ensureRenewalTasks(db);
  // I task chiusi restano visibili per 30 giorni.
  const rows = (await db.query(`${SELECT} where ${visibleSql(user)} and (t.status = 'open' or t.done_at > now() - interval '30 days') order by t.status, t.due nulls last, t.id`)).rows;
  const prs = rows.filter(r => r.source === "rda").map(r => r.source_key);
  const pos = prs.length ? (await db.query("select * from sap_pos where pr = any($1) order by doc_date", [prs])).rows : [];
  const last = (await db.query("select kind, max(at) as at from sap_imports group by kind")).rows;
  const at = (k: string) => { const r = last.find(x => x.kind === k); return r ? iso(r.at) : null; };
  const { sourcingThreshold } = await loadRdaSettings(db);
  const docs = rows.length ? (await db.query("select * from task_documents where task_id = any($1) order by id", [rows.map(r => r.id)])).rows : [];
  return { tasks: rows.map(r => mapTask(r, pos, sourcingThreshold, docs)), sapUpdatedAt: { pr: at("pr"), po: at("po") } };
}

export async function taskSummary(user: User): Promise<TaskSummary> {
  const db = getPool();
  await ensureRenewalTasks(db);
  const { sourcingThreshold } = await loadRdaSettings(db);
  const r = (await db.query(`select count(*)::int as open, count(*) filter (where t.due < current_date)::int as overdue, count(*) filter (where t.due >= current_date and t.due <= current_date + 7)::int as due_soon,
    count(*) filter (where t.assignee_id is null)::int as unassigned,
    count(*) filter (where (t.source in ('rda','contract') or (t.source = 'manual' and t.kind = 'purchase')) and coalesce((t.meta->>'value')::numeric, 0) > $1 and ${SOURCING_MISSING_SQL})::int as sourcing_missing
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
    item: l.item, shortText: l.short_text, qty: Number(l.qty), unit: l.unit, price: Number(l.price), per: Number(l.per), currency: l.currency, delivDate: day(l.deliv_date), costCenter: l.cost_center, glAccount: l.gl_account, value: Number(l.value), internalOrder: l.internal_order ?? "" })) : [];
  const docs = (await db.query("select * from task_documents where task_id = $1 order by id", [id])).rows;
  return { ...mapTask(r, pos, (await loadRdaSettings(db)).sourcingThreshold, docs), lines };
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
  const purchase = input?.kind === "purchase";
  let meta: RdaMeta = {};
  if (purchase) {
    const value = Number(input?.value);
    if (!Number.isFinite(value) || value <= 0) bad("Indica l'importo stimato dell'acquisto");
    const supplierId = Number.isInteger(input?.supplierId) && input.supplierId > 0 ? input.supplierId as number : null;
    if (supplierId && !(await getPool().query("select 1 from suppliers where id = $1", [supplierId])).rows.length) bad("Fornitore non trovato in anagrafica");
    meta = { value, currency: str(input?.currency, 3) || "EUR", supplier: str(input?.supplier, 200), supplierId, object: title };
  }
  const r = (await getPool().query("insert into tasks (source, kind, title, detail, due, priority, assignee_id, created_by, meta) values ('manual',$1,$2,$3,$4,$5,$6,$7,$8) returning id",
    [purchase ? "purchase" : "activity", title, str(input?.detail, 2000), due, priority, assignee, user.name, JSON.stringify(meta)])).rows[0];
  if (purchase && Array.isArray(input?.rdaNumbers) && input.rdaNumbers.length) {
    // Se l'RDA non si può collegare (già in un'altra pratica o già lavorata), la pratica non resta creata a metà.
    try { return await setTaskLinks(user, r.id, { rdaNumbers: input.rdaNumbers }); }
    catch (err) { await getPool().query("delete from tasks where id = $1", [r.id]); throw err; }
  }
  return (await getTask(user, r.id)) as Task;
}

/** Aggiorna un task: stato, assegnatario (solo Manager), scadenza e priorità (solo task manuali). */
export async function updateTask(user: User, id: number, input: Row): Promise<TaskDetail> {
  const cur = await getTask(user, id);
  const sets: string[] = []; const vals: unknown[] = [];
  const set = (col: string, v: unknown) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
  if (input?.status === "done" && cur.status === "open" && (cur.source === "contract" || cur.kind === "purchase" && cur.source === "manual")) {
    const why = closeBlocker(cur);
    if (why) throw new HttpError(409, why, { needsOutcome: cur.source === "contract" && !cur.outcome });
  }
  if (input?.status === "open" && cur.status === "done" && cur.outcome) throw new HttpError(409, "La pratica è già stata chiusa con un contratto registrato");
  if (input?.status === "done" && cur.status === "open" && cur.sourcingRequired && cur.sourcingStatus !== "ok") {
    throw new HttpError(409, cur.sourcingStatus === "pending"
      ? "L'eccezione per questa RDA è in attesa di approvazione del Manager: potrai chiuderla dopo l'approvazione"
      : `${cur.source === "rda" ? "RDA" : cur.source === "contract" ? "Nuovo contratto" : "Acquisto"} sopra soglia (${fmtEur((await loadRdaSettings(getPool())).sourcingThreshold)}): prima di chiuderla registra il confronto con almeno un altro fornitore, oppure indica che è strategica o single source, o chiedi un'eccezione`, { needsSourcing: true });
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
  if (cur.source === "manual" && cur.kind !== "purchase") bad("La scelta del fornitore si registra sulle pratiche d'acquisto: RDA, rinnovi e acquisti");
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
  const amount = (v: unknown) => { if (v === undefined || v === null || v === "") return null; const n = Number(v); if (!Number.isFinite(n) || n <= 0) bad("Importi del saving non validi"); return n; };
  const baseline = amount(input?.baseline), finalAmount = amount(input?.finalAmount);
  const now = new Date().toISOString();
  const manager = user.role === "manager";
  const sourcing: Sourcing = {
    mode, quotes, justification, recordedBy: user.name, recordedAt: now, baseline, finalAmount,
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
    slaDays: st.slaDays, sourcingThreshold: st.sourcingThreshold, renewalLeadDays: st.renewalLeadDays,
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
    const lead = item?.renewalLeadDays === undefined ? prev.renewalLeadDays : Number(item.renewalLeadDays);
    if (!Number.isInteger(lead) || lead < 15 || lead > 365) bad("L'anticipo per i rinnovi deve essere tra 15 e 365 giorni");
    await db.query("insert into settings (key, value) values ('rda', $1) on conflict (key) do update set value = excluded.value", [JSON.stringify({ slaDays: d, sourcingThreshold: th, renewalLeadDays: lead })]);
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

// ─── Rinnovi dei contratti ───────────────────────────────────
/** Crea il task di rinnovo per i contratti attivi la cui data chiave (disdetta o scadenza) è entro N giorni, uno per ciclo. */
export async function ensureRenewalTasks(db: Queryable): Promise<number> {
  const { renewalLeadDays } = await loadRdaSettings(db);
  const r = await db.query(`insert into tasks (source, source_key, title, due, assignee_id, assignee_auto, contract_id, meta, created_by)
    select 'contract', 'C' || c.id || ':' || k.key, left('Rinnovo · ' || c.supplier || ' — ' || c.object, 200), k.key::date, u.id, u.id is not null, c.id,
      jsonb_build_object('value', c.value, 'currency', c.currency, 'supplier', c.supplier, 'object', c.object, 'keyDate', k.key, 'end', c.end_date, 'noticeDate', c.notice_date), 'Sistema'
    from contracts c cross join lateral (select coalesce(nullif(c.notice_date, ''), c.end_date) as key) k
    left join lateral (select id from users where lower(name) = lower(c.owner) and active and role in ('buyer','manager') order by id limit 1) u on true
    where c.status = 'active' and not c.ceased and k.key ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' and k.key::date - $1::int <= current_date
      and not exists (select 1 from tasks t where t.source = 'contract' and t.contract_id = c.id and t.status = 'open')
    on conflict do nothing`, [renewalLeadDays]);
  return r.rowCount ?? 0;
}

const OUTCOMES: ContractOutcome[] = ["renewed", "replaced", "extended", "ceased"];
const OUTCOME_LABEL: Record<ContractOutcome, string> = { renewed: "Rinnovato", replaced: "Sostituito da un nuovo contratto", extended: "Prorogato", ceased: "Cessato" };
const isoDay = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(new Date(v).getTime()) ? v : null);
const nowTs = () => new Date().toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" });

/** Cosa manca per chiudere una pratica (rinnovo o acquisto manuale); null = si può chiudere. */
function closeBlocker(t: Task): string | null {
  if (t.source === "manual") {
    if (t.kind !== "purchase") return null;
    if (t.sourcingRequired && t.sourcingStatus !== "ok") return t.sourcingStatus === "pending" ? "L'eccezione al confronto è in attesa del Manager" : "Acquisto sopra soglia: registra il confronto con un altro fornitore (o strategica, single source, eccezione)";
    if (!t.newContractId && !t.documents.some(d => d.kind === "offer" || d.kind === "contract")) return "Allega l'offerta accettata o registra il contratto firmato";
    if (!t.poNumbers.length && !t.noPoReason) return "Indica il numero di PO, oppure perché non serve";
    return null;
  }
  if (!t.outcome) return "Registra prima l'esito del rinnovo: rinnovo, nuovo contratto, proroga o cessazione";
  if (t.outcome === "renewed" || t.outcome === "replaced") {
    if (!t.newContractId) return "Carica il nuovo contratto";
    if (t.sourcingRequired && t.sourcingStatus !== "ok") return t.sourcingStatus === "pending" ? "L'eccezione al confronto è in attesa del Manager" : "Registra il confronto con un altro fornitore (o strategica, single source, eccezione)";
    if (!t.poNumbers.length && !t.noPoReason) return "Indica il numero di PO, oppure perché non serve";
  }
  return null;
}
/**
 * Collega in automatico il PO ai rinnovi firmati che lo aspettano: tramite le RDA indicate nella pratica,
 * oppure tramite il codice SAP del fornitore del nuovo contratto (PO emessi da 30 giorni prima dell'esito in poi).
 * Poi chiude le pratiche complete. Restituisce quante pratiche ha chiuso.
 */
export async function autoLinkPos(db: Queryable): Promise<number> {
  const pratica = "((t.source = 'contract' and t.outcome in ('renewed','replaced')) or (t.source = 'manual' and t.kind = 'purchase'))";
  const waiting = `${pratica} and t.status = 'open' and cardinality(t.po_numbers) = 0 and t.no_po_reason = ''`;
  await db.query(`update tasks t set po_numbers = x.pos, updated_at = now() from (
      select t.id, array_agg(distinct p.po) as pos from tasks t join sap_pos p on p.pr = any(t.rda_numbers) where ${waiting} group by t.id) x where t.id = x.id`);
  await db.query(`update tasks t set po_numbers = x.pos, updated_at = now() from (
      select t.id, array_agg(distinct p.po) as pos from tasks t
        join contracts nc on nc.id = t.new_contract_id join suppliers s on s.id = nc.supplier_id
        join contracts oc on oc.id = t.contract_id
        join sap_pos p on ltrim(p.supplier_code, '0') = ltrim(s.sap_code, '0') and coalesce(s.sap_code, '') <> '' and p.doc_date >= coalesce(oc.closed_at, t.created_at)::date - 30
      where t.source = 'contract' and ${waiting} group by t.id) x where t.id = x.id`);
  const { sourcingThreshold } = await loadRdaSettings(db);
  const rows = (await db.query(`select t.* from tasks t where ${pratica} and t.status = 'open' and cardinality(t.po_numbers) > 0`)).rows;
  const docs = rows.length ? (await db.query("select * from task_documents where task_id = any($1)", [rows.map(r => r.id)])).rows : [];
  let closed = 0;
  for (const r of rows) {
    if (closeBlocker(mapTask(r, [], sourcingThreshold, docs))) continue;
    await db.query("update tasks set status = 'done', done_at = now(), done_reason = 'outcome', done_by = 'SAP', updated_at = now() where id = $1", [r.id]);
    closed++;
  }
  return closed;
}

async function closeIfComplete(user: User, id: number): Promise<TaskDetail> {
  const t = await getTask(user, id);
  if (t.status === "open" && (t.source === "contract" || (t.source === "manual" && t.kind === "purchase")) && !closeBlocker(t))
    await getPool().query("update tasks set status = 'done', done_at = now(), done_reason = 'outcome', done_by = $2, updated_at = now() where id = $1", [id, user.name]);
  return getTask(user, id);
}
async function attachDoc(db: Queryable, taskId: number, kind: TaskDocKind, doc: Row | undefined, by: string): Promise<{ name: string; path: string } | null> {
  if (!doc) return null;
  const path = str(doc.filePath, 300), name = str(doc.fileName, 200);
  if (!FILE_PATH_RE.test(path) || !name) bad("Documento non valido");
  await db.query("insert into task_documents (task_id, kind, file_name, file_path, size, uploaded_by) values ($1,$2,$3,$4,$5,$6)", [taskId, kind, name, path, Math.max(0, Number(doc.size) || 0), by]);
  return { name, path };
}
const audit = (db: Queryable, contractId: number, user: string, action: string, detail: string) =>
  db.query("insert into audit_log (contract_id, ts, user_name, action, detail) values ($1,$2,$3,$4,$5)", [contractId, nowTs(), user, action, detail]);

interface ContractDefaults { internalOrder?: string; supplier: string; object: string; category: string; country: string; currency: string; owner: string; boEmail: string; type: string; supplierId: number | null; replaces: number | null }
/** Crea un contratto nel registro (con il suo piano di rinnovo) a partire dal form dell'esito o della pratica d'acquisto. */
async function insertContract(db: Queryable, c: Row, note: string, d: ContractDefaults): Promise<{ id: number; supplier: string; end: string; value: number; fileName: string; filePath: string }> {
  const end = isoDay(c.end); if (!end) bad("Indica la scadenza del contratto");
  const start = isoDay(c.start) ?? "";
  if (start && start > end!) bad("La scadenza deve essere successiva alla data di inizio");
  const noticeDays = c.noticeDays === undefined || c.noticeDays === null || c.noticeDays === "" ? null : Number(c.noticeDays);
  if (noticeDays !== null && (!Number.isInteger(noticeDays) || noticeDays < 1 || noticeDays > 1095)) bad("Giorni di preavviso non validi");
  let noticeDate = isoDay(c.noticeDate) ?? "";
  if (noticeDays !== null && !noticeDate) { const x = new Date(`${end}T00:00:00Z`); x.setUTCDate(x.getUTCDate() - noticeDays); noticeDate = x.toISOString().slice(0, 10); }
  if (noticeDate && noticeDate > end!) bad("La data limite di disdetta deve precedere la scadenza");
  const supplier = str(c.supplier, 200) || d.supplier;
  if (!supplier) bad("Indica il fornitore");
  const value = Number(c.value); if (!Number.isFinite(value) || value < 0) bad("Valore del contratto non valido");
  const filePath = str(c.filePath, 300), fileName = str(c.fileName, 200);
  if (!FILE_PATH_RE.test(filePath) || !fileName) bad("Carica il documento del contratto firmato");
  // Fornitore in anagrafica: quello scelto, altrimenti quello di partenza se il nome non cambia.
  let supplierId: number | null = Number.isInteger(c.supplierId) && c.supplierId > 0 ? c.supplierId : null;
  if (supplierId && !(await db.query("select 1 from suppliers where id = $1", [supplierId])).rows.length) bad("Fornitore non trovato in anagrafica");
  if (!supplierId && supplier.toLowerCase() === d.supplier.toLowerCase()) supplierId = d.supplierId;
  const id = (await db.query(`insert into contracts (supplier, object, category, country, value, currency, start_date, end_date, owner, bo_email, renewal, type, notes, ceased, file_name, file_path, notice_days, notice_date, replaces, supplier_id)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'Non definito',$11,$12,false,$13,$14,$15,$16,$17,$18) returning id`,
    [supplier, str(c.object, 300) || d.object, d.category, d.country, value, str(c.currency, 3) || d.currency, start, end, d.owner, str(c.boEmail, 200).toLowerCase() || d.boEmail, d.type, note, fileName, filePath, noticeDays, noticeDate, d.replaces, supplierId])).rows[0].id as number;
  await db.query("update contracts set owner_id = (select u.id from users u where lower(u.name) = lower(contracts.owner) and u.role in ('manager','buyer')) where id = $1", [id]);
  await db.query("update contracts set bo_user_id = (select u.id from users u where lower(u.email) = lower(contracts.bo_email) and u.role = 'bo' and u.active) where id = $1 and bo_email <> ''", [id]);
  const io = str(c.internalOrder, 40).replace(/\s+/g, "") || d.internalOrder;
  if (io) await db.query("update contracts set internal_order = $2 where id = $1", [id, io]);
  for (const s of makePlan(id, noticeDate || end!))
    await db.query(`insert into plan_steps (contract_id, step_id, scheduled_date, original_date, status, completed_at, completed_by, bo_decision, bo_notes, bo_responded_at, modified, modified_reason) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [id, s.stepId, s.scheduledDate, s.originalDate, s.status, s.completedAt, s.completedBy, s.boDecision, s.boNotes, s.boRespondedAt, s.modified, s.modifiedReason]);
  return { id, supplier, end: end!, value, fileName, filePath };
}

/** Pratica d'acquisto manuale chiusa con un contratto firmato: il contratto entra nel registro (e da lì partiranno i rinnovi). */
export async function registerPurchaseContract(user: User, id: number, input: Row): Promise<TaskDetail> {
  const t = await getTask(user, id);
  if (t.source !== "manual" || t.kind !== "purchase") bad("Il contratto si registra qui solo sulle pratiche d'acquisto manuali");
  if (t.newContractId) throw new HttpError(409, "Il contratto di questa pratica è già stato registrato");
  const note = str(input?.note, 1000);
  await inTransaction(async db => {
    const owner = (await db.query("select name from users where id = $1 and active and role in ('buyer','manager')", [t.assigneeId])).rows[0]?.name ?? user.name;
    const c = (input?.contract ?? {}) as Row;
    const nc = await insertContract(db, c, note, { supplier: t.meta.supplier ?? "", object: t.title, category: str(c.category, 100), country: str(c.country, 100) || "Italia", currency: t.meta.currency ?? "EUR", owner, boEmail: "", type: str(c.type, 100) || "Servizi", supplierId: t.meta.supplierId ?? null, replaces: null, internalOrder: t.meta.internalOrder || Object.keys(t.meta.io ?? {})[0] || "" });
    await db.query("update tasks set outcome = 'new_contract', new_contract_id = $2, meta = meta || jsonb_build_object('value', $3::numeric, 'supplier', $4::text), updated_at = now() where id = $1", [id, nc.id, nc.value, nc.supplier]);
    await db.query("insert into task_documents (task_id, kind, file_name, file_path, uploaded_by) values ($1,'contract',$2,$3,$4)", [id, nc.fileName, nc.filePath, user.name]);
    await audit(db, nc.id, user.name, "Contratto creato", `Da pratica d'acquisto: ${t.title}${note ? ` · ${note}` : ""}`);
  });
  await autoLinkPos(getPool());
  return closeIfComplete(user, id);
}

/** Registra l'esito di un rinnovo e lo applica al contratto: nuovo contratto collegato, proroga o cessazione. */
export async function setRenewalOutcome(user: User, id: number, input: Row): Promise<TaskDetail> {
  const t = await getTask(user, id);
  if (t.source !== "contract" || !t.contractId) bad("L'esito si registra sui task di rinnovo dei contratti");
  if (t.outcome) throw new HttpError(409, "L'esito di questo rinnovo è già stato registrato");
  const outcome = input?.outcome as ContractOutcome;
  if (!OUTCOMES.includes(outcome)) bad("Scegli l'esito del rinnovo");
  const note = str(input?.note, 1000);
  await inTransaction(async db => {
    const old = (await db.query("select * from contracts where id = $1 for update", [t.contractId])).rows[0];
    if (!old) throw new HttpError(404, "Contratto non trovato");
    if (old.status !== "active") throw new HttpError(409, "Il contratto è già chiuso");
    if (outcome === "renewed" || outcome === "replaced") {
      const c = (input?.contract ?? {}) as Row;
      const { id: nc, supplier, end, value, fileName, filePath } = await insertContract(db, c, note, { supplier: old.supplier, object: old.object, category: old.category, country: old.country, currency: old.currency, owner: old.owner, boEmail: old.bo_email, type: old.type, supplierId: old.supplier_id ?? null, replaces: old.id, internalOrder: t.meta.internalOrder || old.internal_order || "" });
      await db.query("update contracts set status = 'closed', outcome = $2, outcome_note = $3, closed_at = now(), replaced_by = $4, renewal = $5 where id = $1", [old.id, outcome, note, nc, OUTCOME_LABEL[outcome]]);
      // Da qui la soglia del confronto vale sul nuovo contratto; il valore precedente resta come riferimento per il saving.
      await db.query("update tasks set outcome = $2, new_contract_id = $3, meta = meta || jsonb_build_object('previousValue', meta->'value', 'value', $4::numeric), updated_at = now() where id = $1", [id, outcome, nc, value]);
      await db.query("insert into task_documents (task_id, kind, file_name, file_path, uploaded_by) values ($1,'contract',$2,$3,$4)", [id, fileName, filePath, user.name]);
      await audit(db, old.id, user.name, OUTCOME_LABEL[outcome], `Sostituito dal contratto #${nc} (${supplier}, scadenza ${end})${note ? ` · ${note}` : ""}`);
      await audit(db, nc, user.name, "Contratto creato", `${outcome === "renewed" ? "Rinnovo" : "Sostituisce"} del contratto #${old.id}`);
    } else if (outcome === "extended") {
      const end = isoDay(input?.end); if (!end || end <= old.end_date) bad("Indica la nuova scadenza, successiva a quella attuale");
      const noticeDays = old.notice_days as number | null;
      let noticeDate = isoDay(input?.noticeDate) ?? "";
      if (!noticeDate && noticeDays) { const d = new Date(`${end}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - noticeDays); noticeDate = d.toISOString().slice(0, 10); }
      if (noticeDate && noticeDate > end!) bad("La data limite di disdetta deve precedere la scadenza");
      const doc = await attachDoc(db, id, "addendum", input?.document as Row | undefined, user.name);
      if (!doc) bad("Carica l'addendum o la lettera di proroga");
      const plan = (await db.query("select * from plan_steps where contract_id = $1", [old.id])).rows.map(s => ({ contractId: old.id, stepId: s.step_id, scheduledDate: s.scheduled_date, originalDate: s.original_date, status: s.status, completedAt: s.completed_at, completedBy: s.completed_by, boDecision: s.bo_decision, boNotes: s.bo_notes, boRespondedAt: s.bo_responded_at, modified: s.modified, modifiedReason: s.modified_reason }));
      // Nuovo ciclo: il piano riparte da capo sulla nuova data.
      const next = reschedulePlan(plan.map(s => ({ ...s, status: "upcoming" as const })), old.id, noticeDate || end!);
      await db.query("delete from plan_steps where contract_id = $1", [old.id]);
      for (const s of next)
        await db.query(`insert into plan_steps (contract_id, step_id, scheduled_date, original_date, status, completed_at, completed_by, bo_decision, bo_notes, bo_responded_at, modified, modified_reason) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [old.id, s.stepId, s.scheduledDate, s.originalDate, s.status, s.completedAt, s.completedBy, s.boDecision, s.boNotes, s.boRespondedAt, s.modified, s.modifiedReason]);
      await db.query("update contracts set end_date = $2, notice_date = $3, renewal = 'Non definito' where id = $1", [old.id, end, noticeDate]);
      await db.query("update tasks set outcome = 'extended', status = 'done', done_at = now(), done_reason = 'outcome', done_by = $2, updated_at = now() where id = $1", [id, user.name]);
      await audit(db, old.id, user.name, "Prorogato", `Nuova scadenza ${end}${noticeDate ? `, disdetta entro ${noticeDate}` : ""} · ${doc!.name}${note ? ` · ${note}` : ""}`);
    } else {
      const sent = isoDay(input?.sentDate); if (!sent) bad("Indica la data di invio della disdetta");
      const doc = await attachDoc(db, id, "termination", input?.document as Row | undefined, user.name);
      if (!doc) bad("Carica la disdetta inviata (PEC, raccomandata o lettera)");
      await db.query("update contracts set status = 'closed', outcome = 'ceased', ceased = true, outcome_note = $2, closed_at = now(), renewal = 'Cessato' where id = $1", [old.id, `Disdetta inviata il ${sent}${note ? ` · ${note}` : ""}`]);
      await db.query("update tasks set outcome = 'ceased', status = 'done', done_at = now(), done_reason = 'outcome', done_by = $2, updated_at = now() where id = $1", [id, user.name]);
      await audit(db, old.id, user.name, "Cessato", `Disdetta inviata il ${sent} · ${doc!.name}${note ? ` · ${note}` : ""}`);
    }
  });
  await autoLinkPos(getPool());
  return closeIfComplete(user, id);
}

/** Numeri di RDA e PO collegati alla pratica (oltre a quelli letti da SAP), o il motivo per cui il PO non serve. */
export async function setTaskLinks(user: User, id: number, input: Row): Promise<TaskDetail> {
  const t = await getTask(user, id);
  if (t.source === "manual" && t.kind !== "purchase") bad("RDA e PO si collegano alle pratiche d'acquisto");
  const list = (v: unknown) => [...new Set((Array.isArray(v) ? v : []).map(x => str(x, 30).replace(/\s+/g, "")).filter(Boolean))].slice(0, 20);
  const sets: string[] = [], vals: unknown[] = [id];
  if (input?.poNumbers !== undefined) { const p = list(input.poNumbers); if (p.some(x => !/^[A-Za-z0-9/-]{3,30}$/.test(x))) bad("Numero di PO non valido"); vals.push(p); sets.push(`po_numbers = $${vals.length}`); }
  if (input?.rdaNumbers !== undefined) { const p = list(input.rdaNumbers); if (p.some(x => !/^[A-Za-z0-9/-]{3,30}$/.test(x))) bad("Numero di RDA non valido"); vals.push(p); sets.push(`rda_numbers = $${vals.length}`); }
  if (input?.internalOrder !== undefined) {
    const io = str(input.internalOrder, 40).replace(/\s+/g, "");
    if (io && !/^[A-Za-z0-9/._-]{3,40}$/.test(io)) bad("Internal order non valido");
    if (t.source === "rda" && t.meta.io && Object.keys(t.meta.io).length) bad("Questa RDA ha già l'internal order da SAP");
    vals.push(io); sets.push(`meta = meta || jsonb_build_object('internalOrder', $${vals.length}::text)`);
  }
  if (input?.noPoReason !== undefined) { const r = str(input.noPoReason, 500); if (r && r.length < 5) bad("Spiega perché il PO non serve"); vals.push(r); sets.push(`no_po_reason = $${vals.length}`); }
  if (!sets.length) return t;
  // Una RDA già arrivata da SAP come task a sé viene unita a questa pratica, per non lavorarla due volte.
  const newRdas = input?.rdaNumbers !== undefined && t.source !== "rda" ? list(input.rdaNumbers).filter(x => !t.rdaNumbers.includes(x)) : [];
  if (newRdas.length) {
    const dup = (await getPool().query("select id, source_key, sourcing, (select count(*)::int from task_documents d where d.task_id = t.id) as docs from tasks t where source = 'rda' and status = 'open' and source_key = any($1)", [newRdas])).rows;
    const busy = dup.find(d => d.sourcing || d.docs > 0);
    if (busy) throw new HttpError(409, `La RDA ${busy.source_key} ha già un task con confronto o documenti: completa la pratica da quel task`);
    const other = (await getPool().query("select id from tasks where id <> $1 and source in ('manual','contract') and status = 'open' and rda_numbers && $2::text[]", [id, newRdas])).rows[0];
    if (other) throw new HttpError(409, "Questa RDA è già collegata a un'altra pratica aperta");
    for (const d of dup) await getPool().query("update tasks set status = 'done', done_at = now(), done_reason = 'merged', done_by = $2, meta = meta || jsonb_build_object('mergedInto', $3::int), updated_at = now() where id = $1", [d.id, user.name, id]);
  }
  await getPool().query(`update tasks set ${sets.join(", ")}, updated_at = now() where id = $1`, vals);
  await autoLinkPos(getPool());
  return closeIfComplete(user, id);
}

const DOC_KINDS: TaskDocKind[] = ["offer", "contract", "addendum", "termination", "other"];
export async function addTaskDocument(user: User, id: number, input: Row): Promise<TaskDetail> {
  await getTask(user, id);
  const kind = DOC_KINDS.includes(input?.kind) ? input.kind as TaskDocKind : "other";
  await attachDoc(getPool(), id, kind, input, user.name);
  return getTask(user, id);
}
export async function deleteTaskDocument(user: User, id: number, docId: number): Promise<{ task: TaskDetail; staleFile: string | null }> {
  await getTask(user, id);
  const r = (await getPool().query("delete from task_documents where id = $1 and task_id = $2 and kind in ('offer','other') returning file_path", [docId, id])).rows[0];
  if (!r) throw new HttpError(404, "Documento non trovato o non eliminabile");
  return { task: await getTask(user, id), staleFile: r.file_path };
}
export async function taskDocumentPath(user: User, docId: number): Promise<{ fileName: string; filePath: string }> {
  const r = (await getPool().query("select * from task_documents where id = $1", [docId])).rows[0];
  if (!r) throw new HttpError(404, "Documento non trovato");
  await getTask(user, r.task_id);
  return { fileName: r.file_name, filePath: r.file_path };
}
