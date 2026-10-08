import { DOCUMENT_EXTENSIONS, MAX_DOCUMENT_BYTES, type AppState, type CommitPayload, type CommitResult, type NewUserInput, type UpdateUserInput, type User } from "./types.ts";

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
