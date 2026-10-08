import { clearAttempts, ensureSchema, findUserByEmail, publicUser, recordFailedAttempt, tooManyAttempts } from "./_db.js";
import { createSessionToken, sessionCookie, verifyPassword } from "./_crypto.js";
import { errorResponse, HttpError, readJson } from "./_http.js";

export async function POST(request: Request) {
  try {
    const body = (await readJson(request)) as { email?: unknown; password?: unknown };
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!email || !password || password.length > 200) throw new HttpError(400, "Inserisci email e password");
    await ensureSchema();
    if (await tooManyAttempts(email)) throw new HttpError(429, "Troppi tentativi falliti: riprova tra 15 minuti");

    const row = await findUserByEmail(email);
    const ok = await verifyPassword(password, row?.passwordHash);
    if (!row || !ok || !row.active) {
      await recordFailedAttempt(email);
      throw new HttpError(401, "Credenziali non valide");
    }
    await clearAttempts(email);
    const user = publicUser(row);
    return Response.json({ user }, { headers: { "Set-Cookie": sessionCookie(request, createSessionToken(user.id)), "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
