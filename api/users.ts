import { requireManager } from "./_auth.js";
import { createUser, listUsers, updateUser } from "./_db.js";
import { errorResponse, readJson } from "./_http.js";

export async function GET(request: Request) {
  try {
    await requireManager(request);
    return Response.json({ users: await listUsers() }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}

// Con `id` aggiorna un utente esistente (ruolo, titolo, stato, nuova password), altrimenti ne crea uno.
export async function POST(request: Request) {
  try {
    const actor = await requireManager(request);
    const body = (await readJson(request)) as { id?: unknown };
    return Response.json({ user: body.id === undefined ? await createUser(body) : await updateUser(actor, body) });
  } catch (err) {
    return errorResponse(err);
  }
}
