import type { User } from "../src/types.ts";
import { loadActing } from "./_cover.js";
import { countUsers, ensureSchema, findUserById, getPool, publicUser } from "./_db.js";
import { HttpError } from "./_http.js";
import { readSessionCookie, verifySessionToken } from "./_crypto.js";
import { canManageUsers } from "./_permissions.js";

/** Restituisce l'utente della sessione, o risponde 401. L'utente viene riletto dal database a ogni richiesta, quindi disattivazioni e cambi di ruolo hanno effetto subito. */
export async function requireUser(request: Request): Promise<User> {
  await ensureSchema();
  const token = readSessionCookie(request);
  const id = token ? verifySessionToken(token) : null;
  const row = id === null ? undefined : await findUserById(id);
  if (!row || !row.active) throw new HttpError(401, "Non autenticato", { setupRequired: (await countUsers()) === 0 });
  const user = publicUser(row);
  // I buyer in sostituzione di un collega assente agiscono anche per lui (vedi _cover.ts).
  if (user.role === "buyer") user.acting = await loadActing(getPool(), user);
  return user;
}

/** Come requireUser, ma solo per i ruoli indicati (altrimenti 403). */
export async function requireRole(request: Request, allowed: User["role"][]): Promise<User> {
  const user = await requireUser(request);
  if (!allowed.includes(user.role)) throw new HttpError(403, "Operazione non consentita");
  return user;
}

export async function requireManager(request: Request): Promise<User> {
  const user = await requireUser(request);
  if (!canManageUsers(user)) throw new HttpError(403, "Operazione non consentita");
  return user;
}
