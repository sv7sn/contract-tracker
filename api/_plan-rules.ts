// Piano di rinnovo di un contratto: condiviso tra interfaccia e server (che crea il piano dei nuovi contratti).
import type { PlanStep, StepTemplate } from "../src/types.ts";

/** Giorni prima della scadenza in cui parte la notifica al Business Owner, se non è stato scelto altro. */
export const DEFAULT_BO_LEAD_DAYS = 75;

export const PLANNING_STEPS: StepTemplate[] = [
  { id: "analysis",    daysBeforeEnd: 90, icon: "analysis", label: "Analisi spend",           actor: "buyer"  },
  { id: "bo_notify",   daysBeforeEnd: 75, icon: "bo_notify",  label: "Notifica Business Owner", actor: "system" },
  { id: "bo_response", daysBeforeEnd: 60, icon: "bo_response",  label: "Risposta Business Owner", actor: "bo"     },
  { id: "action",      daysBeforeEnd: 45, icon: "action",  label: "Avvio azione",            actor: "buyer"  },
  { id: "negotiation", daysBeforeEnd: 30, icon: "negotiation",  label: "Negoziazione",            actor: "buyer"  },
  { id: "signature",   daysBeforeEnd: 15, icon: "signature",  label: "Firma / formalizzazione", actor: "buyer"  },
  { id: "expiry",      daysBeforeEnd: 0,  icon: "expiry",  label: "Scadenza",                actor: "system" },
];
const addDays = (date: string | Date, days: number) => { const d = new Date(date); d.setDate(d.getDate() + days); return d; };
const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const fmtDate = (d: Date) => d.toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" });

export function makePlan(contractId: number, end: string, offsetDays = 0): PlanStep[] {
  return PLANNING_STEPS.map(s => {
    const scheduled = addDays(end, -(s.daysBeforeEnd + offsetDays));
    const isPast = scheduled < new Date();
    return { contractId, stepId: s.id, scheduledDate: isoDate(scheduled), originalDate: isoDate(scheduled), status: isPast ? (s.id === "bo_response" ? "pending_bo" : "done") : "upcoming", completedAt: isPast && s.id !== "bo_response" ? fmtDate(scheduled) : null, completedBy: isPast && s.id !== "bo_response" ? (s.actor === "system" ? "Sistema" : "Buyer") : null, boDecision: null, boNotes: "", boRespondedAt: null, modified: false, modifiedReason: "" };
  });
}

// Ricalcola le date del piano su una nuova scadenza mantenendo lo stato delle attività già avviate/completate.
export function reschedulePlan(oldPlan: PlanStep[], contractId: number, end: string, offsetDays = 0): PlanStep[] {
  return makePlan(contractId, end, offsetDays).map(ns => {
    const old = oldPlan.find(s => s.stepId === ns.stepId);
    return old && old.status !== "upcoming" ? { ...old, scheduledDate: ns.scheduledDate, originalDate: ns.originalDate, modified: false, modifiedReason: "" } : ns;
  });
}

