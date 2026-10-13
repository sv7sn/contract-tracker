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
import zlib from "node:zlib";
const mkDocx = paras => {
  const xml = `<?xml version="1.0"?><w:document xmlns:w="x"><w:body>${paras.map(p => `<w:p><w:r><w:t xml:space="preserve">${p.replace(/&/g, "&amp;")}</w:t></w:r></w:p>`).join("")}</w:body></w:document>`;
  const name = Buffer.from("word/document.xml"), raw = Buffer.from(xml), comp = zlib.deflateRawSync(raw), crc = zlib.crc32(raw);
  const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(name.length, 26);
  const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(8, 10); cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(comp.length, 20); cd.writeUInt32LE(raw.length, 24); cd.writeUInt16LE(name.length, 28); cd.writeUInt32LE(0, 42);
  const eo = Buffer.alloc(22); eo.writeUInt32LE(0x06054b50, 0); eo.writeUInt16LE(1, 8); eo.writeUInt16LE(1, 10); eo.writeUInt32LE(cd.length + name.length, 12); eo.writeUInt32LE(30 + name.length + comp.length, 16);
  return Buffer.concat([lh, name, comp, cd, name, eo]);
};
const docxFile = (paras, n = "bozza.docx") => { const p = `contracts/${globalThis.crypto.randomUUID()}/${n}`; blob.store.set(p, mkDocx(paras)); return p; };
await pool.query("insert into buying_companies (code, name, sap_company_code, purch_org) values ('C1','Soc','1000','1000') on conflict do nothing"); await pool.query("insert into industry_codes (code, name) values ('I1','Ind') on conflict do nothing");
const demoMod = await import(B + "_demo.js");
const mgr = { id: 1, role: "manager", name: "Admin" };
const sA = await demoMod.createDemoSupplier(mgr, { name: "Fornitore Buono Srl" }), sB = await demoMod.createDemoSupplier(mgr, { name: "Altro Fornitore Srl" });
const SUP = sA.id;
const lg = await mk("legal@test.it", "Laura Legal", "legal"), vw = await mk("viewer@test.it", "Vera Viewer", "viewer"), bo = await mk("bo@test.it", "Bruno BO", "bo");
const legal = await signin("legal@test.it", "Password-123!"), viewer = await signin("viewer@test.it", "Password-123!"), boC = await signin("bo@test.it", "Password-123!");
const supA = await signin(sA.email, sA.password), supB = await signin(sB.email, sB.password);
const mails = async (tpl, to) => (await pool.query("select body from notifications where template = $1 and to_email = $2", [tpl, to])).rows;

const task = (await P(buyer, "POST", "task-create", { title: "RDA 9001 · manutenzione riservata", kind: "purchase", value: 20000, supplier: "x" })).data.task; const T = `&id=${task.id}`;
const paras = ["1. Oggetto", "Il fornitore eroga servizi di manutenzione.", "2. Corrispettivo", "Il corrispettivo annuo è di ventimila euro."];
let r = await P(buyer, "POST", "draft-upload", { fileName: "contratto manutenzione.docx", filePath: docxFile(paras), size: 9 }, T); assert.equal(r.status, 201);
const D1 = r.data.draftId;

// ─── Condivisione
r = await P(buyer, "POST", "draft-share", { draftId: D1 }, T); assert.equal(r.status, 400); assert.match(r.data.error, /fornitore/i); ok("senza fornitore scelto non si condivide");
await P(buyer, "POST", "task-supplier", { supplierId: SUP }, T);
r = await P(buyer, "POST", "draft-share", { draftId: D1 }, T); assert.equal(r.status, 409); assert.match(r.data.error, /Legal/); ok("testo non ancora approvato internamente: non si condivide");
await P(legal, "POST", "draft-comment", { para: 3, quote: "ventimila", start: 31, end: 40, body: "COMMENTO INTERNO RISERVATO: il budget massimo è 25.000" }, T);
await P(legal, "POST", "draft-decide", { decision: "approved" }, T);
r = await P(buyer, "POST", "draft-share", { draftId: D1, message: "Ecco la nostra bozza" }, T); assert.equal(r.status, 200, JSON.stringify(r.data)); assert(r.data.drafts[0].sharedAt); ok("approvata dal Legal: il buyer la condivide con il fornitore");
assert.equal((await mails("negotiation_shared", sA.email)).length, 1); ok("il fornitore riceve l'email");

// ─── Il fornitore vede solo ciò che gli è stato condiviso
r = await P(supA, "GET", "supplier-negotiations"); assert.equal(r.data.negotiations.length, 1); assert.equal(r.data.negotiations[0].taskId, task.id); assert.equal(r.data.negotiations[0].title, "contratto manutenzione"); ok("il fornitore vede la trattativa con un titolo neutro (non quello interno)");
r = await P(supA, "GET", "supplier-negotiation", undefined, T); assert.equal(r.status, 200); assert.deepEqual(r.data.paras, paras);
assert.deepEqual(Object.keys(r.data).sort(), ["comments", "draftId", "drafts", "layout", "paras", "title"]); assert.equal(r.data.comments.length, 0); assert(!JSON.stringify(r.data).includes("RISERVATO")); assert(!JSON.stringify(r.data).includes("RDA 9001")); ok("il fornitore non vede commenti interni, pareri, regole né il titolo interno");
assert.equal((await P(supB, "GET", "supplier-negotiations")).data.negotiations.length, 0); assert.equal((await P(supB, "GET", "supplier-negotiation", undefined, T)).status, 404); ok("un altro fornitore non vede niente");
for (const [n, c] of [["viewer", viewer], ["legal", legal], ["bo", boC], ["buyer", buyer]]) assert.equal((await P(c, "GET", "supplier-negotiations")).status, 403, n); ok("l'area è solo dei fornitori");

// ─── Commenti separati
r = await P(buyer, "POST", "draft-comment", { body: "Possiamo discutere i tempi", external: true, draftId: D1 }, T); assert.equal(r.status, 200); assert(r.data.comments.some(c => c.external && c.body.includes("tempi")));
r = await P(supA, "GET", "supplier-negotiation", undefined, T); assert.equal(r.data.comments.length, 1); assert.equal(r.data.comments[0].author, "Ufficio acquisti"); ok("il commento esterno del buyer è visibile al fornitore, senza il nome del buyer");
assert.equal((await P(legal, "POST", "draft-comment", { body: "x", external: true, draftId: D1 }, T)).status, 403); ok("solo il buyer scrive al fornitore");
r = await P(supA, "POST", "supplier-negotiation-comment", { draftId: D1, para: 3, start: 31, end: 40, quote: "ventimila", body: "Chiediamo 22.000 euro" }, T); assert.equal(r.status, 200); assert.equal(r.data.comments.length, 2);
r = await P(buyer, "GET", "drafts", undefined, T); const sc = r.data.comments.find(c => c.func === "supplier"); assert(sc && sc.external && sc.para === 3); assert(r.data.comments.some(c => !c.external && /RISERVATO/.test(c.body))); ok("il buyer vede il commento del fornitore ancorato al testo, distinto da quelli interni");
assert((await mails("negotiation_reply", "buyer@test.it")).some(m => /\/\?task=\d+/.test(m.body))); ok("il buyer riceve l'avviso con il link al task");
assert.equal((await P(supB, "POST", "supplier-negotiation-comment", { draftId: D1, body: "intruso" }, T)).status, 404); assert.equal((await P(supA, "POST", "supplier-negotiation-comment", { draftId: D1, body: "" }, T)).status, 400);
r = await P(supA, "POST", "supplier-negotiation-comment", { draftId: D1, body: "Grazie", parentId: sc.id }, T); assert.equal(r.status, 200);
// un commento interno non si può usare come padre
const internalId = (await P(buyer, "GET", "drafts", undefined, T)).data.comments.find(c => !c.external).id; assert.equal((await P(supA, "POST", "supplier-negotiation-comment", { draftId: D1, body: "x", parentId: internalId }, T)).status, 400); ok("il fornitore non può agganciarsi a commenti interni");

// ─── Controproposta
const theirs = ["1. Oggetto", "Il fornitore eroga servizi di manutenzione.", "2. Corrispettivo", "Il corrispettivo annuo è di ventiduemila euro."];
const upPath = `suppliers/${globalThis.crypto.randomUUID()}/nostra-versione.docx`; blob.store.set(upPath, mkDocx(theirs));
assert.equal((await P(supA, "POST", "supplier-negotiation-upload", { fileName: "x.docx", filePath: file("x.docx"), size: 3 }, T)).status, 400); ok("percorso non del fornitore: rifiutato");
r = await P(supA, "POST", "supplier-negotiation-upload", { fileName: "nostra-versione.docx", filePath: upPath, size: 12 }, T); assert.equal(r.status, 201, JSON.stringify(r.data)); const V2 = r.data.draftId; assert.equal(r.data.drafts[0].origin, "supplier"); assert.equal(r.data.drafts[0].version, 2); ok("il fornitore carica la sua versione (numerata di seguito)");
r = await P(buyer, "GET", "drafts", undefined, T); assert.equal(r.data.drafts.length, 2); assert.equal(r.data.latestId, D1); assert.equal(r.data.reviews.length, 1); assert.equal(r.data.reviews[0].status, "approved"); ok("la versione del fornitore non azzera i pareri interni");
r = await P(buyer, "GET", "draft-diff", undefined, `${T}&from=${D1}&to=${V2}`); assert.equal(r.data.modified, 1); assert(r.data.ops.find(o => o.type === "mod").words.some(w => w.k === "add" && /ventiduemila/.test(w.t))); ok("il buyer confronta la proposta del fornitore con la nostra");
assert.equal((await P(buyer, "GET", "drafts", undefined, T)).data.gate, null);
r = await P(supA, "GET", "supplier-negotiation-file", undefined, `&id=${V2}`); assert.equal(r.status, 200); ok("il fornitore scarica i file condivisi");
assert.equal((await P(supB, "GET", "supplier-negotiation-file", undefined, `&id=${D1}`)).status, 404);

// ─── Nuova versione interna e ritiro
r = await P(buyer, "POST", "draft-upload", { fileName: "v3.docx", filePath: docxFile([...paras, "3. Durata", "Il contratto dura dodici mesi."]), size: 9 }, T); const D3 = r.data.draftId; assert.equal(r.data.drafts[0].version, 3);
r = await P(buyer, "POST", "draft-share", { draftId: D1 }, T); assert.equal(r.status, 400); assert.match(r.data.error, /ultima/); ok("si condivide solo l'ultima versione interna");
r = await P(buyer, "POST", "draft-share", { draftId: D3 }, T); assert.equal(r.status, 409); ok("la nuova versione deve prima essere riapprovata");
await P(legal, "POST", "draft-decide", { decision: "approved" }, T); r = await P(buyer, "POST", "draft-share", { draftId: D3 }, T); assert.equal(r.status, 200);
assert.equal((await P(supA, "GET", "supplier-negotiation", undefined, T)).data.drafts.length, 3); ok("v3 approvata e condivisa");
r = await P(buyer, "POST", "draft-share", { draftId: D3, share: false }, T); assert.equal(r.status, 200); r = await P(supA, "GET", "supplier-negotiation", undefined, `${T}&draft=${D3}`); assert.equal(r.status, 404); ok("ritirata: il fornitore non la vede più");
await pool.query("update contract_drafts set shared_at = null where task_id = $1", [task.id]); assert.equal((await P(supA, "GET", "supplier-negotiations")).data.negotiations.length, 0);
r = await P(buyer, "POST", "draft-comment", { body: "x", external: true }, T); assert.equal(r.status, 400); ok("senza versione condivisa non si scrive al fornitore");
r = await P(buyer, "GET", "draft-audit", undefined, T); const acts = r.data.entries.map(e => e.action); for (const a of ["Bozza condivisa con il fornitore", "Commento del fornitore", "Controproposta del fornitore", "Condivisione ritirata"]) assert(acts.includes(a), a); ok("la trattativa è nel registro azioni");

// ─── Obblighi contrattuali
const cX = await newContract("Obblighi Srl", day(300)); await pool.query("update contracts set owner_id = $1 where id = $2", [b1, cX]);
r = await P(buyer, "POST", "obligation-save", { title: "x", due: day(3) }, `&id=${cX}`); assert.equal(r.status, 400);
r = await P(buyer, "POST", "obligation-save", { title: "Consegna report trimestrale", kind: "deliverable", due: day(3), owner: "Operations", repeatMonths: 3 }, `&id=${cX}`); assert.equal(r.status, 200); assert.equal(r.data.obligations.length, 1);
r = await P(buyer, "POST", "obligation-save", { title: "Revisione prezzi ISTAT", kind: "indexation", due: day(100) }, `&id=${cX}`); assert.equal(r.data.obligations.length, 2); ok("il buyer registra gli obblighi del contratto");
assert.equal((await P(viewer, "GET", "obligations", undefined, `&id=${cX}`)).status, 403); assert.equal((await P(buyer2, "GET", "obligations", undefined, `&id=${cX}`)).status, 404); assert.equal((await P(buyer2, "POST", "obligation-save", { title: "intruso", due: day(1) }, `&id=${cX}`)).status, 404); ok("obblighi riservati a chi vede il contratto");
r = await P(buyer, "GET", "my-work"); const od = r.data.items.find(i => i.kind === "obligation_due"); assert(od && /Consegna report/.test(od.title) && /tra 3 giorni/.test(od.detail)); assert(!r.data.items.some(i => /ISTAT/.test(i.title))); ok("in 'Il mio lavoro' compaiono solo gli obblighi in scadenza entro 7 giorni");
assert(!(await P(buyer2, "GET", "my-work")).data.items.some(i => i.kind === "obligation_due")); 
const oid = (await P(buyer, "GET", "obligations", undefined, `&id=${cX}`)).data.obligations[0].id;
r = await P(buyer, "POST", "obligation-done", {}, `&id=${oid}`); assert.equal(r.data.obligations.length, 3); assert.equal(r.data.obligations.filter(o => o.status === "open").length, 2); assert(r.data.obligations.some(o => o.status === "open" && o.title.includes("Consegna report") && o.due > day(80))); ok("completare un obbligo periodico crea il successivo a 3 mesi");
assert.equal((await P(buyer, "POST", "obligation-done", {}, `&id=${oid}`)).status, 400);
r = await P(buyer, "POST", "obligation-delete", {}, `&id=${r.data.obligations.find(o => o.status === "open").id}`); assert.equal(r.status, 200);

// ─── Spesa vicina al valore del contratto
const cY = await newContract("Fornitore Buono Srl", day(300), { value: 100000 }); await pool.query("update contracts set owner_id = $1, supplier_id = $2, start_date = $3 where id = $4", [b1, SUP, day(-100), cY]);
const code = (await pool.query("select sap_code from suppliers where id = $1", [SUP])).rows[0].sap_code;
const po = (n, v) => pool.query("insert into po_lines (po, item, doc_date, supplier_code, value) values ($1,'10',$2,$3,$4)", [n, day(-10), code, v]);
await po("4500000001", 60000); r = await P(buyer, "GET", "my-work"); assert(!r.data.items.some(i => i.kind === "contract_cap")); 
await po("4500000002", 25000); r = await P(buyer, "GET", "my-work"); let cap = r.data.items.find(i => i.kind === "contract_cap"); assert(cap && /85%/.test(cap.detail) && cap.urgency === 1); ok("spesa SAP all'85% del valore: avviso da seguire");
await po("4500000003", 20000); cap = (await P(buyer, "GET", "my-work")).data.items.find(i => i.kind === "contract_cap"); assert(/105%/.test(cap.detail) && cap.urgency === 2); ok("oltre il 100%: avviso più urgente");
assert(!(await P(buyer2, "GET", "my-work")).data.items.some(i => i.kind === "contract_cap")); ok("e solo per il buyer del contratto");
console.log(`\n${passed} controlli superati`); await pool.end();
