import { loadActing } from "./_cover.js";
import { clearAttempts, ensureSchema, findUserByEmail, getPool, logSecurity, publicUser, recordFailedAttempt, tooManyAttempts } from "./_db.js";
import { createSessionToken, sessionCookie, verifyPassword } from "./_crypto.js";
import { clientIp, errorResponse, HttpError, readJson } from "./_http.js";

export async function POST(request: Request) {
  try {
    const body = (await readJson(request)) as { email?: unknown; password?: unknown };
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!email || !password || password.length > 200) throw new HttpError(400, "Inserisci email e password");
    await ensureSchema();
    const ip = clientIp(request);
    if (await tooManyAttempts(email, ip)) { await logSecurity("login_blocked", { email, ip, detail: "troppi tentativi" }); throw new HttpError(429, "Troppi tentativi falliti: riprova tra 15 minuti"); }

    const row = await findUserByEmail(email);
    const ok = await verifyPassword(password, row?.passwordHash);
    if (!row || !ok || !row.active) {
      await recordFailedAttempt(email, ip);
      await logSecurity("login_failed", { userId: row?.id, email, ip, detail: row && !row.active ? "account disattivato" : "" });
      throw new HttpError(401, "Credenziali non valide");
    }
    await clearAttempts(email);
    await logSecurity("login_ok", { userId: row.id, email, ip });
    const user = publicUser(row);
    if (user.role === "buyer") user.acting = await loadActing(getPool(), user);
    return Response.json({ user }, { headers: { "Set-Cookie": sessionCookie(request, createSessionToken(user.id, row.sessionVersion)), "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
