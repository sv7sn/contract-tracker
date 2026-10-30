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
const ok_ = n => {
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
process.env.COMPANY_CHECK_MODE = "off";
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
const risk = await import(B + "_risk.js"),
  demo = await import(B + "_demo.js");
// 1. Regole del livello (funzione pura)
const ok = { status: "ok", detail: "" },
  base = {
    status: "registered",
    lifecycle: "active",
    qualification: "valid",
    compliance: { checkedAt: new Date().toISOString(), vies: ok, sanctions: ok, company: ok },
    rating: null,
    spendShare: null,
  };
const A = x => risk.assessRisk({ ...base, ...x });
assert.equal(A({}).level, "low");
assert.equal(A({}).factors.length, 0);
ok_("nessuna criticità: rischio basso");
assert.equal(A({ status: "submitted" }).level, "na");
assert.equal(A({ lifecycle: "inactive" }).level, "na");
ok_("non ancora registrato o disattivato: nessun livello");
assert.equal(A({ compliance: { ...base.compliance, company: { status: "fail", detail: "liquidazione" } } }).level, "high");
assert.equal(A({ compliance: { ...base.compliance, company: { status: "warn", detail: "" } } }).level, "medium");
assert.equal(A({ compliance: { ...base.compliance, sanctions: { status: "fail", detail: "" } } }).level, "high");
assert.equal(A({ compliance: { ...base.compliance, vies: { status: "fail", detail: "" } } }).level, "high");
ok_("azienda, partita IVA e sanzioni: criticità = alto, da verificare = medio");
assert.equal(A({ qualification: "lapsed" }).level, "high");
assert.equal(A({ qualification: "expiring" }).level, "medium");
assert.equal(A({ lifecycle: "blocked" }).level, "high");
ok_("documenti scaduti e fornitore bloccato");
assert.equal(A({ rating: { overall: 2.1, count: 2 } }).level, "high");
assert.equal(A({ rating: { overall: 3.2, count: 1 } }).level, "medium");
assert.equal(A({ rating: { overall: 4.5, count: 3 } }).level, "low");
assert.deepEqual(A({ rating: { overall: 2.1, count: 2 } }).factors[0].vars, { score: 2.1 });
ok_("valutazione dei buyer con il punteggio come valore");
assert.equal(A({ spendShare: 0.35 }).level, "medium");
assert.equal(A({ spendShare: 0.35, qualification: "expiring" }).level, "high");
assert.equal(A({ spendShare: 0.1, qualification: "expiring" }).level, "medium");
ok_("forte concentrazione della spesa: da sola rischio medio, con un'altra criticità media diventa alto");
assert.equal(A({ compliance: null }).level, "medium");
assert.equal(A({ compliance: null }).factors[0].area, "unverified");
ok_("controlli esterni mai eseguiti: rischio medio");
const ck = new Date(Date.now() - 10 * 864e5).toISOString();
assert.equal(
  A({ compliance: { ...base.compliance, checkedAt: ck } }).nextCheckAt.slice(0, 10),
  new Date(Date.parse(ck) + 180 * 864e5).toISOString().slice(0, 10),
);
assert.equal(
  A({ qualification: "lapsed", compliance: { ...base.compliance, checkedAt: ck } }).nextCheckAt.slice(0, 10),
  new Date(Date.parse(ck) + 30 * 864e5).toISOString().slice(0, 10),
);
ok_("prossima verifica secondo il livello (basso 180 giorni, alto 30)");
// 2. Impostazioni
const admin = await signin("admin@test.it", "Admin-pass-123!");
await mk("buyer@test.it", "Marta Buyer", "buyer");
const buyer = await signin("buyer@test.it", "Password-123!");
let r = await P(admin, "GET", "config");
assert.deepEqual(r.data.config.risk, { enabled: true, days: { high: 30, medium: 90, low: 180 }, batch: 20 });
ok_("impostazioni predefinite");
assert.equal(
  (
    await P(admin, "POST", "config-save", {
      entity: "risk",
      action: "save",
      item: { enabled: true, days: { high: 120, medium: 60, low: 180 }, batch: 20 },
    })
  ).status,
  400,
);
assert.equal(
  (
    await P(admin, "POST", "config-save", {
      entity: "risk",
      action: "save",
      item: { enabled: true, days: { high: 2, medium: 60, low: 180 }, batch: 20 },
    })
  ).status,
  400,
);
assert.equal((await P(buyer, "POST", "config-save", { entity: "risk", action: "save", item: { enabled: false } })).status, 403);
assert.equal(
  (
    await P(admin, "POST", "config-save", {
      entity: "risk",
      action: "save",
      item: { enabled: true, days: { high: 14, medium: 60, low: 120 }, batch: 5 },
    })
  ).status,
  200,
);
r = await P(admin, "GET", "config");
assert.deepEqual(r.data.config.risk.days, { high: 14, medium: 60, low: 120 });
assert((await pool.query("select 1 from config_audit where area = 'risk'")).rows.length);
ok_("impostazioni salvate con controlli, solo dal Manager e tracciate");
// 3. Verifica periodica
await pool.query(
  "insert into buying_companies (code, name, sap_company_code, purch_org) values ('C1','Soc','1000','1000') on conflict do nothing",
);
await pool.query("insert into industry_codes (code, name) values ('I1','Ind') on conflict do nothing");
const mgr = { id: 1, role: "manager", name: "Admin" };
const s1 = await demo.createDemoSupplier(mgr, { name: "Rischio Uno Srl" }),
  s2 = await demo.createDemoSupplier(mgr, { name: "Rischio Due Srl" });
await pool.query("update suppliers set status = 'registered', compliance = null where id = any($1)", [[s1.id, s2.id]]);
r = await P(admin, "GET", "vendors");
const row1 = r.data.vendors.find(v => v.id === s1.id);
assert.equal(row1.risk.level, "medium");
assert.equal(row1.risk.factors[0].area, "unverified");
ok_("elenco fornitori con il livello di rischio");
let res = await P(admin, "POST", "risk-run");
assert.equal(res.status, 200);
assert.equal(res.data.checked, 2);
assert.equal(res.data.worsened, 0);
r = await P(admin, "GET", "vendor", undefined, `&id=${s1.id}`);
assert.equal(r.data.supplier.risk.level, "low");
assert.equal(r.data.supplier.riskHistory.length, 1);
assert.equal(r.data.supplier.riskHistory[0].trigger, "periodic");
ok_("prima verifica: controlli eseguiti, rischio basso, storico avviato");
res = await P(admin, "POST", "risk-run");
assert.equal(res.data.due, 0);
assert.equal(res.data.checked, 0);
ok_("verificati di recente: nessun ricontrollo prima della scadenza");
// La partita IVA di s1 diventa non valida (VIES simulato: finisce con 0000) e la verifica è scaduta.
await pool.query(
  "update suppliers set data = jsonb_set(data, '{company,vatCode}', '\"IT12340000\"'), compliance = jsonb_set(compliance, '{checkedAt}', to_jsonb((now() - interval '200 days')::text)) where id = $1",
  [s1.id],
);
const mails0 = (await pool.query("select count(*)::int n from notifications where template = 'risk_alert'")).rows[0].n;
res = await P(admin, "POST", "risk-run");
assert.equal(res.data.checked, 1);
assert.equal(res.data.worsened, 1);
r = await P(admin, "GET", "vendor", undefined, `&id=${s1.id}`);
const sup = r.data.supplier;
assert.equal(sup.risk.level, "high");
assert(sup.risk.worsenedAt);
assert.deepEqual(sup.riskHistory[0].worsened, ["Partita IVA (VIES)"]);
assert.equal(sup.riskHistory.length, 2);
assert(sup.events.some(e => e.action === "Verifica periodica: situazione peggiorata"));
const mails = (await pool.query("select to_email, subject from notifications where template = 'risk_alert'")).rows;
assert(mails.length > mails0);
assert(mails.some(m => /Rischio Uno Srl/.test(m.subject)));
ok_("peggioramento: rischio alto, evento sulla scheda ed email ai buyer");
// Il ricontrollo manuale finisce nello storico ma non manda email.
const before = mails.length;

await P(admin, "POST", "vendor-checks", {}, `&id=${s2.id}`);
r = await P(admin, "GET", "vendor", undefined, `&id=${s2.id}`);
assert.equal(r.data.supplier.riskHistory[0].trigger, "manual");
assert.equal((await pool.query("select count(*)::int n from notifications where template = 'risk_alert'")).rows[0].n, before);
ok_("ricontrollo manuale registrato nello storico, senza email");
// Disattivata: la verifica automatica non parte (il pulsante del Manager sì).
await P(admin, "POST", "config-save", {
  entity: "risk",
  action: "save",
  item: { enabled: false, days: { high: 14, medium: 60, low: 120 }, batch: 5 },
});
await pool.query("update suppliers set compliance = jsonb_set(compliance, '{checkedAt}', to_jsonb((now() - interval '400 days')::text))");
const cronRisk = await risk.runRiskChecks("https://app.test");
assert.equal(cronRisk.checked, 0);
assert.equal((await P(buyer, "POST", "risk-run")).status, 403);
ok_("verifica automatica disattivabile; avvio manuale solo per il Manager");
// Il fornitore non vede il proprio livello di rischio.
const supC = await signin(s1.email, s1.password);
r = await P(supC, "GET", "supplier-me");
assert.equal(r.data.supplier.risk, undefined);
assert.equal(r.data.supplier.riskHistory, undefined);
ok_("il fornitore non vede rischio e storico delle verifiche");
console.log("Totale:", passed, "controlli");
await pool.end();
process.exit(0);
