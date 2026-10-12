// Obblighi e scadenze di un contratto: consegne, revisioni prezzo, verifiche. Ognuno ha un responsabile e una data, e compare in "Il mio lavoro".
import type { Obligation, User } from "../src/types.ts";
import { addAudit, getContract, getPool } from "./_db.js";
import { HttpError } from "./_http.js";
import { canEditContract, canViewContract } from "./_permissions.js";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const bad = (m: string): never => { throw new HttpError(400, m); };
const KINDS = ["deliverable", "indexation", "review", "payment", "other"];
const day = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10);
const map = (r: Row): Obligation => ({ id: r.id, contractId: r.contract_id, kind: r.kind, title: r.title, due: day(r.due), owner: r.owner_name, note: r.note, status: r.status, repeatMonths: r.repeat_months, doneAt: r.done_at ? new Date(r.done_at).toISOString() : null, doneBy: r.done_by });
const stamp = () => new Date().toLocaleString("it-IT");
const addMonths = (d: string, n: number) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCMonth(x.getUTCMonth() + n); return x.toISOString().slice(0, 10); };

async function contractOf(user: User, id: number, edit: boolean) {
  const c = await getContract(id);
  if (!c || !canViewContract(user, c)) throw new HttpError(404, "Contratto non trovato");
  if (edit && !canEditContract(user, c)) throw new HttpError(403, "Operazione non consentita");
  return c;
}
export async function listObligations(user: User, contractId: number): Promise<Obligation[]> {
  await contractOf(user, contractId, false);
  return (await getPool().query("select * from contract_obligations where contract_id = $1 order by (status = 'done'), due, id", [contractId])).rows.map(map);
}
export async function saveObligation(user: User, contractId: number, input: Row): Promise<Obligation[]> {
  await contractOf(user, contractId, true);
  const title = String(input?.title ?? "").trim().slice(0, 200);
  if (title.length < 3) bad("Descrivi l'obbligo");
  const due = String(input?.due ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) bad("Indica la scadenza");
  const kind = KINDS.includes(input?.kind) ? input.kind : "other";
  const rep = input?.repeatMonths === null || input?.repeatMonths === "" || input?.repeatMonths === undefined ? null : Number(input.repeatMonths);
  if (rep !== null && (!Number.isInteger(rep) || rep < 1 || rep > 60)) bad("La ripetizione va da 1 a 60 mesi");
  const owner = String(input?.owner ?? "").trim().slice(0, 100), note = String(input?.note ?? "").trim().slice(0, 500);
  const db = getPool();
  if (input?.id) { if (!(await db.query("update contract_obligations set kind=$3, title=$4, due=$5, owner_name=$6, note=$7, repeat_months=$8 where id=$1 and contract_id=$2 and status = 'open' returning id", [Number(input.id), contractId, kind, title, due, owner, note, rep])).rows.length) throw new HttpError(404, "Obbligo non trovato"); }
  else {
    await db.query("insert into contract_obligations (contract_id, kind, title, due, owner_name, note, repeat_months, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8)", [contractId, kind, title, due, owner, note, rep, user.name]);
    await addAudit(db, contractId, user, [{ ts: stamp(), user: user.name, action: "Obbligo aggiunto", detail: `${title} (entro ${due})` }]);
  }
  return listObligations(user, contractId);
}
/** Segna l'obbligo come fatto; se è periodico crea subito il successivo. */
export async function completeObligation(user: User, id: number): Promise<Obligation[]> {
  const db = getPool();
  const o = (await db.query("select * from contract_obligations where id = $1", [id])).rows[0];
  if (!o) throw new HttpError(404, "Obbligo non trovato");
  await contractOf(user, o.contract_id, true);
  if (o.status === "done") bad("Obbligo già completato");
  await db.query("update contract_obligations set status = 'done', done_at = now(), done_by = $2 where id = $1", [id, user.name]);
  if (o.repeat_months) await db.query("insert into contract_obligations (contract_id, kind, title, due, owner_name, note, repeat_months, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8)", [o.contract_id, o.kind, o.title, addMonths(day(o.due), o.repeat_months), o.owner_name, o.note, o.repeat_months, user.name]);
  await addAudit(db, o.contract_id, user, [{ ts: stamp(), user: user.name, action: "Obbligo completato", detail: o.title }]);
  return listObligations(user, o.contract_id);
}
export async function deleteObligation(user: User, id: number): Promise<Obligation[]> {
  const db = getPool();
  const o = (await db.query("select * from contract_obligations where id = $1", [id])).rows[0];
  if (!o) throw new HttpError(404, "Obbligo non trovato");
  await contractOf(user, o.contract_id, true);
  await db.query("delete from contract_obligations where id = $1", [id]);
  return listObligations(user, o.contract_id);
}
