import { requireUser } from "./_auth.js";
import { cleanPayload, commit } from "./_db.js";
import { errorResponse, readJson } from "./_http.js";
import type { CommitResult } from "../src/types.ts";

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const contractId = await commit(user, cleanPayload(await readJson(request)));
    return Response.json({ contractId } satisfies CommitResult);
  } catch (err) {
    return errorResponse(err);
  }
}
