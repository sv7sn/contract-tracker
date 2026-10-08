// Tipi condivisi tra frontend (src/) e API (api/).
export type Role = "manager" | "buyer" | "bo";
export type Urgency = "green" | "yellow" | "red" | "gray";
export type StepStatus = "upcoming" | "done" | "pending_bo";
export type View = "dashboard" | "list" | "planning" | "team" | "notifiche" | "bo" | "detail";

export interface User { id: string; name: string; email: string; role: Role; avatar: string; color: string; title: string }
export interface Contract {
  id: number; supplier: string; object: string; category: string; country: string;
  value: number; currency: string; start: string; end: string; owner: string; boEmail: string;
  renewal: string; type: string; notes: string; ceased: boolean; fileName: string | null;
}
export type ContractData = Omit<Contract, "id">;
export interface PlanStep {
  contractId: number; stepId: string; scheduledDate: string; originalDate: string; status: StepStatus;
  completedAt: string | null; completedBy: string | null; boDecision: string | null; boNotes: string;
  boRespondedAt: string | null; modified: boolean; modifiedReason: string;
}
export interface StepTemplate { id: string; daysBeforeEnd: number; icon: string; label: string; actor: string }
export interface AuditEntry { ts: string; user: string; action: string; detail: string }
export type Plans = Record<number, PlanStep[]>;
export type AuditLogs = Record<number, AuditEntry[]>;
export interface Suggestion { contractId: number; supplier: string; owner: string; reason: string; recommendedOffset: number }
export interface MonthLoad { label: string; total: number; byBuyer: Record<string, number> }


/** Stato completo dell'applicazione, così come lo restituisce l'API. */
export interface AppState { contracts: Contract[]; plans: Plans; auditLogs: AuditLogs }

/** Una modifica atomica: contratto, piano e voci di audit vengono salvati insieme. */
export interface CommitPayload {
  /** Contratto esistente a cui si riferiscono piano e audit, se `contract` non è incluso. */
  contractId?: number;
  contract?: Omit<Contract, "id"> & { id?: number };
  plan?: PlanStep[];
  audit?: (AuditEntry & { contractId?: number })[];
}
export interface CommitResult { contractId: number }
