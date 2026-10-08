import { ensureSchema, errorResponse, HttpError, seedIfEmpty } from "./_db.js";
import type { AppState } from "../src/types.ts";

// Carica i dati demo solo se il database è vuoto: non sovrascrive mai dati esistenti.
export async function POST(request: Request) {
  try {
    let body: AppState;
    try { body = (await request.json()) as AppState; } catch { throw new HttpError(400, "JSON non valido"); }
    if (!Array.isArray(body?.contracts) || body.contracts.length > 100) throw new HttpError(400, "Dati demo non validi");
    await ensureSchema();
    return Response.json({ seeded: await seedIfEmpty(body) });
  } catch (err) {
    return errorResponse(err);
  }
}
