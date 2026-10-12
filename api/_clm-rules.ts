// CLM: funzioni che rivedono una bozza di contratto, con il ruolo utente che le rappresenta.
import type { FuncKey, Role } from "../src/types.ts";

export const FUNCS: FuncKey[] = ["requester", "legal", "compliance", "itsec"];
export const FUNC_LABEL: Record<FuncKey, string> = { requester: "Richiedente", legal: "Legal", compliance: "Compliance", itsec: "IT Security" };
/** Ruolo utente di ogni funzione: il richiedente è il Business Owner. */
export const FUNC_ROLE: Record<FuncKey, Role> = { requester: "bo", legal: "legal", compliance: "compliance", itsec: "itsec" };
export const funcOfRole = (r: Role): FuncKey | null => FUNCS.find(f => FUNC_ROLE[f] === r) ?? null;
/** Giorni di tempo che una funzione ha di default per rispondere. */
export const REVIEW_SLA_DAYS = 3;
export const isReviewer = (r: Role) => funcOfRole(r) !== null;
