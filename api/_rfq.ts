// Richieste di offerta: il buyer invita fornitori registrati dalla pratica, i fornitori rispondono dalla propria area
// e le offerte diventano il confronto tra fornitori della pratica.
import type { Rfq, SupplierRfq, TaskDetail, User } from "../src/types.ts";
import { getPool, inTransaction } from "./_db.js";
import { HttpError } from "./_http.js";
import { sendMail } from "./_notify.js";
import { getTask, saveSourcing } from "./_tasks.js";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const bad = (msg: string): never => { throw new HttpError(400, msg); };
const str = (v: unknown, max = 300) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const staff = (u: User) => u.role === "manager" || u.role === "buyer";
const today = () => new Date().toISOString().slice(0, 10);
const day = (d: unknown) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));
const langOf = (data: Row | null) => (data?.contacts?.language === "EN" ? "EN" : "IT") as "IT" | "EN";

/** Una richiesta è aperta finché non è chiusa a mano e la scadenza non è passata. */
const effective = (r: Row) => (r.status === "closed" || day(r.deadline) < today() ? "closed" : "open") as "open" | "closed";

async function loadRfqs(where: string, params: unknown[]): Promise<Rfq[]> {
  const db = getPool();
  const rows = (await db.query(`select * from rfqs where ${where} order by id desc`, params)).rows;
  if (!rows.length) return [];
  const inv = (await db.query(`select i.*, s.name, s.sap_code from rfq_invites i join suppliers s on s.id = i.supplier_id where i.rfq_id = any($1) order by s.name`, [rows.map(r => r.id)])).rows;
  return rows.map(r => ({ id: r.id, taskId: r.task_id, title: r.title, description: r.description, deadline: day(r.deadline), status: effective(r), createdBy: r.created_by_name, createdAt: new Date(r.created_at).toISOString(),
    invites: inv.filter(i => i.rfq_id === r.id).map(i => ({ supplierId: i.supplier_id, supplierName: i.name, sapCode: i.sap_code ?? "", amount: i.amount === null ? null : Number(i.amount), notes: i.notes, quotedAt: i.quoted_at ? new Date(i.quoted_at).toISOString() : null, declined: i.declined })) }));
}

function eligible(t: TaskDetail) {
  if (t.source === "manual" && t.kind !== "purchase") bad("La richiesta di offerta si fa sulle pratiche d'acquisto: RDA, rinnovi e acquisti");
  if (t.status === "done" && t.source === "rda") bad("La RDA è già diventata un ordine");
}

export async function listTaskRfqs(user: User, taskId: number): Promise<Rfq[]> {
  if (!staff(user)) throw new HttpError(403, "Operazione non consentita");
  await getTask(user, taskId);
  return loadRfqs("task_id = $1", [taskId]);
}

export async function createRfq(user: User, input: Row, origin: string): Promise<Rfq[]> {
  if (!staff(user)) throw new HttpError(403, "Operazione non consentita");
  const task = await getTask(user, Number(input?.taskId)); eligible(task);
  const title = str(input?.title, 200) || task.title.slice(0, 200);
  const description = str(input?.description, 2000);
  const deadline = str(input?.deadline, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(deadline) || deadline < today()) bad("Indica una scadenza non passata");
  if (deadline > new Date(Date.now() + 120 * 864e5).toISOString().slice(0, 10)) bad("La scadenza non può superare i 120 giorni");
  const ids = [...new Set((Array.isArray(input?.supplierIds) ? input.supplierIds : []).map(Number))].filter(Number.isInteger);
  if (ids.length < 2 || ids.length > 10) bad("Invita da 2 a 10 fornitori");
  const db = getPool();
  const sups = (await db.query("select id, name, email, data, approved_data, status, lifecycle from suppliers where id = any($1)", [ids])).rows;
  if (sups.length !== ids.length) throw new HttpError(404, "Fornitore non trovato");
  for (const s of sups) if (s.status !== "registered" || s.lifecycle !== "active") bad(`${s.name}: si invitano solo fornitori registrati e attivi`);
  if ((await db.query("select 1 from rfqs where task_id = $1 and status = 'open' and deadline >= current_date", [task.id])).rows.length) bad("C'è già una richiesta di offerta aperta su questa pratica");
  const id = await inTransaction(async tx => {
    const rid = (await tx.query("insert into rfqs (task_id, title, description, deadline, created_by, created_by_name) values ($1,$2,$3,$4,$5,$6) returning id", [task.id, title, description, deadline, user.id, user.name])).rows[0].id as number;
    for (const s of sups) await tx.query("insert into rfq_invites (rfq_id, supplier_id) values ($1,$2)", [rid, s.id]);
    return rid;
  });
  for (const s of sups) await sendMail(db, { to: s.email, template: "rfq_invite", lang: langOf(s.approved_data ?? s.data), supplierId: s.id, vars: { name: s.name, link: `${origin}/`, reason: title, detail: description, deadline: new Date(`${deadline}T00:00:00`).toLocaleDateString("it-IT") } });
  void id;
  return loadRfqs("task_id = $1", [task.id]);
}

async function rfqOf(user: User, id: number): Promise<Row> {
  if (!staff(user)) throw new HttpError(403, "Operazione non consentita");
  const r = (await getPool().query("select * from rfqs where id = $1", [id])).rows[0];
  if (!r) throw new HttpError(404, "Richiesta non trovata");
  await getTask(user, r.task_id);
  return r;
}

export async function closeRfq(user: User, id: number): Promise<Rfq[]> {
  const r = await rfqOf(user, id);
  await getPool().query("update rfqs set status = 'closed', closed_at = now() where id = $1 and status = 'open'", [id]);
  return loadRfqs("task_id = $1", [r.task_id]);
}

/** Le offerte ricevute diventano il confronto tra fornitori della pratica. */
export async function applyRfq(user: User, id: number, input: Row): Promise<TaskDetail> {
  const r = await rfqOf(user, id);
  const [rfq] = await loadRfqs("id = $1", [id]);
  const quotes = rfq.invites.filter(i => i.amount !== null && !i.declined);
  if (quotes.length < 2) bad("Servono almeno due offerte ricevute per fare il confronto");
  const chosen = Number(input?.supplierId);
  if (!quotes.some(q => q.supplierId === chosen)) bad("Scegli uno dei fornitori che hanno presentato un'offerta");
  const task = await saveSourcing(user, r.task_id, { mode: "comparison", justification: str(input?.justification, 2000), baseline: input?.baseline, finalAmount: input?.finalAmount,
    quotes: quotes.map(q => ({ supplier: q.supplierName, amount: q.amount, chosen: q.supplierId === chosen })) });
  await getPool().query("update rfqs set status = 'closed', closed_at = coalesce(closed_at, now()) where id = $1", [id]);
  return task;
}

// ─── Area fornitore ──────────────────────────────────────────
async function mySupplierId(user: User): Promise<number> {
  if (user.role !== "supplier") throw new HttpError(403, "Operazione non consentita");
  const r = (await getPool().query("select id from suppliers where user_id = $1", [user.id])).rows[0];
  if (!r) throw new HttpError(404, "Scheda fornitore non trovata");
  return r.id;
}

export async function listMyRfqs(user: User): Promise<SupplierRfq[]> {
  const sid = await mySupplierId(user);
  const rows = (await getPool().query(`select r.*, i.amount, i.notes, i.quoted_at, i.declined from rfqs r join rfq_invites i on i.rfq_id = r.id where i.supplier_id = $1 order by r.deadline desc, r.id desc limit 50`, [sid])).rows;
  return rows.map(r => ({ id: r.id, title: r.title, description: r.description, deadline: day(r.deadline), status: effective(r),
    myQuote: { amount: r.amount === null ? null : Number(r.amount), notes: r.notes, quotedAt: r.quoted_at ? new Date(r.quoted_at).toISOString() : null, declined: r.declined } }));
}

export async function submitQuote(user: User, rfqId: number, input: Row, origin: string): Promise<SupplierRfq[]> {
  const sid = await mySupplierId(user);
  const db = getPool();
  const r = (await db.query("select r.*, u.email as buyer_email from rfqs r join rfq_invites i on i.rfq_id = r.id left join users u on u.id = r.created_by where r.id = $1 and i.supplier_id = $2", [rfqId, sid])).rows[0];
  if (!r) throw new HttpError(404, "Richiesta non trovata");
  if (effective(r) !== "open") bad("La richiesta di offerta è chiusa");
  const declined = input?.declined === true;
  const amount = declined ? null : Number(input?.amount);
  if (!declined && (!Number.isFinite(amount) || (amount as number) <= 0 || (amount as number) > 1e10)) bad("Indica l'importo dell'offerta");
  await db.query("update rfq_invites set amount = $3, notes = $4, quoted_at = now(), declined = $5 where rfq_id = $1 and supplier_id = $2", [rfqId, sid, amount, declined ? "" : str(input?.notes, 1000), declined]);
  const name = (await db.query("select name from suppliers where id = $1", [sid])).rows[0].name as string;
  if (r.buyer_email) await sendMail(db, { to: r.buyer_email, template: "rfq_quote", supplierId: sid, vars: { name, link: `${origin}/`, reason: r.title, detail: declined ? "ha rinunciato" : `offerta di ${new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(amount as number)}` } });
  return listMyRfqs(user);
}
