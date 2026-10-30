import assert from "node:assert/strict";
const B = process.env.API_BUILD + "/api/";
process.env.DATABASE_URL = process.env.TEST_DB_URL;
process.env.ADMIN_EMAIL = "admin@test.it";
process.env.ADMIN_PASSWORD = "Admin-pass-123!";
process.env.SESSION_SECRET = "x".repeat(40);
process.env.VIES_MODE = "mock";
process.env.SANCTIONS_PROVIDER = "mock";
process.env.DOC_AI_PROVIDER = "mock";
const portal = await import(B + "portal.js"),
  login = await import(B + "login.js");
const db = await import(B + "_db.js"),
  crypto = await import(B + "_crypto.js"),
  blob = await import(process.env.API_BUILD + "/node_modules/@vercel/blob/index.js");
const ai = await import(B + "_docai.js");
await db.ensureSchema();
const pool = db.getPool();
let passed = 0;
const ok = n => {
  passed++;
  console.log("  ✓", n);
};
const call = async (mod, cookie, method, qs, body, headers = {}) => {
  const r = new Request("https://app.test/api/x" + qs, {
    method,
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}), ...headers },
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
const P = (c, m, op, body, extra = "", h) => call(portal, c, m, `?op=${op}${extra}`, body, h);
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
await mk("buyer2@test.it", "Buyer Due", "buyer");
await mk("fin@test.it", "Finance Uno", "finance");
const admin = await signin("admin@test.it", "Admin-pass-123!"),
  buyer = await signin("buyer@test.it", "Password-123!"),
  buyer2 = await signin("buyer2@test.it", "Password-123!"),
  fin = await signin("fin@test.it", "Password-123!");

console.log("Valutazione AI (regole)");
const ctx = {
  typeKey: "durc",
  typeLabel: "DURC",
  expires: true,
  legalName: "Rossi Servizi Srl",
  vatCode: "IT12345678901",
  declaredValidUntil: "2027-01-01",
  today: "2026-10-09",
};
const x0 = {
  readable: true,
  matchesType: true,
  documentType: "DURC",
  holderName: "ROSSI SERVIZI S.R.L.",
  vatCode: "12345678901",
  issueDate: null,
  validUntil: "2027-01-01",
  issues: [],
};
assert.equal(ai.evaluate(x0, ctx).status, "ok");
ok("documento corretto (nome con forma societaria diversa, IVA senza prefisso)");
assert.equal(ai.evaluate({ ...x0, matchesType: false, documentType: "fattura" }, ctx).status, "problem");
ok("tipo sbagliato = problema");
assert.equal(ai.evaluate({ ...x0, readable: false }, ctx).status, "problem");
ok("illeggibile = problema");
assert.equal(ai.evaluate({ ...x0, holderName: "Altra SpA" }, ctx).status, "warning");
ok("intestatario diverso = avviso");
assert.equal(ai.evaluate({ ...x0, vatCode: "99999999999" }, ctx).status, "warning");
ok("partita IVA diversa = avviso");
assert.equal(ai.evaluate({ ...x0, validUntil: "2026-01-01" }, { ...ctx, declaredValidUntil: "2026-01-01" }).status, "warning");
ok("documento scaduto = avviso");
assert.equal(ai.evaluate({ ...x0, validUntil: "2027-06-01" }, ctx).status, "warning");
ok("scadenza diversa da quella indicata = avviso");
assert.equal(ai.evaluate({ ...x0, validUntil: null }, ctx).status, "warning");
ok("scadenza non trovata = avviso");
assert.deepEqual(
  ai.parseExtraction(
    'Ecco:\n```json\n{"readable":true,"matchesType":true,"documentType":"DURC","validUntil":"2027-01-01","issues":["a","b","c","d"]}\n```',
  ).issues.length,
  3,
);
ok("parsing risposta AI (testo attorno al JSON, max 3 dubbi)");
assert.throws(() => ai.parseExtraction("nessun json"));
ok("risposta non interpretabile = errore");

console.log("Regole documentali");
const cfg0 = (await P(admin, "GET", "config")).data.config;
assert(cfg0.docTypes.some(t => t.key === "iso_27001") && !cfg0.docRules.some(r => r.docType === "iso_27001"));
ok("ISO presenti ma senza regole");
assert.equal(
  (await P(buyer, "POST", "config-save", { entity: "doc_type", action: "save", item: { key: "x_doc", label: "X", rules: [] } })).status,
  403,
);
ok("solo il Manager configura");
await P(admin, "POST", "config-save", {
  entity: "company",
  action: "save",
  item: { code: "ACME", name: "Acme", sapCompanyCode: "1000", purchOrg: "1000" },
});
await P(admin, "POST", "config-save", { entity: "industry", action: "save", item: { code: "IT01", name: "IT", buyerIds: [buyerId] } });
await P(admin, "POST", "config-save", {
  entity: "industry",
  action: "save",
  item: { code: "LAB1", name: "Laboratori", buyerIds: [buyerId] },
});
await P(admin, "POST", "config-save", {
  entity: "sap",
  action: "save",
  item: { reconciliationAccounts: { ITD1: "2010", ITW1: "2020", ITF3: "2030", BRD6: "2040" } },
});
const saveType = item => P(admin, "POST", "config-save", { entity: "doc_type", action: "save", item });
assert.equal((await saveType({ key: "Bad Key", label: "X", rules: [] })).status, 400);
ok("codice documento non valido");
assert.equal(
  (await saveType({ key: "iso_27001", label: "ISO 27001", expires: true, rules: [{ scope: "country", value: "ZZ", level: "required" }] }))
    .status,
  400,
);
ok("paese inesistente in una regola");
assert.equal(
  (
    await saveType({
      key: "iso_27001",
      label: "ISO 27001",
      expires: true,
      rules: [{ scope: "industry", value: "NOPE", level: "required" }],
    })
  ).status,
  400,
);
ok("codice merceologico inesistente in una regola");
assert.equal(
  (
    await saveType({
      key: "iso_27001",
      label: "Certificazione ISO/IEC 27001",
      expires: true,
      rules: [{ scope: "industry", value: "IT01", level: "required" }],
    })
  ).status,
  200,
);
assert.equal(
  (
    await saveType({
      key: "iso_17025",
      label: "ISO 17025",
      expires: true,
      rules: [
        { scope: "industry", value: "LAB1", level: "required" },
        { scope: "country", value: "DE", level: "optional" },
      ],
    })
  ).status,
  200,
);
assert.equal(
  (
    await saveType({
      key: "nuovo_doc",
      label: "Documento nuovo",
      help: "h",
      expires: false,
      multiple: false,
      rules: [{ scope: "all", level: "optional" }],
    })
  ).status,
  200,
);
ok("nuovo tipo di documento creato");
let c1 = (await P(admin, "GET", "config")).data.config;
assert(c1.docTypes.some(t => t.key === "nuovo_doc") && c1.docRules.filter(r => r.docType === "iso_17025").length === 2);
ok("regole salvate");

const invite = async (name, email, industryCode) => {
  const r = await P(admin, "POST", "vendor-invite", { name, email, companyCodes: ["ACME"], industryCode, referenceBuyerId: buyerId });
  const t = new URL(r.data.link).searchParams.get("invite");
  return (await P(null, "POST", "activate", { token: t, password: "Fornitore-123!" })).cookie;
};
const data = (name, vat) => ({
  company: { legalName: name, vatCode: vat, fiscalCode: vat.replace(/^IT/, "") },
  address: { street: "Via Roma", houseNumber: "1", postalCode: "20100", city: "Milano", country: "IT", region: "MI" },
  payment: {
    iban: "IT60X0542811101000000123456",
    swift: "BCITITMM",
    accountNumber: "1",
    bankName: "B",
    currency: "EUR",
    withholdingTax: false,
  },
  contacts: { language: "IT", ordersEmail: "o@x.it", adminEmail: "a@x.it", phone: "+39 02 1234567" },
  acceptedTerms: true,
  declarations: { conflictOfInterest: false, noSanctions: true, privacyAccepted: true },
});
const addDoc = async (c, type, name, validUntil = null) => {
  const path = `suppliers/${globalThis.crypto.randomUUID()}/${name}`;
  blob.store.set(path, Buffer.from("x"));
  return P(c, "POST", "supplier-doc-add", { type, fileName: name, filePath: path, size: 100, validUntil });
};

const sup = await invite("Rossi Servizi Srl", "rossi@f.it", "IT01");
await P(sup, "POST", "supplier-save", data("Rossi Servizi Srl", "IT12345678901"));
let me = (await P(sup, "GET", "supplier-me")).data.supplier;
const keys = me.docTypes.map(t => t.key);
assert(keys.includes("iso_27001") && !keys.includes("iso_17025") && keys.includes("nuovo_doc") && keys.includes("durc"));
assert(me.docTypes.find(t => t.key === "iso_27001").required);
ok("il fornitore IT01 vede ISO 27001 obbligatoria e non ISO 17025");
const lab = await invite("Lab Test Srl", "lab@f.it", "LAB1");
const labKeys = (await P(lab, "GET", "supplier-me")).data.supplier.docTypes.map(t => t.key);
assert(labKeys.includes("iso_17025") && !labKeys.includes("iso_27001"));
ok("il laboratorio vede ISO 17025 e non ISO 27001");
assert.equal((await addDoc(lab, "iso_27001", "x.pdf", "2099-01-01")).status, 400);
ok("documento non richiesto al suo tipo: rifiutato");
assert.equal((await addDoc(sup, "durc", "durc.pdf")).status, 400);
ok("documento con scadenza senza data: rifiutato");
for (const [t, n, d] of [
  ["bank_letter", "banca.pdf"],
  ["chamber_certificate", "visura.pdf", "2099-01-01"],
  ["durc", "durc.pdf", "2099-01-01"],
  ["code_of_conduct", "coc.pdf"],
])
  await addDoc(sup, t, n, d);
const sub = await P(sup, "POST", "supplier-submit");
assert.equal(sub.status, 422);
assert.deepEqual(sub.data.missingDocuments, ["iso_27001"]);
ok("invio bloccato: manca ISO 27001 (obbligatoria per IT01)");
const iso = await addDoc(sup, "iso_27001", "iso27001.pdf", "2027-02-01");
assert.equal(iso.status, 200);
{
  const s2 = await P(sup, "POST", "supplier-submit");
  assert.equal(s2.status, 200, JSON.stringify(s2.data));
}
let vid = me.id;
assert.equal((await P(buyer, "POST", "vendor-action", { action: "approve", paymentTerms: "0030" }, `&id=${vid}`)).status, 200);
assert.equal((await P(fin, "POST", "vendor-action", { action: "approve" }, `&id=${vid}`)).status, 200);
ok("registrazione completata");
assert.equal((await saveType({ key: "iso_27001", label: "ISO 27001", expires: true, rules: [] })).status, 200);
assert.equal((await P(admin, "POST", "config-save", { entity: "doc_type", action: "delete", item: { key: "iso_27001" } })).status, 409);
ok("tipo usato da documenti: non eliminabile");
assert.equal((await P(admin, "POST", "config-save", { entity: "doc_type", action: "delete", item: { key: "nuovo_doc" } })).status, 200);
ok("tipo inutilizzato eliminato");
await saveType({ key: "iso_27001", label: "ISO 27001", expires: true, rules: [{ scope: "industry", value: "IT01", level: "required" }] });
await saveType({ key: "iso_9001", label: "ISO 9001", expires: true, rules: [{ scope: "all", level: "required" }] });

console.log("Monitoraggio scadenze");
const mon = async c => (await P(c, "GET", "doc-monitor")).data;
let m = await mon(buyer);
const find = (m, type) => m.items.find(i => i.docType === type);
assert.equal(find(m, "iso_9001").state, "missing");
assert.equal(find(m, "iso_27001").state, "valid");
ok("documento reso obbligatorio dopo: risulta mancante");
assert.equal((await mon(buyer2)).items.length, 0);
ok("buyer non assegnato non vede nulla");
assert.equal((await P(null, "GET", "doc-monitor")).status, 401);
assert.equal((await mon(fin)).items.length > 0, true);
ok("Finance vede il monitoraggio");
await pool.query("update supplier_documents set valid_until = (now() + interval '20 days')::date where type = 'durc'");
await pool.query("update supplier_documents set valid_until = (now() - interval '5 days')::date where type = 'chamber_certificate'");
m = await mon(buyer);
assert.equal(find(m, "durc").state, "expiring");
assert.equal(find(m, "durc").daysLeft, 20);
assert.equal(find(m, "chamber_certificate").state, "expired");
assert(find(m, "chamber_certificate").daysLeft < 0);
ok("stati: in scadenza e scaduto, con giorni residui");

console.log("Reminder");
assert.equal((await P(null, "GET", "cron-reminders")).status, 503);
ok("cron senza CRON_SECRET configurato: 503");
process.env.CRON_SECRET = "s3cret-s3cret";
assert.equal((await P(null, "GET", "cron-reminders")).status, 401);
assert.equal((await P(null, "GET", "cron-reminders", undefined, "", { authorization: "Bearer nope" })).status, 401);
ok("cron senza chiave giusta: 401");
const cron = () => P(null, "GET", "cron-reminders", undefined, "", { authorization: "Bearer s3cret-s3cret" });
let r = await cron();
assert.equal(r.status, 200);
assert.equal(r.data.emails, 1);
assert.equal(r.data.items, 3, JSON.stringify(r.data));
ok("primo giro: 1 email con 3 documenti (mancante, scaduto, in scadenza)");
const mail = (await pool.query("select * from notifications where template = 'doc_reminder' order by id desc limit 1")).rows[0];
assert.equal(mail.to_email, "rossi@f.it");
assert(mail.body.includes("ISO 9001") && mail.body.includes("Visura") && mail.body.includes("DURC"));
ok("testo email con elenco dei documenti");
r = await cron();
assert.equal(r.data.emails, 0);
ok("secondo giro subito dopo: nessun invio doppio");
m = await mon(buyer);
assert.equal(find(m, "iso_9001").reminders, 1);
assert.equal(find(m, "iso_9001").unresponsive, false);
await pool.query("update doc_reminders set sent_at = now() - interval '8 days'");
r = await cron();
assert.equal(r.data.emails, 1);
assert.equal(r.data.items, 2);
ok("dopo 8 giorni: ripetuto per scaduto e mancante (non per quello in scadenza, già sollecitato a quella soglia)");
assert.equal(r.data.alerts, 1);
assert(
  (await pool.query("select 1 from notifications where template = 'doc_unresponsive' and to_email = 'buyer@test.it'")).rows.length === 1,
);
ok("avviso al buyer: il fornitore non risponde");
m = await mon(buyer);
assert.equal(find(m, "iso_9001").unresponsive, true);
assert.equal(find(m, "chamber_certificate").unresponsive, true);
assert.equal(find(m, "durc").unresponsive, false);
ok("segnalato 'non risponde' dopo 2 solleciti");
r = await cron();
assert.equal(r.data.alerts, 0);
ok("l'avviso al buyer non si ripete subito");
assert.equal((await P(fin, "POST", "doc-remind", { supplierId: vid, channel: "email" })).status, 403);
ok("Finance non sollecita");
assert.equal((await P(buyer2, "POST", "doc-remind", { supplierId: vid, channel: "email" })).status, 400);
ok("buyer non assegnato non sollecita");
assert.equal((await P(buyer, "POST", "doc-remind", { supplierId: vid, channel: "phone" })).status, 400);
ok("contatto telefonico senza nota rifiutato");
assert.equal(
  (await P(buyer, "POST", "doc-remind", { supplierId: vid, channel: "phone", note: "Parlato con Sig. Rossi, carica entro venerdì" }))
    .status,
  200,
);
assert.equal((await P(buyer, "POST", "doc-remind", { supplierId: vid, channel: "email" })).status, 200);
ok("sollecito manuale (email) e contatto telefonico registrati");
m = await mon(buyer);
assert(find(m, "iso_9001").reminders >= 4);
assert.equal(find(m, "iso_9001").lastChannel, "email");
assert.equal((await P(admin, "POST", "reminders-run")).status, 200);
assert.equal((await P(buyer, "POST", "reminders-run")).status, 403);
ok("esecuzione manuale solo per il Manager");
await P(admin, "POST", "config-save", {
  entity: "reminders",
  action: "save",
  item: { enabled: false, days: [90, 30], repeatDays: 3, escalateAfter: 3 },
});
assert.equal(
  (
    await P(admin, "POST", "config-save", {
      entity: "reminders",
      action: "save",
      item: { enabled: true, days: [], repeatDays: 3, escalateAfter: 3 },
    })
  ).status,
  400,
);
ok("politica reminder validata");
await pool.query("update doc_reminders set sent_at = now() - interval '30 days'");
r = await cron();
assert.equal(r.data.emails, 0);
ok("reminder disattivati: nessun invio");
const pol = (await P(admin, "GET", "config")).data.config.reminders;
assert.deepEqual(pol.days, [90, 30]);
assert.equal(pol.escalateAfter, 3);
await P(admin, "POST", "config-save", {
  entity: "reminders",
  action: "save",
  item: { enabled: true, days: [60, 30, 15], repeatDays: 7, escalateAfter: 2 },
});

console.log("Il fornitore aggiorna i documenti");
assert.equal((await addDoc(sup, "chamber_certificate", "visura-nuova.pdf", "2099-05-01")).status, 200);
assert.equal((await addDoc(sup, "iso_9001", "iso9001.pdf", "2099-05-01")).status, 200);
const st = (await pool.query("select status from suppliers where id = $1", [vid])).rows[0].status;
assert.equal(st, "pending");
ok("modifica di un registrato: torna in verifica");

console.log("Controllo AI (flusso)");
await pool.query("update suppliers set status = 'draft' where id = $1", [vid]);
const dd = async name => {
  const x = await addDoc(sup, "durc", name, "2099-01-01");
  return x.data.docId;
};
let id1 = await dd("durc-ok.pdf");
let a1 = (await P(sup, "POST", "supplier-doc-check", undefined, `&id=${id1}`)).data.supplier.documents.find(d => d.id === id1).ai;
assert.equal(a1.status, "ok");
ok("documento corretto: esito ok");
let id2 = await dd("durc-wrong.pdf");
let a2 = (await P(sup, "POST", "supplier-doc-check", undefined, `&id=${id2}`)).data.supplier.documents.find(d => d.id === id2).ai;
assert.equal(a2.status, "problem");
assert(a2.summary.includes("contratto di locazione"));
ok("documento sbagliato: problema con spiegazione");
let id3 = await dd("durc-other.pdf");
assert.equal(
  (await P(sup, "POST", "supplier-doc-check", undefined, `&id=${id3}`)).data.supplier.documents.find(d => d.id === id3).ai.status,
  "warning",
);
ok("altro intestatario: avviso");
assert.equal((await P(lab, "POST", "supplier-doc-check", undefined, `&id=${id3}`)).status, 404);
ok("un fornitore non controlla i documenti altrui");
assert.equal((await P(buyer, "POST", "doc-check", undefined, `&id=${id3}`)).status, 200);
assert.equal((await P(fin, "POST", "doc-check", undefined, `&id=${id3}`)).status, 403);
assert.equal((await P(buyer2, "POST", "doc-check", undefined, `&id=${id3}`)).status, 404);
ok("ripetizione del controllo: buyer sì, Finance no, buyer non assegnato 404");
const staff = (await P(buyer, "GET", "vendor", undefined, `&id=${vid}`)).data.supplier;
assert(staff.documents.some(d => d.ai));
ok("il buyer vede l'esito sul documento");
delete process.env.DOC_AI_PROVIDER;
delete process.env.ANTHROPIC_API_KEY;
let id4 = await dd("durc-nuovo.pdf");
const none = (await P(sup, "POST", "supplier-doc-check", undefined, `&id=${id4}`)).data.supplier.documents.find(d => d.id === id4).ai;
assert.equal(none, null);
ok("senza motore AI configurato: nessun esito, nessun errore");
console.log(`\n${passed} controlli superati`);
process.exit(0);
