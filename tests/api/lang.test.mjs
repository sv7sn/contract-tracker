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
const mk = async (e, n, r) =>
  pool
    .query("insert into users (email,name,role,title,password_hash) values ($1,$2,$3,'t',$4) returning id", [
      e,
      n,
      r,
      await crypto.hashPassword("Password-123!"),
    ])
    .then(x => x.rows[0].id);
const signin = async (e, p) => (await call(login, null, "POST", "", { email: e, password: p })).cookie;
const me = await import(B + "me.js"),
  notify = await import(B + "_notify.js"),
  http = await import(B + "_http.js");
// Lingua del profilo: si salva, torna con l'utente, vale per le email.
await mk("buyer@test.it", "Marta Buyer", "buyer");
const buyer = await signin("buyer@test.it", "Password-123!");
let r = await call(me, buyer, "GET", "");
assert.equal(r.data.user.lang, "it");
ok("lingua predefinita: italiano");
assert.equal((await P(buyer, "POST", "my-lang", { lang: "fr" })).status, 400);
ok("lingua non supportata rifiutata");
assert.equal((await P(null, "POST", "my-lang", { lang: "en" })).status, 401);
ok("senza accesso non si cambia la lingua");
assert.equal((await P(buyer, "POST", "my-lang", { lang: "en" })).status, 200);
r = await call(me, buyer, "GET", "");
assert.equal(r.data.user.lang, "en");
r = await call(login, null, "POST", "", { email: "buyer@test.it", password: "Password-123!" });
assert.equal(r.data.user.lang, "en");
ok("la lingua scelta torna con l'utente (sessione e accesso)");
await notify.sendMail(pool, {
  to: "BUYER@test.it",
  template: "bo_message",
  vars: { name: "Luca", link: "https://x", reason: "Contratto" },
});
await notify.sendMail(pool, {
  to: "altro@esterno.it",
  template: "bo_message",
  vars: { name: "Luca", link: "https://x", reason: "Contratto" },
});
const mails = (await pool.query("select to_email, subject from notifications order by id")).rows;
const it =
  (await notify.sendMail(pool, { to: "x@y.it", template: "bo_message", vars: { name: "Luca", link: "https://x", reason: "Contratto" } })) &&
  (await pool.query("select subject from notifications order by id desc limit 1")).rows[0].subject;
assert.notEqual(mails[0].subject, mails[1].subject);
assert.equal(mails[1].subject, it);
ok("email in inglese a chi ha scelto l'inglese, in italiano agli altri");
// Messaggi d'errore con valori: testo italiano invariato, modello e valori a parte per la traduzione.
const res = http.errorResponse(http.HttpError.t(400, "Il file supera {mb} MB", { mb: 25 }));
const body = await res.json();
assert.equal(body.error, "Il file supera 25 MB");
assert.equal(body.errorKey, "Il file supera {mb} MB");
assert.deepEqual(body.errorVars, { mb: 25 });
ok("errore con valori: testo, modello e valori");
// I miei dati: funzione e telefono, con controlli; nome e ruolo non si toccano da qui.
assert.equal(
  (await P(buyer, "POST", "my-profile", { title: "Buyer ICT", phone: "+39 02 1234567", name: "Altro", role: "manager" })).status,
  200,
);
r = await call(me, buyer, "GET", "");
assert.equal(r.data.user.title, "Buyer ICT");
assert.equal(r.data.user.phone, "+39 02 1234567");
assert.equal(r.data.user.name, "Marta Buyer");
assert.equal(r.data.user.role, "buyer");
assert.equal((await P(buyer, "POST", "my-profile", { title: "x", phone: "chiamami<script>" })).status, 400);
assert.equal((await P(buyer, "POST", "my-profile", { title: "x".repeat(81), phone: "" })).status, 400);
assert.equal((await P(null, "POST", "my-profile", { title: "x" })).status, 401);
ok("i miei dati: funzione e telefono salvati, nome e ruolo invariati, valori non validi rifiutati");
console.log("Totale:", passed, "controlli");
await pool.end();
process.exit(0);
