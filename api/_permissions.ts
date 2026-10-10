// Regole di accesso condivise: usate dall'API per far rispettare i permessi e dall'interfaccia per mostrare/nascondere i comandi.
// Resta dentro api/ perché Vercel compila questi file insieme alle funzioni (vedi i commenti in README).
import type { Contract, User } from "../src/types.ts";

type Subject = Pick<User, "role" | "name" | "email"> & { id?: number };
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export const isManager = (u: Subject) => u.role === "manager";

/** Il contratto è del buyer: per utente collegato (ownerId) e, per i contratti più vecchi non ancora collegati, per nome. */
const isOwner = (u: Subject, c: Pick<Contract, "owner" | "ownerId">) => (c.ownerId != null && u.id !== undefined ? c.ownerId === u.id : same(c.owner, u.name));

/** Controlling / CFO (viewer) vedono tutti i contratti ma non modificano nulla. */
export const canViewContract = (u: Subject, c: Pick<Contract, "owner" | "ownerId" | "boEmail">) =>
  u.role === "manager" || u.role === "viewer" || (u.role === "buyer" && isOwner(u, c)) || (u.role === "bo" && !!c.boEmail && same(c.boEmail, u.email));

/** Modificare dati, piano e stato di un contratto. */
export const canEditContract = (u: Subject, c: Pick<Contract, "owner" | "ownerId">) =>
  u.role === "manager" || (u.role === "buyer" && isOwner(u, c));

export const canCreateContract = (u: Subject) => u.role === "manager" || u.role === "buyer";
export const canDeleteContract = (u: Subject) => u.role === "manager";

/** Registrare la decisione del Business Owner: il BO del contratto (o un manager per suo conto). */
export const canRespondBO = (u: Subject, c: Pick<Contract, "boEmail">) =>
  u.role === "manager" || (u.role === "bo" && !!c.boEmail && same(c.boEmail, u.email));

export const canManageUsers = (u: Subject) => u.role === "manager";
export const canViewTeam = (u: Subject) => u.role === "manager";

// ─── Fornitori ───────────────────────────────────────────────
/** Utenti interni che gestiscono l'anagrafica fornitori. */
export const isVendorStaff = (u: Subject) => u.role === "manager" || u.role === "buyer" || u.role === "finance";
export const isSupplierUser = (u: Subject) => u.role === "supplier";
/** Invitare fornitori (preregistrazione): solo manager e buyer. */
export const canInviteSuppliers = (u: Subject) => u.role === "manager" || u.role === "buyer";
export const canConfigurePortal = (u: Subject) => u.role === "manager";
