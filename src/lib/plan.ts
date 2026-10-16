import type { Contract, MonthLoad, PlanStep, Plans, Suggestion } from "../types.ts";
import { C } from "../theme.ts";
import { fmtMonth, monthKey, NOW } from "./format.ts";
import { PLANNING_STEPS } from "../../api/_plan-rules.ts";
import { t } from "../i18n/index.ts";
export { makePlan, PLANNING_STEPS, reschedulePlan } from "../../api/_plan-rules.ts";

export const stepTemplate = (id: string) => PLANNING_STEPS.find(s => s.id === id)!;
/** Etichetta dell'attività: con il preavviso l'ultima tappa è il termine per la disdetta, non la scadenza. */
export const stepLabel = (id: string, c?: { noticeDate: string } | null) => id === "expiry" && c?.noticeDate ? t("Termine disdetta") : t(stepTemplate(id).label);

export const BO_DECISIONS = ["Rinnovare alle stesse condizioni", "Rinnovare con rinegoziazione", "Mettere in gara (RFQ/RFP)", "Prorogare temporaneamente", "Cessare l'attività"];
export const BO_COLORS: Record<string, { bg: string; color: string }> = {
  "Rinnovare alle stesse condizioni": { bg: C.greenBg,  color: C.green  },
  "Rinnovare con rinegoziazione":     { bg: C.blueBg,   color: C.blue   },
  "Mettere in gara (RFQ/RFP)":        { bg: C.yellowBg, color: C.yellow },
  "Prorogare temporaneamente":         { bg: C.purpleBg, color: C.purple },
  "Cessare l'attività":                { bg: C.redBg,    color: C.red    },
};
/** Come la decisione del BO cambia lo stato di rinnovo del contratto. */
export const RENEWAL_BY_DECISION: Record<string, string> = {
  "Rinnovare alle stesse condizioni": "Rinnovo automatico", "Rinnovare con rinegoziazione": "In negoziazione",
  "Mettere in gara (RFQ/RFP)": "Da rilanciare a gara", "Prorogare temporaneamente": "In negoziazione", "Cessare l'attività": "Da rescindere",
};

export const WORKLOAD_THRESHOLD = 3;

export function planProgress(plan: PlanStep[]) { return plan.length ? Math.round((plan.filter(s => s.status === "done").length / plan.length) * 100) : 0; }

export function calcWorkload(contracts: Contract[], plans: Plans) {
  const months: Record<string, MonthLoad> = {};
  for (let i = -1; i < 12; i++) {
    const d = new Date(NOW.getFullYear(), NOW.getMonth() + i, 1);
    months[monthKey(d)] = { label: fmtMonth(d), total: 0, byBuyer: {} };
  }
  contracts.filter(c => !c.ceased).forEach(c => {
    (plans[c.id] || []).filter(s => s.status !== "done" && s.stepId !== "expiry").forEach(s => {
      const key = monthKey(new Date(s.scheduledDate));
      if (months[key]) { months[key].total++; if (!months[key].byBuyer[c.owner]) months[key].byBuyer[c.owner] = 0; months[key].byBuyer[c.owner]++; }
    });
  });
  return months;
}

export interface TeamItem { contract: Contract; stepId: string; date: string }
export interface TeamCell { steps: TeamItem[]; expiring: Contract[] }
/** Piano del team: per ogni buyer e per ogni mese (dal mese scorso ai prossimi 11) i passaggi di rinnovo da fare e i contratti in scadenza. */
export function teamMatrix(contracts: Contract[], plans: Plans) {
  const months: { key: string; label: string }[] = [];
  for (let i = -1; i < 12; i++) { const d = new Date(NOW.getFullYear(), NOW.getMonth() + i, 1); months.push({ key: monthKey(d), label: fmtMonth(d) }); }
  const keys = new Set(months.map(m => m.key));
  const rows = new Map<string, Record<string, TeamCell>>();
  const cell = (buyer: string, key: string) => {
    const r = rows.get(buyer) ?? {}; rows.set(buyer, r);
    return (r[key] ??= { steps: [], expiring: [] });
  };
  for (const c of contracts.filter(x => !x.ceased)) {
    const buyer = c.owner || t("Da assegnare");
    for (const s of (plans[c.id] || []).filter(x => x.status !== "done" && x.stepId !== "expiry")) {
      const key = monthKey(new Date(s.scheduledDate));
      if (keys.has(key)) cell(buyer, key).steps.push({ contract: c, stepId: s.stepId, date: s.scheduledDate });
    }
    const due = monthKey(new Date(c.noticeDate || c.end));
    if (keys.has(due)) cell(buyer, due).expiring.push(c);
  }
  const buyers = [...rows.entries()].map(([name, cells]) => ({ name, cells })).sort((a, b) => a.name.localeCompare(b.name));
  return { months, buyers };
}

/** Riga di riepilogo del carico del team (prossimi 12 mesi). */
export function teamSummary(contracts: Contract[], plans: Plans): string {
  const w = Object.values(calcWorkload(contracts, plans));
  const total = w.reduce((a, m) => a + m.total, 0), over = w.filter(m => Math.max(0, ...Object.values(m.byBuyer)) >= WORKLOAD_THRESHOLD).length;
  return over ? t("{n} attività di rinnovo · {m} mesi con un buyer sovraccarico", { n: total, m: over }) : t("{n} attività di rinnovo · nessun mese sovraccarico", { n: total });
}

export function getSuggestions(contracts: Contract[], plans: Plans) {
  const workload = calcWorkload(contracts, plans);
  return contracts.filter(c => !c.ceased).reduce((acc, c) => {
    const first = (plans[c.id] || []).find(s => s.stepId === "analysis");
    if (!first || first.status === "done") return acc;
    const d = new Date(first.scheduledDate);
    const load = workload[monthKey(d)]?.byBuyer[c.owner] || 0;
    if (load >= WORKLOAD_THRESHOLD) acc.push({ contractId: c.id, supplier: c.supplier, owner: c.owner, reason: t("{owner} ha {n} attività a {month}", { owner: c.owner, n: load, month: fmtMonth(d) }), recommendedOffset: 30 });
    return acc;
  }, [] as Suggestion[]);
}
