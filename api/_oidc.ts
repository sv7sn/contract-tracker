// Accesso con l'account aziendale (OpenID Connect, flusso "authorization code" con PKCE). Funziona con qualunque provider OIDC
// (Microsoft Entra ID, Okta, Keycloak, Google): si configura solo con variabili d'ambiente. Nessuna libreria esterna.
//
// OIDC_ISSUER           es. https://login.microsoftonline.com/<tenant>/v2.0   (da qui si legge la configurazione del provider)
// OIDC_CLIENT_ID / OIDC_CLIENT_SECRET   dalla registrazione dell'app presso il provider
// OIDC_ALLOWED_DOMAINS  facoltativo, es. azienda.it,azienda.com: domini email ammessi
// OIDC_GROUP_ROLES      facoltativo, JSON {"<id gruppo>":"buyer", ...}: il ruolo si ricava dai gruppi del provider
// SSO_AUTO_PROVISION=1  crea l'utente al primo accesso (solo se i gruppi gli assegnano un ruolo)
// SSO_ENFORCE=1         il personale interno entra solo con SSO (i fornitori continuano con email e password)
// SSO_BREAKGLASS_EMAIL  unico account interno che può ancora entrare con la password, per le emergenze
import { createHash, createPublicKey, randomBytes, verify as cryptoVerify } from "node:crypto";
import type { Role, User } from "../src/types.ts";
import { getPool, logSecurity, findUserByEmail, ensureSchema } from "./_db.js";
import { createSessionToken, openValue, sealValue, sessionCookie } from "./_crypto.js";
import { clientIp, HttpError } from "./_http.js";

type Json = Record<string, unknown>;
const env = (k: string) => process.env[k]?.trim() ?? "";
export const ssoEnabled = () => !!(env("OIDC_ISSUER") && env("OIDC_CLIENT_ID") && env("OIDC_CLIENT_SECRET"));
export const ssoEnforced = () => ssoEnabled() && env("SSO_ENFORCE") === "1";
export const isBreakGlass = (email: string) =>
  !!env("SSO_BREAKGLASS_EMAIL") && email.trim().toLowerCase() === env("SSO_BREAKGLASS_EMAIL").toLowerCase();
export const ssoPublicConfig = () => ({ enabled: ssoEnabled(), enforce: ssoEnforced() });

const ROLE_PRIORITY: Role[] = ["manager", "buyer", "finance", "legal", "compliance", "itsec", "bo", "viewer"];
const b64u = (b: Buffer) => b.toString("base64url");
const redirectUri = (request: Request) =>
  env("OIDC_REDIRECT_URI") ||
  `${process.env.APP_URL?.trim().replace(/\/+$/, "") || new URL(request.url).origin}/api/portal?op=sso-callback`;

// Configurazione e chiavi del provider, in memoria per qualche minuto.
let meta: { at: number; doc: Json } | undefined, jwks: { at: number; keys: Json[] } | undefined;
async function getJson(url: string): Promise<Json> {
  const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new HttpError(502, "Il provider di accesso non risponde");
  return (await r.json()) as Json;
}
async function discovery(): Promise<Json> {
  if (meta && Date.now() - meta.at < 10 * 60_000) return meta.doc;
  const issuer = env("OIDC_ISSUER").replace(/\/+$/, "");
  const doc = await getJson(`${issuer}/.well-known/openid-configuration`);
  if (String(doc.issuer ?? "").replace(/\/+$/, "") !== issuer)
    throw new HttpError(502, "Configurazione del provider non coerente con OIDC_ISSUER");
  meta = { at: Date.now(), doc };
  return doc;
}
async function keyFor(kid: string, refresh = false): Promise<Json | undefined> {
  if (!jwks || refresh || Date.now() - jwks.at > 10 * 60_000)
    jwks = { at: Date.now(), keys: ((await getJson(String((await discovery()).jwks_uri))).keys as Json[]) ?? [] };
  return jwks.keys.find(k => k.kid === kid);
}

/** Verifica firma e dichiarazioni di un id_token (solo RS256). */
export async function verifyIdToken(idToken: string, expect: { nonce: string }): Promise<Json> {
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new HttpError(401, "Risposta del provider non valida");
  const header = JSON.parse(Buffer.from(parts[0], "base64url").toString()) as Json,
    claims = JSON.parse(Buffer.from(parts[1], "base64url").toString()) as Json;
  if (header.alg !== "RS256") throw new HttpError(401, "Algoritmo di firma non ammesso");
  let jwk = await keyFor(String(header.kid));
  if (!jwk) jwk = await keyFor(String(header.kid), true);
  if (!jwk) throw new HttpError(401, "Chiave di firma sconosciuta");
  const ok = cryptoVerify(
    "RSA-SHA256",
    Buffer.from(`${parts[0]}.${parts[1]}`),
    createPublicKey({ key: jwk as never, format: "jwk" }),
    Buffer.from(parts[2], "base64url"),
  );
  if (!ok) throw new HttpError(401, "Firma non valida");
  const now = Math.floor(Date.now() / 1000),
    aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (String(claims.iss ?? "").replace(/\/+$/, "") !== env("OIDC_ISSUER").replace(/\/+$/, ""))
    throw new HttpError(401, "Emittente non valido");
  if (!aud.includes(env("OIDC_CLIENT_ID"))) throw new HttpError(401, "Destinatario non valido");
  if (typeof claims.exp !== "number" || claims.exp < now - 60) throw new HttpError(401, "Accesso scaduto");
  if (typeof claims.nbf === "number" && claims.nbf > now + 60) throw new HttpError(401, "Accesso non ancora valido");
  if (claims.nonce !== expect.nonce) throw new HttpError(401, "Accesso non riconosciuto (nonce)");
  return claims;
}

const COOKIE = "ct_sso";
const stateCookie = (request: Request, value: string | null) =>
  `${COOKIE}=${value ?? ""}; Path=/api/portal; HttpOnly; SameSite=Lax; Max-Age=${value ? 600 : 0}${new URL(request.url).protocol === "https:" || request.headers.get("x-forwarded-proto") === "https" ? "; Secure" : ""}`;
const back = (to: string, cookies: string[]) => {
  const h = new Headers({ Location: to, "Cache-Control": "no-store" });
  for (const c of cookies) h.append("Set-Cookie", c);
  return new Response(null, { status: 302, headers: h });
};

/** Primo passo: manda l'utente al provider. Lo stato (state, nonce, verificatore PKCE) sta in un cookie firmato di 10 minuti. */
export async function ssoStart(request: Request): Promise<Response> {
  if (!ssoEnabled()) throw new HttpError(404, "Accesso aziendale non configurato");
  const doc = await discovery();
  const state = b64u(randomBytes(24)),
    nonce = b64u(randomBytes(24)),
    verifier = b64u(randomBytes(48));
  const url = new URL(String(doc.authorization_endpoint));
  for (const [k, v] of Object.entries({
    response_type: "code",
    client_id: env("OIDC_CLIENT_ID"),
    redirect_uri: redirectUri(request),
    scope: env("OIDC_SCOPES") || "openid profile email",
    state,
    nonce,
    code_challenge: b64u(createHash("sha256").update(verifier).digest()),
    code_challenge_method: "S256",
  }))
    url.searchParams.set(k, v);
  return back(url.toString(), [stateCookie(request, sealValue({ state, nonce, verifier }, 600))]);
}

function roleFromGroups(groups: unknown): Role | null {
  let map: Record<string, string> = {};
  try {
    map = JSON.parse(env("OIDC_GROUP_ROLES") || "{}");
  } catch {
    return null;
  }
  const mine = new Set((Array.isArray(groups) ? groups : []).map(String));
  const roles = Object.entries(map)
    .filter(([g]) => mine.has(g))
    .map(([, r]) => r as Role);
  return ROLE_PRIORITY.find(r => roles.includes(r)) ?? null;
}

/** Secondo passo: il provider ci rimanda qui con un codice, che scambiamo per l'identità dell'utente. */
export async function ssoCallback(request: Request): Promise<Response> {
  if (!ssoEnabled()) throw new HttpError(404, "Accesso aziendale non configurato");
  await ensureSchema();
  const ip = clientIp(request),
    url = new URL(request.url);
  const deny = async (reason: string, email = "") => {
    await logSecurity("sso_denied", { email, ip, detail: reason });
    return back("/?sso=denied", [stateCookie(request, null)]);
  };
  const cookie = /(?:^|;\s*)ct_sso=([^;]+)/.exec(request.headers.get("cookie") ?? "")?.[1];
  const st = openValue<{ state: string; nonce: string; verifier: string }>(cookie);
  if (url.searchParams.get("error")) return deny(`errore del provider: ${url.searchParams.get("error")}`);
  if (!st || !url.searchParams.get("code") || url.searchParams.get("state") !== st.state) return deny("stato non valido o scaduto");
  let claims: Json;
  try {
    const doc = await discovery();
    const tr = await fetch(String(doc.token_endpoint), {
      method: "POST",
      signal: AbortSignal.timeout(8000),
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: url.searchParams.get("code")!,
        redirect_uri: redirectUri(request),
        client_id: env("OIDC_CLIENT_ID"),
        client_secret: env("OIDC_CLIENT_SECRET"),
        code_verifier: st.verifier,
      }),
    });
    if (!tr.ok) return deny(`scambio del codice rifiutato (${tr.status})`);
    const tok = (await tr.json()) as Json;
    if (typeof tok.id_token !== "string") return deny("manca l'id_token");
    claims = await verifyIdToken(tok.id_token, { nonce: st.nonce });
  } catch (err) {
    return deny(err instanceof HttpError ? err.message : "errore nella verifica");
  }
  const email = String(claims.email ?? claims.preferred_username ?? claims.upn ?? "")
    .trim()
    .toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return deny("il provider non ha indicato un indirizzo email");
  const domains = env("OIDC_ALLOWED_DOMAINS")
    .toLowerCase()
    .split(/[\s,;]+/)
    .filter(Boolean);
  if (domains.length && !domains.includes(email.split("@")[1])) return deny("dominio non ammesso", email);
  let row = await findUserByEmail(email);
  const mapped = roleFromGroups(claims.groups);
  if (!row) {
    if (env("SSO_AUTO_PROVISION") !== "1" || !mapped) return deny("utente non presente in Procurement Lab", email);
    await getPool().query(
      "insert into users (email, name, role, title, password_hash) values ($1,$2,$3,'Accesso aziendale','sso-only') on conflict do nothing",
      [email, String(claims.name ?? email).slice(0, 100), mapped],
    );
    await logSecurity("sso_user_created", { email, ip, detail: `ruolo ${mapped} dai gruppi` });
    row = await findUserByEmail(email);
  } else if (mapped && mapped !== row.role && row.role !== "supplier") {
    await getPool().query("update users set role = $1, session_version = session_version + 1 where id = $2", [mapped, row.id]);
    await logSecurity("sso_role_changed", { userId: row.id, email, ip, detail: `${row.role} → ${mapped} dai gruppi` });
    row = await findUserByEmail(email);
  }
  if (!row || !row.active) return deny("account disattivato", email);
  if (row.role === "supplier") return deny("i fornitori entrano con email e password", email);
  await logSecurity("login_ok", { userId: row.id, email, ip, detail: "SSO" });
  return back("/", [sessionCookie(request, createSessionToken(row.id, row.sessionVersion)), stateCookie(request, null)]);
}
export type SsoUser = User;
