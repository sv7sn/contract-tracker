import { requireManager } from "./_auth.js";
import { createUser, deleteUser, getPool, listUsers, updateUser } from "./_db.js";
import { logChange } from "./_audit.js";
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
    const before = body.id === undefined ? null : (await listUsers()).find(u => u.id === Number(body.id)) ?? null;
    const user = body.id === undefined ? await createUser(body) : await updateUser(actor, body);
    const view = (u: typeof user) => ({ name: u.name, email: u.email, role: u.role, title: u.title, active: u.active });
    await logChange(getPool(), actor, "user", before ? "update" : "create", user.email, before ? view(before) : null, view(user));
    if (before && typeof (body as { password?: unknown }).password === "string") await getPool().query("insert into config_audit (actor, area, action, subject, detail) values ($1,'user','update',$2,'Password reimpostata')", [actor.name, user.email]);
    return Response.json({ user });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(request: Request) {
  try {
    const actor = await requireManager(request);
    const id = Number(new URL(request.url).searchParams.get("id"));
    const before = (await listUsers()).find(u => u.id === id);
    await deleteUser(actor, id);
    if (before) await logChange(getPool(), actor, "user", "delete", before.email, { name: before.name, email: before.email, role: before.role }, null);
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
