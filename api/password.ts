import { requireUser } from "./_auth.js";
import { findUserById, logSecurity, setPassword } from "./_db.js";
import { createSessionToken, sessionCookie, verifyPassword } from "./_crypto.js";
import { clientIp, errorResponse, HttpError, readJson } from "./_http.js";

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const body = (await readJson(request)) as { current?: unknown; next?: unknown };
    if (typeof body.current !== "string" || typeof body.next !== "string") throw new HttpError(400, "Dati mancanti");
    const row = await findUserById(user.id);
    if (!(await verifyPassword(body.current, row?.passwordHash))) throw new HttpError(400, "La password attuale non è corretta");
    const version = await setPassword(user.id, body.next);
    await logSecurity("password_changed", {
      userId: user.id,
      email: user.email,
      ip: clientIp(request),
      detail: "le altre sessioni sono state chiuse",
    });
    // Le altre sessioni si chiudono; questa continua con il nuovo token.
    return Response.json(
      { ok: true },
      { headers: { "Set-Cookie": sessionCookie(request, createSessionToken(user.id, version)), "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return errorResponse(err);
  }
}
