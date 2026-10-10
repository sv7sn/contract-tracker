import { DOCUMENT_EXTENSIONS, MAX_DOCUMENT_BYTES, type AppState, type CommitPayload, type ConfigAuditEntry, type CommitResult, type BudgetImport, type BudgetItem, type BudgetLine, type BudgetView, type ImportResult, type Kpis, type InviteInput, type MonitorData, type NewUserInput, type PortalConfig, type Supplier, type SupplierData, type SupplierSummary, type TaskDetail, type TaskList, type TaskSummary, type UpdateUserInput, type User, type VendorAction } from "./types.ts";

export class ApiError extends Error {
  status: number;
  data: Record<string, unknown>;
  constructor(status: number, message: string, data: Record<string, unknown> = {}) { super(message); this.status = status; this.data = data; }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { "Content-Type": "application/json" } });
  const type = res.headers.get("content-type") ?? "";
  // In sviluppo (`vite dev`) /api non esiste e restituisce HTML: lo trattiamo come "backend non disponibile" (status 0).
  if (!type.includes("application/json")) throw new ApiError(0, "Backend non disponibile");
  const data = await res.json();
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Errore ${res.status}`, data);
  return data as T;
}
const post = <T>(path: string, body: unknown) => request<T>(path, { method: "POST", body: JSON.stringify(body) });

export const api = {
  me: () => request<{ user: User }>("/api/me"),
  login: (email: string, password: string) => post<{ user: User }>("/api/login", { email, password }),
  logout: () => post<{ ok: true }>("/api/logout", {}),
  changePassword: (current: string, next: string) => post<{ ok: true }>("/api/password", { current, next }),
  loadState: () => request<AppState>("/api/state"),
  commit: (payload: CommitPayload) => post<CommitResult>("/api/commit", payload),
  listUsers: () => request<{ users: User[] }>("/api/users").then(r => r.users),
  createUser: (input: NewUserInput) => post<{ user: User }>("/api/users", input).then(r => r.user),
  updateUser: (input: UpdateUserInput) => post<{ user: User }>("/api/users", input).then(r => r.user),
  deleteUser: (id: number) => request<{ ok: true }>(`/api/users?id=${id}`, { method: "DELETE" }),
  purge: () => post<{ deleted: number }>("/api/purge", { confirm: "ELIMINA" }),
};

/** Controllo preventivo del file scelto; restituisce un messaggio di errore o null. */
export function checkDocument(file: File): string | null {
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  if (!(DOCUMENT_EXTENSIONS as readonly string[]).includes(ext)) return "Formato non supportato: usa PDF, DOC o DOCX";
  if (file.size > MAX_DOCUMENT_BYTES) return `Il file supera il limite di ${MAX_DOCUMENT_BYTES / 1024 / 1024} MB`;
  if (file.size === 0) return "Il file è vuoto";
  return null;
}

/** Carica il documento direttamente nell'archivio privato (autorizzato da /api/upload) e restituisce il percorso salvato. */
export async function uploadDocument(file: File): Promise<string> {
  const { uploadPresigned } = await import("@vercel/blob/client");
  const safeName = file.name.replace(/[^\p{L}\p{N}._ ()-]+/gu, "_").slice(-120);
  try {
    const result = await uploadPresigned(`contracts/${crypto.randomUUID()}/${safeName}`, file, { access: "private", handleUploadUrl: "/api/upload" });
    return result.pathname;
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (/private/i.test(message)) throw new Error("L'archivio Blob su Vercel deve essere creato in modalità PRIVATA");
    // Il dettaglio tecnico resta visibile per capire subito cosa manca nella configurazione.
    if (/token|store|credential|oidc|presigned|not.?found|suspended|configur/i.test(message)) throw new Error(`Archivio documenti non configurato su Vercel (${message.replace(/^Vercel Blob: /, "").slice(0, 180)})`);
    throw new Error(message || "Caricamento del documento non riuscito");
  }
}

export const documentUrl = (contractId: number, download = false) => `/api/document?id=${contractId}${download ? "&download=1" : ""}`;

// ─── Portale fornitori ───────────────────────────────────────
const portal = (op: string, extra = "") => `/api/portal?op=${op}${extra}`;
export const portalApi = {
  inviteInfo: (token: string) => request<{ name: string; email: string; companies: string[]; privacyNotice: string }>(portal("invite-info", `&token=${encodeURIComponent(token)}`)),
  activate: (token: string, password: string) => post<{ user: User }>(portal("activate"), { token, password }),
  // Area del fornitore
  myself: () => request<{ supplier: Supplier }>(portal("supplier-me")).then(r => r.supplier),
  save: (data: SupplierData) => post<{ supplier: Supplier }>(portal("supplier-save"), data).then(r => r.supplier),
  submit: () => post<{ supplier: Supplier }>(portal("supplier-submit"), {}).then(r => r.supplier),
  addDocument: (doc: { type: string; fileName: string; filePath: string; size: number; validUntil: string | null }) => post<{ supplier: Supplier; docId: number }>(portal("supplier-doc-add"), doc),
  removeDocument: (id: number) => request<{ supplier: Supplier }>(portal("supplier-doc", `&id=${id}`), { method: "DELETE" }).then(r => r.supplier),
  // Staff
  kpis: () => request<Kpis>(portal("kpis")),
  sanctionsRefresh: () => post<{ updated: string[]; errors: string[]; rescreened: number; newHits: number; config: PortalConfig }>(portal("sanctions-refresh"), {}),
  demoSupplier: () => post<{ id: number; name: string; email: string; password: string }>(portal("vendor-demo"), {}),
  budget: (year?: number) => request<BudgetView>(portal("budget", year ? `&year=${year}` : "")),
  budgetIo: (io: string, year?: number) => request<{ line: BudgetLine | null; items: BudgetItem[]; year: number }>(portal("budget-io", `&io=${encodeURIComponent(io)}${year ? `&year=${year}` : ""}`)),
  loadBudgetDemo: () => post<{ years: number[]; tasks: number; contracts: number; suppliers: number }>(portal("budget-demo"), {}),
  deleteBudgetDemo: () => request<{ deleted: number }>(portal("budget-demo"), { method: "DELETE" }),
  deleteBudgetVersion: (id: number) => request<{ ok: true }>(portal("budget-version", `&id=${id}`), { method: "DELETE" }),
  configAudit: () => request<{ entries: ConfigAuditEntry[] }>(portal("config-audit")).then(r => r.entries),
  anonymize: (id: number, reason: string) => post<{ supplier: Supplier }>(portal("vendor-anonymize", `&id=${id}`), { reason }).then(r => r.supplier),
  vendors: () => request<{ vendors: SupplierSummary[] }>(portal("vendors")).then(r => r.vendors),
  vendor: (id: number) => request<{ supplier: Supplier }>(portal("vendor", `&id=${id}`)).then(r => r.supplier),
  invite: (input: InviteInput & { confirmDuplicates?: boolean }) => post<{ supplier: Supplier; link: string }>(portal("vendor-invite"), input),
  reinvite: (id: number) => post<{ supplier: Supplier; link: string }>(portal("vendor-reinvite", `&id=${id}`), {}),
  deleteInvite: (id: number) => request<{ ok: true }>(portal("vendor-invite", `&id=${id}`), { method: "DELETE" }),
  action: (id: number, action: VendorAction, extra: Record<string, unknown> = {}) => post<{ supplier: Supplier }>(portal("vendor-action", `&id=${id}`), { action, ...extra }).then(r => r.supplier),
  vendorChecks: (id: number) => post<{ supplier: Supplier }>(portal("vendor-checks", `&id=${id}`), {}).then(r => r.supplier),
  checkDocument: (id: number) => request<{ supplier: Supplier }>(portal("supplier-doc-check", `&id=${id}`), { method: "POST", body: "{}" }).then(r => r.supplier),
  recheckDocument: (id: number) => request<{ supplier: Supplier }>(portal("doc-check", `&id=${id}`), { method: "POST", body: "{}" }).then(r => r.supplier),
  monitor: () => request<MonitorData>(portal("doc-monitor")),
  remind: (supplierId: number, channel: "email" | "phone", note = "") => post<{ sent: number }>(portal("doc-remind"), { supplierId, channel, note }),
  runReminders: () => post<{ suppliers: number; emails: number; items: number; alerts: number }>(portal("reminders-run"), {}),
  tasks: () => request<TaskList>(portal("tasks")),
  taskSummary: () => request<TaskSummary>(portal("task-summary")),
  task: (id: number) => request<{ task: TaskDetail }>(portal("task", `&id=${id}`)).then(r => r.task),
  createTask: (input: { title: string; detail?: string; due?: string | null; priority?: string; assigneeId?: number; kind?: "activity" | "purchase"; value?: number; currency?: string; supplier?: string; supplierId?: number | null; rdaNumbers?: string[] }) => post<{ task: TaskDetail }>(portal("task-create"), input).then(r => r.task),
  updateTask: (id: number, patch: Record<string, unknown>) => post<{ task: TaskDetail }>(portal("task-update", `&id=${id}`), patch).then(r => r.task),
  saveSourcing: (id: number, input: Record<string, unknown>) => post<{ task: TaskDetail }>(portal("task-sourcing", `&id=${id}`), input).then(r => r.task),
  decideSourcing: (id: number, approve: boolean, note: string) => post<{ task: TaskDetail }>(portal("task-sourcing-approve", `&id=${id}`), { approve, note }).then(r => r.task),
  setOutcome: (id: number, input: Record<string, unknown>) => post<{ task: TaskDetail }>(portal("task-outcome", `&id=${id}`), input).then(r => r.task),
  registerContract: (id: number, input: Record<string, unknown>) => post<{ task: TaskDetail }>(portal("task-contract", `&id=${id}`), input).then(r => r.task),
  setTaskLinks: (id: number, input: { poNumbers?: string[]; rdaNumbers?: string[]; noPoReason?: string; internalOrder?: string }) => post<{ task: TaskDetail }>(portal("task-links", `&id=${id}`), input).then(r => r.task),
  addTaskDoc: (id: number, doc: { kind: string; fileName: string; filePath: string; size: number }) => post<{ task: TaskDetail }>(portal("task-doc", `&id=${id}`), doc).then(r => r.task),
  removeTaskDoc: (id: number, docId: number) => request<{ task: TaskDetail }>(portal("task-doc", `&id=${id}&doc=${docId}`), { method: "DELETE" }).then(r => r.task),
  deleteTask: (id: number) => request<{ ok: true }>(portal("task", `&id=${id}`), { method: "DELETE" }),
  config: () => request<{ config: PortalConfig }>(portal("config")).then(r => r.config),
  saveConfig: (entity: "company" | "industry" | "payment_term" | "sap" | "doc_type" | "reminders" | "rda" | "pgr" | "privacy", action: "save" | "delete", item: unknown) => post<{ config: PortalConfig }>(portal("config-save"), { entity, action, item }).then(r => r.config),
};

export const demoSapFileUrl = (kind: "pr" | "po") => `/api/portal?op=budget-demo-file&kind=${kind}`;
export const budgetTemplateUrl = "/api/portal?op=budget-template";
export const taskDocUrl = (docId: number) => `/api/portal?op=task-doc-download&id=${docId}`;
export const vendorExportUrl = (id: number) => `/api/portal?op=vendor-export&id=${id}`;
export const myDataExportUrl = "/api/portal?op=supplier-export";
export const supplierDocUrl = (id: number, download = false) => `/api/portal?op=doc-download&id=${id}${download ? "&download=1" : ""}`;

/** Carica un documento di qualifica nell'archivio privato e restituisce il percorso salvato. */
export async function uploadSupplierDocument(file: File): Promise<string> {
  const { uploadPresigned } = await import("@vercel/blob/client");
  const safeName = file.name.replace(/[^\p{L}\p{N}._ ()-]+/gu, "_").slice(-120);
  try {
    const result = await uploadPresigned(`suppliers/${crypto.randomUUID()}/${safeName}`, file, { access: "private", handleUploadUrl: "/api/portal?op=supplier-upload-token" });
    return result.pathname;
  } catch (err) {
    throw new Error(err instanceof Error && err.message ? err.message.replace(/^Vercel Blob: /, "").slice(0, 200) : "Caricamento del documento non riuscito");
  }
}

/** Importa un file Excel di SAP (RDA aperte o ordini) così com'è: il server riconosce il tipo dal contenuto. */
export async function importSapFile(file: File, force = false): Promise<ImportResult> {
  const res = await fetch(`/api/portal?op=rda-import${force ? "&force=1" : ""}`, { method: "POST", headers: { "x-file-name": encodeURIComponent(file.name) }, body: file });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Errore ${res.status}`, data);
  return data as ImportResult;
}

/** Carica una versione del Master Plan (Excel .xlsx, CSV o XML di Excel) per l'anno indicato. */
export async function importBudgetFile(file: File, year: number, label: string): Promise<BudgetImport> {
  const res = await fetch(`/api/portal?op=budget-import&year=${year}&label=${encodeURIComponent(label)}`, { method: "POST", headers: { "x-file-name": encodeURIComponent(file.name) }, body: file });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Errore ${res.status}`, data);
  return data as BudgetImport;
}
