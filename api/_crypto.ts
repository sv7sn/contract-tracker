import { createHash, createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { HttpError } from "./_http.js";

const scrypt = promisify(scryptCb) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

export const MIN_PASSWORD = 8;
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

export function createSessionToken(userId: number, now = Date.now()): string {
  const body = `${userId}.${now + SESSION_DAYS * 864e5}`;
  return `${body}.${sign(body)}`;
}

/** Restituisce l'id utente se il token è autentico e non scaduto. */
export function verifySessionToken(token: string, now = Date.now()): number | null {
  const [id, exp, sig] = token.split(".");
  if (!id || !exp || !sig) return null;
  const expected = Buffer.from(sign(`${id}.${exp}`));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  const userId = Number(id);
  return Number.isInteger(userId) && Number(exp) > now ? userId : null;
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
