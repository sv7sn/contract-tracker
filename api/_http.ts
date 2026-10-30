export class HttpError extends Error {
  status: number;
  data?: Record<string, unknown>;
  constructor(status: number, message: string, data?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.data = data;
  }
  /** Messaggio con valori variabili: il testo resta in italiano, ma modello e valori viaggiano a parte così l'interfaccia lo traduce. */
  static t(status: number, template: string, vars: Record<string, string | number>, data?: Record<string, unknown>) {
    return new HttpError(
      status,
      template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)),
      { ...data, errorKey: template, errorVars: vars },
    );
  }
}

/** Errori del database dovuti a dati non validi (testo al posto di un numero, valore troppo lungo, campo obbligatorio vuoto…): per chi chiama sono richieste sbagliate, non guasti del server. */
const DB_INPUT_ERRORS: Record<string, [number, string]> = {
  "22P02": [400, "Dati non validi"],
  "22003": [400, "Valore fuori intervallo"],
  "22007": [400, "Data non valida"],
  "22008": [400, "Data non valida"],
  "22001": [400, "Testo troppo lungo"],
  "22021": [400, "Il testo contiene caratteri non ammessi"],
  "22P05": [400, "Il testo contiene caratteri non ammessi"],
  "23502": [400, "Manca un dato obbligatorio"],
  "23503": [409, "Il dato collegato non esiste o è ancora in uso"],
  "23505": [409, "Esiste già un elemento uguale"],
  "23514": [400, "Valore non ammesso"],
};
export function errorResponse(err: unknown) {
  if (err instanceof HttpError) return Response.json({ error: err.message, ...err.data }, { status: err.status });
  const mapped = DB_INPUT_ERRORS[(err as { code?: string })?.code ?? ""];
  if (mapped) {
    console.error(err);
    return Response.json({ error: mapped[1] }, { status: mapped[0] });
  }
  console.error(err);
  return Response.json({ error: "Errore del server" }, { status: 500 });
}

/** Legge il corpo JSON. Richiedere `application/json` impedisce anche i POST cross-site da form HTML. */
export function clientIp(request: Request): string | null {
  const f = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return f || request.headers.get("x-real-ip") || null;
}

/** Rifiuta le richieste che arrivano da un altro sito (Origin diverso o Sec-Fetch-Site cross-site). Senza questi header (chiamate da server, cron, test) passa. */
export function assertSameOrigin(request: Request): void {
  if (request.headers.get("sec-fetch-site") === "cross-site") throw new HttpError(403, "Richiesta da un altro sito non consentita");
  const origin = request.headers.get("origin");
  if (!origin) return;
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    throw new HttpError(403, "Origine non valida");
  }
  const own = new Set(
    [request.headers.get("host"), new URL(request.url).host, process.env.APP_URL ? new URL(process.env.APP_URL).host : null].filter(
      Boolean,
    ),
  );
  if (!own.has(host)) throw new HttpError(403, "Richiesta da un altro sito non consentita");
}

export async function readJson(request: Request): Promise<unknown> {
  assertSameOrigin(request);
  if (!(request.headers.get("content-type") ?? "").includes("application/json"))
    throw new HttpError(415, "Content-Type deve essere application/json");
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, "JSON non valido");
  }
}
