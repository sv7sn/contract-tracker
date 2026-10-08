// Tipi condivisi tra frontend (src/) e API (api/).
export type Role = "manager" | "buyer" | "finance" | "bo" | "supplier";
export type Urgency = "green" | "yellow" | "red" | "gray";
export type StepStatus = "upcoming" | "done" | "pending_bo";
export type View = "dashboard" | "list" | "planning" | "team" | "notifiche" | "bo" | "users" | "detail" | "vendors" | "config" | "supplier";

/** Utente autenticato, come restituito dall'API (mai con la password). */
export interface User { id: number; email: string; name: string; role: Role; title: string; active: boolean }
export interface Contract {
  id: number; supplier: string; object: string; category: string; country: string;
  value: number; currency: string; start: string; end: string; owner: string; boEmail: string;
  renewal: string; type: string; notes: string; ceased: boolean;
  /** Nome del file mostrato all'utente. */
  fileName: string | null;
  /** Percorso del documento nell'archivio privato; null se il file non è stato salvato. */
  filePath: string | null;
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
  /** Elimina un contratto (solo manager). Ignora gli altri campi. */
  deleteContractId?: number;
  /** Contratto esistente a cui si riferiscono piano e audit, se `contract` non è incluso. */
  contractId?: number;
  contract?: Omit<Contract, "id"> & { id?: number };
  plan?: PlanStep[];
  audit?: (AuditEntry & { contractId?: number })[];
}
export interface CommitResult { contractId: number }

/** Limiti e formati dei documenti allegati ai contratti. */
export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
export const DOCUMENT_EXTENSIONS = ["pdf", "doc", "docx"] as const;

export interface NewUserInput { email: string; name: string; role: Role; title: string; password: string }
export interface UpdateUserInput { id: number; role?: Role; title?: string; active?: boolean; password?: string }

// ─── Onboarding fornitori ────────────────────────────────────

/** Stato di un fornitore nel percorso di registrazione. */
export type SupplierStatus = "invited" | "draft" | "pending" | "pending_revision" | "approved" | "rejected" | "registered";

export interface SupplierData {
  company?: { legalName?: string; vatCode?: string; fiscalCode?: string };
  address?: { street?: string; houseNumber?: string; postalCode?: string; city?: string; country?: string; region?: string };
  payment?: { iban?: string; swift?: string; accountNumber?: string; bankName?: string; currency?: string; withholdingTax?: boolean | null; withholdingType?: string; withholdingSpec?: string };
  contacts?: { language?: "IT" | "EN"; ordersEmail?: string; adminEmail?: string; phone?: string };
  acceptedTerms?: boolean;
}

export interface SupplierDocument { id: number; type: string; fileName: string; size: number; validUntil: string | null; uploadedAt: string; uploadedBy: string }
export interface SupplierEvent { at: string; actor: string; action: string; detail: string }

export interface Supplier {
  id: number; email: string; name: string;
  companyCodes: string[]; industryCode: string; customerCode: string;
  referenceBuyerId: number | null; referenceBuyerName: string;
  status: SupplierStatus; data: SupplierData;
  paymentTerms: string | null; sapCode: string | null; sapAccountGroup: string | null;
  rejectionReason: string; isUpdate: boolean;
  invitedAt: string; expiresAt: string | null; submittedAt: string | null; updatedAt: string;
  /** Solo per lo staff e solo finché l'invito non è stato usato. */
  inviteLink?: string;
  documents: SupplierDocument[]; events: SupplierEvent[];
}
export type SupplierSummary = Omit<Supplier, "documents" | "events" | "data"> & { country: string; legalName: string; documentCount: number };

export interface BuyingCompany { code: string; name: string; sapCompanyCode: string; purchOrg: string }
export interface IndustryCode { code: string; name: string; buyerIds: number[] }
export interface PaymentTerm { code: string; label: string }
export interface SapSettings {
  tradingPartner: string; sortKey: string; cashManagementGroup: string; releaseGroup: string;
  reconciliationAccounts: Record<string, string>;
}
export interface PortalConfig { companies: BuyingCompany[]; industryCodes: IndustryCode[]; paymentTerms: PaymentTerm[]; sap: SapSettings; buyers: { id: number; name: string; active: boolean }[] }

export interface InviteInput { email: string; name: string; companyCodes: string[]; industryCode: string; customerCode?: string; referenceBuyerId: number }
export type VendorAction = "approve" | "reject" | "request_revision" | "set_payment_terms" | "change_status";
