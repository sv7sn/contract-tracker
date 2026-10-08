import { requireUser } from "./_auth.js";
import { findUserById, setPassword } from "./_db.js";
import { verifyPassword } from "./_crypto.js";
import { errorResponse, HttpError, readJson } from "./_http.js";

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const body = (await readJson(request)) as { current?: unknown; next?: unknown };
    if (typeof body.current !== "string" || typeof body.next !== "string") throw new HttpError(400, "Dati mancanti");
    const row = await findUserById(user.id);
    if (!(await verifyPassword(body.current, row?.passwordHash))) throw new HttpError(400, "La password attuale non è corretta");
    await setPassword(user.id, body.next);
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
