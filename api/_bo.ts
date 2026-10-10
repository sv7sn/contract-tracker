// Avvisi al Business Owner: il buyer li invia (o li reinvia) dal contratto, con una vera email e un link per rispondere.
// Opzionalmente partono da soli alla data prevista dal piano, con solleciti; questa modalità è spenta finché il Manager non la attiva.
import type { BoInfo, BoNotice, BoSettings, Contract, PlanStep, User } from "../src/types.ts";
import { addAudit, fetchPlan, getContract, getPool, inTransaction, replacePlan, type Queryable } from "./_db.js";
import { HttpError } from "./_http.js";
import { sendMail } from "./_notify.js";
import { canEditContract, canViewContract } from "./_permissions.js";
import { DEFAULT_BO_LEAD_DAYS, reschedulePlan } from "./_plan-rules.js";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const bad = (msg: string): never => { throw new HttpError(400, msg); };
const MAX_REMINDERS = 3;
const SYSTEM: User = { id: 0, email: "", name: "Sistema", role: "manager", title: "", active: true };
const keyDate = (c: Pick<Contract, "end" | "noticeDate">) => c.noticeDate || c.end;
const today = () => new Date().toISOString().slice(0, 10);
const tsNow = () => new Date().toLocaleString("it-IT");
const fmtDay = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("it-IT", { day: "2-digit", month: "long", year: "numeric" });

export async function loadBoSettings(db: Queryable): Promise<BoSettings> {
  const v = (await db.query("select value from settings where key = 'bo_notices'")).rows[0]?.value as Partial<BoSettings> | undefined;
  return { auto: v?.auto === true, reminderDays: Number.isInteger(v?.reminderDays) && (v!.reminderDays as number) >= 2 && (v!.reminderDays as number) <= 60 ? (v!.reminderDays as number) : 7 };
}
export async function saveBoSettings(user: User, input: Row): Promise<BoSettings> {
  if (user.role !== "manager") throw new HttpError(403, "Solo il Manager cambia queste impostazioni");
  const db = getPool();
  const prev = await loadBoSettings(db);
  const days = input?.reminderDays === undefined ? prev.reminderDays : Number(input.reminderDays);
  if (!Number.isInteger(days) || days < 2 || days > 60) bad("I giorni tra un sollecito e l'altro devono essere tra 2 e 60");
  const next: BoSettings = { auto: input?.auto === undefined ? prev.auto : input.auto === true, reminderDays: days };
  await db.query("insert into settings (key, value) values ('bo_notices', $1) on conflict (key) do update set value = excluded.value", [JSON.stringify(next)]);
  await db.query("insert into config_audit (actor, area, action, subject, detail) values ($1,'bo_notices','update','Avvisi ai Business Owner',$2)", [user.name,
    `Invio automatico: ${prev.auto ? "sì" : "no"} → ${next.auto ? "sì" : "no"}; solleciti ogni ${prev.reminderDays} → ${next.reminderDays} giorni`]);
  return next;
}

async function visibleContract(user: User, id: number): Promise<Contract> {
  const c = await getContract(id);
  if (!c || !canViewContract(user, c)) throw new HttpError(404, "Contratto non trovato");
  return c;
}

export async function boInfo(user: User, contractId: number): Promise<BoInfo> {
  const c = await visibleContract(user, contractId);
  return infoFor(getPool(), c);
}

async function infoFor(db: Queryable, c: Contract): Promise<BoInfo> {
  const plan = await fetchPlan(db, c.id);
  const resp = plan.find(s => s.stepId === "bo_response"), notify = plan.find(s => s.stepId === "bo_notify");
  const rows = (await db.query("select * from bo_notices where contract_id = $1 order by sent_at desc, id desc limit 30", [c.id])).rows;
  const notices: BoNotice[] = rows.map(r => ({ id: r.id, kind: r.kind, toEmail: r.to_email, message: r.message, sentBy: r.sent_by, sentAt: new Date(r.sent_at).toISOString(), status: r.status }));
  const answered = resp?.status === "done";
  const since = notices[0]?.sentAt ?? null;
  const waiting = !answered && (resp?.status === "pending_bo" || notify?.status === "done") && since;
  const hasBoAccount = c.boEmail ? (await db.query("select 1 from users where lower(email) = lower($1) and role = 'bo' and active", [c.boEmail])).rows.length > 0 : false;
  return {
    boEmail: c.boEmail, hasBoAccount, leadDays: c.boLeadDays ?? DEFAULT_BO_LEAD_DAYS, defaultLeadDays: DEFAULT_BO_LEAD_DAYS, noticeDate: notify?.scheduledDate ?? "",
    state: answered ? "answered" : waiting ? "waiting" : "to_send", waitingDays: waiting ? Math.max(0, Math.floor((Date.now() - new Date(since as string).getTime()) / 864e5)) : null,
    decision: answered ? resp?.boDecision ?? "" : "", notices, settings: await loadBoSettings(db),
  };
}

/** Invia l'email, registra l'avviso e aggiorna il piano (notifica fatta, risposta attesa). */
async function deliver(db: Queryable, actor: User, c: Contract, opts: { message: string; restart: boolean; auto: boolean; origin: string }): Promise<void> {
  if (!c.boEmail) bad("Manca l'email del Business Owner: aggiungila nel contratto");
  const plan = await fetchPlan(db, c.id);
  const resp = plan.find(s => s.stepId === "bo_response");
  if (resp?.status === "done" && !opts.restart) throw new HttpError(409, "Il Business Owner ha già risposto: per chiedere una nuova decisione riapri la richiesta");
  const prior = (await db.query("select count(*)::int n from bo_notices where contract_id = $1", [c.id])).rows[0].n as number;
  const reminder = prior > 0 && !opts.restart && resp?.status === "pending_bo";
  const kind = opts.auto ? (reminder ? "auto_reminder" : "auto") : reminder ? "reminder" : "notice";
  const bo = (await db.query("select name from users where lower(email) = lower($1) and role = 'bo' and active", [c.boEmail])).rows[0];
  const status = await sendMail(db, { to: c.boEmail, template: reminder ? "bo_reminder" : "bo_notice", vars: { name: bo?.name ?? c.boEmail, link: `${opts.origin}/`, reason: `${c.supplier} — ${c.object}`.slice(0, 160), detail: opts.message,
    deadline: `${c.noticeDate ? "ha come data limite per la disdetta il" : "scade il"} ${fmtDay(keyDate(c))}` } });
  await db.query("insert into bo_notices (contract_id, kind, to_email, message, sent_by, status) values ($1,$2,$3,$4,$5,$6)", [c.id, kind, c.boEmail, opts.message, actor.name, status]);
  const next: PlanStep[] = plan.map(s => s.stepId === "bo_notify" && s.status !== "done" ? { ...s, status: "done" as const, completedAt: tsNow(), completedBy: actor.name }
    : s.stepId === "bo_response" && (s.status !== "done" || opts.restart) ? { ...s, status: "pending_bo" as const, ...(opts.restart ? { completedAt: null, completedBy: null, boDecision: null, boNotes: "", boRespondedAt: null } : {}) } : s);
  await replacePlan(db, c.id, next);
  const label = kind === "auto" ? "Notifica BO inviata (automatica)" : kind === "auto_reminder" ? "Sollecito BO inviato (automatico)" : reminder ? "Sollecito BO inviato" : opts.restart ? "Richiesta al BO riaperta" : "Notifica BO inviata";
  await addAudit(db, c.id, actor, [{ ts: tsNow(), user: actor.name === "Sistema" ? "Sistema" : actor.name, action: label, detail: `A: ${c.boEmail}${status === "logged" ? " (email non configurata: solo registrata)" : status === "failed" ? " (invio non riuscito)" : ""}${opts.message ? ` · "${opts.message.slice(0, 120)}"` : ""}` }]);
}

export async function sendBoNotice(user: User, contractId: number, input: Row, origin: string): Promise<BoInfo> {
  const c = await visibleContract(user, contractId);
  if (!canEditContract(user, c)) throw new HttpError(403, "Solo il buyer del contratto o il Manager inviano gli avvisi");
  if (c.ceased || c.status === "closed") bad("Il contratto è chiuso: non servono avvisi");
  const message = typeof input?.message === "string" ? input.message.trim().slice(0, 1000) : "";
  await inTransaction(db => deliver(db, user, c, { message, restart: input?.restart === true, auto: false, origin }));
  return infoFor(getPool(), (await getContract(contractId))!);
}

/** Quanti giorni prima della scadenza partono gli avvisi: il piano si ricalcola, le attività già fatte restano. */
export async function setBoLead(user: User, contractId: number, daysIn: unknown): Promise<BoInfo> {
  const c = await visibleContract(user, contractId);
  if (!canEditContract(user, c)) throw new HttpError(403, "Solo il buyer del contratto o il Manager cambiano i tempi");
  const days = Number(daysIn);
  if (!Number.isInteger(days) || days < 30 || days > 365) bad("Gli avvisi devono partire da 30 a 365 giorni prima della scadenza");
  await inTransaction(async db => {
    const plan = reschedulePlan(await fetchPlan(db, c.id), c.id, keyDate(c), days - DEFAULT_BO_LEAD_DAYS);
    await replacePlan(db, c.id, plan);
    await db.query("update contracts set bo_lead_days = $2 where id = $1", [c.id, days === DEFAULT_BO_LEAD_DAYS ? null : days]);
    await addAudit(db, c.id, user, [{ ts: tsNow(), user: user.name, action: "Tempi degli avvisi modificati", detail: `Gli avvisi al BO partono ${days} giorni prima della scadenza (prima: ${c.boLeadDays ?? DEFAULT_BO_LEAD_DAYS})` }]);
  });
  return infoFor(getPool(), (await getContract(contractId))!);
}

/** Cron giornaliero: se attivo, invia gli avvisi in scadenza e i solleciti. */
export async function runBoNotices(origin: string): Promise<{ enabled: boolean; sent: number; reminders: number }> {
  const db = getPool();
  const settings = await loadBoSettings(db);
  if (!settings.auto) return { enabled: false, sent: 0, reminders: 0 };
  let sent = 0, reminders = 0;
  const due = (await db.query(`select c.id from contracts c join plan_steps n on n.contract_id = c.id and n.step_id = 'bo_notify' and n.status = 'upcoming' and n.scheduled_date <= $1
    where c.bo_email <> '' and c.status = 'active' and not c.ceased`, [today()])).rows;
  const wait = (await db.query(`select c.id from contracts c join plan_steps r on r.contract_id = c.id and r.step_id = 'bo_response' and r.status = 'pending_bo'
    where c.bo_email <> '' and c.status = 'active' and not c.ceased
      and coalesce((select max(sent_at) from bo_notices b where b.contract_id = c.id), 'epoch') < now() - make_interval(days => $1)
      and (select count(*) from bo_notices b where b.contract_id = c.id and b.kind in ('reminder','auto_reminder')) < $2
      and exists (select 1 from bo_notices b where b.contract_id = c.id)`, [settings.reminderDays, MAX_REMINDERS])).rows;
  for (const [rows, isReminder] of [[due, false], [wait, true]] as [Row[], boolean][]) {
    for (const r of rows) {
      try {
        const c = (await getContract(r.id))!;
        await inTransaction(tx => deliver(tx, SYSTEM, c, { message: "", restart: false, auto: true, origin }));
        if (isReminder) reminders++; else sent++;
      } catch (err) { console.error("Avviso automatico al Business Owner non riuscito", r.id, err); }
    }
  }
  return { enabled: true, sent, reminders };
}
