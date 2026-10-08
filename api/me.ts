import { requireUser } from "./_auth.js";
import { errorResponse } from "./_http.js";

export async function GET(request: Request) {
  try {
    return Response.json({ user: await requireUser(request) }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
