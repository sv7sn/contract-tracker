// Assenze dei buyer: nel periodo indicato il sostituto vede e gestisce le pratiche dell'assente (task, contratti, fornitori, richieste di offerta).
import type { CoverView, User } from "../src/types.ts";
import { getPool, type Queryable } from "./_db.js";
import { HttpError } from "./_http.js";

const iso = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
const day = /^\d{4}-\d{2}-\d{2}$/;

/** Per un buyer: sé stesso più i colleghi che sostituisce oggi. Calcolato a ogni richiesta, quindi inizio e fine assenza hanno effetto subito. */
export async function loadActing(db: Queryable, user: User): Promise<NonNullable<User["acting"]>> {
  const rows = (await db.query(`select u.id, u.name, c.to_date from buyer_cover c join users u on u.id = c.user_id
    where c.substitute_id = $1 and current_date between c.from_date and c.to_date and u.active and u.role in ('buyer','manager')`, [user.id])).rows;
  const covering = rows.map(r => ({ id: r.id as number, name: r.name as string, until: iso(r.to_date) }));
  return { ids: [user.id, ...covering.map(c => c.id)], names: [user.name, ...covering.map(c => c.name)], covering };
}

export async function listCover(user: User): Promise<CoverView> {
  if (user.role !== "manager" && user.role !== "buyer") throw new HttpError(403, "Operazione non consentita");
  const db = getPool();
  const rows = (await db.query(`select c.*, a.name as user_name, s.name as sub_name from buyer_cover c join users a on a.id = c.user_id join users s on s.id = c.substitute_id
    where c.to_date >= current_date - 30 ${user.role === "manager" ? "" : "and (c.user_id = $1 or c.substitute_id = $1)"} order by c.from_date`, user.role === "manager" ? [] : [user.id])).rows;
  const today = new Date().toISOString().slice(0, 10);
  const buyers = (await db.query("select id, name from users where active and role in ('buyer','manager') order by name")).rows.map(r => ({ id: r.id as number, name: r.name as string }));
  return { entries: rows.map(r => ({ id: r.id, userId: r.user_id, userName: r.user_name, substituteId: r.substitute_id, substituteName: r.sub_name, from: iso(r.from_date), to: iso(r.to_date), active: iso(r.from_date) <= today && today <= iso(r.to_date) })), buyers };
}

export async function addCover(user: User, input: Record<string, unknown>): Promise<CoverView> {
  if (user.role !== "manager" && user.role !== "buyer") throw new HttpError(403, "Operazione non consentita");
  const db = getPool();
  // Un buyer indica la propria assenza; il Manager può farlo per chiunque.
  const absent = user.role === "manager" && input?.userId !== undefined ? Number(input.userId) : user.id;
  const sub = Number(input?.substituteId), from = String(input?.from ?? ""), to = String(input?.to ?? "");
  if (!day.test(from) || !day.test(to) || to < from) throw new HttpError(400, "Indica un periodo valido (dal, al)");
  if (to < new Date().toISOString().slice(0, 10)) throw new HttpError(400, "Il periodo è già passato");
  if (absent === sub) throw new HttpError(400, "Il sostituto deve essere un'altra persona");
  const ok = (await db.query("select id from users where id = any($1) and active and role in ('buyer','manager')", [[absent, sub]])).rows.length;
  if (ok !== 2) throw new HttpError(400, "Assente e sostituto devono essere buyer o manager attivi");
  if ((await db.query("select 1 from buyer_cover where user_id = $1 and from_date <= $3 and to_date >= $2", [absent, from, to])).rows.length) throw new HttpError(409, "C'è già un'assenza registrata in questo periodo");
  await db.query("insert into buyer_cover (user_id, substitute_id, from_date, to_date, created_by) values ($1,$2,$3,$4,$5)", [absent, sub, from, to, user.name]);
  return listCover(user);
}

export async function deleteCover(user: User, id: number): Promise<CoverView> {
  if (user.role !== "manager" && user.role !== "buyer") throw new HttpError(403, "Operazione non consentita");
  const r = await getPool().query(`delete from buyer_cover where id = $1 ${user.role === "manager" ? "" : "and user_id = $2"} returning id`, user.role === "manager" ? [id] : [id, user.id]);
  if (!r.rowCount) throw new HttpError(404, "Assenza non trovata");
  return listCover(user);
}
