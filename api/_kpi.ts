// Indicatori di processo: tempi e conformità di RDA, scelta del fornitore, onboarding, qualifica e contratti.
import type { Kpis, User } from "../src/types.ts";
import { getPool } from "./_db.js";
import { HttpError } from "./_http.js";
import { listVendors } from "./_portal.js";
import { loadRdaSettings } from "./_tasks.js";
import { computeSaving } from "./_saving.js";

const num = (v: unknown) => (v === null || v === undefined ? null : Math.round(Number(v) * 10) / 10);
const MODE_LABEL: Record<string, string> = { comparison: "Confronto tra offerte", strategic: "Fornitura strategica", single_source: "Single source", exception: "Eccezione" };
const STATUS_LABEL: Record<string, string> = { invited: "Invitati (non ancora attivi)", draft: "In compilazione", pending_revision: "Modifiche richieste", pending: "Da verificare (Buyer)", approved: "Da registrare (Finance)" };
/** Giorni dal rilascio della RDA alla chiusura con PO. */
const CYCLE = "extract(epoch from (t.done_at - (t.meta->>'releaseDate')::date)) / 86400";
const KEY_DATE = "coalesce(nullif(c.notice_date, ''), c.end_date)::date";

export async function computeKpis(user: User): Promise<Kpis> {
  if (user.role !== "manager" && user.role !== "viewer") throw new HttpError(403, "Gli indicatori sono riservati al Manager e a Controlling/CFO");
  const db = getPool();
  const { slaDays, sourcingThreshold: th } = await loadRdaSettings(db);
  const q = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows;

  const [open] = await q(`select count(*)::int as open, count(*) filter (where due < current_date)::int as overdue from tasks t where source = 'rda' and status = 'open'`);
  const aging = await q(`select case when age <= 7 then '0–7 giorni' when age <= 15 then '8–15 giorni' when age <= 30 then '16–30 giorni' else 'Oltre 30 giorni' end as label, count(*)::int as n
    from (select current_date - (meta->>'releaseDate')::date as age from tasks where source = 'rda' and status = 'open' and meta->>'releaseDate' is not null) x group by 1`);
  const [closed] = await q(`select count(*)::int as n, count(*) filter (where t.done_at::date <= t.due)::int as ok,
      percentile_cont(0.5) within group (order by ${CYCLE}) filter (where t.done_reason = 'po_created' and t.meta->>'releaseDate' is not null) as median
    from tasks t where t.source = 'rda' and t.status = 'done' and t.done_reason in ('po_created','manual') and t.done_at > now() - interval '90 days'`);
  const monthly = await q(`select to_char(date_trunc('month', t.done_at), 'YYYY-MM') as month, count(*)::int as closed,
      percentile_cont(0.5) within group (order by ${CYCLE}) filter (where t.meta->>'releaseDate' is not null) as median
    from tasks t where t.source = 'rda' and t.done_reason = 'po_created' and t.done_at >= date_trunc('month', now()) - interval '5 months' group by 1 order by 1`);
  const byBuyer = await q(`select coalesce(u.name, 'Da assegnare') as name, count(*)::int as open, count(*) filter (where t.due < current_date)::int as overdue
    from tasks t left join users u on u.id = t.assignee_id where t.source = 'rda' and t.status = 'open' group by 1 order by 2 desc`);

  const big = `(t.source = 'rda' or (t.source = 'manual' and t.kind = 'purchase') or (t.source = 'contract' and t.outcome in ('', 'renewed', 'replaced'))) and coalesce((t.meta->>'value')::numeric, 0) > $1`;
  const okSourcing = `(t.sourcing is not null and (t.sourcing->>'mode' <> 'exception' or t.sourcing->>'approval' = 'approved'))`;
  const [src] = await q(`select count(*) filter (where t.status = 'done' and t.done_at > now() - interval '90 days')::int as req,
      count(*) filter (where t.status = 'done' and t.done_at > now() - interval '90 days' and ${okSourcing})::int as ok,
      count(*) filter (where t.status = 'open' and not ${okSourcing})::int as missing from tasks t where ${big}`, [th]);
  const modes = await q(`select t.sourcing->>'mode' as mode, count(*)::int as n from tasks t where ${big} and t.sourcing is not null and t.updated_at > now() - interval '90 days' group by 1`, [th]);
  const [pend] = await q("select count(*)::int as n from tasks where sourcing->>'approval' = 'pending'");
  // Saving: pratiche chiuse negli ultimi 12 mesi con un confronto o un prezzo di riferimento (solo importi in euro).
  const sv = (await q(`select sourcing, meta from tasks t where t.status = 'done' and t.sourcing is not null and t.done_at > now() - interval '12 months' and coalesce(t.meta->>'currency', 'EUR') = 'EUR'`))
    .map(r => ({ s: computeSaving(r.sourcing) })).filter(x => x.s);
  const saving12m = Math.round(sv.reduce((a, x) => a + x.s!.amount, 0));
  const savingBase = sv.reduce((a, x) => a + x.s!.finalAmount + x.s!.amount, 0);

  const inProgress = await q("select status, count(*)::int as n from suppliers where status in ('invited','draft','pending_revision','pending','approved') and anonymized_at is null group by 1");
  const [onb] = await q(`select count(*)::int as n, percentile_cont(0.5) within group (order by extract(epoch from approved_at - created_at) / 86400) as median
    from suppliers where approved_at > now() - interval '12 months'`);
  const [stuck] = await q(`select count(*) filter (where status = 'pending' and coalesce(submitted_at, updated_at) < now() - interval '7 days')::int as buyer,
      count(*) filter (where status = 'approved' and updated_at < now() - interval '5 days')::int as finance from suppliers`);

  const vendors = (await listVendors(user)).filter(v => v.status === "registered" && v.lifecycle !== "inactive" && v.lifecycle !== "excluded");
  const [ct] = await q(`select count(*)::int as active,
      count(*) filter (where ${KEY_DATE} between current_date and current_date + 90)::int as next90,
      count(*) filter (where c.notice_date <> '')::int as with_notice,
      count(*) filter (where ${KEY_DATE} between current_date and current_date + 60 and not exists (select 1 from plan_steps p where p.contract_id = c.id and p.step_id = 'bo_response' and p.status = 'done'))::int as no_decision,
      count(*) filter (where c.end_date::date < current_date)::int as missed
    from contracts c where not c.ceased and c.status = 'active'`);

  const AGES = ["0–7 giorni", "8–15 giorni", "16–30 giorni", "Oltre 30 giorni"];
  return {
    generatedAt: new Date().toISOString(),
    rda: {
      open: open.open, overdue: open.overdue, slaDays, aging: AGES.map(l => ({ label: l, n: aging.find(a => a.label === l)?.n ?? 0 })),
      closed90: closed.n, withinSla90: closed.n ? Math.round((closed.ok / closed.n) * 100) : null, medianCycleDays: num(closed.median),
      monthly: Array.from({ length: 6 }, (_, i) => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 5 + i); const m = d.toISOString().slice(0, 7); const r = monthly.find(x => x.month === m); return { month: m, closed: r?.closed ?? 0, medianDays: num(r?.median) }; }),
      byBuyer: byBuyer.map(b => ({ name: b.name, open: b.open, overdue: b.overdue })),
    },
    sourcing: { threshold: th, required90: src.req, compliant90: src.ok, byMode: Object.keys(MODE_LABEL).map(k => ({ label: MODE_LABEL[k], n: modes.find(m => m.mode === k)?.n ?? 0 })), openMissing: src.missing, exceptionsPending: pend.n,
      saving12m, savingCount12m: sv.length, savingPct12m: savingBase > 0 ? Math.round((saving12m / savingBase) * 1000) / 10 : null },
    onboarding: {
      inProgress: Object.keys(STATUS_LABEL).map(k => ({ label: STATUS_LABEL[k], n: inProgress.find(r => r.status === k)?.n ?? 0 })),
      registered12m: onb.n, medianDaysToRegister: num(onb.median), stuckAtBuyer: stuck.buyer, stuckAtFinance: stuck.finance,
    },
    qualification: { valid: vendors.filter(v => v.qualification === "valid").length, expiring: vendors.filter(v => v.qualification === "expiring").length, lapsed: vendors.filter(v => v.qualification === "lapsed").length, blocked: vendors.filter(v => v.lifecycle === "blocked").length },
    contracts: { active: ct.active, keyNext90: ct.next90, withNotice: ct.with_notice, withoutDecision: ct.no_decision, missedDeadline: ct.missed },
  };
}
