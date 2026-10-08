import type { AppState, CommitPayload, CommitResult } from "./types.ts";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { "Content-Type": "application/json" } });
  const type = res.headers.get("content-type") ?? "";
  // In sviluppo (`vite dev`) /api non esiste e restituisce HTML: lo trattiamo come "backend non disponibile".
  if (!type.includes("application/json")) throw new Error("Backend non disponibile");
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error ?? `Errore ${res.status}`);
  return data as T;
}

export const api = {
  loadState: () => request<AppState>("/api/state"),
  commit: (payload: CommitPayload) => request<CommitResult>("/api/commit", { method: "POST", body: JSON.stringify(payload) }),
  seed: (state: AppState) => request<{ seeded: boolean }>("/api/seed", { method: "POST", body: JSON.stringify(state) }),
};
