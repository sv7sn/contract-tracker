import { ensureSchema, errorResponse, loadState } from "./_db.js";

export async function GET() {
  try {
    await ensureSchema();
    return Response.json(await loadState(), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
