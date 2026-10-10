// Tipi condivisi tra frontend (src/) e API (api/).
/** viewer = Controlling / CFO: consulta contratti, Master Plan, spesa e indicatori senza poter modificare nulla. */
export type Role = "manager" | "buyer" | "finance" | "bo" | "supplier" | "viewer";
export type Urgency = "green" | "yellow" | "red" | "gray";
export type StepStatus = "upcoming" | "done" | "pending_bo";
export type View = "dashboard" | "list" | "planning" | "team" | "notifiche" | "bo" | "users" | "detail" | "vendors" | "config" | "supplier" | "expiries" | "tasks" | "hub" | "kpi" | "budget" | "spend" | "requests";

/** Utente autenticato, come restituito dall'API (mai con la password). */
export interface User { id: number; email: string; name: string; role: Role; title: string; active: boolean; /** Codice utente SAP del richiedente (solo Business Owner): collega le RDA aperte in SAP a lui. */ sapUser?: string;
  /** Solo buyer: chi sta sostituendo oggi (assenze dei colleghi), calcolato a ogni richiesta. `ids` e `names` includono sempre l'utente stesso. */
  acting?: { ids: number[]; names: string[]; covering: { id: number; name: string; until: string }[] } }
export interface Contract {
  id: number; supplier: string; object: string; category: string; country: string;
  value: number; currency: string; start: string; end: string; owner: string; boEmail: string;
  renewal: string; type: string; notes: string; ceased: boolean;
  /** Giorni di preavviso per la disdetta (null se il contratto non lo prevede). */
  noticeDays: number | null;
  /** Data limite per inviare la disdetta ("" se non c'è preavviso): se presente il piano si conta da qui. */
  noticeDate: string;
  /** Ciclo di vita (gestito dal task di rinnovo, non dal form): attivo oppure chiuso con un esito. */
  status?: ContractStatus; outcome?: ContractOutcome | ""; outcomeNote?: string; closedAt?: string | null;
  /** Catena dei contratti: quello che questo sostituisce e quello che lo sostituisce. */
  replaces?: number | null; replacedBy?: number | null;
  /** Giorni prima della scadenza in cui partono gli avvisi al Business Owner (null = predefinito, 75). */
  boLeadDays?: number | null;
  /** Utente buyer o manager responsabile del contratto (il nome in `owner` resta per la visualizzazione). */
  ownerId?: number | null;
  /** Business Owner: utente con ruolo Business Owner (la sua email resta in `boEmail`, per i contratti più vecchi anche da sola). */
  boUserId?: number | null; boName?: string;
  /** Fornitore in anagrafica (portale fornitori), se collegato. */
  supplierId?: number | null;
  /** Riga del Master Plan su cui pesa il contratto. */
  internalOrder?: string;
  /** Nome del file mostrato all'utente. */
  fileName: string | null;
  /** Percorso del documento nell'archivio privato; null se il file non è stato salvato. */
  filePath: string | null;
}
export type ContractData = Omit<Contract, "id" | "boName">;
export type ContractStatus = "active" | "closed";
/** renewed = rinnovato/rinegoziato con lo stesso fornitore; replaced = sostituito (gara o altro fornitore); extended = prorogato; ceased = cessato. */
export type ContractOutcome = "renewed" | "replaced" | "extended" | "ceased";
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

export interface NewUserInput { email: string; name: string; role: Role; title: string; password: string; sapUser?: string }
export interface UpdateUserInput { id: number; role?: Role; title?: string; active?: boolean; password?: string; sapUser?: string }

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
  /** Solo per Manager e Buyer: contratti collegati al fornitore (attivi e storico). */
  contracts?: { id: number; object: string; end: string; noticeDate: string; value: number; currency: string; status: string; outcome: string; owner: string }[];
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
export interface SanctionsStatus { provider: "lists" | "opensanctions" | "mock"; updatedAt: string | null; sources: { key: string; label: string; count: number; at: string | null; error: string }[] }
export interface PrivacySettings { notice: string; inviteDays: number; retentionMonths: number }
export interface ConfigAuditEntry { id: number; at: string; actor: string; area: string; areaLabel: string; action: string; subject: string; detail: string }
export interface PortalConfig {
  companies: BuyingCompany[]; industryCodes: IndustryCode[]; paymentTerms: PaymentTerm[]; sap: SapSettings; buyers: { id: number; name: string; active: boolean }[];
  docTypes: DocTypeDef[]; docRules: DocRule[]; reminders: ReminderPolicy;
  emailConfigured: boolean; ai: { provider: string; configured: boolean };
  rda: RdaConfig; privacy: PrivacySettings; sanctions: SanctionsStatus;
  /** Fonti esterne collegate per la verifica dell'azienda. */
  externalChecks: { vies: boolean; openapi: boolean };
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
export interface RdaMeta { pgr?: string; requestedBy?: string; createdBy?: string; value?: number; currency?: string; lines?: number; releaseDate?: string | null; delivDate?: string | null; plant?: string; firstSeen?: string;
  /** Valore per internal order (RDA da SAP) o internal order indicato a mano (pratiche, RDA senza ordine). */
  io?: Record<string, number>; internalOrder?: string; costCenter?: string;
  /** Solo task di rinnovo: dati del contratto di origine al momento della creazione. */
  supplier?: string; object?: string; keyDate?: string; end?: string; noticeDate?: string;
  /** Valore del contratto in scadenza, dopo che l'esito ha registrato il nuovo valore. */
  previousValue?: number;
  /** Acquisti manuali: fornitore previsto in anagrafica; RDA da SAP: pratica in cui è stata unita. */
  supplierId?: number | null; mergedInto?: number }
/** Come è stato scelto il fornitore di una RDA sopra soglia. */
export type SourcingMode = "comparison" | "strategic" | "single_source" | "exception";
export interface SourcingQuote { supplier: string; amount: number; chosen: boolean }
/** Saving: rispetto al prezzo di riferimento (es. contratto precedente), alla media delle offerte e alla prima offerta del fornitore scelto. */
export interface Saving { finalAmount: number; vsBaseline: number | null; vsAverage: number | null; negotiation: number | null; amount: number; pct: number; basis: "baseline" | "average" | "negotiation" }
export interface Sourcing {
  mode: SourcingMode; quotes: SourcingQuote[]; justification: string; recordedBy: string; recordedAt: string;
  /** Solo per le eccezioni: approvazione del Manager. */
  approval: "pending" | "approved" | "rejected" | null; approvedBy: string; approvedAt: string | null; approvalNote: string;
  /** Prezzo di riferimento (es. valore del contratto precedente) e importo finale negoziato con il fornitore scelto. */
  baseline?: number | null; finalAmount?: number | null;
}
/** na = sotto soglia; missing = serve e manca; pending = eccezione in attesa del Manager; ok = documentata. */
export type SourcingStatus = "na" | "missing" | "pending" | "ok";
export interface Task {
  id: number; source: "rda" | "manual" | "contract"; sourceKey: string | null; title: string; detail: string; due: string | null; priority: TaskPriority;
  assigneeId: number | null; assigneeName: string; status: "open" | "done"; doneAt: string | null; doneReason: string; doneBy: string;
  meta: RdaMeta; pos: TaskPo[]; createdBy: string; createdAt: string; updatedAt: string;
  sourcing: Sourcing | null; sourcingRequired: boolean; sourcingStatus: SourcingStatus; saving: Saving | null;
  /** Pratica: contratto di origine (task di rinnovo), esito, nuovo contratto, RDA, PO e documenti. */
  contractId: number | null; outcome: ContractOutcome | "new_contract" | ""; newContractId: number | null;
  /** Solo task manuali: attività semplice oppure acquisto (pratica completa come RDA e rinnovi). */
  kind: "activity" | "purchase";
  rdaNumbers: string[]; poNumbers: string[]; noPoReason: string; documents: TaskDocument[];
}
export type TaskDocKind = "offer" | "contract" | "addendum" | "termination" | "other";
export interface TaskDocument { id: number; kind: TaskDocKind; fileName: string; size: number; uploadedBy: string; uploadedAt: string }
export interface TaskLine { item: string; shortText: string; qty: number; unit: string; price: number; per: number; currency: string; delivDate: string | null; costCenter: string; glAccount: string; value: number; internalOrder: string }
export interface TaskDetail extends Task { lines: TaskLine[] }
export interface TaskList { tasks: Task[]; sapUpdatedAt: { pr: string | null; po: string | null } }
export interface ImportResult { kind: "pr" | "po"; fileName: string; rows: number; prs: number; created: number; updated: number; reopened: number; closedPo: number; closedGone: number; linked: number; /** Righe d'ordine salvate per l'analisi della spesa (solo file ordini). */ poLines?: number }
export interface RdaGroup { pgr: string; userId: number | null; note: string; openTasks: number }
export interface RdaConfig { slaDays: number; sourcingThreshold: number; renewalLeadDays: number; groups: RdaGroup[]; ingestConfigured: boolean; lastImports: { kind: string; fileName: string; rows: number; at: string; by: string }[] }
export interface TaskSummary { open: number; overdue: number; dueSoon: number; unassigned: number; sourcingMissing: number; exceptionsPending: number }

/** Indicatori di processo (pagina Indicatori, solo Manager). */
export interface KpiCount { label: string; n: number }
export interface Kpis {
  generatedAt: string;
  rda: {
    open: number; overdue: number; slaDays: number; aging: KpiCount[]; closed90: number; withinSla90: number | null; medianCycleDays: number | null;
    monthly: { month: string; closed: number; medianDays: number | null }[]; byBuyer: { name: string; open: number; overdue: number }[];
  };
  sourcing: { threshold: number; required90: number; compliant90: number; byMode: KpiCount[]; openMissing: number; exceptionsPending: number;
    /** Saving delle pratiche chiuse negli ultimi 12 mesi (EUR). */
    saving12m: number; savingCount12m: number; savingPct12m: number | null };
  onboarding: { inProgress: KpiCount[]; registered12m: number; medianDaysToRegister: number | null; stuckAtBuyer: number; stuckAtFinance: number };
  qualification: { valid: number; expiring: number; lapsed: number; blocked: number };
  contracts: { active: number; keyNext90: number; withNotice: number; withoutDecision: number; missedDeadline: number };
}

/** Master Plan (budget annuale per internal order): versioni caricate da Finance. La prima versione dell'anno è il riferimento per il saving. */
export interface BudgetImport { year: number; created: MpVersion[]; updated: MpVersion[] }
export interface MpVersion { id: number; year: number; version: number; label: string; fileName: string; uploadedBy: string; uploadedAt: string; lines: number; total: number }
export interface BudgetLine {
  io: string; description: string; function: string; costCenter: string; glAccount: string; category: string;
  /** Budget nella prima versione (riferimento) e nell'ultima versione dell'anno. */
  baseline: number | null; current: number | null;
  /** Impegnato: RDA approvate (aperte o già ordinate) e acquisti chiusi. In previsione: pratiche aperte senza RDA. Contratti: quota dell'anno dei contratti collegati. */
  committed: number; pipeline: number; contracts: number;
  residual: number | null; vsBaseline: number | null; items: number;
}
export interface BudgetItem { kind: "rda" | "purchase" | "contract"; id: number; title: string; value: number; status: string; date: string | null }
export interface BudgetView {
  year: number; currentYear: number; years: number[]; versions: MpVersion[]; baselineId: number | null; currentId: number | null;
  lines: BudgetLine[]; unassigned: { taskId: number; title: string; value: number; costCenter: string; sourceKey: string | null }[];
  canUpload: boolean;
  /** La simulazione (dati di prova MP26/MP27) è caricata. */
  demo: boolean;
}

// ─── Spesa dai file ordini SAP ───────────────────────────────
/** Copertura contrattuale di una riga d'ordine: accordo quadro SAP (Agmt), contratto del registro valido alla data del PO, nessuna. */
export type SpendCoverage = "agreement" | "contract" | "none";
export interface SpendSupplier { code: string; name: string; supplierId: number | null; value: number; pos: number; share: number; agreement: number; contract: number; none: number }
export interface SpendGroup { label: string; value: number; pos: number; suppliers: number }
export interface SpendPo { po: string; item: string; docDate: string | null; supplierCode: string; supplierName: string; value: number; valueSource: string; prValue: number; netValue: number | null; shortText: string; category: string; internalOrder: string; costCenter: string; pr: string }
/** Possibile frazionamento: elementi ravvicinati, ciascuno sotto soglia, che insieme la superano. */
export interface SplitCase { kind: "po" | "rda"; who: string; detail: string; total: number; from: string; to: string; items: { id: string; date: string; value: number; label: string }[] }
export interface SpendView {
  year: number | null; years: number[]; from: string | null; to: string | null; firstImport: string | null; threshold: number;
  total: number; lines: number; pos: number; suppliers: number;
  /** Da dove viene il valore delle righe: netto PO, valore RDA, entrata merci, nessun valore. */
  valued: { net: number; pr: number; gr: number; none: number };
  otherCurrency: { lines: number; currencies: string[] };
  concentration: { top1: number; top5: number; top10: number; coreSuppliers: number; tailSuppliers: number; tailValue: number; tailShare: number };
  coverage: { agreement: number; contract: number; none: number; coveredShare: number };
  monthly: { month: string; value: number; pos: number }[];
  bySupplier: SpendSupplier[]; byCategory: SpendGroup[]; byFunction: SpendGroup[];
  /** Ordini senza RDA, senza accordo quadro e senza contratto. */
  noRda: { lines: number; value: number; items: SpendPo[] };
  /** Fornitori sopra la soglia senza contratto né accordo quadro: candidati a un contratto. */
  candidates: SpendSupplier[];
  /** Spesa non attribuita a nessuna categoria unificata (gruppi merci SAP non classificati). */
  unclassified: { value: number; groups: number };
  /** Budget del Master Plan (versione in uso) e spesa per categoria unificata; vuoto se non ci sono categorie. */
  categoryBudget: { label: string; budget: number; spend: number }[];
  /** Possibili frazionamenti di ordini (stesso fornitore e categoria) e di RDA (stesso richiedente e internal order) nella finestra indicata. */
  splits: { windowDays: number; cases: SplitCase[] };
  /** Ordini con valore netto oltre quello della RDA (solo se l'estrazione ha il valore netto). */
  overRda: { available: boolean; items: SpendPo[] };
}

// ─── Categorie unificate ─────────────────────────────────────
export interface CategorySource { kind: "sap" | "mp"; key: string; label: string; amount: number; categoryId: number | null }
export interface CategoriesView { categories: { id: number; name: string }[]; sources: CategorySource[];
  /** Buyer assegnati a ciascuna categoria e buyer che non ne seguono nessuna (vedono tutta la spesa). */
  assignments: Record<number, number[]>; buyers: { id: number; name: string }[]; unscoped: string[] }

// ─── Richieste di offerta ────────────────────────────────────
export interface RfqInvite { supplierId: number; supplierName: string; sapCode: string; amount: number | null; notes: string; quotedAt: string | null; declined: boolean; fileName: string }
export interface Rfq { id: number; taskId: number; title: string; description: string; deadline: string; status: "open" | "closed"; createdBy: string; createdAt: string; specFile: string; invites: RfqInvite[] }
/** Vista del fornitore: solo la propria offerta, mai quelle degli altri. */
export interface SupplierRfq { id: number; title: string; description: string; deadline: string; status: "open" | "closed"; specFile: string; myQuote: { amount: number | null; notes: string; quotedAt: string | null; declined: boolean; fileName: string } }

// ─── Valutazione dei fornitori ───────────────────────────────
export type RatingCriterion = "quality" | "delivery" | "service" | "price";
export interface SupplierRating { id: number; raterName: string; quality: number; delivery: number; service: number; price: number; comment: string; po: string; createdAt: string; mine: boolean }
export interface Scorecard {
  count: number; overall: number | null; criteria: Record<RatingCriterion, number | null>; ratings: SupplierRating[];
  /** Dati che il software già conosce: risposte alle richieste di offerta e ordini degli ultimi 12 mesi. */
  rfq: { invited: number; answered: number; declined: number };
  spend12m: number; pos12m: number;
}

// ─── Il mio lavoro ───────────────────────────────────────────
export type WorkKind = "bo_message" | "bo_to_send" | "bo_waiting" | "task_late" | "task_soon" | "sourcing_missing" | "exception" | "unassigned" | "rfq_answers" | "rfq_compare" | "vendor_review" | "vendor_lapsed" | "vendor_unresponsive" | "splits";
export interface WorkItem {
  kind: WorkKind; urgency: 1 | 2 | 3; title: string; detail: string;
  /** Giorni di ritardo (positivo) o mancanti (negativo), se la voce ha una scadenza. */
  days: number | null;
  target: { view: View; taskId?: number; vendorId?: number; contractId?: number };
  /** Azione rapida sulla riga: invia o sollecita l'avviso al Business Owner del contratto. */
  quick?: { label: string; contractId: number };
}

// ─── Pulizia dei dati di prova ───────────────────────────────
export type ResetArea = "tasks" | "contracts" | "suppliers_test" | "suppliers_all" | "sap" | "budget" | "categories";
export type ResetPreview = Record<ResetArea, number>;

// ─── Avvisi al Business Owner ────────────────────────────────
export interface BoNotice { id: number; kind: "notice" | "reminder" | "auto" | "auto_reminder"; toEmail: string; message: string; sentBy: string; sentAt: string; status: string }
export interface BoSettings { auto: boolean; reminderDays: number }
export interface BoInfo {
  boEmail: string; hasBoAccount: boolean; leadDays: number; defaultLeadDays: number; noticeDate: string;
  /** Stato della richiesta: da inviare, in attesa di risposta (da quanti giorni), risposta data. */
  state: "to_send" | "waiting" | "answered"; waitingDays: number | null; decision: string; notices: BoNotice[]; settings: BoSettings;
}

// ─── Area del Business Owner / Richiedente ───────────────────
export type RdaStage = "received" | "working" | "rfq" | "chosen" | "ordered" | "closed";
export interface RequesterRda {
  pr: string; title: string; value: number; currency: string; releaseDate: string | null; buyerName: string; stage: RdaStage; stageLabel: string; pos: string[];
  io: string; budget: { current: number | null; committed: number; residual: number | null } | null;
}
export interface RequesterContract {
  contractId: number; title: string; keyDate: string; state: "to_answer" | "answered" | "upcoming"; decision: string; noticeDate: string;
  task: { status: "open" | "done"; buyerName: string; outcome: string } | null; unreadMessages: number;
}
export interface Requests { sapUser: string; rdas: RequesterRda[]; contracts: RequesterContract[] }
export interface BoMessage { id: number; authorName: string; authorRole: Role; body: string; createdAt: string; fromMe: boolean }

// ─── Assenze e sostituti ─────────────────────────────────────
export interface CoverEntry { id: number; userId: number; userName: string; substituteId: number; substituteName: string; from: string; to: string; active: boolean }
export interface CoverBuyer { id: number; name: string }
export interface CoverView { entries: CoverEntry[]; buyers: CoverBuyer[] }
