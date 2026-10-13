import { createHash, createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { HttpError } from "./_http.js";

const scrypt = promisify(scryptCb) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

export const MIN_PASSWORD = 12;
const COMMON = ["password", "passw0rd", "qwerty", "123456", "12345678", "111111", "abc123", "letmein", "welcome", "admin", "iloveyou", "monkey", "dragon", "azerty", "procurement", "prometeon"];
/** Regole per le nuove password: lunghezza minima, niente password banali né l'email o il nome utente. Restituisce il problema, o null se va bene. */
export function passwordProblem(password: string, email = ""): string | null {
  if (password.length < MIN_PASSWORD) return `La password deve avere almeno ${MIN_PASSWORD} caratteri`;
  if (password.length > 200) return "La password è troppo lunga";
  const low = password.toLowerCase(), local = email.split("@")[0]?.toLowerCase() ?? "";
  if (local.length >= 4 && low.includes(local)) return "La password non deve contenere il tuo indirizzo email";
  if ([/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter(re => re.test(password)).length < 3) return "Usa almeno tre tipi di caratteri tra maiuscole, minuscole, numeri e simboli";
  if (new Set(low).size < 5) return "La password è troppo semplice: usa caratteri diversi";
  if (COMMON.some(w => low.replace(/[^a-z0-9]/g, "").startsWith(w)) || /^(.{1,4})\1+$/.test(low)) return "La password è troppo comune: scegline un'altra";
  return null;
}
export const SESSION_DAYS = 7;
export const COOKIE_NAME = "ct_session";

// ─── Password (scrypt con salt casuale) ──────────────────────
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string | undefined): Promise<boolean> {
  // Anche per utenti inesistenti si esegue un confronto, per non rivelare quali email esistono dai tempi di risposta.
  const [scheme, salt, key] = (stored ?? DUMMY_HASH).split("$");
  if (scheme !== "scrypt" || !salt || !key) return false;
  const expected = Buffer.from(key, "base64");
  const actual = await scrypt(password, Buffer.from(salt, "base64"), expected.length);
  return timingSafeEqual(actual, expected) && stored !== undefined;
}
const DUMMY_HASH = `scrypt$${Buffer.alloc(16).toString("base64")}$${Buffer.alloc(64).toString("base64")}`;

// ─── Sessione: token firmato HMAC in cookie HttpOnly ─────────
function secret(): Buffer {
  const explicit = process.env.SESSION_SECRET;
  if (explicit) return Buffer.from(explicit);
  // Senza SESSION_SECRET la chiave deriva dalla stringa di connessione al database (anch'essa segreta e stabile).
  const db = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  if (!db) throw new HttpError(503, "Database non configurato (manca DATABASE_URL)");
  return createHash("sha256").update(`contract-tracker:session:${db}`).digest();
}
const sign = (body: string) => createHmac("sha256", secret()).update(body).digest("base64url");

/** Il token porta la "versione di sessione" dell'utente: cambiarla (nuova password, cambio di ruolo, "esci da tutti i dispositivi") invalida tutte le sessioni già aperte. */
export function createSessionToken(userId: number, version = 0, now = Date.now()): string {
  const body = `${userId}.${now + SESSION_DAYS * 864e5}.${version}`;
  return `${body}.${sign(body)}`;
}

/** Restituisce utente e versione di sessione se il token è autentico e non scaduto. I token del vecchio formato (senza versione) valgono come versione 0. */
export function verifySessionToken(token: string, now = Date.now()): { id: number; version: number } | null {
  const parts = token.split(".");
  if (parts.length !== 3 && parts.length !== 4) return null;
  const sig = parts[parts.length - 1], body = parts.slice(0, -1).join(".");
  const [id, exp, ver] = parts;
  if (!id || !exp || !sig) return null;
  const expected = Buffer.from(sign(body));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  const userId = Number(id), version = parts.length === 4 ? Number(ver) : 0;
  return Number.isInteger(userId) && Number.isInteger(version) && Number(exp) > now ? { id: userId, version } : null;
}

export function readSessionCookie(request: Request): string | null {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === COOKIE_NAME) return rest.join("=") || null;
  }
  return null;
}

const isHttps = (request: Request) => request.url.startsWith("https:") || request.headers.get("x-forwarded-proto") === "https";

export function sessionCookie(request: Request, token: string | null): string {
  const attrs = ["Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${token ? SESSION_DAYS * 86400 : 0}`];
  if (isHttps(request)) attrs.push("Secure");
  return `${COOKIE_NAME}=${token ?? ""}; ${attrs.join("; ")}`;
}
