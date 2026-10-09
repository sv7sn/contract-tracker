import type { Contract, MonthLoad, PlanStep, Plans, StepTemplate, Suggestion } from "../types.ts";
import { C } from "../theme.ts";
import { addDays, fmtDate, fmtMonth, isoDate, monthKey, NOW } from "./format.ts";

export const PLANNING_STEPS: StepTemplate[] = [
  { id: "analysis",    daysBeforeEnd: 90, icon: "analysis", label: "Analisi spend",           actor: "buyer"  },
  { id: "bo_notify",   daysBeforeEnd: 75, icon: "bo_notify",  label: "Notifica Business Owner", actor: "system" },
  { id: "bo_response", daysBeforeEnd: 60, icon: "bo_response",  label: "Risposta Business Owner", actor: "bo"     },
  { id: "action",      daysBeforeEnd: 45, icon: "action",  label: "Avvio azione",            actor: "buyer"  },
  { id: "negotiation", daysBeforeEnd: 30, icon: "negotiation",  label: "Negoziazione",            actor: "buyer"  },
  { id: "signature",   daysBeforeEnd: 15, icon: "signature",  label: "Firma / formalizzazione", actor: "buyer"  },
  { id: "expiry",      daysBeforeEnd: 0,  icon: "expiry",  label: "Scadenza",                actor: "system" },
];
export const stepTemplate = (id: string) => PLANNING_STEPS.find(s => s.id === id)!;
/** Etichetta dell'attività: con il preavviso l'ultima tappa è il termine per la disdetta, non la scadenza. */
export const stepLabel = (id: string, c?: { noticeDate: string } | null) => id === "expiry" && c?.noticeDate ? "Termine disdetta" : stepTemplate(id).label;

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

export function makePlan(contractId: number, end: string, offsetDays = 0): PlanStep[] {
  return PLANNING_STEPS.map(s => {
    const scheduled = addDays(end, -(s.daysBeforeEnd + offsetDays));
    const isPast = scheduled < NOW;
    return { contractId, stepId: s.id, scheduledDate: isoDate(scheduled), originalDate: isoDate(scheduled), status: isPast ? (s.id === "bo_response" ? "pending_bo" : "done") : "upcoming", completedAt: isPast && s.id !== "bo_response" ? fmtDate(scheduled) : null, completedBy: isPast && s.id !== "bo_response" ? (s.actor === "system" ? "Sistema" : "Buyer") : null, boDecision: null, boNotes: "", boRespondedAt: null, modified: false, modifiedReason: "" };
  });
}

// Ricalcola le date del piano su una nuova scadenza mantenendo lo stato delle attività già avviate/completate.
export function reschedulePlan(oldPlan: PlanStep[], contractId: number, end: string): PlanStep[] {
  return makePlan(contractId, end).map(ns => {
    const old = oldPlan.find(s => s.stepId === ns.stepId);
    return old && old.status !== "upcoming" ? { ...old, scheduledDate: ns.scheduledDate, originalDate: ns.originalDate, modified: false, modifiedReason: "" } : ns;
  });
}

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

export function getSuggestions(contracts: Contract[], plans: Plans) {
  const workload = calcWorkload(contracts, plans);
  return contracts.filter(c => !c.ceased).reduce((acc, c) => {
    const first = (plans[c.id] || []).find(s => s.stepId === "analysis");
    if (!first || first.status === "done") return acc;
    const d = new Date(first.scheduledDate);
    const load = workload[monthKey(d)]?.byBuyer[c.owner] || 0;
    if (load >= WORKLOAD_THRESHOLD) acc.push({ contractId: c.id, supplier: c.supplier, owner: c.owner, reason: `${c.owner} ha ${load} attività a ${fmtMonth(d)}`, recommendedOffset: 30 });
    return acc;
  }, [] as Suggestion[]);
}
