import pg from "pg";
import type { AppState, AuditEntry, CommitPayload, Contract, NewUserInput, PlanStep, Role, StepStatus, UpdateUserInput, User } from "../src/types.ts";
import { HttpError } from "./_http.js";
import { hashPassword, MIN_PASSWORD } from "./_crypto.js";
import { DEFAULT_DOC_RULES, DEFAULT_DOC_TYPES } from "./_supplier-rules.js";
import { canCreateContract, canDeleteContract, canEditContract, canRespondBO, canViewContract } from "./_permissions.js";
import { FILE_PATH_RE } from "./_blob.js";

const connectionString = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;

// Una sola connessione per istanza serverless: il pooler di Neon gestisce la concorrenza.
let pool: pg.Pool | undefined;
export function getPool() {
  if (!connectionString) throw new HttpError(503, "Database non configurato (manca DATABASE_URL)");
  pool ??= new pg.Pool({ connectionString, max: 1 });
  return pool;
}

const SCHEMA = `
create table if not exists contracts (
  id serial primary key,
  supplier text not null, object text not null, category text not null default '', country text not null default '',
  value double precision not null default 0, currency text not null default 'EUR',
  start_date text not null default '', end_date text not null,
  owner text not null default '', bo_email text not null default '', renewal text not null default 'Non definito',
  type text not null default '', notes text not null default '', ceased boolean not null default false, file_name text, file_path text
);
alter table contracts add column if not exists file_path text;
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
create table if not exists users (
  id serial primary key,
  email text not null, name text not null,
  role text not null,
  title text not null default '', password_hash text not null,
  active boolean not null default true, created_at timestamptz not null default now()
);
create unique index if not exists users_email_key on users (lower(email));
create table if not exists settings (key text primary key, value jsonb not null);
create table if not exists buying_companies (
  code text primary key, name text not null, sap_company_code text not null default '', purch_org text not null default ''
);
create table if not exists industry_codes (code text primary key, name text not null);
create table if not exists industry_buyers (
  industry_code text not null references industry_codes(code) on delete cascade,
  user_id integer not null references users(id) on delete cascade, primary key (industry_code, user_id)
);
create table if not exists payment_terms (code text primary key, label text not null);
create table if not exists suppliers (
  id serial primary key, email text not null, name text not null,
  company_codes text[] not null default '{}', industry_code text not null, customer_code text not null default '',
  reference_buyer_id integer references users(id) on delete set null,
  status text not null, data jsonb not null default '{}'::jsonb,
  payment_terms text, sap_code text, sap_account_group text,
  rejection_reason text not null default '', is_update boolean not null default false,
  token_hash text, token_expires timestamptz, sap_lock timestamptz,
  user_id integer references users(id) on delete set null, invited_by integer references users(id) on delete set null,
  created_at timestamptz not null default now(), submitted_at timestamptz, updated_at timestamptz not null default now()
);
create unique index if not exists suppliers_email_key on suppliers (lower(email));
create index if not exists suppliers_status_idx on suppliers (status);
create table if not exists supplier_documents (
  id serial primary key, supplier_id integer not null references suppliers(id) on delete cascade,
  type text not null, file_name text not null, file_path text not null, size integer not null default 0,
  valid_until date, uploaded_at timestamptz not null default now(), uploaded_by text not null default ''
);
create index if not exists supplier_documents_supplier_idx on supplier_documents (supplier_id);
create table if not exists supplier_events (
  id serial primary key, supplier_id integer not null references suppliers(id) on delete cascade,
  at timestamptz not null default now(), actor text not null, action text not null, detail text not null default '',
  public boolean not null default false
);
create index if not exists supplier_events_supplier_idx on supplier_events (supplier_id);
create table if not exists notifications (
  id serial primary key, supplier_id integer references suppliers(id) on delete set null,
  to_email text not null, template text not null, subject text not null, body text not null,
  status text not null, error text, created_at timestamptz not null default now()
);
create table if not exists sap_requests (
  id serial primary key, supplier_id integer references suppliers(id) on delete set null, mode text not null,
  payload jsonb not null, response jsonb, ok boolean not null, created_at timestamptz not null default now()
);

-- Ruoli ammessi: aggiunti "finance" e "supplier" (si aggiorna il vincolo solo se non li include ancora).
alter table users drop constraint if exists users_role_check;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'users_role_check_v2') then
    alter table users add constraint users_role_check_v2 check (role in ('manager','buyer','finance','bo','supplier'));
  end if;
end $$;
-- Il nome è unico solo tra il personale interno (i fornitori possono avere nomi uguali o simili).
drop index if exists users_name_key;
create unique index if not exists users_name_staff_key on users (lower(name)) where role <> 'supplier';
create table if not exists doc_types (
  key text primary key, label text not null, help text not null default '',
  expires boolean not null default false, multiple boolean not null default false, position integer not null default 0
);
create table if not exists doc_rules (
  id serial primary key, doc_type text not null references doc_types(key) on delete cascade,
  scope text not null check (scope in ('all','country','industry')), value text not null default '',
  level text not null check (level in ('required','optional')), unique (doc_type, scope, value)
);
alter table supplier_documents add column if not exists ai_status text;
alter table supplier_documents add column if not exists ai_result jsonb;
alter table supplier_documents add column if not exists ai_checked_at timestamptz;
create table if not exists doc_reminders (
  id serial primary key, supplier_id integer not null references suppliers(id) on delete cascade,
  doc_type text not null, doc_id integer, stage text not null, channel text not null default 'email',
  kind text not null default 'auto', sent_by text not null default 'Sistema', status text not null default 'logged',
  note text not null default '', sent_at timestamptz not null default now()
);
create index if not exists doc_reminders_supplier_idx on doc_reminders (supplier_id, doc_type);
create table if not exists tasks (
  id serial primary key, source text not null check (source in ('rda','manual')), source_key text,
  title text not null, detail text not null default '', due date, priority text not null default 'normal',
  assignee_id integer references users(id) on delete set null, assignee_auto boolean not null default false,
  group_key text not null default '', status text not null default 'open' check (status in ('open','done')),
  done_at timestamptz, done_reason text not null default '', done_by text not null default '',
  meta jsonb not null default '{}'::jsonb, created_by text not null default '',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index if not exists tasks_source_key_idx on tasks (source, source_key) where source_key is not null;
create index if not exists tasks_assignee_idx on tasks (assignee_id, status);
create table if not exists rda_lines (
  id serial primary key, pr text not null, item text not null default '0', pgr text not null default '', short_text text not null default '',
  qty numeric not null default 0, unit text not null default '', price numeric not null default 0, per numeric not null default 1, currency text not null default 'EUR',
  req_date date, deliv_date date, release_date date, requested_by text not null default '', created_by text not null default '',
  plant text not null default '', cost_center text not null default '', gl_account text not null default '', value numeric not null default 0
);
create index if not exists rda_lines_pr_idx on rda_lines (pr);
create table if not exists sap_pos (
  po text not null, pr text not null, supplier_code text not null default '', supplier_name text not null default '',
  doc_date date, pgr text not null default '', created_by text not null default '', seen_at timestamptz not null default now(), primary key (po, pr)
);
create index if not exists sap_pos_pr_idx on sap_pos (pr);
create table if not exists pgr_assignments (pgr text primary key, user_id integer references users(id) on delete set null, note text not null default '');
create table if not exists sap_imports (
  id serial primary key, kind text not null, file_name text not null, rows integer not null default 0, result jsonb not null default '{}'::jsonb,
  at timestamptz not null default now(), by text not null default ''
);
alter table suppliers add column if not exists lifecycle text not null default 'active';
alter table suppliers add column if not exists lifecycle_reason text not null default '';
alter table suppliers add column if not exists approved_data jsonb;
alter table suppliers add column if not exists approved_at timestamptz;
alter table suppliers add column if not exists compliance jsonb;
alter table suppliers add column if not exists dup_confirmed integer[] not null default '{}';
update suppliers set approved_data = data, approved_at = updated_at where status = 'registered' and approved_data is null;
create table if not exists login_attempts (email text not null, at timestamptz not null default now());
create index if not exists login_attempts_idx on login_attempts (email, at);
`;

/** Ruoli assegnabili dalla pagina Utenti: i fornitori si creano solo tramite invito. */
export const ROLES: Role[] = ["manager", "buyer", "finance", "bo"];

let ready: Promise<unknown> | undefined;
/** Crea le tabelle e, se non esiste ancora nessun utente, il primo amministratore da ADMIN_EMAIL / ADMIN_PASSWORD. */
export function ensureSchema() {
  ready ??= (async () => {
    const db = getPool();
    await db.query(SCHEMA);
    await db.query(`insert into settings (key, value) values ('sap', $1) on conflict do nothing`, [JSON.stringify({ tradingPartner: "999999", sortKey: "002", cashManagementGroup: "0_VEND_001", releaseGroup: "MFL1", reconciliationAccounts: {} })]);
    await db.query(`insert into industry_codes (code, name) values ('CT00', 'Partner / Clienti') on conflict do nothing`);
    await db.query(`insert into payment_terms (code, label) values ('0030','30 giorni data fattura'),('0060','60 giorni data fattura'),('0090','90 giorni data fattura') on conflict do nothing`);
    await db.query(`insert into settings (key, value) values ('rda', $1) on conflict do nothing`, [JSON.stringify({ slaDays: 7 })]);
    await db.query(`insert into settings (key, value) values ('reminders', $1) on conflict do nothing`, [JSON.stringify({ enabled: true, days: [60, 30, 15], repeatDays: 7, escalateAfter: 2 })]);
    if (!(await db.query("select 1 from doc_types limit 1")).rows.length) {
      for (const [i, t] of DEFAULT_DOC_TYPES.entries()) await db.query("insert into doc_types (key, label, help, expires, multiple, position) values ($1,$2,$3,$4,$5,$6) on conflict do nothing", [t.key, t.label, t.help, t.expires, t.multiple, i]);
      for (const r of DEFAULT_DOC_RULES) await db.query("insert into doc_rules (doc_type, scope, value, level) values ($1,$2,$3,$4) on conflict do nothing", [r.docType, r.scope, r.value, r.level]);
    }
    const { rows } = await db.query("select count(*)::int as n from users");
    const email = process.env.ADMIN_EMAIL?.trim(), password = process.env.ADMIN_PASSWORD;
    if (rows[0].n === 0 && email && password) {
      if (password.length < MIN_PASSWORD) { console.error(`ADMIN_PASSWORD troppo corta (minimo ${MIN_PASSWORD} caratteri)`); return; }
      await db.query("insert into users (email, name, role, title, password_hash) values ($1,$2,'manager',$3,$4) on conflict do nothing",
        [email.toLowerCase(), process.env.ADMIN_NAME?.trim() || "Amministratore", "Amministratore", await hashPassword(password)]);
    }
  })().catch(err => { ready = undefined; throw err; });
  return ready;
}

// ─── Validazione ─────────────────────────────────────────────
const STATUSES: StepStatus[] = ["upcoming", "done", "pending_bo"];
const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const isEmail = (v: unknown): v is string => typeof v === "string" && v.length <= 200 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const str = (v: unknown, max = 2000) => typeof v === "string" ? v.slice(0, max) : "";
const nstr = (v: unknown) => typeof v === "string" ? v.slice(0, 2000) : null;
const bad = (msg: string): never => { throw new HttpError(400, msg); };

type ContractInput = Omit<Contract, "id"> & { id?: number };

function cleanContract(c: unknown): ContractInput {
  const r = (c ?? {}) as Record<string, unknown>;
  if (!str(r.supplier).trim()) bad("Fornitore obbligatorio");
  if (!str(r.object).trim()) bad("Oggetto obbligatorio");
  if (!isDate(r.end)) bad("Data di scadenza non valida");
  if (r.start !== "" && r.start !== undefined && !isDate(r.start)) bad("Data di inizio non valida");
  if (r.boEmail && !isEmail(r.boEmail)) bad("Email Business Owner non valida");
  const value = Number(r.value);
  return {
    id: Number.isInteger(r.id) ? (r.id as number) : undefined,
    supplier: str(r.supplier, 200), object: str(r.object, 300), category: str(r.category, 100), country: str(r.country, 100),
    value: Number.isFinite(value) ? value : 0, currency: str(r.currency, 3) || "EUR",
    start: str(r.start, 10), end: r.end as string, owner: str(r.owner, 100), boEmail: str(r.boEmail, 200).toLowerCase(),
    renewal: str(r.renewal, 100) || "Non definito", type: str(r.type, 100), notes: str(r.notes, 4000),
    ceased: r.ceased === true, fileName: nstr(r.fileName),
    filePath: r.filePath == null ? null : typeof r.filePath === "string" && FILE_PATH_RE.test(r.filePath) ? r.filePath : bad("Documento non valido"),
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

function cleanAudit(audit: unknown): AuditEntry[] {
  if (audit === undefined) return [];
  if (!Array.isArray(audit) || audit.length > 50) return bad("Audit non valido");
  return audit.map((a: Record<string, unknown>) => ({ ts: str(a.ts, 50), user: str(a.user, 100), action: str(a.action, 300), detail: str(a.detail, 1000) }));
}

export function cleanPayload(body: unknown): CommitPayload {
  const b = (body ?? {}) as Record<string, unknown>;
  if (b.deleteContractId !== undefined) {
    return Number.isInteger(b.deleteContractId) ? { deleteContractId: b.deleteContractId as number } : bad("Contratto non valido");
  }
  return {
    contractId: Number.isInteger(b.contractId) ? (b.contractId as number) : undefined,
    contract: b.contract === undefined ? undefined : cleanContract(b.contract),
    plan: b.plan === undefined ? undefined : cleanPlan(b.plan),
    audit: cleanAudit(b.audit),
  };
}

// ─── Utenti ──────────────────────────────────────────────────
/** Solo i campi pubblici: mai l'hash della password. */
export const publicUser = (u: User): User => ({ id: u.id, email: u.email, name: u.name, role: u.role, title: u.title, active: u.active });
const toUser = (r: Record<string, unknown>): User => ({ id: r.id as number, email: r.email as string, name: r.name as string, role: r.role as Role, title: r.title as string, active: r.active as boolean });

export async function countUsers(): Promise<number> {
  return (await getPool().query("select count(*)::int as n from users")).rows[0].n;
}
export async function findUserByEmail(email: string): Promise<(User & { passwordHash: string }) | undefined> {
  const r = (await getPool().query("select * from users where lower(email) = lower($1)", [email.trim()])).rows[0];
  return r ? { ...toUser(r), passwordHash: r.password_hash } : undefined;
}
export async function findUserById(id: number): Promise<(User & { passwordHash: string }) | undefined> {
  const r = (await getPool().query("select * from users where id = $1", [id])).rows[0];
  return r ? { ...toUser(r), passwordHash: r.password_hash } : undefined;
}
export async function listUsers(): Promise<User[]> {
  return (await getPool().query("select * from users where role <> 'supplier' order by role, name")).rows.map(toUser);
}

const FAILED_LIMIT = 5;
const WINDOW = "15 minutes";
export async function tooManyAttempts(email: string): Promise<boolean> {
  const db = getPool();
  await db.query("delete from login_attempts where at < now() - interval '1 day'");
  const { rows } = await db.query(`select count(*)::int as n from login_attempts where lower(email) = lower($1) and at > now() - interval '${WINDOW}'`, [email]);
  return rows[0].n >= FAILED_LIMIT;
}
export const recordFailedAttempt = (email: string) => getPool().query("insert into login_attempts (email) values ($1)", [email.toLowerCase()]);
export const clearAttempts = (email: string) => getPool().query("delete from login_attempts where lower(email) = lower($1)", [email]);

export async function setPassword(userId: number, password: string) {
  if (password.length < MIN_PASSWORD) throw new HttpError(400, `La password deve avere almeno ${MIN_PASSWORD} caratteri`);
  await getPool().query("update users set password_hash = $1 where id = $2", [await hashPassword(password), userId]);
}

const uniqueViolation = (err: unknown) => (err as { code?: string })?.code === "23505";

export async function createUser(input: unknown): Promise<User> {
  const r = (input ?? {}) as Partial<NewUserInput>;
  if (!isEmail(r.email)) bad("Email non valida");
  const name = str(r.name, 80).trim();
  if (name.length < 2) bad("Nome obbligatorio");
  if (!ROLES.includes(r.role as Role)) bad("Ruolo non valido");
  if (typeof r.password !== "string" || r.password.length < MIN_PASSWORD) bad(`La password deve avere almeno ${MIN_PASSWORD} caratteri`);
  try {
    const { rows } = await getPool().query("insert into users (email, name, role, title, password_hash) values ($1,$2,$3,$4,$5) returning *",
      [(r.email as string).trim().toLowerCase(), name, r.role, str(r.title, 100), await hashPassword(r.password as string)]);
    return toUser(rows[0]);
  } catch (err) {
    if (uniqueViolation(err)) throw new HttpError(409, "Esiste già un utente con questa email o questo nome");
    throw err;
  }
}

/** Contratti in cui l'utente compare come contract owner (per nome). */
async function countOwnedContracts(u: Pick<User, "name">): Promise<number> {
  return (await getPool().query("select count(*)::int as n from contracts where lower(owner) = lower($1)", [u.name])).rows[0].n;
}

/** Elimina un utente. Non si può eliminare se stessi, l'ultimo manager, né chi è ancora collegato a dei contratti. */
export async function deleteUser(actor: User, id: number): Promise<void> {
  if (!Number.isInteger(id)) bad("Utente non valido");
  const target = await findUserById(id);
  if (!target) throw new HttpError(404, "Utente non trovato");
  if (target.id === actor.id) bad("Non puoi eliminare il tuo account");
  if (target.role === "manager" && target.active) {
    const { rows } = await getPool().query("select count(*)::int as n from users where role = 'manager' and active and id <> $1", [id]);
    if (rows[0].n === 0) bad("Deve restare almeno un manager attivo");
  }
  const owned = await countOwnedContracts(target);
  const asBo = (await getPool().query("select count(*)::int as n from contracts where lower(bo_email) = lower($1)", [target.email])).rows[0].n;
  if (owned || asBo) {
    const parts = [owned && `contract owner di ${owned}`, asBo && `Business Owner di ${asBo}`].filter(Boolean).join(" e ");
    throw new HttpError(409, `${target.name} è ${parts} contratti: riassegnali prima di eliminarlo (oppure disattiva l'utente)`);
  }
  await getPool().query("delete from users where id = $1", [id]);
  await getPool().query("delete from login_attempts where lower(email) = lower($1)", [target.email]);
}

export async function updateUser(actor: User, input: unknown): Promise<User> {
  const r = (input ?? {}) as Partial<UpdateUserInput>;
  if (!Number.isInteger(r.id)) bad("Utente non valido");
  const target = await findUserById(r.id as number);
  if (!target) throw new HttpError(404, "Utente non trovato");
  if (r.role !== undefined && !ROLES.includes(r.role)) bad("Ruolo non valido");
  const role = r.role ?? target.role;
  const active = r.active ?? target.active;
  if (target.id === actor.id && (role !== actor.role || !active)) bad("Non puoi cambiare il tuo ruolo né disattivare il tuo account");
  if (role !== target.role && role === "bo") {
    const owned = await countOwnedContracts(target);
    if (owned > 0) throw new HttpError(409, `${target.name} è contract owner di ${owned} contratti: riassegnali prima di renderlo Business Owner`);
  }
  if (target.role === "manager" && target.active && (role !== "manager" || !active)) {
    const { rows } = await getPool().query("select count(*)::int as n from users where role = 'manager' and active and id <> $1", [target.id]);
    if (rows[0].n === 0) bad("Deve restare almeno un manager attivo");
  }
  const { rows } = await getPool().query("update users set role = $1, title = $2, active = $3 where id = $4 returning *",
    [role, r.title === undefined ? target.title : str(r.title, 100), active, target.id]);
  if (r.password !== undefined) await setPassword(target.id, r.password);
  return toUser(rows[0]);
}

// ─── Lettura (filtrata per ruolo) ────────────────────────────
function rowToContract(r: Record<string, unknown>): Contract {
  return {
    id: r.id as number, supplier: r.supplier as string, object: r.object as string, category: r.category as string, country: r.country as string,
    value: r.value as number, currency: r.currency as string, start: r.start_date as string, end: r.end_date as string, owner: r.owner as string,
    boEmail: r.bo_email as string, renewal: r.renewal as string, type: r.type as string, notes: r.notes as string, ceased: r.ceased as boolean,
    fileName: r.file_name as string | null, filePath: r.file_path as string | null,
  };
}
function rowToStep(r: Record<string, unknown>): PlanStep {
  return {
    contractId: r.contract_id as number, stepId: r.step_id as string, scheduledDate: r.scheduled_date as string, originalDate: r.original_date as string,
    status: r.status as StepStatus, completedAt: r.completed_at as string | null, completedBy: r.completed_by as string | null,
    boDecision: r.bo_decision as string | null, boNotes: r.bo_notes as string, boRespondedAt: r.bo_responded_at as string | null,
    modified: r.modified as boolean, modifiedReason: r.modified_reason as string,
  };
}

const STEP_ORDER = ["analysis", "bo_notify", "bo_response", "action", "negotiation", "signature", "expiry"];
const STEP_ORDER_SQL = `case step_id ${STEP_ORDER.map((id, i) => `when '${id}' then ${i}`).join(" ")} else 99 end`;

/** Restituisce solo i contratti che l'utente può vedere, con i relativi piani e storico. */
export async function loadState(user: User): Promise<AppState> {
  const db = getPool();
  const contracts = (await db.query("select * from contracts order by id")).rows.map(rowToContract).filter(c => canViewContract(user, c));
  const state: AppState = { contracts, plans: {}, auditLogs: {} };
  if (!contracts.length) return state;
  const ids = contracts.map(c => c.id);
  const [p, a] = await Promise.all([
    db.query(`select * from plan_steps where contract_id = any($1) order by contract_id, ${STEP_ORDER_SQL}`, [ids]),
    db.query("select * from audit_log where contract_id = any($1) order by id", [ids]),
  ]);
  for (const r of p.rows) (state.plans[r.contract_id] ??= []).push(rowToStep(r));
  for (const r of a.rows) (state.auditLogs[r.contract_id] ??= []).push({ ts: r.ts, user: r.user_name, action: r.action, detail: r.detail });
  return state;
}

// ─── Scrittura (tutto in una transazione, con controllo dei permessi) ─
export type Queryable = Pick<pg.PoolClient, "query">;

export async function getContract(id: number): Promise<Contract | undefined> { return fetchContract(getPool(), id); }

async function fetchContract(db: Queryable, id: number): Promise<Contract | undefined> {
  const r = (await db.query("select * from contracts where id = $1", [id])).rows[0];
  return r ? rowToContract(r) : undefined;
}
async function fetchPlan(db: Queryable, id: number): Promise<PlanStep[]> {
  return (await db.query(`select * from plan_steps where contract_id = $1 order by ${STEP_ORDER_SQL}`, [id])).rows.map(rowToStep);
}

async function upsertContract(db: Queryable, c: ContractInput): Promise<number> {
  const cols = [c.supplier, c.object, c.category, c.country, c.value, c.currency, c.start, c.end, c.owner, c.boEmail, c.renewal, c.type, c.notes, c.ceased, c.fileName, c.filePath];
  if (c.id === undefined) {
    const r = await db.query(
      `insert into contracts (supplier, object, category, country, value, currency, start_date, end_date, owner, bo_email, renewal, type, notes, ceased, file_name, file_path)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) returning id`, cols);
    return r.rows[0].id;
  }
  const r = await db.query(
    `update contracts set supplier=$1, object=$2, category=$3, country=$4, value=$5, currency=$6, start_date=$7, end_date=$8,
       owner=$9, bo_email=$10, renewal=$11, type=$12, notes=$13, ceased=$14, file_name=$15, file_path=$16 where id=$17`, [...cols, c.id]);
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

async function addAudit(db: Queryable, contractId: number, user: User, entries: AuditEntry[]) {
  for (const e of entries) {
    // L'autore è sempre l'utente della sessione: il client non può attribuire azioni ad altri ("Sistema" indica le azioni automatiche).
    await db.query("insert into audit_log (contract_id, ts, user_name, action, detail) values ($1,$2,$3,$4,$5)",
      [contractId, e.ts, e.user === "Sistema" ? "Sistema" : user.name, e.action, e.detail]);
  }
}

export async function inTransaction<T>(fn: (db: Queryable) => Promise<T>): Promise<T> {
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

const forbidden = () => new HttpError(403, "Operazione non consentita");

async function assertValidOwner(db: Queryable, owner: string) {
  const { rows } = await db.query("select 1 from users where lower(name) = lower($1) and active and role in ('manager','buyer')", [owner]);
  if (!rows.length) bad("Il contract owner deve essere un buyer o un manager attivo");
}

const STEP_FIELDS = ["scheduledDate", "originalDate", "status", "completedAt", "completedBy", "boDecision", "boNotes", "boRespondedAt", "modified", "modifiedReason"] as const;

/** Un Business Owner può solo registrare la propria decisione: cambia lo stato di rinnovo e la sola attività "bo_response". */
function assertBoOnlyChanges(existing: Contract, existingPlan: PlanStep[], contract?: ContractInput, plan?: PlanStep[]) {
  if (contract) {
    for (const k of Object.keys(existing) as (keyof Contract)[]) {
      if (k !== "renewal" && contract[k] !== existing[k]) throw forbidden();
    }
  }
  if (plan) {
    if (plan.length !== existingPlan.length) throw forbidden();
    for (const s of plan) {
      const old = existingPlan.find(o => o.stepId === s.stepId);
      if (!old) throw forbidden();
      if (s.stepId !== "bo_response" && STEP_FIELDS.some(f => s[f] !== old[f])) throw forbidden();
    }
  }
}

/** Salva una modifica verificando i permessi dell'utente. Restituisce l'id del contratto (assegnato dal database se nuovo) e i documenti rimasti senza contratto. */
export async function commit(user: User, payload: CommitPayload): Promise<{ contractId: number; staleFiles: string[] }> {
  return inTransaction(async db => {
    const staleFiles: string[] = [];
    if (payload.deleteContractId !== undefined) {
      if (!canDeleteContract(user)) throw forbidden();
      const r = await db.query("delete from contracts where id = $1 returning file_path", [payload.deleteContractId]);
      if (!r.rowCount) throw new HttpError(404, "Contratto non trovato");
      if (r.rows[0].file_path) staleFiles.push(r.rows[0].file_path);
      return { contractId: payload.deleteContractId, staleFiles };
    }

    const targetId = payload.contract?.id ?? payload.contractId;
    const existing = targetId === undefined ? undefined : await fetchContract(db, targetId);
    if (targetId !== undefined && (!existing || !canViewContract(user, existing))) throw new HttpError(404, "Contratto non trovato");

    let contract = payload.contract;
    let contractId: number;
    if (!existing) {
      if (!contract) throw new HttpError(400, "Contratto mancante");
      if (!canCreateContract(user)) throw forbidden();
      if (user.role === "buyer") contract = { ...contract, owner: user.name };
      else if (contract.owner) await assertValidOwner(db, contract.owner);
      else contract = { ...contract, owner: user.name };
      contractId = await upsertContract(db, contract);
    } else if (canEditContract(user, existing)) {
      if (contract) {
        if (user.role === "buyer") contract = { ...contract, owner: existing.owner };
        else if (contract.owner !== existing.owner) await assertValidOwner(db, contract.owner);
        await upsertContract(db, contract);
        if (existing.filePath && contract.filePath !== existing.filePath) staleFiles.push(existing.filePath);
      }
      contractId = existing.id;
    } else if (canRespondBO(user, existing)) {
      assertBoOnlyChanges(existing, await fetchPlan(db, existing.id), contract, payload.plan);
      if (contract) await upsertContract(db, contract);
      contractId = existing.id;
    } else {
      throw forbidden();
    }

    if (payload.plan) await replacePlan(db, contractId, payload.plan);
    if (payload.audit?.length) await addAudit(db, contractId, user, payload.audit);
    return { contractId, staleFiles };
  });
}

/** Elimina tutti i contratti (piani e storico inclusi). Solo manager, chiamato con conferma esplicita. Restituisce anche i documenti da eliminare. */
export async function purgeContracts(): Promise<{ deleted: number; staleFiles: string[] }> {
  const r = await getPool().query("delete from contracts returning file_path");
  return { deleted: r.rowCount ?? 0, staleFiles: r.rows.map(x => x.file_path).filter(Boolean) };
}
