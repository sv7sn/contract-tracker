// Area del Business Owner, che è anche il Richiedente: le sue RDA (sola lettura), i suoi contratti con lo stato del lavoro del buyer
// e i messaggi con il buyer. Le RDA si riconoscono dal codice utente SAP indicato nella sua scheda.
import type { BoMessage, RdaStage, RequesterContract, RequesterRda, Requests, User } from "../src/types.ts";
import { budgetView } from "./_budget.js";
import { getContract, getPool } from "./_db.js";
import { HttpError } from "./_http.js";
import { sendMail } from "./_notify.js";
import { canEditContract, canViewContract } from "./_permissions.js";

const STAGE: Record<RdaStage, string> = { received: "Ricevuta, in attesa di un buyer", working: "In lavorazione", rfq: "Offerte in corso", chosen: "Fornitore scelto", ordered: "Ordinata", closed: "Chiusa" };
const MANAGER = { id: 0, email: "", name: "Sistema", role: "manager", title: "", active: true } as User;

export async function myRequests(user: User): Promise<Requests> {
  if (user.role !== "bo") throw new HttpError(403, "Operazione non consentita");
  const db = getPool();
  const sap = (await db.query("select sap_user from users where id = $1", [user.id])).rows[0]?.sap_user as string ?? "";
  const rdas: RequesterRda[] = [];
  if (sap) {
    const rows = (await db.query(`select t.*, u.name as buyer, (select count(*)::int from rfqs r where r.task_id = t.id and r.status = 'open' and r.deadline >= current_date) as open_rfq,
        coalesce((select array_agg(distinct p.po) from sap_pos p where p.pr = t.source_key), '{}') as pos
      from tasks t left join users u on u.id = t.assignee_id
      where t.source = 'rda' and upper(t.meta->>'requestedBy') = upper($1) and coalesce(t.done_reason, '') <> 'merged' and (t.status = 'open' or t.done_at > now() - interval '60 days')
      order by t.status, t.created_at desc limit 100`, [sap])).rows;
    const budgets = new Map<number, Awaited<ReturnType<typeof budgetView>>>();
    for (const t of rows) {
      const m = t.meta ?? {};
      const stage: RdaStage = t.status === "done" ? (t.done_reason === "po_created" || t.pos.length ? "ordered" : "closed")
        : t.open_rfq > 0 ? "rfq" : t.sourcing ? "chosen" : t.assignee_id ? "working" : "received";
      const io = Object.keys(m.io ?? {})[0] ?? m.internalOrder ?? "";
      let budget: RequesterRda["budget"] = null;
      const year = Number(String(m.releaseDate ?? "").slice(0, 4)) || new Date().getFullYear();
      if (io) {
        if (!budgets.has(year)) budgets.set(year, await budgetView(MANAGER, year).catch(() => null as never));
        const line = budgets.get(year)?.lines.find(l => l.io === io);
        if (line) budget = { current: line.current, committed: line.committed, residual: line.residual };
      }
      rdas.push({ pr: t.source_key, title: String(t.title).replace(/^RDA \S+ · /, ""), value: Number(m.value) || 0, currency: m.currency ?? "EUR", releaseDate: m.releaseDate ?? null, buyerName: t.buyer ?? "", stage, stageLabel: stage === "ordered" && t.pos.length ? `Ordinata (PO ${t.pos.join(", ")})` : STAGE[stage], pos: t.pos, io, budget });
    }
  }
  const cr = (await db.query(`select c.id, c.supplier, c.object, coalesce(nullif(c.notice_date,''), c.end_date) as key_date, c.outcome,
      r.status as resp_status, r.bo_decision, n.scheduled_date as notify_date,
      (select t.status from tasks t where t.contract_id = c.id order by t.id desc limit 1) as task_status,
      (select coalesce(u.name, '') from tasks t left join users u on u.id = t.assignee_id where t.contract_id = c.id order by t.id desc limit 1) as buyer,
      (select count(*)::int from bo_messages m where m.contract_id = c.id and m.author_role <> 'bo' and m.seen_at is null) as unread
    from contracts c left join plan_steps r on r.contract_id = c.id and r.step_id = 'bo_response' left join plan_steps n on n.contract_id = c.id and n.step_id = 'bo_notify'
    where lower(c.bo_email) = lower($1) and c.status = 'active' and not c.ceased order by (r.status = 'pending_bo') desc, key_date`, [user.email])).rows;
  const contracts: RequesterContract[] = cr.map(r => ({ contractId: r.id, title: `${r.supplier} — ${r.object}`, keyDate: String(r.key_date), state: r.resp_status === "pending_bo" ? "to_answer" : r.resp_status === "done" ? "answered" : "upcoming",
    decision: r.resp_status === "done" ? r.bo_decision ?? "" : "", noticeDate: r.notify_date ?? "", task: r.task_status ? { status: r.task_status, buyerName: r.buyer ?? "", outcome: r.outcome ?? "" } : null, unreadMessages: r.unread }));
  return { sapUser: sap, rdas, contracts };
}

// ─── Messaggi sul contratto ──────────────────────────────────
async function contractFor(user: User, id: number) {
  const c = await getContract(id);
  if (!c || !canViewContract(user, c)) throw new HttpError(404, "Contratto non trovato");
  return c;
}

/** Elenco dei messaggi: leggerli li segna come visti dall'altra parte. */
export async function listBoMessages(user: User, contractId: number): Promise<BoMessage[]> {
  await contractFor(user, contractId);
  const db = getPool();
  await db.query("update bo_messages set seen_at = now() where contract_id = $1 and seen_at is null and (author_role = 'bo') <> $2", [contractId, user.role === "bo"]);
  const rows = (await db.query("select * from bo_messages where contract_id = $1 order by created_at, id", [contractId])).rows;
  return rows.map(r => ({ id: r.id, authorName: r.author_name, authorRole: r.author_role, body: r.body, createdAt: new Date(r.created_at).toISOString(), fromMe: r.author_id === user.id }));
}

export async function postBoMessage(user: User, contractId: number, bodyIn: unknown, origin: string): Promise<BoMessage[]> {
  const c = await contractFor(user, contractId);
  const isBo = user.role === "bo";
  if (!isBo && !canEditContract(user, c)) throw new HttpError(403, "Solo il buyer del contratto, il Manager o il Business Owner scrivono qui");
  const body = typeof bodyIn === "string" ? bodyIn.trim().slice(0, 1500) : "";
  if (body.length < 2) throw new HttpError(400, "Scrivi il messaggio");
  const db = getPool();
  await db.query("insert into bo_messages (contract_id, author_id, author_name, author_role, body) values ($1,$2,$3,$4,$5)", [contractId, user.id, user.name, user.role, body]);
  // Avviso all'altra parte: il buyer del contratto se scrive il Business Owner, altrimenti il Business Owner.
  const to = isBo ? (await db.query("select email from users where lower(name) = lower($1) and active and role in ('buyer','manager')", [c.owner])).rows[0]?.email as string | undefined : c.boEmail;
  if (to) await sendMail(db, { to, template: "bo_message", vars: { name: user.name, link: `${origin}/`, reason: `${c.supplier} — ${c.object}`.slice(0, 160), detail: body } });
  return listBoMessages(user, contractId);
}
