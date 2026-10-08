import type { AppState, CommitPayload, CommitResult, NewUserInput, UpdateUserInput, User } from "./types.ts";

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
