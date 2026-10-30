import { requireManager } from "./_auth.js";
import { logSecurity } from "./_db.js";
import { deleteDocuments } from "./_blob.js";
import { purgeContracts } from "./_db.js";
import { clientIp, errorResponse, HttpError, readJson } from "./_http.js";

// Elimina TUTTI i contratti. Richiede la parola di conferma nel corpo della richiesta.
export async function POST(request: Request) {
  try {
    const actor = await requireManager(request);
    const body = (await readJson(request)) as { confirm?: unknown };
    if (body.confirm !== "ELIMINA") throw new HttpError(400, "Conferma mancante");
    const { deleted, staleFiles } = await purgeContracts();
    await deleteDocuments(staleFiles);
    await logSecurity("contracts_purged", {
      userId: actor.id,
      email: actor.email,
      ip: clientIp(request),
      detail: `${deleted} contratti eliminati`,
    });
    return Response.json({ deleted });
  } catch (err) {
    return errorResponse(err);
  }
}
