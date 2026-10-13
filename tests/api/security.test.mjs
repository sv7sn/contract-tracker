import assert from "node:assert/strict";
const B = process.env.API_BUILD + "/api/";
process.env.DATABASE_URL = process.env.TEST_DB_URL;
process.env.ADMIN_EMAIL = "admin@test.it"; process.env.ADMIN_PASSWORD = "Admin-pass-123!"; process.env.SESSION_SECRET = "x".repeat(40);
const portal = await import(B + "portal.js"), login = await import(B + "login.js"), commitApi = await import(B + "commit.js"), stateApi = await import(B + "state.js");
const db = await import(B + "_db.js"), crypto = await import(B + "_crypto.js"), blob = await import(process.env.API_BUILD + "/node_modules/@vercel/blob/index.js");
await db.ensureSchema(); const pool = db.getPool();
let passed = 0; const ok = n => { passed++; console.log("  ✓", n); };
const call = async (mod, cookie, method, qs, body) => {
  const r = new Request("https://app.test/api/x" + qs, { method, headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const res = await mod[method](r); const sc = res.headers.get("set-cookie"); let data; try { data = await res.clone().json(); } catch { data = null; }
  return { status: res.status, data, cookie: sc ? sc.split(";")[0] : null, res };
};
const P = (c, m, op, body, extra = "") => call(portal, c, m, `?op=${op}${extra}`, body);
const signin = async (e, p) => (await call(login, null, "POST", "", { email: e, password: p })).cookie;
const mk = async (e, n, r) => pool.query("insert into users (email,name,role,title,password_hash) values ($1,$2,$3,'t',$4) returning id", [e, n, r, await crypto.hashPassword("Password-123!")]).then(x => x.rows[0].id);
const b1 = await mk("buyer@test.it", "Marta Buyer", "buyer"); await mk("buyer2@test.it", "Luca Buyer", "buyer");
const admin = await signin("admin@test.it", "Admin-pass-123!"), buyer = await signin("buyer@test.it", "Password-123!"), buyer2 = await signin("buyer2@test.it", "Password-123!");
const day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const file = n => { const p = `contracts/${globalThis.crypto.randomUUID()}/${n}`; blob.store.set(p, Buffer.from("%PDF")); return p; };
const newContract = async (supplier, end, extra = {}) => (await call(commitApi, admin, "POST", "", { contract: { supplier, object: "Servizio " + supplier, category: "IT", country: "Italia", value: 50000, currency: "EUR", start: day(-700), end, owner: "Marta Buyer", boEmail: "", renewal: "Non definito", type: "Servizi", notes: "", ceased: false, fileName: "c.pdf", filePath: file("c.pdf"), noticeDays: null, noticeDate: "", ...extra } })).data.contractId;
const req = (method, qs, body, headers = {}) => new Request("https://app.test/api/x" + qs, { method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
const passwordMod = await import(B + "password.js");
const cookieOf = res => (res.headers.get("set-cookie") ?? "").split(";")[0] || null;
const userId = async e => (await pool.query("select id from users where email = $1", [e])).rows[0].id;

// ─── Regole sulle password
const U = async (c, method, body) => { const r = await usersMod[method](req(method, "", body, { cookie: c })); return { status: r.status, data: await r.clone().json().catch(() => null) }; };
const usersMod = await import(B + "users.js");
const mkU = pw => U(admin, "POST", { email: "nuovo1@test.it", name: "Nuovo", role: "buyer", title: "b", password: pw });
for (const [pw, why] of [["Breve-1!", "troppo corta"], ["Password-1234!", "comune"], ["nuovo1-Pass-9876!", "contiene l'email"], ["abcdefghijklmnop", "un solo tipo di caratteri"], ["aaaaaaaaaaaaA1!", "troppo semplice"]]) assert.equal((await mkU(pw)).status, 400, why);
ok("password deboli rifiutate: corta, comune, con l'email, di un solo tipo, ripetitiva");
assert.equal((await mkU("Nuova-pass-9876!")).status, 200); ok("password robusta accettata");

// ─── Sessioni revocabili
const tokenOld = await signin("nuovo1@test.it", "Nuova-pass-9876!");
assert.equal((await P(tokenOld, "GET", "my-work")).status, 200);
let res = await passwordMod.POST(req("POST", "", { current: "Nuova-pass-9876!", next: "Altra-pass-54321!" }, { cookie: tokenOld })); assert.equal(res.status, 200); const tokenNew = cookieOf(res);
assert.equal((await P(tokenOld, "GET", "my-work")).status, 401); assert((await P(tokenNew, "GET", "my-work")).status !== 401); ok("cambio password: le altre sessioni si chiudono, quella in uso continua");
res = await passwordMod.POST(req("POST", "", { current: "Altra-pass-54321!", next: "debole" }, { cookie: tokenNew })); assert.equal(res.status, 400); ok("anche il cambio password applica le regole");
const t1 = await signin("nuovo1@test.it", "Altra-pass-54321!"), t2 = await signin("nuovo1@test.it", "Altra-pass-54321!");
res = await call(portal, t1, "POST", "?op=sessions-revoke", {}); assert.equal(res.status, 200); const t1new = res.cookie;
assert.equal((await P(t2, "GET", "my-work")).status, 401); assert((await P(t1new, "GET", "my-work")).status !== 401); assert.equal((await P(t1, "GET", "my-work")).status, 401); ok("'esci da tutti i dispositivi' chiude le altre sessioni");
const t3 = await signin("nuovo1@test.it", "Altra-pass-54321!");
assert.equal((await U(admin, "POST", { id: await userId("nuovo1@test.it"), role: "finance" })).status, 200);
assert.equal((await P(t3, "GET", "my-work")).status, 401); ok("cambio di ruolo da parte del Manager: le sessioni dell'utente si chiudono");
const t4 = await signin("nuovo1@test.it", "Altra-pass-54321!");
assert.equal((await U(admin, "POST", { id: await userId("nuovo1@test.it"), password: "Ripristino-pass-777!" })).status, 200); assert.equal((await P(t4, "GET", "vendors")).status, 401); ok("reimpostazione della password da parte del Manager: sessioni chiuse");
const cryptoMod = await import(B + "_crypto.js"); const bid = await userId("buyer@test.it");
const forged = cryptoMod.createSessionToken(bid, 5).replace(/\.[^.]+$/, ".firmafalsa");
assert.equal((await P("ct_session=" + forged, "GET", "my-work")).status, 401); assert.equal((await P("ct_session=" + cryptoMod.createSessionToken(bid, 7), "GET", "my-work")).status, 401); ok("firma falsa o versione di sessione sbagliata: rifiutate");

// ─── Limitazione per indirizzo
const loginMod = await import(B + "login.js");
const attempt = (email, ip) => loginMod.POST(req("POST", "", { email, password: "sbagliata-123!" }, { "x-forwarded-for": ip }));
for (let n = 0; n < 30; n++) assert.equal((await attempt(`inesistente${n}@test.it`, "9.9.9.9")).status, 401);
assert.equal((await attempt("altro@test.it", "9.9.9.9")).status, 429); ok("30 tentativi falliti dallo stesso indirizzo, anche con email diverse: bloccato");
assert.equal((await loginMod.POST(req("POST", "", { email: "buyer@test.it", password: "Password-123!" }, { "x-forwarded-for": "8.8.8.8" }))).status, 200); ok("un altro indirizzo non è toccato");

// ─── Richieste da altri siti
const asBuyer = { cookie: buyer };
assert.equal((await portal.POST(req("POST", "?op=task-create", { title: "x" }, { ...asBuyer, origin: "https://evil.example" }))).status, 403); ok("Origin di un altro sito: rifiutato");
assert.equal((await portal.POST(req("POST", "?op=task-create", { title: "Dallo stesso sito" }, { ...asBuyer, origin: "https://app.test" }))).status, 201); ok("stesso Origin: accettato");
assert.equal((await portal.POST(req("POST", "?op=task-create", { title: "x" }, { ...asBuyer, "sec-fetch-site": "cross-site" }))).status, 403); ok("Sec-Fetch-Site cross-site: rifiutato");

// ─── Registro di sicurezza, controllo configurazione, salute
res = await P(admin, "GET", "security-events"); assert.equal(res.status, 200); const evs = res.data.events.map(x => x.event);
for (const ev of ["login_ok", "login_failed", "login_blocked", "password_changed", "sessions_revoked", "password_reset_by_admin"]) assert(evs.includes(ev), ev);
assert(res.data.events.find(x => x.event === "login_failed").ip); ok("accessi, rifiuti, blocchi, cambi di password e sessioni chiuse sono registrati");
assert.equal((await P(buyer, "GET", "security-events")).status, 403); assert.equal((await P(buyer, "GET", "readiness")).status, 403); ok("li vede solo il Manager");
res = await P(admin, "GET", "security-events-export"); assert.match(await res.res.text(), /^Data;Evento;Utente;Email;Indirizzo;Dettaglio/); ok("esportabile in CSV");
process.env.SESSION_SECRET = "x".repeat(40); process.env.ADMIN_PASSWORD = "Admin-pass-123!";
res = await P(admin, "GET", "readiness"); assert.equal(res.status, 200); const rk = Object.fromEntries(res.data.checks.map(c => [c.key, c]));
assert.equal(rk.db.status, "ok"); assert.equal(rk.session.status, "ok"); assert.equal(rk.admin_env.status, "warn"); assert.equal(rk.cron.status, "warn"); assert(!JSON.stringify(res.data).includes("Admin-pass-123!") && !JSON.stringify(res.data).includes("x".repeat(40))); ok("controllo configurazione: segnala cosa manca e non rivela mai i valori");
res = await call(portal, null, "GET", "?op=health"); assert.equal(res.status, 200); assert.deepEqual(res.data, { ok: true }); ok("controllo di salute pubblico, senza dati");

// ─── Strumenti di prova e operazioni distruttive
process.env.DISABLE_DEMO_TOOLS = "1";
assert.equal((await P(admin, "POST", "test-accesses", {})).status, 403); assert.equal((await P(admin, "POST", "budget-demo", {})).status, 403); assert.equal((await P(admin, "POST", "vendor-demo", {})).status, 403); ok("DISABLE_DEMO_TOOLS=1: accessi di prova, simulazione e fornitori di prova disattivati");
assert.equal((await P(admin, "GET", "readiness")).data.checks.find(c => c.key === "demo").status, "ok");
delete process.env.DISABLE_DEMO_TOOLS; assert.equal((await P(admin, "GET", "readiness")).data.checks.find(c => c.key === "demo").status, "warn"); ok("il controllo di configurazione segnala gli strumenti di prova ancora attivi");
assert.equal((await P(admin, "POST", "reset-run", { areas: ["tasks"], confirm: "ELIMINA" })).status, 200);
assert((await P(admin, "GET", "security-events")).data.events.some(e => e.event === "data_reset")); ok("lo svuotamento dei dati è nel registro di sicurezza");
console.log(`\n${passed} controlli superati`); await pool.end();
