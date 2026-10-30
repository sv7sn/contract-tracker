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

console.log("Dichiarazioni e privacy");
let inv = await invite("Alfa Servizi Srl", "alfa@f.it");
assert.equal(inv.status, 201);
let alfa = await activate(inv.data.link);
const alfaId = inv.data.supplier.id;
await fill(alfa, dataFor("Alfa Servizi Srl", "11111111111", "IT60X0542811101000000123456", { declarations: {} }));
let sub = await P(alfa, "POST", "supplier-submit");
assert.equal(sub.status, 422);
assert(
  sub.data.fieldErrors["declarations.noSanctions"] &&
    sub.data.fieldErrors["declarations.privacyAccepted"] &&
    sub.data.fieldErrors["declarations.conflictOfInterest"],
);
ok("invio bloccato senza dichiarazioni e informativa privacy");
await P(alfa, "POST", "supplier-save", { declarations: { conflictOfInterest: true, conflictDetails: "" } });
assert((await P(alfa, "POST", "supplier-submit")).data.fieldErrors["declarations.conflictDetails"]);
ok("conflitto d'interessi dichiarato: serve la descrizione");
await P(alfa, "POST", "supplier-save", { declarations: DECL });
let me = (await P(alfa, "GET", "supplier-me")).data.supplier;
assert(me.data.declarations.privacyAcceptedAt);
assert.deepEqual(me.compliance, []);
assert.deepEqual(me.duplicates, []);
ok("data di presa visione privacy registrata; il fornitore non vede controlli e doppioni");
assert.equal((await P(alfa, "POST", "supplier-submit")).status, 200);
let v = await vendor(buyer, alfaId);
const chk = k => v.compliance.find(c => c.key === k);
assert.equal(chk("vies").status, "ok");
assert.equal(chk("sanctions").status, "ok");
assert.equal(chk("declarations").status, "ok");
assert.equal(chk("iban_country").status, "ok");
assert.equal(chk("duplicates").status, "ok");
assert.equal(chk("documents").status, "ok");
ok("controlli di conformità eseguiti all'invio: tutti superati");
assert.equal((await act(buyer, alfaId, { action: "approve", paymentTerms: "0030" })).status, 200);
assert.equal((await act(fin, alfaId, { action: "approve" })).status, 200);
ok("fornitore pulito: registrato senza conferme aggiuntive");
v = await vendor(fin, alfaId);
assert.equal(v.status, "registered");
assert(v.approvedAt);
assert.equal(v.qualification, "valid");

console.log("Doppioni");
inv = await invite("ALFA SERVIZI S.p.A.", "alfa2@f.it");
assert.equal(inv.status, 409);
assert.equal(inv.data.needsConfirm, true);
assert.equal(inv.data.duplicates[0].supplierId, alfaId);
assert(inv.data.duplicates[0].fields.includes("Ragione sociale"));
ok("invito con la stessa ragione sociale (forma societaria diversa): bloccato con l'elenco dei possibili doppioni");
inv = await invite("ALFA SERVIZI S.p.A.", "alfa2@f.it", true);
assert.equal(inv.status, 201);
ok("con conferma esplicita l'invito parte");
const alfa2 = await activate(inv.data.link),
  alfa2Id = inv.data.supplier.id;
await fill(alfa2, dataFor("ALFA SERVIZI S.p.A.", "IT11111111111", IB2));
assert.equal((await P(alfa2, "POST", "supplier-submit")).status, 200);
v = await vendor(buyer, alfa2Id);
assert(v.duplicates.some(d => d.supplierId === alfaId && d.fields.includes("Partita IVA")));
assert.equal(v.compliance.find(c => c.key === "duplicates").status, "warn");
ok("stessa partita IVA (con o senza prefisso IT): segnalato");
let r = await act(buyer, alfa2Id, { action: "approve", paymentTerms: "0030" });
assert.equal(r.status, 409);
assert.equal(r.data.needsDuplicateConfirm, true);
ok("il Buyer non approva un possibile doppione senza conferma");
r = await act(buyer, alfa2Id, { action: "approve", paymentTerms: "0030", confirmDuplicates: true, duplicateReason: "x" });
assert.equal(r.status, 409);
ok("serve anche una motivazione");
r = await act(buyer, alfa2Id, {
  action: "approve",
  paymentTerms: "0030",
  confirmDuplicates: true,
  duplicateReason: "Sede secondaria con stessa P.IVA",
});
assert.equal(r.status, 200);
assert(r.data.supplier.events.some(e => e.action === "Doppione verificato dal Buyer"));
ok("con conferma e motivazione: approvato e tracciato");
v = await vendor(fin, alfa2Id);
assert.equal(v.compliance.find(c => c.key === "duplicates").status, "ok");
assert(v.duplicates[0].confirmed);
ok("doppione verificato dal Buyer: il controllo risulta superato");
r = await act(fin, alfa2Id, { action: "approve" });
assert.equal(r.status, 200);
ok("il Finance registra senza riconferme");
const list = (await P(buyer, "GET", "vendors")).data.vendors;
assert(list.find(x => x.id === alfaId).duplicate && list.find(x => x.id === alfa2Id).duplicate);
ok("nell'elenco entrambi segnati come possibile doppione");

const beta = await register("Beta Srl", "beta@f.it", "22222222222", "IT60X0542811101000000123456");
v = await vendor(buyer, beta.id);
const dupBeta = v.duplicates.find(d => d.supplierId === alfaId);
assert(dupBeta.fields.includes("IBAN") && dupBeta.severe);
assert.equal(v.compliance.find(c => c.key === "duplicates").status, "fail");
ok("stesso IBAN di un'altra azienda: segnalazione grave (possibile frode)");

console.log("Blocco, disattivazione, esclusione");
assert.equal((await act(buyer, beta.id, { action: "exclude", reason: "frode" })).status, 403);
ok("il Buyer non può escludere");
assert.equal((await act(buyer, beta.id, { action: "block" })).status, 400);
ok("motivo obbligatorio");
r = await act(buyer, beta.id, { action: "block", reason: "IBAN da verificare" });
assert.equal(r.data.supplier.lifecycle, "blocked");
ok("il Buyer blocca un fornitore");
assert.equal(
  (await act(buyer, beta.id, { action: "approve", paymentTerms: "0030", confirmDuplicates: true, duplicateReason: "verificato" })).status,
  409,
);
ok("un fornitore bloccato non si approva");
assert.equal((await P(beta.c, "GET", "supplier-me")).status, 200);
ok("bloccato: può ancora accedere per sistemare i dati");
r = await act(admin, beta.id, { action: "exclude", reason: "IBAN di un altro fornitore, tentativo di frode" });
assert.equal(r.data.supplier.lifecycle, "excluded");
assert.equal((await P(beta.c, "GET", "supplier-me")).status, 401);
assert.equal(await signin("beta@f.it", "Fornitore-123!"), null);
ok("escluso: non può più accedere");
inv = await invite("Beta S.r.l.", "beta-new@f.it", true);
assert.equal(inv.status, 409);
assert(/escluso/i.test(inv.data.error));
ok("un Buyer non può reinvitare un fornitore escluso");
inv = await P(admin, "POST", "vendor-invite", {
  name: "Beta S.r.l.",
  email: "beta-new@f.it",
  companyCodes: ["ACME"],
  industryCode: "IT01",
  referenceBuyerId: buyerId,
  confirmDuplicates: true,
});
assert.equal(inv.status, 201);
ok("il Manager sì, consapevolmente");
const beta2 = await activate(inv.data.link);
await fill(beta2, dataFor("Beta S.r.l.", "22222222222", IB2));
await P(beta2, "POST", "supplier-submit");
r = await act(buyer, inv.data.supplier.id, {
  action: "approve",
  paymentTerms: "0030",
  confirmDuplicates: true,
  duplicateReason: "nuova richiesta",
});
assert.equal(r.status, 409);
assert(/escluso/i.test(r.data.error));
ok("stessa partita IVA di un fornitore escluso: non approvabile");
r = await act(admin, beta.id, { action: "reactivate", reason: "chiarito con la banca" });
assert.equal(r.data.supplier.lifecycle, "active");
assert(await signin("beta@f.it", "Fornitore-123!"));
ok("riattivazione: torna ad accedere");
r = await act(admin, alfa2Id, { action: "deactivate", reason: "non più utilizzato" });
assert.equal(r.data.supplier.lifecycle, "inactive");
assert.equal((await P(alfa2, "GET", "supplier-me")).status, 401);
ok("disattivato: non accede");
await act(admin, alfa2Id, { action: "reactivate", reason: "riattivato" });

console.log("Cambio delle coordinate bancarie");
await pool.query("delete from notifications");
assert.equal((await P(alfa, "POST", "supplier-save", { payment: { iban: IB3 } })).status, 200);
v = await vendor(buyer, alfaId);
assert.equal(v.status, "pending");
assert(v.bankChanged);
const ch = v.changes.find(c => c.field === "payment.iban");
assert(ch.bank && ch.before.endsWith("123456") && ch.after.endsWith("789099"));
ok("modifica IBAN: torna in verifica con il confronto prima/dopo");
const alerts = (await pool.query("select to_email from notifications where template = 'bank_change_alert'")).rows
  .map(x => x.to_email)
  .sort();
assert.deepEqual(alerts, ["alfa@f.it", "amm@11111111111.it"]);
ok("avviso di sicurezza ai contatti già noti");
await P(alfa, "POST", "supplier-save", { contacts: { phone: "+39 02 7654321" } });
assert.equal((await pool.query("select count(*)::int n from notifications where template = 'bank_change_alert'")).rows[0].n, 2);
ok("nessun avviso doppio per modifiche successive non bancarie");
r = await act(buyer, alfaId, { action: "approve", paymentTerms: "0030" });
assert.equal(r.status, 409);
assert(/lettera della banca/.test(r.data.error));
ok("Buyer: senza la nuova lettera della banca non si approva");
assert.equal((await addDoc(alfa, "bank_letter", "nuova-lettera.pdf")).status, 200);
ok("il fornitore carica la lettera mentre la modifica è in verifica");
assert.equal((await act(buyer, alfaId, { action: "approve", paymentTerms: "0030" })).status, 200);
ok("doppione già verificato: nessuna riconferma all'aggiornamento");
r = await act(fin, alfaId, { action: "approve" });
assert.equal(r.status, 400);
assert(/chi hai chiamato/.test(r.data.error));
ok("Finance: serve la verifica telefonica");
r = await act(fin, alfaId, {
  action: "approve",
  bankVerification: { contact: "Mario Bianchi, amministrazione, numero da anagrafica", note: "Confermato il cambio banca" },
  complianceAck: true,
  complianceNote: "IBAN verificato",
});
assert.equal(r.status, 200, JSON.stringify(r.data));
v = await vendor(fin, alfaId);
assert.equal(v.status, "registered");
assert.equal(v.changes.length, 0);
assert(v.events.some(e => e.action === "Coordinate bancarie verificate"));
ok("con lettera e telefonata: aggiornato, i nuovi dati diventano quelli approvati");

console.log("Qualifica scaduta");
await pool.query("update supplier_documents set valid_until = current_date - 2 where type = 'durc' and supplier_id = $1", [alfaId]);
assert.equal((await P(buyer, "GET", "vendors")).data.vendors.find(x => x.id === alfaId).qualification, "lapsed");
v = await vendor(buyer, alfaId);
assert.equal(v.qualification, "lapsed");
assert.equal(v.compliance.find(c => c.key === "documents").status, "fail");
ok("documento obbligatorio scaduto: qualifica scaduta");
await pool.query("update supplier_documents set valid_until = current_date + 10 where type = 'durc' and supplier_id = $1", [alfaId]);
assert.equal((await vendor(buyer, alfaId)).qualification, "expiring");
ok("in scadenza entro 30 giorni");

console.log("Controlli esterni");
const gamma = await register("Gamma Sanctioned Ltd", "gamma@f.it", "33330000000", IB4);
v = await vendor(fin, gamma.id);
assert.equal(v.compliance.find(c => c.key === "vies").status, "fail");
assert.equal(v.compliance.find(c => c.key === "sanctions").status, "fail");
ok("partita IVA non valida per VIES e nome in lista sanzioni: segnalati");
process.env.SANCTIONS_PROVIDER = "";
assert.equal(
  (await P(fin, "POST", "vendor-checks", undefined, `&id=${gamma.id}`)).data.supplier.compliance.find(c => c.key === "sanctions").status,
  "todo",
);
ok("senza servizio collegato: verifica manuale richiesta");
assert.equal((await act(fin, gamma.id, { action: "sanctions_manual", reason: "ok" })).status, 400);
r = await act(fin, gamma.id, { action: "sanctions_manual", reason: "Consultata lista UE consolidata: nessuna corrispondenza" });
assert.equal(r.data.supplier.compliance.find(c => c.key === "sanctions").status, "ok");
ok("verifica manuale registrata dal Finance");
assert.equal((await P(buyer, "POST", "vendor-checks", undefined, `&id=${999}`)).status, 404);

console.log("Reminder");
await act(admin, beta.id, { action: "exclude", reason: "di nuovo" });
const docs = await import(B + "_docs.js");
process.env.CRON_SECRET = "s";
const res = await docs.runReminders("https://x");
assert(!(await pool.query("select 1 from doc_reminders where supplier_id = $1", [beta.id])).rows.length);
ok("nessun reminder ai fornitori esclusi");
console.log(`\n${passed} controlli superati`);
process.exit(0);
