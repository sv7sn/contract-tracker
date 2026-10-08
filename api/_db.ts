import pg from "pg";
import type { AppState, AuditEntry, CommitPayload, Contract, PlanStep, StepStatus } from "../src/types.ts";

const connectionString = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;

// Una sola connessione per istanza serverless: il pooler di Neon gestisce la concorrenza.
let pool: pg.Pool | undefined;
export function getPool() {
  if (!connectionString) throw new HttpError(503, "Database non configurato (manca DATABASE_URL)");
  pool ??= new pg.Pool({ connectionString, max: 1 });
  return pool;
}

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

const SCHEMA = `
create table if not exists contracts (
  id serial primary key,
  supplier text not null, object text not null, category text not null default '', country text not null default '',
  value double precision not null default 0, currency text not null default 'EUR',
  start_date text not null default '', end_date text not null,
  owner text not null default '', bo_email text not null default '', renewal text not null default 'Non definito',
  type text not null default '', notes text not null default '', ceased boolean not null default false, file_name text
);
create table if not exists plan_steps (
  contract_id integer not null references contracts(id) on delete cascade, step_id text not null,
  scheduled_date text not null, original_date text not null, status text not null,
  completed_at text, completed_by text, bo_decision text, bo_notes text not null default '',
  bo_responded_at text, modified boolean not null default false, modified_reason text not null default '',
  primary key (contract_id, step_id)
);
create table if not exists audit_log (
  id serial primary key,
  contract_id integer not null references contracts(id) on delete cascade,
  ts text not null, user_name text not null, action text not null, detail text not null default ''
);
create index if not exists audit_log_contract_idx on audit_log(contract_id);
`;

let schemaReady: Promise<unknown> | undefined;
export function ensureSchema() {
  schemaReady ??= getPool().query(SCHEMA).catch(err => { schemaReady = undefined; throw err; });
  return schemaReady;
}

// ─── Validazione ─────────────────────────────────────────────
const STATUSES: StepStatus[] = ["upcoming", "done", "pending_bo"];
const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const str = (v: unknown, max = 2000) => typeof v === "string" ? v.slice(0, max) : "";
const nstr = (v: unknown) => typeof v === "string" ? v.slice(0, 2000) : null;
const bad = (msg: string): never => { throw new HttpError(400, msg); };

function cleanContract(c: unknown): Omit<Contract, "id"> & { id?: number } {
  const r = (c ?? {}) as Record<string, unknown>;
  if (!str(r.supplier).trim()) bad("Fornitore obbligatorio");
  if (!str(r.object).trim()) bad("Oggetto obbligatorio");
  if (!isDate(r.end)) bad("Data di scadenza non valida");
  if (r.start !== "" && r.start !== undefined && !isDate(r.start)) bad("Data di inizio non valida");
  const value = Number(r.value);
  return {
    id: Number.isInteger(r.id) ? (r.id as number) : undefined,
    supplier: str(r.supplier, 200), object: str(r.object, 300), category: str(r.category, 100), country: str(r.country, 100),
    value: Number.isFinite(value) ? value : 0, currency: str(r.currency, 3) || "EUR",
    start: str(r.start, 10), end: r.end as string, owner: str(r.owner, 100), boEmail: str(r.boEmail, 200),
    renewal: str(r.renewal, 100) || "Non definito", type: str(r.type, 100), notes: str(r.notes, 4000),
    ceased: r.ceased === true, fileName: nstr(r.fileName),
  };
}

function cleanPlan(plan: unknown): PlanStep[] {
  if (!Array.isArray(plan) || plan.length > 20) return bad("Piano non valido");
  return plan.map((raw: Record<string, unknown>) => {
    if (!isDate(raw.scheduledDate) || !isDate(raw.originalDate) || !STATUSES.includes(raw.status as StepStatus) || !str(raw.stepId)) bad("Attività del piano non valida");
    return {
      contractId: 0, stepId: str(raw.stepId, 50), scheduledDate: raw.scheduledDate as string, originalDate: raw.originalDate as string,
      status: raw.status as StepStatus, completedAt: nstr(raw.completedAt), completedBy: nstr(raw.completedBy),
      boDecision: nstr(raw.boDecision), boNotes: str(raw.boNotes), boRespondedAt: nstr(raw.boRespondedAt),
      modified: raw.modified === true, modifiedReason: str(raw.modifiedReason),
    };
  });
}

function cleanAudit(audit: unknown): (AuditEntry & { contractId?: number })[] {
  if (audit === undefined) return [];
  if (!Array.isArray(audit) || audit.length > 50) return bad("Audit non valido");
  return audit.map((a: Record<string, unknown>) => ({
    contractId: Number.isInteger(a.contractId) ? (a.contractId as number) : undefined,
    ts: str(a.ts, 50), user: str(a.user, 100) || "Sistema", action: str(a.action, 300), detail: str(a.detail, 1000),
  }));
}

export function cleanPayload(body: unknown): CommitPayload {
  const b = (body ?? {}) as Record<string, unknown>;
  return {
    contractId: Number.isInteger(b.contractId) ? (b.contractId as number) : undefined,
    contract: b.contract === undefined ? undefined : cleanContract(b.contract),
    plan: b.plan === undefined ? undefined : cleanPlan(b.plan),
    audit: cleanAudit(b.audit),
  };
}

export function errorResponse(err: unknown) {
  if (err instanceof HttpError) return Response.json({ error: err.message }, { status: err.status });
  console.error(err);
  return Response.json({ error: "Errore del server" }, { status: 500 });
}

const STEP_ORDER = ["analysis", "bo_notify", "bo_response", "action", "negotiation", "signature", "expiry"];

// ─── Lettura ─────────────────────────────────────────────────
export async function loadState(): Promise<AppState> {
  const db = getPool();
  const [c, p, a] = await Promise.all([
    db.query("select * from contracts order by id"),
    db.query(`select * from plan_steps order by contract_id, case step_id ${STEP_ORDER.map((id, i) => `when '${id}' then ${i}`).join(" ")} else 99 end`),
    db.query("select * from audit_log order by id"),
  ]);
  const state: AppState = { contracts: [], plans: {}, auditLogs: {} };
  state.contracts = c.rows.map(r => ({
    id: r.id, supplier: r.supplier, object: r.object, category: r.category, country: r.country, value: r.value, currency: r.currency,
    start: r.start_date, end: r.end_date, owner: r.owner, boEmail: r.bo_email, renewal: r.renewal, type: r.type, notes: r.notes,
    ceased: r.ceased, fileName: r.file_name,
  }));
  for (const r of p.rows) {
    (state.plans[r.contract_id] ??= []).push({
      contractId: r.contract_id, stepId: r.step_id, scheduledDate: r.scheduled_date, originalDate: r.original_date, status: r.status,
      completedAt: r.completed_at, completedBy: r.completed_by, boDecision: r.bo_decision, boNotes: r.bo_notes,
      boRespondedAt: r.bo_responded_at, modified: r.modified, modifiedReason: r.modified_reason,
    });
  }
  for (const r of a.rows) (state.auditLogs[r.contract_id] ??= []).push({ ts: r.ts, user: r.user_name, action: r.action, detail: r.detail });
  return state;
}

// ─── Scrittura (tutto in una transazione) ────────────────────
type Queryable = Pick<pg.PoolClient, "query">;

async function upsertContract(db: Queryable, c: Omit<Contract, "id"> & { id?: number }): Promise<number> {
  const cols = [c.supplier, c.object, c.category, c.country, c.value, c.currency, c.start, c.end, c.owner, c.boEmail, c.renewal, c.type, c.notes, c.ceased, c.fileName];
  if (c.id === undefined) {
    const r = await db.query(
      `insert into contracts (supplier, object, category, country, value, currency, start_date, end_date, owner, bo_email, renewal, type, notes, ceased, file_name)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) returning id`, cols);
    return r.rows[0].id;
  }
  const r = await db.query(
    `update contracts set supplier=$1, object=$2, category=$3, country=$4, value=$5, currency=$6, start_date=$7, end_date=$8,
       owner=$9, bo_email=$10, renewal=$11, type=$12, notes=$13, ceased=$14, file_name=$15 where id=$16`, [...cols, c.id]);
  if (!r.rowCount) throw new HttpError(404, "Contratto non trovato");
  return c.id;
}

async function replacePlan(db: Queryable, contractId: number, plan: PlanStep[]) {
  await db.query("delete from plan_steps where contract_id = $1", [contractId]);
  for (const s of plan) {
    await db.query(
      `insert into plan_steps (contract_id, step_id, scheduled_date, original_date, status, completed_at, completed_by, bo_decision, bo_notes, bo_responded_at, modified, modified_reason)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [contractId, s.stepId, s.scheduledDate, s.originalDate, s.status, s.completedAt, s.completedBy, s.boDecision, s.boNotes, s.boRespondedAt, s.modified, s.modifiedReason]);
  }
}

async function addAudit(db: Queryable, contractId: number, entries: (AuditEntry & { contractId?: number })[]) {
  for (const e of entries) {
    await db.query("insert into audit_log (contract_id, ts, user_name, action, detail) values ($1,$2,$3,$4,$5)", [e.contractId ?? contractId, e.ts, e.user, e.action, e.detail]);
  }
}

async function inTransaction<T>(fn: (db: Queryable) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const out = await fn(client);
    await client.query("commit");
    return out;
  } catch (err) {
    await client.query("rollback").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** Salva una modifica. Se il contratto è nuovo (senza id) restituisce l'id assegnato dal database. */
export async function commit(payload: CommitPayload): Promise<number> {
  return inTransaction(async db => {
    const contractId = payload.contract ? await upsertContract(db, payload.contract) : payload.contractId;
    if (contractId === undefined) throw new HttpError(400, "Contratto mancante");
    if (payload.plan) await replacePlan(db, contractId, payload.plan);
    if (payload.audit?.length) await addAudit(db, contractId, payload.audit);
    return contractId;
  });
}

/** Inserisce i dati demo solo se il database è ancora vuoto. Restituisce true se ha inserito qualcosa. */
export async function seedIfEmpty(state: AppState): Promise<boolean> {
  return inTransaction(async db => {
    await db.query("lock table contracts in exclusive mode");
    const { rows } = await db.query("select count(*)::int as n from contracts");
    if (rows[0].n > 0) return false;
    for (const c of state.contracts) {
      const clean = cleanContract({ ...c, id: undefined });
      const id = await upsertContract(db, clean);
      await replacePlan(db, id, cleanPlan(state.plans[c.id] ?? []));
      await addAudit(db, id, cleanAudit(state.auditLogs[c.id] ?? []));
    }
    return true;
  });
}
