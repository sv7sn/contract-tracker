// Valutazione dei fornitori: voti dei buyer su qualità, puntualità, servizio e prezzo, più i dati già noti al software
// (risposte alle richieste di offerta, ordini degli ultimi 12 mesi). Si considerano le valutazioni degli ultimi 24 mesi.
import type { RatingCriterion, Scorecard, SupplierRating, User } from "../src/types.ts";
import { logChange } from "./_audit.js";
import { getPool } from "./_db.js";
import { HttpError } from "./_http.js";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const CRITERIA: RatingCriterion[] = ["quality", "delivery", "service", "price"];
const staff = (u: User) => u.role === "manager" || u.role === "buyer";
const need = (u: User) => { if (!staff(u)) throw new HttpError(403, "Operazione non consentita"); };
const r1 = (n: number) => Math.round(n * 10) / 10;
const WINDOW = "r.created_at > now() - interval '24 months'";

export async function supplierScorecard(user: User, supplierId: number): Promise<Scorecard> {
  need(user);
  const db = getPool();
  const sup = (await db.query("select id, sap_code from suppliers where id = $1", [supplierId])).rows[0];
  if (!sup) throw new HttpError(404, "Fornitore non trovato");
  const rows = (await db.query("select r.* from supplier_ratings r where r.supplier_id = $1 order by r.created_at desc, r.id desc limit 50", [supplierId])).rows;
  const recent = (await db.query(`select avg(quality)::float q, avg(delivery)::float d, avg(service)::float s, avg(price)::float p, count(*)::int n from supplier_ratings r where r.supplier_id = $1 and ${WINDOW}`, [supplierId])).rows[0];
  const criteria = { quality: recent.n ? r1(recent.q) : null, delivery: recent.n ? r1(recent.d) : null, service: recent.n ? r1(recent.s) : null, price: recent.n ? r1(recent.p) : null } as Record<RatingCriterion, number | null>;
  const rfq = (await db.query(`select count(*)::int invited, count(*) filter (where amount is not null)::int answered, count(*) filter (where declined)::int declined
    from rfq_invites i join rfqs r on r.id = i.rfq_id where i.supplier_id = $1`, [supplierId])).rows[0];
  const sp = sup.sap_code ? (await db.query(`select coalesce(sum(value) filter (where currency = 'EUR'), 0)::float v, count(distinct po)::int n from po_lines where supplier_code = $1 and doc_date > current_date - interval '12 months'`, [sup.sap_code])).rows[0] : { v: 0, n: 0 };
  return {
    count: recent.n, overall: recent.n ? r1(CRITERIA.reduce((a, c) => a + (criteria[c] ?? 0), 0) / CRITERIA.length) : null, criteria,
    ratings: rows.map((r: Row): SupplierRating => ({ id: r.id, raterName: r.rater_name, quality: r.quality, delivery: r.delivery, service: r.service, price: r.price, comment: r.comment, po: r.po, createdAt: new Date(r.created_at).toISOString(), mine: r.rater_id === user.id })),
    rfq: { invited: rfq.invited, answered: rfq.answered, declined: rfq.declined }, spend12m: Math.round(sp.v), pos12m: sp.n,
  };
}

export async function addRating(user: User, supplierId: number, input: Row): Promise<Scorecard> {
  need(user);
  const db = getPool();
  const sup = (await db.query("select name, status from suppliers where id = $1", [supplierId])).rows[0];
  if (!sup) throw new HttpError(404, "Fornitore non trovato");
  if (sup.status !== "registered") throw new HttpError(400, "Si valutano solo i fornitori registrati");
  const v = Object.fromEntries(CRITERIA.map(c => [c, Number(input?.[c])]));
  if (CRITERIA.some(c => !Number.isInteger(v[c]) || v[c] < 1 || v[c] > 5)) throw new HttpError(400, "Dai un voto da 1 a 5 a ogni criterio");
  const comment = typeof input?.comment === "string" ? input.comment.trim().slice(0, 1000) : "";
  const low = CRITERIA.some(c => v[c] <= 2);
  if (low && comment.length < 10) throw new HttpError(400, "Con un voto di 1 o 2 spiega il motivo");
  const po = typeof input?.po === "string" ? input.po.trim().slice(0, 30) : "";
  await db.query("insert into supplier_ratings (supplier_id, rater_id, rater_name, quality, delivery, service, price, comment, po) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)", [supplierId, user.id, user.name, v.quality, v.delivery, v.service, v.price, comment, po]);
  return supplierScorecard(user, supplierId);
}

export async function deleteRating(user: User, id: number): Promise<Scorecard> {
  need(user);
  const db = getPool();
  const r = (await db.query("select * from supplier_ratings where id = $1", [id])).rows[0];
  if (!r) throw new HttpError(404, "Valutazione non trovata");
  if (user.role !== "manager" && r.rater_id !== user.id) throw new HttpError(403, "Puoi eliminare solo le tue valutazioni");
  await db.query("delete from supplier_ratings where id = $1", [id]);
  const name = (await db.query("select name from suppliers where id = $1", [r.supplier_id])).rows[0]?.name ?? "";
  await logChange(db, user, "rating", "delete", name, { voto: `${r.quality}/${r.delivery}/${r.service}/${r.price}`, valutatore: r.rater_name }, null);
  return supplierScorecard(user, r.supplier_id);
}

/** Media complessiva e numero di valutazioni per fornitore, per la lista. */
export async function ratingSummary(user: User): Promise<Record<number, { overall: number; count: number }>> {
  need(user);
  const rows = (await getPool().query(`select supplier_id, avg((quality + delivery + service + price) / 4.0)::float a, count(*)::int n from supplier_ratings r where ${WINDOW} group by supplier_id`)).rows;
  return Object.fromEntries(rows.map(r => [r.supplier_id as number, { overall: r1(r.a), count: r.n }]));
}
