// "Il mio lavoro": tutto ciò che richiede un'azione del buyer (o del Manager) in un'unica lista in ordine di urgenza.
// Non calcola nulla di nuovo: riunisce quello che i moduli già sanno (task, offerte, fornitori, spesa).
import type { User, WorkItem } from "../src/types.ts";
import { monitorData } from "./_docs.js";
import { getPool } from "./_db.js";
import { HttpError } from "./_http.js";
import { listVendors } from "./_portal.js";
import { spendView } from "./_spend.js";
import { pendingReviewsOf } from "./_clm.js";
import { listTasks } from "./_tasks.js";

const today = () => new Date().toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 864e5);
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export async function myWork(user: User): Promise<WorkItem[]> {
  if (user.role !== "manager" && user.role !== "buyer") throw new HttpError(403, "Operazione non consentita");
  const db = getPool(),
    t0 = today(),
    manager = user.role === "manager";
  const items: WorkItem[] = [];
  // Rinnovi che aspettano ancora la RDA: a parità di urgenza vengono dopo le pratiche con RDA già approvata.
  const waitingRda = new Set<number>();
  // Il buyer in sostituzione lavora anche sulle pratiche del collega assente.
  const ids = user.acting?.ids ?? [user.id],
    names = (user.acting?.names ?? [user.name]).map(n => n.toLowerCase());
  const safe = async (f: () => Promise<void>) => {
    try {
      await f();
    } catch {
      /* una sezione che non carica non blocca le altre */
    }
  };

  await safe(async () => {
    const { tasks } = await listTasks(user);
    const open = tasks.filter(t => t.status === "open");
    for (const t of open) {
      if (t.source === "contract" && !t.rdaNumbers.length && !t.outcome) waitingRda.add(t.id);
      const overdue = t.due && t.due < t0 ? daysBetween(t0, t.due) : 0;
      const label = t.source === "contract" ? "Rinnovo" : t.source === "rda" ? "RDA" : t.kind === "purchase" ? "Acquisto" : "Attività";
      const target = { view: "tasks" as const, taskId: t.id };
      if (overdue > 0)
        items.push({
          kind: "task_late",
          urgency: overdue > 7 ? 3 : 2,
          title: t.title,
          detail: `${label} in ritardo di ${overdue} ${plural(overdue, "giorno", "giorni")}${t.assigneeName && manager ? ` · ${t.assigneeName}` : ""}`,
          days: overdue,
          target,
        });
      else if (t.due && daysBetween(t.due, t0) <= 3)
        items.push({
          kind: "task_soon",
          urgency: 1,
          title: t.title,
          detail: `${label} da chiudere ${daysBetween(t.due, t0) === 0 ? "oggi" : `entro ${daysBetween(t.due, t0)} ${plural(daysBetween(t.due, t0), "giorno", "giorni")}`}`,
          days: -daysBetween(t.due, t0),
          target,
        });
      if (t.sourcingRequired && t.sourcingStatus === "missing" && t.source !== "contract")
        items.push({
          kind: "sourcing_missing",
          urgency: 2,
          title: t.title,
          detail: "Sopra soglia: manca il confronto tra fornitori",
          days: null,
          target,
        });
      if (t.source === "rda" && t.pos.length && t.blocker)
        items.push({
          kind: "po_gap",
          urgency: 3,
          title: t.title,
          detail: `Ordine già emesso in SAP (${t.pos.map(p => p.po).join(", ")}) ma manca: ${t.blocker}`,
          days: null,
          target,
        });
      if (manager && t.sourcing?.approval === "pending")
        items.push({
          kind: "exception",
          urgency: 3,
          title: t.title,
          detail: `Eccezione al confronto da approvare (${t.sourcing.recordedBy})`,
          days: null,
          target,
        });
    }
    const unassigned = open.filter(t => t.assigneeId === null && t.source !== "contract");
    if (manager && unassigned.length)
      items.push({
        kind: "unassigned",
        urgency: 2,
        title: `${unassigned.length} ${plural(unassigned.length, "task senza assegnatario", "task senza assegnatario")}`,
        detail: "Assegnali a un buyer dal modulo Task",
        days: null,
        target: { view: "tasks" },
      });
  });

  // Revisioni della bozza che aspettano una funzione (Legal, Compliance…): il task del buyer è fermo lì, ma resta da sollecitare.
  await safe(async () => {
    const mine = (await pendingReviewsOf(db, null)).filter(r => manager || (r.assigneeId !== null && ids.includes(r.assigneeId)));
    const F: Record<string, string> = { requester: "Richiedente", legal: "Legal", compliance: "Compliance", itsec: "IT Security" };
    for (const r of mine) {
      if (r.overdue <= 0 && r.waitDays < 3) continue;
      items.push({
        kind: "review_late",
        urgency: r.overdue >= 2 ? 3 : 2,
        title: r.title,
        detail: `In attesa di ${F[r.func]} da ${r.waitDays} ${plural(r.waitDays, "giorno", "giorni")}${r.overdue > 0 ? ` (scaduto da ${r.overdue})` : ""}`,
        days: r.overdue || null,
        target: { view: "tasks", taskId: r.taskId },
      });
    }
  });

  // Obblighi dei contratti in scadenza o scaduti, e spesa SAP che si avvicina al valore del contratto.
  await safe(async () => {
    const scope = manager ? "true" : "(c.owner_id = any($1) or lower(c.owner) = any($2))",
      args = manager ? [] : [ids, names];
    const obl = (
      await db.query(
        `select o.id, o.title, o.due::text as due, c.id as cid, c.supplier from contract_obligations o join contracts c on c.id = o.contract_id
      where o.status = 'open' and c.status = 'active' and o.due <= current_date + 7 and ${scope} order by o.due`,
        args,
      )
    ).rows;
    for (const o of obl) {
      const d = daysBetween(t0, o.due);
      items.push({
        kind: "obligation_due",
        urgency: d > 0 ? 3 : d >= -3 ? 2 : 1,
        title: `${o.supplier} — ${o.title}`.slice(0, 120),
        detail:
          d > 0
            ? `Obbligo scaduto da ${d} ${plural(d, "giorno", "giorni")}`
            : d === 0
              ? "Obbligo da completare oggi"
              : `Obbligo in scadenza tra ${-d} ${plural(-d, "giorno", "giorni")}`,
        days: d > 0 ? d : null,
        target: { view: "list", contractId: o.cid },
      });
    }
    const cap = (
      await db.query(
        `select c.id, c.supplier, c.value::float as value, spent.total::float as spent from contracts c join suppliers s on s.id = c.supplier_id
      join lateral (select coalesce(sum(l.value), 0) as total from po_lines l where l.supplier_code = s.sap_code and s.sap_code <> '' and coalesce(nullif(l.currency, ''), 'EUR') = 'EUR'
        and (c.start_date !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or l.doc_date >= c.start_date::date)) spent on true
      where c.status = 'active' and not c.ceased and c.value > 0 and ${scope} and spent.total >= c.value * 0.8`,
        args,
      )
    ).rows;
    for (const c of cap) {
      const p = Math.round((c.spent / c.value) * 100);
      items.push({
        kind: "contract_cap",
        urgency: p >= 100 ? 2 : 1,
        title: c.supplier,
        detail: `Spesa SAP dall'inizio del contratto: ${p}% del valore (${Math.round(c.spent).toLocaleString("it-IT")} su ${Math.round(c.value).toLocaleString("it-IT")} €)`,
        days: null,
        target: { view: "list", contractId: c.id },
      });
    }
  });

  // Avvisi ai Business Owner: da inviare (data prevista passata) o senza risposta.
  await safe(async () => {
    const rows = (
      await db.query(
        `select c.id, c.supplier, c.object, n.scheduled_date as notify_date, r.status as resp_status,
        (select max(sent_at)::date::text from bo_notices b where b.contract_id = c.id) as last_sent
      from contracts c join plan_steps n on n.contract_id = c.id and n.step_id = 'bo_notify' join plan_steps r on r.contract_id = c.id and r.step_id = 'bo_response'
      where c.bo_email <> '' and c.status = 'active' and not c.ceased and r.status <> 'done' and ${manager ? "true" : "(c.owner_id = any($1) or lower(c.owner) = any($2))"}`,
        manager ? [] : [ids, names],
      )
    ).rows;
    for (const r of rows) {
      const title = `${r.supplier} — ${r.object}`.slice(0, 120),
        target = { view: "list" as const, contractId: r.id };
      if (r.last_sent) {
        const d = daysBetween(t0, r.last_sent);
        if (d >= 7)
          items.push({
            kind: "bo_waiting",
            urgency: d >= 14 ? 3 : 2,
            title,
            detail: `In attesa del Business Owner da ${d} giorni`,
            days: d,
            target,
            quick: { label: "Sollecita", contractId: r.id },
          });
      } else if (r.notify_date <= t0)
        items.push({
          kind: "bo_to_send",
          urgency: 2,
          title,
          detail: `Avviso al Business Owner da inviare (previsto il ${r.notify_date.split("-").reverse().join("/")})`,
          days: daysBetween(t0, r.notify_date),
          target,
          quick: { label: "Invia ora", contractId: r.id },
        });
    }
  });

  // Messaggi del Business Owner non ancora letti.
  await safe(async () => {
    const rows = (
      await db.query(
        `select c.id, c.supplier, c.object, count(*)::int as n from bo_messages m join contracts c on c.id = m.contract_id
      where m.author_role = 'bo' and m.seen_at is null and ${manager ? "true" : "(c.owner_id = any($1) or lower(c.owner) = any($2))"} group by c.id`,
        manager ? [] : [ids, names],
      )
    ).rows;
    for (const r of rows)
      items.push({
        kind: "bo_message",
        urgency: 2,
        title: `${r.supplier} — ${r.object}`.slice(0, 120),
        detail: `Il Business Owner ha scritto (${r.n} ${plural(r.n, "messaggio", "messaggi")}): rispondigli`,
        days: null,
        target: { view: "list", contractId: r.id },
      });
  });

  await safe(async () => {
    const rows = (
      await db.query(
        `select r.id, r.title, r.task_id, r.deadline::text as deadline, r.status, t.sourcing is null as no_sourcing,
        (select count(*)::int from rfq_invites i where i.rfq_id = r.id and i.amount is not null and not i.declined) as quotes, (select count(*)::int from rfq_invites i where i.rfq_id = r.id) as invited
      from rfqs r join tasks t on t.id = r.task_id where t.status = 'open' and (r.created_by = any($1) or $2) order by r.deadline`,
        [ids, manager],
      )
    ).rows;
    for (const r of rows) {
      const closed = r.status === "closed" || r.deadline < t0;
      const target = { view: "tasks" as const, taskId: r.task_id };
      if (closed && r.no_sourcing && r.quotes >= 2)
        items.push({
          kind: "rfq_compare",
          urgency: 2,
          title: r.title,
          detail: `Richiesta chiusa con ${r.quotes} offerte: scegli il fornitore`,
          days: null,
          target,
        });
      else if (!closed && r.quotes > 0)
        items.push({
          kind: "rfq_answers",
          urgency: 1,
          title: r.title,
          detail: `${r.quotes} ${plural(r.quotes, "offerta ricevuta", "offerte ricevute")} su ${r.invited} inviti · scade tra ${daysBetween(r.deadline, t0)} ${plural(daysBetween(r.deadline, t0), "giorno", "giorni")}`,
          days: -daysBetween(r.deadline, t0),
          target,
        });
    }
  });

  await safe(async () => {
    const vendors = await listVendors(user);
    for (const v of vendors) {
      const target = { view: "vendors" as const, vendorId: v.id },
        name = v.legalName || v.name;
      if (v.status === "pending")
        items.push({
          kind: "vendor_review",
          urgency: 2,
          title: name,
          detail: v.isUpdate ? "Modifiche ai dati da verificare" : "Registrazione da verificare",
          days: null,
          target,
        });
      else if (v.status === "registered" && v.lifecycle === "active" && v.qualification === "lapsed")
        items.push({
          kind: "vendor_lapsed",
          urgency: 2,
          title: name,
          detail: "Qualifica scaduta: documenti obbligatori da rinnovare",
          days: null,
          target,
        });
    }
    const stuck = new Map<number, string>();
    for (const m of (await monitorData(user)).items) if (m.unresponsive) stuck.set(m.supplierId, m.supplierName);
    for (const [id, name] of stuck)
      items.push({
        kind: "vendor_unresponsive",
        urgency: 3,
        title: name,
        detail: "Non risponde ai reminder sui documenti: serve un contatto diretto",
        days: null,
        target: { view: "vendors", vendorId: id },
      });
  });

  await safe(async () => {
    const sp = await spendView(user);
    const recent = sp.splits.cases.filter(c => daysBetween(t0, c.to) <= 60);
    if (recent.length)
      items.push({
        kind: "splits",
        urgency: 1,
        title: `${recent.length} ${plural(recent.length, "possibile frazionamento", "possibili frazionamenti")}`,
        detail: "Ordini o RDA ravvicinati, sotto soglia, che insieme la superano",
        days: null,
        target: { view: "spend" },
      });
  });

  // Una riga per pratica: più motivi sulla stessa pratica si uniscono, con l'urgenza più alta.
  const merged: WorkItem[] = [];
  for (const it of items) {
    const same = it.target.taskId ? merged.find(m => m.target.taskId === it.target.taskId && m.title === it.title) : undefined;
    if (!same) {
      merged.push({ ...it });
      continue;
    }
    if (it.urgency > same.urgency) {
      same.urgency = it.urgency;
      same.kind = it.kind;
    }
    same.detail = `${same.detail} · ${it.detail}`;
    if (it.days !== null && (same.days === null || it.days > same.days)) same.days = it.days;
  }
  const waits = (i: WorkItem) => (i.target.taskId !== undefined && waitingRda.has(i.target.taskId) ? 1 : 0);
  return merged.sort((a, b) => b.urgency - a.urgency || waits(a) - waits(b) || (b.days ?? -999) - (a.days ?? -999));
}
