export class HttpError extends Error {
  status: number;
  data?: Record<string, unknown>;
  constructor(status: number, message: string, data?: Record<string, unknown>) { super(message); this.status = status; this.data = data; }
}

export function errorResponse(err: unknown) {
  if (err instanceof HttpError) return Response.json({ error: err.message, ...err.data }, { status: err.status });
  console.error(err);
  return Response.json({ error: "Errore del server" }, { status: 500 });
}

/** Legge il corpo JSON. Richiedere `application/json` impedisce anche i POST cross-site da form HTML. */
export async function readJson(request: Request): Promise<unknown> {
  if (!(request.headers.get("content-type") ?? "").includes("application/json")) throw new HttpError(415, "Content-Type deve essere application/json");
  try { return await request.json(); } catch { throw new HttpError(400, "JSON non valido"); }
}
