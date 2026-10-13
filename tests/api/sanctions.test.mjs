import assert from "node:assert/strict";
const B = process.env.API_BUILD + "/api/";
process.env.DATABASE_URL = process.env.TEST_DB_URL;
process.env.ADMIN_EMAIL = "admin@test.it"; process.env.ADMIN_PASSWORD = "Admin-pass-123!"; process.env.SESSION_SECRET = "x".repeat(40);
process.env.VIES_MODE = "mock"; 
const portal = await import(B + "portal.js"), login = await import(B + "login.js");
const db = await import(B + "_db.js"), crypto = await import(B + "_crypto.js"), blob = await import(process.env.API_BUILD + "/node_modules/@vercel/blob/index.js");
await db.ensureSchema(); const pool = db.getPool();
let passed = 0; const ok = n => { passed++; console.log("  ✓", n); };
const call = async (mod, cookie, method, qs, body) => {
  const r = new Request("https://app.test/api/x" + qs, { method, headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const res = await mod[method](r); const sc = res.headers.get("set-cookie"); let data; try { data = await res.clone().json(); } catch { data = null; }
  return { status: res.status, data, cookie: sc ? sc.split(";")[0] : null };
};
const P = (c, m, op, body, extra = "") => call(portal, c, m, `?op=${op}${extra}`, body);
const signin = async (e, p) => (await call(login, null, "POST", "", { email: e, password: p })).cookie;
const mk = async (e, n, r) => pool.query("insert into users (email,name,role,title,password_hash) values ($1,$2,$3,'t',$4) returning id", [e, n, r, await crypto.hashPassword("Password-123!")]).then(x => x.rows[0].id);
const buyerId = await mk("buyer@test.it", "Buyer Uno", "buyer"); await mk("fin@test.it", "Finance Uno", "finance");
const admin = await signin("admin@test.it", "Admin-pass-123!"), buyer = await signin("buyer@test.it", "Password-123!"), fin = await signin("fin@test.it", "Password-123!");
await P(admin, "POST", "config-save", { entity: "company", action: "save", item: { code: "ACME", name: "Acme", sapCompanyCode: "1000", purchOrg: "1000" } });
await P(admin, "POST", "config-save", { entity: "industry", action: "save", item: { code: "IT01", name: "IT", buyerIds: [buyerId] } });
await P(admin, "POST", "config-save", { entity: "sap", action: "save", item: { reconciliationAccounts: { ITD1: "2010", ITW1: "2020", ITF3: "2030", BRD6: "2040" } } });

const ibanIT = bban => { const num = (bban + "IT00").replace(/[A-Z]/g, c => String(c.charCodeAt(0) - 55)); let m = 0; for (const ch of num) m = (m * 10 + Number(ch)) % 97; return "IT" + String(98 - m).padStart(2, "0") + bban; };
const IB2 = ibanIT("L1234512345123456789012"), IB3 = ibanIT("L1234512345123456789099"), IB4 = ibanIT("L1234512345123456780000");
const DECL = { conflictOfInterest: false, noSanctions: true, privacyAccepted: true };
const dataFor = (name, vat, iban = "IT60X0542811101000000123456", extra = {}) => ({ company: { legalName: name, vatCode: vat, fiscalCode: vat.replace(/^IT/, "") }, address: { street: "Via Roma", houseNumber: "1", postalCode: "20100", city: "Milano", country: "IT", region: "MI" }, payment: { iban, swift: "BCITITMM", accountNumber: "1", bankName: "Banca", currency: "EUR", withholdingTax: false }, contacts: { language: "IT", ordersEmail: "o@x.it", adminEmail: "amm@" + vat + ".it", phone: "+39 02 1234567" }, acceptedTerms: true, declarations: DECL, ...extra });
const addDoc = async (c, type, name, validUntil = null) => { const path = `suppliers/${globalThis.crypto.randomUUID()}/${name}`; blob.store.set(path, Buffer.from("x")); return P(c, "POST", "supplier-doc-add", { type, fileName: name, filePath: path, size: 100, validUntil }); };
const invite = async (name, email, confirm = false) => P(buyer, "POST", "vendor-invite", { name, email, companyCodes: ["ACME"], industryCode: "IT01", referenceBuyerId: buyerId, confirmDuplicates: confirm });
const activate = async link => (await P(null, "POST", "activate", { token: new URL(link).searchParams.get("invite"), password: "Fornitore-123!" })).cookie;
const fill = async (c, data) => { await P(c, "POST", "supplier-save", data); for (const [t, n, d] of [["bank_letter", "banca.pdf"], ["chamber_certificate", "visura.pdf", "2099-01-01"], ["durc", "durc.pdf", "2099-01-01"], ["code_of_conduct", "coc.pdf"]]) await addDoc(c, t, n, d); };
const vendor = async (c, id) => (await P(c, "GET", "vendor", undefined, `&id=${id}`)).data.supplier;
const act = (c, id, body) => P(c, "POST", "vendor-action", body, `&id=${id}`);
const register = async (name, email, vat, iban) => {
  const inv = await invite(name, email, true); const c = await activate(inv.data.link); await fill(c, dataFor(name, vat, iban));
  const sub = await P(c, "POST", "supplier-submit"); assert.equal(sub.status, 200, JSON.stringify(sub.data));
  const id = inv.data.supplier.id;
  return { id, c };
};

const sx = await import(B + "_sanctions.js");
const filler = n => Array.from({ length: n }, (_, i) => `Filler Person Number${i} Xq${i}`);
const euCsv = "﻿" + ['"fileGenerationDate";"Entity_LogicalId";"Entity_SubjectType";"NameAlias_LastName";"NameAlias_WholeName";"NameAlias_Function"',
  '"2026-10-01";"13";"enterprise";"";"Rosneft Trading S.A.";""', '"2026-10-01";"14";"person";"Rossi";"Mario ""Il Nero"" Rossi";""',
  ...filler(60).map((n, i) => `"2026-10-01";"${100 + i}";"person";"";"${n}";""`)].join("\r\n");
const unXml = `<?xml version="1.0"?><CONSOLIDATED_LIST><INDIVIDUALS>${filler(60).map((n, i) => `<INDIVIDUAL><DATAID>${i}</DATAID><REFERENCE_NUMBER>QDi.${i}</REFERENCE_NUMBER><FIRST_NAME>${n}</FIRST_NAME></INDIVIDUAL>`).join("")}</INDIVIDUALS><ENTITIES><ENTITY><DATAID>9</DATAID><REFERENCE_NUMBER>QDe.009</REFERENCE_NUMBER><FIRST_NAME>AL &amp; NOOR EXCHANGE COMPANY</FIRST_NAME><ENTITY_ALIAS><ALIAS_NAME>Noor Exchange House</ALIAS_NAME></ENTITY_ALIAS></ENTITY></ENTITIES></CONSOLIDATED_LIST>`;
const sdn = [`36,"AEROCARIBBEAN AIRLINES",-0- ,"CUBA",-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- `, ...filler(60).map((n, i) => `${500 + i},"${n}","individual","SDGT",-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- `)].join("\r\n");
const alt = `36,12,"aka","AERO-CARIBBEAN",-0- \r\n`;
const ukCsv = "Report Date: 01-Oct-2026\r\nLast Updated,Unique ID,OFSI Group ID,UN Reference Number,Name 6,Name 1,Name 2,Name 3,Name 4,Name 5,Name type\r\n" + filler(60).map((n, i) => `01/09/2026,GBR${i},${i},,${n},,,,,,Primary name`).join("\r\n");
const files = { eu: euCsv, un: unXml, sdn, alt, uk: ukCsv };
let failUn = false;
const fetcher = async url => { if (url.includes("fcdo.gov.uk")) return files.uk; if (url.includes("un.org")) { if (failUn) throw new Error("HTTP 503"); return files.un; } return url.includes("webgate") ? files.eu : url.endsWith("alt.csv") ? files.alt : files.sdn; };

console.log("Lettura delle liste");
let eu = sx.parseEu([euCsv]); assert(eu.some(e => e.name === 'Mario "Il Nero" Rossi' && e.ref === "UE 14")); ok("UE: CSV con ';', virgolette e BOM");
let un = sx.parseUn([unXml]); assert(un.some(e => e.name === "AL & NOOR EXCHANGE COMPANY" && e.ref === "ONU QDe.009")); assert(un.some(e => e.name === "Noor Exchange House")); ok("ONU: entità, persone e alias");
let us = sx.parseOfac([sdn, alt]); assert(us.some(e => e.name === "AEROCARIBBEAN AIRLINES")); assert(us.some(e => e.name === "AERO-CARIBBEAN")); ok("OFAC: nomi e alias");
assert.throws(() => sx.parseEu(["a;b\n1;2"])); ok("formato cambiato: errore esplicito");
assert.deepEqual(sx.nameTokens("Rosneft Trading S.p.A."), ["ROSNEFT"]); assert.deepEqual(sx.nameTokens("Società Cooperativa Àlfa srl"), ["ALFA"]); ok("forme societarie e accenti ignorati");

console.log("Controllo");
let s0 = await sx.screenName(pool, "Qualsiasi Srl"); assert.equal(s0.status, "todo"); ok("liste vuote: serve la verifica manuale");
let r = await sx.refreshSanctionLists(fetcher); assert.deepEqual(r.updated, ["eu", "un", "uk", "us"]); assert.deepEqual(r.errors, []); ok("liste scaricate e salvate");
assert.equal((await sx.screenName(pool, "Alfa Servizi Srl")).status, "ok");
let h = await sx.screenName(pool, "ROSSI MARIO IL NERO"); assert.equal(h.status, "fail"); assert.match(h.detail, /Unione Europea/); ok("stesso nome (ordine diverso): corrispondenza");
h = await sx.screenName(pool, "Al Noor Exchange Company LLC"); assert.equal(h.status, "fail"); assert.match(h.detail, /ONU/); ok("forma societaria diversa: corrispondenza");
h = await sx.screenName(pool, "Aerocaribbean Airlines Italia Srl"); assert.equal(h.status, "warn"); ok("nome in lista contenuto nella ragione sociale: possibile corrispondenza");
h = await sx.screenName(pool, "Rosneft"); assert.equal(h.status, "warn"); ok("una sola parola uguale: da verificare, non bloccante");

console.log("Fornitori");
const z = await register("Noor Exchange House", "noor@f.it", "77777777777", ibanIT("L1234512345123456787777"));
let v = await vendor(buyer, z.id); assert.equal(v.compliance.find(c => c.key === "sanctions").status, "fail"); ok("all'invio il fornitore in lista viene segnalato");
const ok2 = await register("Pulizie Brillanti Srl", "pul@f.it", "88888888888", ibanIT("L1234512345123456788888"));
assert.equal((await vendor(buyer, ok2.id)).compliance.find(c => c.key === "sanctions").status, "ok");
files.eu = files.eu + '\r\n"2026-10-02";"99";"enterprise";"";"Pulizie Brillanti";""'; failUn = true;
r = await sx.refreshSanctionLists(fetcher); assert.deepEqual(r.updated, ["eu", "uk", "us"]); assert.equal(r.errors.length, 1); assert(r.newHits >= 1); ok("ONU non raggiungibile: le altre si aggiornano, la vecchia lista ONU resta");
assert.equal((await pool.query("select count(*)::int n from sanction_entries where source = 'un'")).rows[0].n > 0, true);
v = await vendor(buyer, ok2.id); assert.equal(v.compliance.find(c => c.key === "sanctions").status, "fail"); assert(v.events.some(e => e.action === "Controllo sanzioni: da verificare")); ok("fornitore entrato in lista dopo la registrazione: ricontrollato e segnalato");
const cfg = (await P(admin, "GET", "config")).data.config; assert.equal(cfg.sanctions.provider, "lists"); assert(cfg.sanctions.sources.find(x => x.key === "un").error); ok("stato delle liste in Configurazione");
assert.equal((await P(buyer, "POST", "sanctions-refresh")).status, 403);
files.us = ""; const bad = await sx.refreshSanctionLists(async u => u.includes("treasury") ? "" : fetcher(u)); assert(bad.errors.some(e => /OFAC/.test(e))); assert((await pool.query("select count(*)::int n from sanction_entries where source = 'us'")).rows[0].n > 50); ok("file vuoto: la lista precedente non viene cancellata");
console.log(`\n${passed} controlli superati`); process.exit(0);
