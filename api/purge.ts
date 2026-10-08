import { requireManager } from "./_auth.js";
import { purgeContracts } from "./_db.js";
import { errorResponse, HttpError, readJson } from "./_http.js";

// Elimina TUTTI i contratti. Richiede la parola di conferma nel corpo della richiesta.
export async function POST(request: Request) {
  try {
    await requireManager(request);
    const body = (await readJson(request)) as { confirm?: unknown };
    if (body.confirm !== "ELIMINA") throw new HttpError(400, "Conferma mancante");
    return Response.json({ deleted: await purgeContracts() });
  } catch (err) {
    return errorResponse(err);
  }
}
