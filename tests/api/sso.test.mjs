import assert from "node:assert/strict";
const B = process.env.API_BUILD + "/api/";
process.env.DATABASE_URL = process.env.TEST_DB_URL;
process.env.ADMIN_EMAIL = "admin@test.it";
process.env.ADMIN_PASSWORD = "Admin-pass-123!";
process.env.SESSION_SECRET = "x".repeat(40);
const portal = await import(B + "portal.js"),
  login = await import(B + "login.js"),
  commitApi = await import(B + "commit.js"),
  stateApi = await import(B + "state.js");
const db = await import(B + "_db.js"),
  crypto = await import(B + "_crypto.js"),
  blob = await import(process.env.API_BUILD + "/node_modules/@vercel/blob/index.js");
await db.ensureSchema();
const pool = db.getPool();
let passed = 0;
const ok = n => {
  passed++;
  console.log("  ✓", n);
};
const call = async (mod, cookie, method, qs, body) => {
  const r = new Request("https://app.test/api/x" + qs, {
    method,
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const res = await mod[method](r);
  const sc = res.headers.get("set-cookie");
  let data;
  try {
    data = await res.clone().json();
  } catch {
    data = null;
  }
  return { status: res.status, data, cookie: sc ? sc.split(";")[0] : null, res };
};
const P = (c, m, op, body, extra = "") => call(portal, c, m, `?op=${op}${extra}`, body);
import http from "node:http";
import { generateKeyPairSync, createSign } from "node:crypto";
const mk = async (e, n, r) =>
  pool
    .query("insert into users (email,name,role,title,password_hash) values ($1,$2,$3,'t',$4) returning id", [
      e,
      n,
      r,
      await crypto.hashPassword("Password-123!"),
    ])
    .then(x => x.rows[0].id);
// Provider OIDC finto: configurazione, chiavi e scambio del codice.
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" };
let issuer = "",
  nextClaims = {},
  tokenCalls = [];
const b64 = o => Buffer.from(JSON.stringify(o)).toString("base64url");
const idToken = (claims, key = privateKey) => {
  const h = b64({ alg: "RS256", kid: "k1", typ: "JWT" }),
    p = b64(claims);
  const s = createSign("RSA-SHA256").update(`${h}.${p}`).sign(key).toString("base64url");
  return `${h}.${p}.${s}`;
};
const idp = http.createServer(async (req, res) => {
  const u = new URL(req.url, issuer);
  if (u.pathname === "/.well-known/openid-configuration")
    return res.end(
      JSON.stringify({
        issuer,
        authorization_endpoint: issuer + "/authorize",
        token_endpoint: issuer + "/token",
        jwks_uri: issuer + "/jwks",
      }),
    );
  if (u.pathname === "/jwks") return res.end(JSON.stringify({ keys: [jwk] }));
  if (u.pathname === "/token") {
    let b = "";
    for await (const c of req) b += c;
    const f = new URLSearchParams(b);
    tokenCalls.push(Object.fromEntries(f));
    if (f.get("code") === "bad") {
      res.statusCode = 400;
      return res.end("{}");
    }
    return res.end(
      JSON.stringify({
        id_token: idToken({
          iss: issuer,
          aud: "client-1",
          exp: Math.floor(Date.now() / 1000) + 300,
          nonce: nextClaims.__nonce,
          ...nextClaims.c,
        }),
      }),
    );
  }
  res.statusCode = 404;
  res.end();
});
await new Promise(r => idp.listen(0, "127.0.0.1", r));
issuer = `http://127.0.0.1:${idp.address().port}`;
Object.assign(process.env, {
  OIDC_ISSUER: issuer,
  OIDC_CLIENT_ID: "client-1",
  OIDC_CLIENT_SECRET: "secret-1",
  OIDC_ALLOWED_DOMAINS: "azienda.it",
  OIDC_GROUP_ROLES: JSON.stringify({ "g-buy": "buyer", "g-leg": "legal", "g-mgr": "manager" }),
  APP_URL: "https://app.test",
});

const get = (op, extra = "", cookie) =>
  portal.GET(new Request(`https://app.test/api/portal?op=${op}${extra}`, { headers: cookie ? { cookie } : {} }));
const cookieOf = r => (r.headers.getSetCookie?.() ?? [r.headers.get("set-cookie")]).filter(Boolean).map(c => c.split(";")[0]);
// Percorre l'intero flusso: avvio → provider → ritorno con codice.
const flow = async (claims, { code = "good", tamperState = false, noCookie = false } = {}) => {
  const s = await get("sso-start");
  const loc = new URL(s.headers.get("location")),
    jar = cookieOf(s).find(c => c.startsWith("ct_sso="));
  nextClaims = { __nonce: loc.searchParams.get("nonce"), c: claims };
  const cb = await get(
    "sso-callback",
    `&code=${code}&state=${tamperState ? "x" : loc.searchParams.get("state")}`,
    noCookie ? undefined : jar,
  );
  return {
    start: s,
    loc,
    cb,
    session: cookieOf(cb).find(c => c.startsWith("ct_session=") || (c.includes("=") && !c.startsWith("ct_sso=") && c.split("=")[1])),
  };
};

await mk("buyer@azienda.it", "Marta Buyer", "buyer");
await mk("legal@azienda.it", "Laura Legal", "legal");
await mk("old@azienda.it", "Ex Utente", "buyer");
await pool.query("update users set active = false where email = 'old@azienda.it'");
await mk("mgr@test.it", "Capo Manager", "manager");
const supId = await mk("forn@azienda.it", "Forn", "supplier");

let cfg = await (await get("sso-config")).json();
assert.deepEqual(cfg, { enabled: true, enforce: false });
ok("la configurazione pubblica dice solo se l'SSO è attivo");
let f = await flow({ email: "buyer@azienda.it", name: "Marta" });
assert.equal(f.start.status, 302);
assert.equal(f.loc.origin, issuer);
assert.equal(f.loc.searchParams.get("code_challenge_method"), "S256");
assert.equal(f.loc.searchParams.get("redirect_uri"), "https://app.test/api/portal?op=sso-callback");
assert(/HttpOnly/i.test(f.start.headers.get("set-cookie")) && /SameSite=Lax/i.test(f.start.headers.get("set-cookie")));
ok("l'avvio manda al provider con PKCE, state e nonce in un cookie protetto");
assert.equal(f.cb.status, 302);
assert.equal(f.cb.headers.get("location"), "/");
assert(f.session, "sessione emessa");
assert.equal(tokenCalls.at(-1).client_secret, "secret-1");
assert(tokenCalls.at(-1).code_verifier.length >= 43);
ok("il ritorno con codice valido apre la sessione e il verificatore PKCE arriva al provider");
const me = await portal.GET(new Request("https://app.test/api/portal?op=my-reviews", { headers: { cookie: f.session } }));
assert.notEqual(me.status, 401);
ok("la sessione SSO è una sessione normale");

for (const [claims, opts, why] of [
  [{ email: "buyer@azienda.it" }, { tamperState: true }, "state manomesso"],
  [{ email: "buyer@azienda.it" }, { noCookie: true }, "cookie di stato assente"],
  [{ email: "buyer@azienda.it" }, { code: "bad" }, "codice rifiutato dal provider"],
  [{ email: "buyer@esterno.com" }, {}, "dominio non ammesso"],
  [{ email: "sconosciuto@azienda.it" }, {}, "utente inesistente senza auto-creazione"],
  [{ email: "old@azienda.it" }, {}, "account disattivato"],
  [{ email: "forn@azienda.it" }, {}, "fornitore"],
  [{ email: "buyer@azienda.it", exp: Math.floor(Date.now() / 1000) - 3600 }, {}, "id_token scaduto"],
  [{ email: "buyer@azienda.it", aud: "altro" }, {}, "destinatario errato"],
  [{ email: "buyer@azienda.it", iss: "http://evil" }, {}, "emittente errato"],
]) {
  const r = await flow(claims, opts);
  assert.equal(r.cb.headers.get("location"), "/?sso=denied", why);
  assert(!r.session, why + ": nessuna sessione");
}
ok("10 casi ostili o non ammessi vengono respinti senza sessione");

// Firma falsa: token firmato con un'altra chiave.
{
  const s = await get("sso-start"),
    loc = new URL(s.headers.get("location")),
    jar = cookieOf(s)[0];
  const other = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
  const orig = idToken;
  const forged = idToken(
    {
      iss: issuer,
      aud: "client-1",
      exp: Math.floor(Date.now() / 1000) + 300,
      nonce: loc.searchParams.get("nonce"),
      email: "buyer@azienda.it",
    },
    other,
  );
  const h = http.createServer((q, r) => r.end());
  h.close();
  const real = globalThis.fetch;
  globalThis.fetch = async (u, o) => (String(u).endsWith("/token") ? new Response(JSON.stringify({ id_token: forged })) : real(u, o));
  const cb = await get("sso-callback", `&code=c&state=${loc.searchParams.get("state")}`, jar);
  globalThis.fetch = real;
  assert.equal(cb.headers.get("location"), "/?sso=denied");
  assert(!cookieOf(cb).some(c => c.startsWith("ct_session")));
  ok("un token firmato con un'altra chiave è respinto");
}

// Gruppi → ruolo.
f = await flow({ email: "legal@azienda.it", groups: ["g-leg"] });
assert.equal(f.cb.headers.get("location"), "/");
await pool.query("update users set role='legal' where email='legal@azienda.it'");
f = await flow({ email: "legal@azienda.it", groups: ["g-buy"] });
assert.equal((await pool.query("select role from users where email='legal@azienda.it'")).rows[0].role, "buyer");
ok("il ruolo segue i gruppi del provider e la modifica è registrata");
const ev = (await pool.query("select event from security_events")).rows.map(r => r.event);
assert(ev.includes("sso_denied") && ev.includes("sso_role_changed") && ev.includes("login_ok"));
ok("esiti dell'SSO nel registro eventi di sicurezza");

// Auto-creazione utenti.
process.env.SSO_AUTO_PROVISION = "1";
f = await flow({ email: "nuovo@azienda.it", name: "Nuovo Utente", groups: ["g-buy"] });
assert.equal(f.cb.headers.get("location"), "/");
assert.equal((await pool.query("select role from users where email='nuovo@azienda.it'")).rows[0].role, "buyer");
f = await flow({ email: "senza@azienda.it", groups: ["g-sconosciuto"] });
assert.equal(f.cb.headers.get("location"), "/?sso=denied");
ok("auto-creazione solo se i gruppi assegnano un ruolo");
const pw = await call(login, null, "POST", "", { email: "nuovo@azienda.it", password: "sso-only" });
assert.equal(pw.status, 401);
ok("l'utente creato dall'SSO non ha una password utilizzabile");

// Obbligatorietà.
process.env.SSO_ENFORCE = "1";
process.env.SSO_BREAKGLASS_EMAIL = "mgr@test.it";
assert.equal((await call(login, null, "POST", "", { email: "buyer@azienda.it", password: "Password-123!" })).status, 403);
ok("con SSO obbligatorio il personale interno non entra più con la password");
assert.equal((await call(login, null, "POST", "", { email: "mgr@test.it", password: "Password-123!" })).status, 200);
ok("l'account di emergenza entra ancora con la password");
assert.equal((await call(login, null, "POST", "", { email: "forn@azienda.it", password: "Password-123!" })).status, 200);
ok("i fornitori continuano con email e password");
delete process.env.OIDC_CLIENT_SECRET;
assert.equal((await get("sso-start")).status, 404);
assert.equal((await call(login, null, "POST", "", { email: "buyer@azienda.it", password: "Password-123!" })).status, 200);
ok("senza configurazione l'SSO è spento e la password torna valida");
console.log("Totale:", passed, "controlli");
idp.close();
await pool.end();
process.exit(0);
