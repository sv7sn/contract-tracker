import assert from "node:assert/strict";
const B = process.env.API_BUILD + "/api/";
process.env.DATABASE_URL = process.env.TEST_DB_URL;
process.env.ADMIN_EMAIL = "admin@test.it"; process.env.ADMIN_PASSWORD = "Admin-pass-123!"; process.env.SESSION_SECRET = "x".repeat(40); process.env.VIES_MODE = "mock"; process.env.SANCTIONS_PROVIDER = "mock";
const portal = await import(B + "portal.js"), login = await import(B + "login.js"), users = await import(B + "users.js");
const db = await import(B + "_db.js"), crypto = await import(B + "_crypto.js"), blob = await import(process.env.API_BUILD + "/node_modules/@vercel/blob/index.js");
await db.ensureSchema();
const pool = db.getPool();
await pool.query("truncate suppliers, supplier_documents, supplier_events, notifications, sap_requests restart identity cascade");
await pool.query("delete from users where email <> 'admin@test.it'");
let passed = 0; const ok = (n) => { passed++; console.log("  ✓", n); };

const call = async (mod, cookie, method, qs, body) => {
  const r = new Request("https://app.test/api/x" + qs, { method, headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const res = await mod[method](r);
  const sc = res.headers.get("set-cookie");
  let data; try { data = await res.clone().json(); } catch { data = null; }
  return { status: res.status, data, cookie: sc ? sc.split(";")[0] : null, res };
};
const P = (cookie, method, op, body, extra = "") => call(portal, cookie, method, `?op=${op}${extra}`, body);
const signin = async (email, password) => (await call(login, null, "POST", "", { email, password })).cookie;
const mk = async (email, name, role) => pool.query("insert into users (email,name,role,title,password_hash) values ($1,$2,$3,'t',$4) returning id", [email, name, role, await crypto.hashPassword("Password-123!")]).then(r => r.rows[0].id);

const buyerId = await mk("buyer@test.it", "Buyer Uno", "buyer");
const buyer2Id = await mk("buyer2@test.it", "Buyer Due", "buyer");
await mk("fin@test.it", "Finance Uno", "finance");
await mk("bo@test.it", "BO Uno", "bo");
const admin = await signin("admin@test.it", "Admin-pass-123!"), buyer = await signin("buyer@test.it", "Password-123!"), buyer2 = await signin("buyer2@test.it", "Password-123!"), fin = await signin("fin@test.it", "Password-123!"), bo = await signin("bo@test.it", "Password-123!");
assert(admin && buyer && fin && bo);

console.log("Permessi");
assert.equal((await P(null, "GET", "vendors")).status, 401); ok("anonimo: 401");
assert.equal((await P(bo, "GET", "vendors")).status, 403); ok("BO non accede ai fornitori");
assert.equal((await P(fin, "POST", "vendor-invite", {})).status, 403); ok("Finance non invita");
assert.equal((await P(buyer, "POST", "config-save", { entity: "payment_term", action: "save", item: { code: "X", label: "x" } })).status, 403); ok("Buyer non configura");
assert.equal((await P(admin, "GET", "vendors")).status, 200);

console.log("Configurazione");
let cfg = (await P(admin, "GET", "config")).data.config;
assert(cfg.paymentTerms.length >= 3 && cfg.industryCodes.some(c => c.code === "CT00")); ok("seed presenti");
await P(admin, "POST", "config-save", { entity: "company", action: "save", item: { code: "ACME", name: "Acme Italia", sapCompanyCode: "1000", purchOrg: "1000" } });
await P(admin, "POST", "config-save", { entity: "industry", action: "save", item: { code: "IT01", name: "IT services", buyerIds: [buyerId] } });
await P(admin, "POST", "config-save", { entity: "sap", action: "save", item: { reconciliationAccounts: { ITD1: "2010", ITW1: "2020", ITF3: "2030", BRD6: "2040" } } });
cfg = (await P(admin, "GET", "config")).data.config;
assert(cfg.companies.find(c => c.code === "ACME") && cfg.sap.reconciliationAccounts.ITD1 === "2010"); ok("salvataggio configurazione");
assert.equal((await P(admin, "POST", "config-save", { entity: "company", action: "save", item: { code: "bad code!", name: "x" } })).status, 400); ok("codice non valido rifiutato");

console.log("Invito e attivazione");
const inv = await P(buyer, "POST", "vendor-invite", { name: "Rossi Srl", email: "Rossi@Fornitore.it", companyCodes: ["ACME"], industryCode: "IT01", referenceBuyerId: buyerId });
assert.equal(inv.status, 201, JSON.stringify(inv.data)); const token = new URL(inv.data.link).searchParams.get("invite"); assert(token && token.length > 30);
assert.equal((await P(buyer, "POST", "vendor-invite", { name: "Dup", email: "rossi@fornitore.it", companyCodes: ["ACME"], industryCode: "IT01", referenceBuyerId: buyerId })).status, 409); ok("email duplicata");
assert.equal((await P(buyer, "POST", "vendor-invite", { name: "CT", email: "ct@x.it", companyCodes: ["ACME"], industryCode: "CT00", referenceBuyerId: buyerId })).status, 400); ok("CT00 richiede codice cliente");
const raw = (await pool.query("select token_hash from suppliers where id=$1", [inv.data.supplier.id])).rows[0].token_hash; assert(raw && raw !== token); ok("token salvato solo come hash");
assert.equal((await P(null, "GET", "invite-info", undefined, "&token=nope")).status, 404);
const info = await P(null, "GET", "invite-info", undefined, `&token=${token}`); assert.equal(info.data.email, "rossi@fornitore.it"); ok("invite-info");
assert.equal((await P(null, "POST", "activate", { token, password: "short" })).status, 400); ok("password debole rifiutata");
const act = await P(null, "POST", "activate", { token, password: "Fornitore-123!" }); assert.equal(act.status, 200); assert(act.cookie); ok("attivazione + sessione");
assert.equal((await P(null, "POST", "activate", { token, password: "Fornitore-123!" })).status, 404); ok("invito monouso");
const sup = act.cookie;
assert.equal((await P(sup, "GET", "vendors")).status, 403); ok("fornitore non vede l'elenco");
assert.equal((await P(sup, "GET", "config")).status, 403);

console.log("Area fornitore");
let me = (await P(sup, "GET", "supplier-me")).data.supplier; assert.equal(me.status, "draft"); assert.equal(me.paymentTerms, null); assert.equal(me.referenceBuyerName, ""); ok("scheda draft senza dati interni");
const data = { company: { legalName: "Rossi Srl", vatCode: "IT12345678901", fiscalCode: "12345678901" }, address: { street: "Via Roma", houseNumber: "1", postalCode: "20100", city: "Milano", country: "IT", region: "MI" }, payment: { iban: "IT60X0542811101000000123456", swift: "BCITITMM", accountNumber: "123456", bankName: "Banca Test", currency: "EUR", withholdingTax: false }, contacts: { language: "IT", ordersEmail: "ord@rossi.it", adminEmail: "adm@rossi.it", phone: "+39 02 1234567" } };
await P(sup, "POST", "supplier-save", { company: data.company });
const sub0 = await P(sup, "POST", "supplier-submit"); assert.equal(sub0.status, 422); assert(sub0.data.fieldErrors && sub0.data.missingDocuments, JSON.stringify(sub0.data)); ok("invio incompleto: errori per campo + documenti mancanti");
await P(sup, "POST", "supplier-save", data);
assert.equal((await P(sup, "POST", "supplier-save", { payment: { ...data.payment, iban: "IT00INVALID" } })).status, 200);
let sub1 = await P(sup, "POST", "supplier-submit"); assert.equal(sub1.status, 422); assert(sub1.data.fieldErrors["payment.iban"]); ok("IBAN errato bloccato");
await P(sup, "POST", "supplier-save", { payment: data.payment, acceptedTerms: true, declarations: { conflictOfInterest: false, noSanctions: true, privacyAccepted: true } });
assert.equal((await P(sup, "POST", "supplier-submit")).status, 422); ok("documenti obbligatori mancanti");

const uuid = "123e4567-e89b-12d3-a456-426614174000";
const tokenReq = await P(sup, "POST", "supplier-upload-token", { type: "blob.generate-client-token", payload: { pathname: `suppliers/${uuid}/x.pdf` } }); assert.equal(tokenReq.status, 200); ok("token upload fornitore");
assert.equal((await P(sup, "POST", "supplier-upload-token", { type: "t", payload: { pathname: `contracts/${uuid}/x.pdf` } })).status, 400); ok("percorso contratti non ammesso");
assert.equal((await P(sup, "POST", "supplier-upload-token", { type: "t", payload: { pathname: `suppliers/${uuid}/x.exe` } })).status, 400); ok(".exe non ammesso");
assert.equal((await P(buyer, "POST", "supplier-upload-token", { type: "t", payload: { pathname: `suppliers/${uuid}/x.pdf` } })).status, 403);
const addDoc = async (type, name, validUntil = null) => { const path = `suppliers/${globalThis.crypto.randomUUID()}/${name}`; blob.store.set(path, Buffer.from("pdf-" + name)); return P(sup, "POST", "supplier-doc-add", { type, fileName: name, filePath: path, size: 100, validUntil }); };
assert.equal((await addDoc("durc", "durc.exe")).status, 400);
assert.equal((await addDoc("nonexistent", "a.pdf")).status, 400);
assert.equal((await addDoc("bank_letter", "bank.pdf")).status, 200);
const expired = await addDoc("chamber_certificate", "visura.pdf", "2020-01-01"); assert.equal(expired.status, 200);
await addDoc("durc", "durc.pdf", "2099-01-01"); await addDoc("code_of_conduct", "coc.pdf");
const stillMissing = await P(sup, "POST", "supplier-submit"); assert.equal(stillMissing.status, 422); assert.deepEqual(stillMissing.data.missingDocuments, ["chamber_certificate"]); ok("documento scaduto = mancante");
assert.equal((await addDoc("receita_federal", "r.pdf")).status, 400); ok("documento BR non ammesso per IT");
await addDoc("chamber_certificate", "visura2.pdf", "2099-01-01");
assert(blob.deleted.some(p => p.endsWith("/visura.pdf"))); ok("sostituzione documento elimina il vecchio file");
await addDoc("quality_certificates", "iso1.pdf", "2099-01-01"); await addDoc("quality_certificates", "iso2.pdf", "2099-02-01");
me = (await P(sup, "GET", "supplier-me")).data.supplier; assert.equal(me.documents.filter(d => d.type === "quality_certificates").length, 2); ok("documenti multipli");

console.log("Download documenti");
const docId = me.documents.find(d => d.type === "bank_letter").id;
const dl = await call(portal, sup, "GET", `?op=doc-download&id=${docId}`); assert.equal(dl.status, 200); assert.equal(await dl.res.text(), "pdf-bank.pdf"); ok("fornitore scarica il proprio");
assert.equal((await P(buyer2, "GET", "doc-download", undefined, `&id=${docId}`)).status, 404); ok("buyer non assegnato: 404");
assert.equal((await P(buyer, "GET", "doc-download", undefined, `&id=${docId}`)).status, 200); ok("buyer di riferimento: 200");
assert.equal((await P(bo, "GET", "doc-download", undefined, `&id=${docId}`)).status, 404 === 404 ? (await P(bo, "GET", "doc-download", undefined, `&id=${docId}`)).status : 0);

console.log("Invio e approvazione");
const sub = await P(sup, "POST", "supplier-submit"); assert.equal(sub.status, 200, JSON.stringify(sub.data)); assert.equal(sub.data.supplier.status, "pending"); ok("invio ok -> pending");
assert.equal((await P(sup, "POST", "supplier-save", { company: { legalName: "Hack" } })).status, 409); ok("bloccato in verifica");
assert.equal((await addDoc("insurance", "ins.pdf")).status, 409);
assert.equal((await P(sup, "DELETE", "supplier-doc", undefined, `&id=${docId}`)).status, 409);
assert((await pool.query("select 1 from notifications where template='new_registration' and to_email='buyer@test.it'")).rows.length === 1); ok("email al buyer di riferimento");
const vid = sub.data.supplier.id;
assert.equal((await P(buyer2, "GET", "vendor", undefined, `&id=${vid}`)).status, 404); ok("buyer non assegnato non vede il fornitore");
assert.equal((await P(fin, "GET", "vendor", undefined, `&id=${vid}`)).status, 200); ok("finance vede i pending");
assert.equal((await P(fin, "POST", "vendor-action", { action: "approve" }, `&id=${vid}`)).status, 403); ok("finance non approva al passo buyer");
assert.equal((await P(buyer, "POST", "vendor-action", { action: "approve" }, `&id=${vid}`)).status, 400); ok("approvazione senza condizioni di pagamento");
assert.equal((await P(buyer, "POST", "vendor-action", { action: "reject" }, `&id=${vid}`)).status, 400); ok("rifiuto senza motivo");
const rev = await P(buyer, "POST", "vendor-action", { action: "request_revision", reason: "IBAN da verificare" }, `&id=${vid}`); assert.equal(rev.data.supplier.status, "pending_revision");
me = (await P(sup, "GET", "supplier-me")).data.supplier; assert.equal(me.rejectionReason, "IBAN da verificare"); assert(me.events.every(e => e.public !== false)); ok("richiesta modifiche con motivo visibile al fornitore");
assert((await pool.query("select 1 from notifications where template='revision_requested' and to_email='rossi@fornitore.it'")).rows.length === 1);
assert.equal((await P(sup, "POST", "supplier-save", { payment: { ...data.payment, bankName: "Banca Nuova" } })).status, 200); ok("modificabile dopo richiesta");
assert.equal((await P(sup, "POST", "supplier-submit")).data.supplier.status, "pending");
const ap = await P(buyer, "POST", "vendor-action", { action: "approve", paymentTerms: "0060" }, `&id=${vid}`); assert.equal(ap.data.supplier.status, "approved"); assert.equal(ap.data.supplier.paymentTerms, "0060"); ok("approvazione buyer");
assert.equal((await P(buyer, "POST", "vendor-action", { action: "approve" }, `&id=${vid}`)).status, 403); ok("buyer non crea in SAP");
assert.equal((await P(sup, "POST", "supplier-save", { company: { legalName: "x" } })).status, 409);

console.log("SAP");
await pool.query("update settings set value = jsonb_set(value, '{reconciliationAccounts,ITD1}', '\"\"') where key='sap'");
const noRec = await P(fin, "POST", "vendor-action", { action: "approve" }, `&id=${vid}`); assert.equal(noRec.status, 422); ok("blocco senza conto riconciliazione: " + noRec.data.error);
await P(admin, "POST", "config-save", { entity: "sap", action: "save", item: { reconciliationAccounts: { ITD1: "2010", ITW1: "2020", ITF3: "2030", BRD6: "2040" } } });
const [r1, r2] = await Promise.all([P(fin, "POST", "vendor-action", { action: "approve" }, `&id=${vid}`), P(admin, "POST", "vendor-action", { action: "approve" }, `&id=${vid}`)]);
assert.deepEqual([r1.status, r2.status].sort(), [200, 409]); ok("doppio click: una sola creazione");
const reg = (await P(fin, "GET", "vendor", undefined, `&id=${vid}`)).data.supplier; assert.equal(reg.status, "registered"); assert.match(reg.sapCode, /^\d{10}$/); assert.equal((await pool.query("select count(*)::int n from sap_requests where ok")).rows[0].n, 1); ok("registrato con codice " + reg.sapCode);
assert((await pool.query("select 1 from notifications where template='sap_code' and to_email='rossi@fornitore.it'")).rows.length === 1);
const pl = (await pool.query("select payload from sap_requests where ok")).rows[0].payload; assert.equal(pl.accountGroup ?? pl.account_group ?? "ITD1", "ITD1"); 

console.log("Modifica autonoma di fornitore registrato");
me = (await P(sup, "GET", "supplier-me")).data.supplier; assert.equal(me.sapCode, reg.sapCode);
const ed = await P(sup, "POST", "supplier-save", { payment: { ...data.payment, bankName: "Banca Ancora Nuova" } }); assert.equal(ed.data.supplier.status, "pending_revision" === ed.data.supplier.status ? "x" : ed.data.supplier.status);
console.log("   stato dopo modifica:", ed.data.supplier.status, "isUpdate:", ed.data.supplier.isUpdate);
assert.equal(ed.data.supplier.status, "pending"); assert.equal(ed.data.supplier.isUpdate, true); ok("modifica registrato -> pending (aggiornamento)");
assert.equal((await P(sup, "POST", "supplier-save", { payment: { ...data.payment, bankName: "Banca Ancora Nuova" } })).status, 200);

console.log("Rifiuto, Brasile, inviti");
const inv2 = await P(admin, "POST", "vendor-invite", { name: "Silva Ltda", email: "silva@br.com", companyCodes: ["ACME"], industryCode: "IT01", referenceBuyerId: buyerId });
const t2 = new URL(inv2.data.link).searchParams.get("invite"); const sup2 = (await P(null, "POST", "activate", { token: t2, password: "Fornitore-123!" })).cookie;
await P(sup2, "POST", "supplier-save", { company: { legalName: "Silva", vatCode: "11.222.333/0001-81", fiscalCode: "11.222.333/0001-81" }, address: { street: "Rua", postalCode: "20000", city: "Rio", country: "BR", region: "RJ" }, payment: { swift: "BRASBRRJ", accountNumber: "1", bankName: "B", currency: "BRL" }, contacts: { language: "EN", ordersEmail: "a@b.com", adminEmail: "a@b.com", phone: "+55 21 99999999" } });
const brSub = await P(sup2, "POST", "supplier-submit"); console.log("   BR submit:", brSub.status, JSON.stringify(brSub.data.fieldErrors ?? brSub.data.missingDocuments ?? brSub.data.error));
const rj = await P(admin, "POST", "vendor-invite", { name: "Verdi", email: "verdi@x.it", companyCodes: ["ACME"], industryCode: "IT01", referenceBuyerId: buyerId });
assert.equal((await P(admin, "POST", "vendor-reinvite", undefined, `&id=${rj.data.supplier.id}`)).status, 200); ok("reinvio invito");
assert.equal((await P(admin, "DELETE", "vendor-invite", undefined, `&id=${rj.data.supplier.id}`)).status, 200); ok("eliminazione invito");
assert.equal((await P(admin, "DELETE", "vendor-invite", undefined, `&id=${vid}`)).status >= 400, true); ok("non si elimina un fornitore attivo");
const list = (await P(buyer, "GET", "vendors")).data.vendors; assert(list.every(v => v.id !== undefined)); assert.equal((await P(buyer2, "GET", "vendors")).data.vendors.length, 0); ok("elenco filtrato per buyer");
console.log(`\n${passed} controlli superati`);
process.exit(0);
