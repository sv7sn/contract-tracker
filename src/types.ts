// Tipi condivisi tra frontend (src/) e API (api/).
export type Role = "manager" | "buyer" | "finance" | "bo" | "supplier";
export type Urgency = "green" | "yellow" | "red" | "gray";
export type StepStatus = "upcoming" | "done" | "pending_bo";
export type View = "dashboard" | "list" | "planning" | "team" | "notifiche" | "bo" | "users" | "detail" | "vendors" | "config" | "supplier" | "expiries" | "tasks" | "hub";

/** Utente autenticato, come restituito dall'API (mai con la password). */
export interface User { id: number; email: string; name: string; role: Role; title: string; active: boolean }
export interface Contract {
  id: number; supplier: string; object: string; category: string; country: string;
  value: number; currency: string; start: string; end: string; owner: string; boEmail: string;
  renewal: string; type: string; notes: string; ceased: boolean;
  /** Giorni di preavviso per la disdetta (null se il contratto non lo prevede). */
  noticeDays: number | null;
  /** Data limite per inviare la disdetta ("" se non c'è preavviso): se presente il piano si conta da qui. */
  noticeDate: string;
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
  /** Dichiarazioni del fornitore (conflitto d'interessi, sanzioni) e presa visione dell'informativa privacy. */
  declarations?: { conflictOfInterest?: boolean | null; conflictDetails?: string; noSanctions?: boolean; privacyAccepted?: boolean; privacyAcceptedAt?: string };
}

export interface DocTypeDef { key: string; label: string; help: string; expires: boolean; multiple: boolean }
export type DocScope = "all" | "country" | "industry";
export interface DocRule { docType: string; scope: DocScope; value: string; level: "required" | "optional" }
/** Tipo di documento così come si applica a un fornitore (paese e codice merceologico già considerati). */
export interface ResolvedDocType extends DocTypeDef { required: boolean }

export type AiStatus = "ok" | "warning" | "problem" | "skipped";
/** Esito del controllo automatico di un documento: è un primo filtro, la decisione resta al Buyer. */
export interface AiCheck {
  status: AiStatus; summary: string; issues: string[]; provider: string; checkedAt: string;
  extracted: { documentType?: string; holderName?: string; vatCode?: string; issueDate?: string | null; validUntil?: string | null };
}

export interface SupplierDocument { id: number; type: string; typeLabel: string; fileName: string; size: number; validUntil: string | null; uploadedAt: string; uploadedBy: string; ai: AiCheck | null }
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
  /** Data di anonimizzazione dei dati personali (privacy), se avvenuta. */
  anonymizedAt?: string | null;
  /** Solo per il fornitore: testo dell'informativa privacy da accettare. */
  privacyNotice?: string;
  documents: SupplierDocument[]; events: SupplierEvent[];
  /** Documenti applicabili a questo fornitore, con l'indicazione di quelli obbligatori. */
  docTypes: ResolvedDocType[];
  lifecycle: Lifecycle; lifecycleReason: string; qualification: Qualification;
  approvedAt: string | null;
  /** Solo per lo staff: differenze rispetto ai dati approvati, possibili doppioni e controlli di conformità. */
  changes: FieldChange[]; bankChanged: boolean; bankLetterAfterChange: boolean;
  duplicates: DuplicateMatch[]; compliance: ComplianceCheck[]; complianceCheckedAt: string | null;
}

/** Stato operativo del fornitore, indipendente dal flusso di registrazione. */
export type Lifecycle = "active" | "blocked" | "inactive" | "excluded";
/** Qualifica documentale: "lapsed" = almeno un documento obbligatorio scaduto o mancante. */
export type Qualification = "valid" | "expiring" | "lapsed" | "na";
export interface FieldChange { field: string; label: string; before: string; after: string; bank: boolean }
export interface DuplicateMatch { supplierId: number; name: string; status: SupplierStatus; lifecycle: Lifecycle; sapCode: string | null; fields: string[]; severe: boolean; confirmed: boolean }
export type CheckStatus = "ok" | "warn" | "fail" | "todo" | "na";
export interface ComplianceCheck { key: string; label: string; status: CheckStatus; detail: string }
export type SupplierSummary = Omit<Supplier, "documents" | "events" | "data" | "docTypes" | "changes" | "duplicates" | "compliance" | "complianceCheckedAt" | "bankLetterAfterChange"> & { country: string; legalName: string; documentCount: number; duplicate: boolean };

export interface BuyingCompany { code: string; name: string; sapCompanyCode: string; purchOrg: string }
export interface IndustryCode { code: string; name: string; buyerIds: number[] }
export interface PaymentTerm { code: string; label: string }
export interface SapSettings {
  tradingPartner: string; sortKey: string; cashManagementGroup: string; releaseGroup: string;
  reconciliationAccounts: Record<string, string>;
}
export interface ReminderPolicy {
  enabled: boolean;
  /** Giorni prima della scadenza in cui parte un reminder (es. 60, 30, 15). */
  days: number[];
  /** Ogni quanti giorni ripetere il sollecito per documenti scaduti o mancanti. */
  repeatDays: number;
  /** Dopo quanti solleciti senza risposta il fornitore risulta "non risponde". */
  escalateAfter: number;
}
export interface PrivacySettings { notice: string; inviteDays: number; retentionMonths: number }
export interface ConfigAuditEntry { id: number; at: string; actor: string; area: string; areaLabel: string; action: string; subject: string; detail: string }
export interface PortalConfig {
  companies: BuyingCompany[]; industryCodes: IndustryCode[]; paymentTerms: PaymentTerm[]; sap: SapSettings; buyers: { id: number; name: string; active: boolean }[];
  docTypes: DocTypeDef[]; docRules: DocRule[]; reminders: ReminderPolicy;
  emailConfigured: boolean; ai: { provider: string; configured: boolean };
  rda: RdaConfig; privacy: PrivacySettings;
}

export type MonitorState = "expired" | "expiring" | "missing" | "valid";
export interface MonitorItem {
  key: string; supplierId: number; supplierName: string; buyerName: string;
  docType: string; docLabel: string; docId: number | null; fileName: string; validUntil: string | null; daysLeft: number | null;
  state: MonitorState; required: boolean;
  reminders: number; lastReminderAt: string | null; lastChannel: string | null; unresponsive: boolean; ai: AiStatus | null;
}
export interface MonitorData { items: MonitorItem[]; policy: ReminderPolicy; emailConfigured: boolean; lastRunAt: string | null }

export interface InviteInput { email: string; name: string; companyCodes: string[]; industryCode: string; customerCode?: string; referenceBuyerId: number }
export type VendorAction = "approve" | "reject" | "request_revision" | "set_payment_terms" | "change_status" | "block" | "deactivate" | "exclude" | "reactivate" | "sanctions_manual";

// ─── Task ────────────────────────────────────────────────────
export type TaskSource = "contract" | "rda" | "manual";
export type TaskPriority = "low" | "normal" | "high";
export interface TaskPo { po: string; supplierName: string; docDate: string | null }
export interface RdaMeta { pgr?: string; requestedBy?: string; createdBy?: string; value?: number; currency?: string; lines?: number; releaseDate?: string | null; delivDate?: string | null; plant?: string; firstSeen?: string }
/** Come è stato scelto il fornitore di una RDA sopra soglia. */
export type SourcingMode = "comparison" | "strategic" | "single_source" | "exception";
export interface SourcingQuote { supplier: string; amount: number; chosen: boolean }
export interface Sourcing {
  mode: SourcingMode; quotes: SourcingQuote[]; justification: string; recordedBy: string; recordedAt: string;
  /** Solo per le eccezioni: approvazione del Manager. */
  approval: "pending" | "approved" | "rejected" | null; approvedBy: string; approvedAt: string | null; approvalNote: string;
}
/** na = sotto soglia; missing = serve e manca; pending = eccezione in attesa del Manager; ok = documentata. */
export type SourcingStatus = "na" | "missing" | "pending" | "ok";
export interface Task {
  id: number; source: "rda" | "manual"; sourceKey: string | null; title: string; detail: string; due: string | null; priority: TaskPriority;
  assigneeId: number | null; assigneeName: string; status: "open" | "done"; doneAt: string | null; doneReason: string; doneBy: string;
  meta: RdaMeta; pos: TaskPo[]; createdBy: string; createdAt: string; updatedAt: string;
  sourcing: Sourcing | null; sourcingRequired: boolean; sourcingStatus: SourcingStatus;
}
export interface TaskLine { item: string; shortText: string; qty: number; unit: string; price: number; per: number; currency: string; delivDate: string | null; costCenter: string; glAccount: string; value: number }
export interface TaskDetail extends Task { lines: TaskLine[] }
export interface TaskList { tasks: Task[]; sapUpdatedAt: { pr: string | null; po: string | null } }
export interface ImportResult { kind: "pr" | "po"; fileName: string; rows: number; prs: number; created: number; updated: number; reopened: number; closedPo: number; closedGone: number; linked: number }
export interface RdaGroup { pgr: string; userId: number | null; note: string; openTasks: number }
export interface RdaConfig { slaDays: number; sourcingThreshold: number; groups: RdaGroup[]; ingestConfigured: boolean; lastImports: { kind: string; fileName: string; rows: number; at: string; by: string }[] }
export interface TaskSummary { open: number; overdue: number; dueSoon: number; unassigned: number; sourcingMissing: number; exceptionsPending: number }
