import assert from "node:assert/strict";
const B = process.env.API_BUILD + "/api/";
process.env.DATABASE_URL = process.env.TEST_DB_URL;
process.env.ADMIN_EMAIL = "admin@test.it";
process.env.ADMIN_PASSWORD = "Admin-pass-123!";
process.env.SESSION_SECRET = "x".repeat(40);
process.env.VIES_MODE = "mock";
process.env.SANCTIONS_PROVIDER = "mock";
const portal = await import(B + "portal.js"),
  login = await import(B + "login.js");
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
  return { status: res.status, data, cookie: sc ? sc.split(";")[0] : null };
};
const P = (c, m, op, body, extra = "") => call(portal, c, m, `?op=${op}${extra}`, body);
const signin = async (e, p) => (await call(login, null, "POST", "", { email: e, password: p })).cookie;
const mk = async (e, n, r) =>
  pool
    .query("insert into users (email,name,role,title,password_hash) values ($1,$2,$3,'t',$4) returning id", [
      e,
      n,
      r,
      await crypto.hashPassword("Password-123!"),
    ])
    .then(x => x.rows[0].id);
const buyerId = await mk("buyer@test.it", "Buyer Uno", "buyer");
await mk("fin@test.it", "Finance Uno", "finance");
const admin = await signin("admin@test.it", "Admin-pass-123!"),
  buyer = await signin("buyer@test.it", "Password-123!"),
  fin = await signin("fin@test.it", "Password-123!");
await P(admin, "POST", "config-save", {
  entity: "company",
  action: "save",
  item: { code: "ACME", name: "Acme", sapCompanyCode: "1000", purchOrg: "1000" },
});
await P(admin, "POST", "config-save", { entity: "industry", action: "save", item: { code: "IT01", name: "IT", buyerIds: [buyerId] } });
await P(admin, "POST", "config-save", {
  entity: "sap",
  action: "save",
  item: { reconciliationAccounts: { ITD1: "2010", ITW1: "2020", ITF3: "2030", BRD6: "2040" } },
});

const ibanIT = bban => {
  const num = (bban + "IT00").replace(/[A-Z]/g, c => String(c.charCodeAt(0) - 55));
  let m = 0;
  for (const ch of num) m = (m * 10 + Number(ch)) % 97;
  return "IT" + String(98 - m).padStart(2, "0") + bban;
};
const IB2 = ibanIT("L1234512345123456789012"),
  IB3 = ibanIT("L1234512345123456789099"),
  IB4 = ibanIT("L1234512345123456780000");
const DECL = { conflictOfInterest: false, noSanctions: true, privacyAccepted: true };
const dataFor = (name, vat, iban = "IT60X0542811101000000123456", extra = {}) => ({
  company: { legalName: name, vatCode: vat, fiscalCode: vat.replace(/^IT/, "") },
  address: { street: "Via Roma", houseNumber: "1", postalCode: "20100", city: "Milano", country: "IT", region: "MI" },
  payment: { iban, swift: "BCITITMM", accountNumber: "1", bankName: "Banca", currency: "EUR", withholdingTax: false },
  contacts: { language: "IT", ordersEmail: "o@x.it", adminEmail: "amm@" + vat + ".it", phone: "+39 02 1234567" },
  acceptedTerms: true,
  declarations: DECL,
  ...extra,
});
const addDoc = async (c, type, name, validUntil = null) => {
  const path = `suppliers/${globalThis.crypto.randomUUID()}/${name}`;
  blob.store.set(path, Buffer.from("x"));
  return P(c, "POST", "supplier-doc-add", { type, fileName: name, filePath: path, size: 100, validUntil });
};
const invite = async (name, email, confirm = false) =>
  P(buyer, "POST", "vendor-invite", {
    name,
    email,
    companyCodes: ["ACME"],
    industryCode: "IT01",
    referenceBuyerId: buyerId,
    confirmDuplicates: confirm,
  });
const activate = async link =>
  (await P(null, "POST", "activate", { token: new URL(link).searchParams.get("invite"), password: "Fornitore-123!" })).cookie;
const fill = async (c, data) => {
  await P(c, "POST", "supplier-save", data);
  for (const [t, n, d] of [
    ["bank_letter", "banca.pdf"],
    ["chamber_certificate", "visura.pdf", "2099-01-01"],
    ["durc", "durc.pdf", "2099-01-01"],
    ["code_of_conduct", "coc.pdf"],
  ])
    await addDoc(c, t, n, d);
};
const vendor = async (c, id) => (await P(c, "GET", "vendor", undefined, `&id=${id}`)).data.supplier;
const act = (c, id, body) => P(c, "POST", "vendor-action", body, `&id=${id}`);
const register = async (name, email, vat, iban) => {
  const inv = await invite(name, email, true);
  const c = await activate(inv.data.link);
  await fill(c, dataFor(name, vat, iban));
  const sub = await P(c, "POST", "supplier-submit");
  assert.equal(sub.status, 200, JSON.stringify(sub.data));
  const id = inv.data.supplier.id;
  return { id, c };
};

const users = await import(B + "users.js");
const U = async (c, method, body, qs = "") => {
  const r = new Request("https://app.test/api/users" + qs, {
    method,
    headers: { "content-type": "application/json", cookie: c },
    body: body ? JSON.stringify(body) : undefined,
  });
  const res = await users[method](r);
  return { status: res.status, data: await res.json().catch(() => null) };
};
const audit = async () => (await P(admin, "GET", "config-audit")).data.entries;

console.log("Registro modifiche");
let e = await audit();
assert(e.some(x => x.area === "company" && x.action === "create" && x.subject === "ACME"));
ok("creazione di una società registrata");
await P(admin, "POST", "config-save", {
  entity: "company",
  action: "save",
  item: { code: "ACME", name: "Acme Italia", sapCompanyCode: "1000", purchOrg: "1000" },
});
e = await audit();
assert.equal(e[0].action, "update");
assert.match(e[0].detail, /Nome: Acme → Acme Italia/);
assert.equal(e[0].actor.length > 0, true);
ok("modifica con valore prima e dopo");
const n0 = e.length;
await P(admin, "POST", "config-save", {
  entity: "company",
  action: "save",
  item: { code: "ACME", name: "Acme Italia", sapCompanyCode: "1000", purchOrg: "1000" },
});
assert.equal((await audit()).length, n0);
ok("salvataggio senza cambiamenti: nessuna voce");
await P(admin, "POST", "config-save", { entity: "rda", action: "save", item: { sourcingThreshold: 15000 } });
e = await audit();
assert.equal(e[0].area, "rda");
assert.match(e[0].detail, /Soglia confronto fornitori: 10000 → 15000/);
ok("soglia del confronto fornitori tracciata");
await P(admin, "POST", "config-save", { entity: "payment_term", action: "save", item: { code: "Z99", label: "99 giorni" } });
await P(admin, "POST", "config-save", { entity: "payment_term", action: "delete", item: { code: "Z99" } });
e = await audit();
assert.equal(e[0].action, "delete");
assert.equal(e[0].detail, "Eliminato");
ok("eliminazione tracciata");
const nu = await U(admin, "POST", { email: "nuovo@test.it", name: "Nuovo Buyer", role: "buyer", title: "b", password: "Nuova-pass-9876!" });
assert.equal(nu.status, 200);
await U(admin, "POST", { id: nu.data.user.id, role: "manager" });
e = await audit();
assert.equal(e[0].area, "user");
assert.match(e[0].detail, /Ruolo: buyer → manager/);
assert.equal(e[1].action, "create");
ok("utenti: creazione e cambio ruolo tracciati");
assert.equal((await P(buyer, "GET", "config-audit")).status, 403);
ok("il registro lo vede solo chi configura");

console.log("Privacy");
let cfg = (await P(admin, "GET", "config")).data.config;
assert(cfg.privacy.notice.length > 40);
assert.equal(cfg.privacy.inviteDays, 90);
assert.equal(cfg.privacy.retentionMonths, 24);
ok("impostazioni privacy predefinite");
assert.equal((await P(admin, "POST", "config-save", { entity: "privacy", action: "save", item: { notice: "corta" } })).status, 400);
let r = await P(admin, "POST", "config-save", {
  entity: "privacy",
  action: "save",
  item: {
    notice: "Informativa di prova: i dati sono trattati per la gestione dei fornitori secondo il GDPR.",
    inviteDays: 30,
    retentionMonths: 12,
  },
});
assert.equal(r.status, 200);
assert.equal(r.data.config.privacy.inviteDays, 30);
assert.equal((await audit())[0].area, "privacy");
ok("informativa e tempi modificabili (e tracciati)");
let inv = await invite("Gamma Srl", "gamma@f.it");
const tok = new URL(inv.data.link).searchParams.get("invite");
const info = await P(null, "GET", "invite-info", undefined, `&token=${tok}`);
assert.match(info.data.privacyNotice, /Informativa di prova/);
ok("l'invito mostra l'informativa");
const gamma = await activate(inv.data.link);
const gammaId = inv.data.supplier.id;
let me = (await P(gamma, "GET", "supplier-me")).data.supplier;
assert.match(me.privacyNotice, /Informativa di prova/);
ok("anche nel portale del fornitore");
await fill(gamma, dataFor("Gamma Srl", "33333333333", IB3));
const exp = await call(portal, gamma, "GET", "?op=supplier-export");
assert.equal(exp.status, 200);
assert.equal(exp.data.supplier.email, "gamma@f.it");
assert.equal(exp.data.documents.length, 4);
ok("il fornitore scarica i propri dati");
assert.equal((await P(buyer, "GET", "vendor-export", undefined, `&id=${gammaId}`)).status, 403);
assert.equal((await P(admin, "GET", "vendor-export", undefined, `&id=${gammaId}`)).data.data.company.vatCode, "33333333333");
ok("export dati fornitore: solo Manager");

const reg = await register("Delta Srl", "delta@f.it", "44444444444", IB4);
await act(buyer, reg.id, { action: "approve", paymentTerms: "0030" });
await act(fin, reg.id, { action: "approve" });
r = await P(admin, "POST", "vendor-anonymize", { reason: "Richiesta del fornitore" }, `&id=${reg.id}`);
assert.equal(r.status, 409);
ok("fornitore attivo e registrato: non si anonimizza");
assert.equal((await P(buyer, "POST", "vendor-anonymize", { reason: "Richiesta del fornitore" }, `&id=${gammaId}`)).status, 403);
assert.equal((await P(admin, "POST", "vendor-anonymize", { reason: "" }, `&id=${gammaId}`)).status, 400);
const files = (await pool.query("select file_path from supplier_documents where supplier_id = $1", [gammaId])).rows.map(x => x.file_path);
r = await P(admin, "POST", "vendor-anonymize", { reason: "Richiesta di cancellazione" }, `&id=${gammaId}`);
assert.equal(r.status, 200);
const g = r.data.supplier;
assert(g.anonymizedAt);
assert.equal(g.documents.length, 0);
assert.equal(g.data.company.vatCode, "33333333333");
assert.equal(g.data.payment.iban, IB3);
assert.equal(g.data.contacts, undefined);
assert.equal(g.data.address, undefined);
assert.match(g.email, /@invalid$/);
assert(files.every(f => !blob.store.has(f)));
ok("anonimizzato: restano P.IVA e IBAN, spariti contatti, indirizzo e file");
assert(!(await signin("gamma@f.it", "Fornitore-123!")));
ok("l'account del fornitore non esiste più");
assert.equal((await P(admin, "POST", "vendor-anonymize", { reason: "di nuovo" }, `&id=${gammaId}`)).status, 400);
ok("non si anonimizza due volte");

console.log("Conservazione (cron)");
const old = await invite("Vecchio Invito Srl", "old@f.it");
await pool.query("update suppliers set created_at = now() - interval '40 days' where id = $1", [old.data.supplier.id]);
const fresh = await invite("Nuovo Invito Srl", "fresh@f.it");
const eps = await invite("Epsilon Srl", "eps@f.it");
const epsC = await activate(eps.data.link);
await fill(epsC, dataFor("Epsilon Srl", "55555555555", ibanIT("L1234512345123456785555")));
await pool.query("update suppliers set updated_at = now() - interval '13 months' where id = $1", [eps.data.supplier.id]);
process.env.CRON_SECRET = "cron-secret";
const cr = await call(portal, null, "GET", "?op=cron-reminders");
assert.equal(cr.status, 401);
const cron = await new Promise(async res => {
  const rq = new Request("https://app.test/api/x?op=cron-reminders", { headers: { authorization: "Bearer cron-secret" } });
  res(await (await portal.GET(rq)).json());
});
assert.equal(cron.retention.invitesDeleted, 1);
assert.equal(cron.retention.anonymized, 1);
ok("il cron elimina gli inviti scaduti e anonimizza i fornitori fermi oltre la conservazione");
assert.equal((await pool.query("select count(*)::int n from suppliers where id = $1", [old.data.supplier.id])).rows[0].n, 0);
assert.equal((await pool.query("select count(*)::int n from suppliers where id = $1", [fresh.data.supplier.id])).rows[0].n, 1);
assert((await pool.query("select anonymized_at from suppliers where id = $1", [eps.data.supplier.id])).rows[0].anonymized_at);
ok("invito recente intatto, bozza ferma anonimizzata");
console.log(`\n${passed} controlli superati`);
process.exit(0);
