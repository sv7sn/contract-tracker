import { cleanPayload, commit, ensureSchema, errorResponse, HttpError } from "./_db.ts";
import type { CommitResult } from "../src/types.ts";

export async function POST(request: Request) {
  try {
    let body: unknown;
    try { body = await request.json(); } catch { throw new HttpError(400, "JSON non valido"); }
    await ensureSchema();
    const contractId = await commit(cleanPayload(body));
    return Response.json({ contractId } satisfies CommitResult);
  } catch (err) {
    return errorResponse(err);
  }
}
