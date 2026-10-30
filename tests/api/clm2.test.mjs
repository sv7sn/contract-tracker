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
const b1 = await mk("buyer@test.it", "Marta Buyer", "buyer");
await mk("buyer2@test.it", "Luca Buyer", "buyer");
const admin = await signin("admin@test.it", "Admin-pass-123!"),
  buyer = await signin("buyer@test.it", "Password-123!"),
  buyer2 = await signin("buyer2@test.it", "Password-123!");
const day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const file = n => {
  const p = `contracts/${globalThis.crypto.randomUUID()}/${n}`;
  blob.store.set(p, Buffer.from("%PDF"));
  return p;
};
const newContract = async (supplier, end, extra = {}) =>
  (
    await call(commitApi, admin, "POST", "", {
      contract: {
        supplier,
        object: "Servizio " + supplier,
        category: "IT",
        country: "Italia",
        value: 50000,
        currency: "EUR",
        start: day(-700),
        end,
        owner: "Marta Buyer",
        boEmail: "",
        renewal: "Non definito",
        type: "Servizi",
        notes: "",
        ceased: false,
        fileName: "c.pdf",
        filePath: file("c.pdf"),
        noticeDays: null,
        noticeDate: "",
        ...extra,
      },
    })
  ).data.contractId;
import zlib from "node:zlib";
const mkDocx = paras => {
  const xml = `<?xml version="1.0"?><w:document xmlns:w="x"><w:body>${paras.map(p => `<w:p><w:r><w:t xml:space="preserve">${p.replace(/&/g, "&amp;")}</w:t></w:r></w:p>`).join("")}</w:body></w:document>`;
  const name = Buffer.from("word/document.xml"),
    raw = Buffer.from(xml),
    comp = zlib.deflateRawSync(raw),
    crc = zlib.crc32(raw);
  const lh = Buffer.alloc(30);
  lh.writeUInt32LE(0x04034b50, 0);
  lh.writeUInt16LE(20, 4);
  lh.writeUInt16LE(8, 8);
  lh.writeUInt32LE(crc, 14);
  lh.writeUInt32LE(comp.length, 18);
  lh.writeUInt32LE(raw.length, 22);
  lh.writeUInt16LE(name.length, 26);
  const cd = Buffer.alloc(46);
  cd.writeUInt32LE(0x02014b50, 0);
  cd.writeUInt16LE(20, 4);
  cd.writeUInt16LE(20, 6);
  cd.writeUInt16LE(8, 10);
  cd.writeUInt32LE(crc, 16);
  cd.writeUInt32LE(comp.length, 20);
  cd.writeUInt32LE(raw.length, 24);
  cd.writeUInt16LE(name.length, 28);
  cd.writeUInt32LE(0, 42);
  const eo = Buffer.alloc(22);
  eo.writeUInt32LE(0x06054b50, 0);
  eo.writeUInt16LE(1, 8);
  eo.writeUInt16LE(1, 10);
  eo.writeUInt32LE(cd.length + name.length, 12);
  eo.writeUInt32LE(30 + name.length + comp.length, 16);
  return Buffer.concat([lh, name, comp, cd, name, eo]);
};
const docxFile = (paras, n = "bozza.docx") => {
  const p = `contracts/${globalThis.crypto.randomUUID()}/${n}`;
  blob.store.set(p, mkDocx(paras));
  return p;
};
await pool.query(
  "insert into buying_companies (code, name, sap_company_code, purch_org) values ('C1','Soc','1000','1000') on conflict do nothing",
);
await pool.query("insert into industry_codes (code, name) values ('I1','Ind') on conflict do nothing");
const demoMod = await import(B + "_demo.js");
const mgr = { id: 1, role: "manager", name: "Admin" };
const SUP = (await demoMod.createDemoSupplier(mgr, { name: "Fornitore Buono Srl" })).id;
const BAD = (await demoMod.createDemoSupplier(mgr, { name: "Fornitore Scaduto Srl" })).id;
await pool.query("delete from supplier_documents where supplier_id = $1", [BAD]);
const lg = await mk("legal@test.it", "Laura Legal", "legal"),
  cmp = await mk("comp@test.it", "Carla Compliance", "compliance"),
  vw = await mk("viewer@test.it", "Vera Viewer", "viewer");
const legal = await signin("legal@test.it", "Password-123!"),
  comp = await signin("comp@test.it", "Password-123!"),
  viewer = await signin("viewer@test.it", "Password-123!");
const clm = await import(B + "_clm.js");
const task = (await P(buyer, "POST", "task-create", { title: "Servizi di manutenzione", kind: "purchase", value: 24000, supplier: "x" }))
  .data.task;
const T = `&id=${task.id}`;
await P(buyer, "POST", "task-supplier", { supplierId: SUP }, T);

// ─── Modelli
let r = await P(buyer, "GET", "draft-templates", undefined, T);
assert.equal(r.status, 200);
assert.deepEqual(
  r.data.templates.map(x => x.code),
  ["NDA", "ADDENDUM", "SERVICES"],
);
const svc = r.data.templates.find(x => x.code === "SERVICES");
const val = k => svc.questions.find(x => x.key === k).value;
assert.equal(val("counterparty"), "Fornitore Buono Srl");
assert.equal(val("value"), "24000");
assert.equal(val("object"), "Servizi di manutenzione");
assert.match(val("startDate"), /^\d{4}-\d{2}-\d{2}$/);
ok("i modelli si precompilano da task e anagrafica fornitore");
assert.equal((await P(viewer, "GET", "draft-templates", undefined, T)).status, 403);
assert.equal((await P(legal, "GET", "draft-templates", undefined, T)).status, 403);
ok("i modelli li usa solo il buyer");

// ─── NDA bilingue a due colonne
const nda = {
  company: "Prometeon Srl",
  counterparty: "Acme SpA",
  purpose: "Valutazione di una fornitura",
  date: day(0),
  termYears: 3,
  governingLaw: "it",
  city: "Milano",
};
assert.equal(
  (await P(buyer, "POST", "draft-from-template", { template: "NDA", langs: ["it", "en"], answers: { company: "X" } }, T)).status,
  400,
);
ok("risposte mancanti: rifiutato con l'elenco");
r = await P(buyer, "POST", "draft-from-template", { template: "NDA", langs: ["it", "en"], answers: nda }, T);
assert.equal(r.status, 201, JSON.stringify(r.data));
let b = r.data;
assert.equal(b.layout.cols, 2);
assert.equal(b.paras.length % 2, 0);
assert.equal(b.generated, true);
assert.match(b.paras[0], /^1\. Parti$/);
assert.match(b.paras[1], /^1\. Parties$/);
assert(b.paras.some(p => /Acme SpA/.test(p)) && b.paras.some(p => /Italian law/.test(p)) && b.paras.some(p => /legge italiana/.test(p)));
assert(!b.paras.some(p => /\{\{/.test(p)));
ok("NDA bilingue: coppie italiano/inglese compilate dalle risposte");
const D1 = b.draftId;
r = await P(buyer, "GET", "draft-file", undefined, `&id=${D1}`);
assert.equal(r.status, 200);
const buf = Buffer.from(await r.res.arrayBuffer());
assert.deepEqual(
  clm.docxParagraphs(buf),
  b.paras.filter(x => x.trim()),
);
ok("il Word generato si apre e contiene lo stesso testo");

// ─── Contratto servizi con sezioni condizionali
const svcAns = {
  company: "Prometeon Srl",
  counterparty: "Fornitore Buono Srl",
  object: "Manutenzione impianti",
  value: 24000,
  currency: "EUR",
  paymentDays: "60",
  startDate: day(0),
  endDate: day(365),
  autoRenew: false,
  penalties: true,
  penaltyPct: 2,
  dataProtection: false,
  governingLaw: "it",
  city: "Torino",
};
r = await P(buyer, "POST", "draft-from-template", { template: "SERVICES", langs: ["it"], answers: svcAns }, T);
b = r.data;
assert.equal(b.layout.cols, 1);
const has = re => b.paras.some(p => re.test(p));
assert(
  has(/Penali/) &&
    !has(/Protezione dei dati/) &&
    !has(/Durata e rinnovo/) &&
    has(/senza rinnovo tacito/) &&
    has(/2% del corrispettivo/) &&
    has(/24\.000 EUR/),
);
ok("sezioni condizionali: penali sì, dati personali no, nessun rinnovo");
const D2 = b.draftId;
r = await P(
  buyer,
  "POST",
  "draft-from-template",
  { template: "SERVICES", langs: ["it"], answers: { ...svcAns, autoRenew: true, penalties: false, dataProtection: true } },
  T,
);
b = r.data;
assert(has(/Durata e rinnovo/) && has(/Protezione dei dati/) && !has(/^\d+\. Penali$/));
assert.equal(b.drafts.length, 3);
ok("rinnovo e protezione dati compaiono quando servono");
const D3 = b.draftId;

// ─── Libreria clausole
r = await P(buyer, "GET", "clauses");
assert.equal(r.status, 200);
assert.equal(r.data.clauses.length, 5);
assert(r.data.clauses.every(c => c.current?.version === 1));
ok("libreria con clausole di partenza già approvate");
assert.equal((await P(viewer, "GET", "clauses")).status, 403);
assert.equal((await P(buyer, "POST", "clause-save", { code: "X1", title: "x", text: { it: "a" } })).status, 403);
ok("il buyer legge la libreria ma non la modifica; il viewer non la vede");
const NEWCONF =
  "Testo NUOVO riservatezza: ciascuna Parte mantiene riservate le informazioni dell'altra per sette anni dalla cessazione del contratto, senza eccezioni diverse dalla legge.";
r = await P(legal, "POST", "clause-save", {
  code: "CONF",
  text: { it: NEWCONF, en: "New confidentiality text for seven years." },
  fallback: { it: NEWCONF, en: "New confidentiality text for seven years." },
  forbidden: "senza obbligo di riservatezza",
});
assert.equal(r.status, 200, JSON.stringify(r.data));
let conf = r.data.clauses.find(c => c.code === "CONF");
assert.equal(conf.versions.length, 2);
assert.equal(conf.current.version, 1);
assert.equal(conf.versions[0].status, "proposed");
ok("una modifica è una versione proposta: lo standard resta il precedente finché non è approvata");
assert.equal((await P(buyer, "POST", "clause-decide", { approve: true }, `&id=${conf.versions[0].id}`)).status, 403);
assert.equal((await P(legal, "POST", "clause-decide", { approve: true }, `&id=${conf.versions[0].id}`)).status, 403);
ok("chi propone non approva: serve un'altra persona (quattro occhi)");
r = await P(admin, "POST", "clause-decide", { approve: true, note: "ok" }, `&id=${conf.versions[0].id}`);
conf = r.data.clauses.find(c => c.code === "CONF");
assert.equal(conf.current.version, 2);
assert.equal(conf.current.approvedBy, "Amministratore");
ok("approvata: diventa lo standard");
assert.equal((await P(legal, "POST", "clause-decide", { approve: true }, `&id=${conf.versions[0].id}`)).status, 400);
ok("una versione già decisa non si decide di nuovo");
assert.equal((await P(legal, "POST", "clause-save", { code: "bad code", title: "x", text: { it: "a" } })).status, 400);
r = await P(legal, "POST", "clause-save", {
  code: "PAYMENT",
  title: "Pagamenti",
  category: "Economico",
  text: { it: "I pagamenti avvengono a sessanta giorni data fattura." },
});
assert(r.data.clauses.some(c => c.code === "PAYMENT" && !c.current));
ok("nuova clausola: nasce proposta, senza standard approvato");

// ─── Il modello usa il testo approvato
await P(buyer, "POST", "draft-from-template", { template: "NDA", langs: ["it"], answers: nda }, T);
r = await P(buyer, "GET", "drafts", undefined, T);
assert(r.data.paras.some(p => p === NEWCONF));
ok("una nuova bozza dal modello usa la clausola approvata più recente");

// ─── Deviazioni dalla libreria
const std = (await P(buyer, "GET", "clauses")).data.clauses.find(c => c.code === "TERMINATION").current;
const lia = (await P(buyer, "GET", "clauses")).data.clauses.find(c => c.code === "LIABILITY").current;
const pre = "Premessa generale del contratto tra le parti per la fornitura di servizi di manutenzione.";
r = await P(
  buyer,
  "POST",
  "draft-upload",
  {
    fileName: "v.docx",
    filePath: docxFile([
      pre,
      std.text.it,
      std.fallback.it.replace("novanta", "ottanta"),
      "Il fornitore assume una responsabilità illimitata per qualsiasi danno derivante dal contratto, senza alcun massimale.",
    ]),
    size: 10,
  },
  T,
);
assert.equal(r.status, 201);
const D4 = r.data.draftId;
r = await P(buyer, "GET", "draft-findings", undefined, T);
const lv = i => r.data.findings.find(f => f.para === i)?.level;
assert.equal(lv(0), undefined);
assert.equal(lv(1), "standard");
assert.equal(lv(2), "deviates");
assert.equal(lv(3), "forbidden");
ok("paragrafi: conforme, si discosta dallo standard, clausola non ammessa");
r = await P(buyer, "POST", "draft-upload", { fileName: "w.docx", filePath: docxFile([pre, std.fallback.it]), size: 10 }, T);
r = await P(buyer, "GET", "draft-findings", undefined, T);
assert.equal(r.data.findings.find(f => f.para === 1).level, "fallback");
ok("il testo di ripiego è riconosciuto come accettabile");

// ─── Blocco firma per clausola non ammessa
r = await P(
  buyer,
  "POST",
  "draft-upload",
  {
    fileName: "v5.docx",
    filePath: docxFile([pre, std.text.it, lia.text.it + " Resta ferma la responsabilità illimitata del fornitore per ogni danno."]),
    size: 10,
  },
  T,
);
await P(buyer, "POST", "draft-invite", { funcs: [{ func: "legal" }] }, T);
await P(legal, "POST", "draft-decide", { decision: "approved" }, T);
r = await P(buyer, "GET", "drafts", undefined, T);
assert.match(r.data.gate, /clausole non ammesse.*LIABILITY/);
ok("pareri tutti positivi, ma una clausola non ammessa blocca ancora la firma");
assert.equal((await P(buyer, "POST", "draft-deviation", { para: 2, code: "LIABILITY", note: "ok" }, T)).status, 403);
ok("il buyer non può accettare la deviazione");
assert.equal((await P(legal, "POST", "draft-deviation", { para: 2, code: "LIABILITY", note: "" }, T)).status, 400);
ok("serve il motivo");
assert.equal((await P(legal, "POST", "draft-deviation", { para: 0, code: "LIABILITY", note: "motivo valido" }, T)).status, 400);
r = await P(legal, "POST", "draft-deviation", { para: 2, code: "LIABILITY", note: "Accettato per questo fornitore strategico" }, T);
assert.equal(r.status, 200);
assert.equal(r.data.accepted.length, 1);
r = await P(buyer, "GET", "drafts", undefined, T);
assert.equal(r.data.gate, null);
ok("accettata dal Legal: via libera");

// ─── Confronto versioni
const A = [
  "Premessa",
  "Il fornitore eroga servizi di assistenza informatica per ventiquattro mesi.",
  "Clausola da togliere interamente dal testo.",
  "Pagamento a trenta giorni data fattura.",
];
const Bv = [
  "Premessa",
  "Il fornitore eroga servizi di assistenza informatica per trentasei mesi.",
  "Pagamento a trenta giorni data fattura.",
  "Nuova clausola aggiunta sul trattamento dei dati.",
];
const va = (await P(buyer, "POST", "draft-upload", { fileName: "a.docx", filePath: docxFile(A), size: 1 }, T)).data.draftId,
  vb = (await P(buyer, "POST", "draft-upload", { fileName: "b.docx", filePath: docxFile(Bv), size: 1 }, T)).data.draftId;
r = await P(buyer, "GET", "draft-diff", undefined, `${T}&from=${va}&to=${vb}`);
assert.equal(r.status, 200);
const kinds = r.data.ops.map(o => o.type);
assert.deepEqual(kinds, ["same", "mod", "del", "same", "add"]);
assert.equal(r.data.modified, 1);
assert.equal(r.data.removed, 1);
assert.equal(r.data.added, 1);
const mod = r.data.ops[1];
assert(mod.words.some(w => w.k === "del" && /ventiquattro/.test(w.t)) && mod.words.some(w => w.k === "add" && /trentasei/.test(w.t)));
ok("confronto: modificato (con le parole cambiate), tolto, invariato, aggiunto");
r = await P(buyer, "GET", "draft-diff", undefined, `${T}&from=${va}&to=${va}`);
assert.equal(
  r.data.ops.every(o => o.type === "same"),
  true,
);
ok("stessa versione: nessuna differenza");
assert.equal((await P(comp, "GET", "draft-diff", undefined, `${T}&from=${va}&to=${vb}`)).status, 404);
assert.equal((await P(viewer, "GET", "draft-diff", undefined, `${T}&from=${va}&to=${vb}`)).status, 403);
ok("il confronto è riservato come la bozza");
assert.equal((await P(buyer, "GET", "draft-diff", undefined, `${T}&from=${va}&to=99999`)).status, 404);

// ─── Registro azioni
r = await P(buyer, "GET", "draft-audit", undefined, T);
assert.equal(r.status, 200);
const acts = r.data.entries.map(e => e.action);
for (const a of ["Bozza creata dal modello", "Bozza caricata", "Funzioni invitate", "Parere", "Deviazione accettata"])
  assert(acts.includes(a), a);
assert(r.data.entries.every(e => e.actor && e.role && e.at));
ok("ogni azione sulla bozza è registrata (chi, quando, che cosa)");
r = await P(buyer, "GET", "draft-audit-export", undefined, T);
assert.equal(r.status, 200);
const csv = await r.res.text();
assert.match(csv, /^Data;Utente;Ruolo;Azione;Dettaglio/);
assert(csv.split("\r\n").length > 8);
ok("registro esportabile in CSV");
assert.equal((await P(legal, "GET", "draft-audit", undefined, T)).status, 403);
assert.equal((await P(buyer2, "GET", "draft-audit", undefined, T)).status, 404);
ok("il registro lo vedono solo buyer del task e Manager");
await P(legal, "GET", "draft-file", undefined, `&id=${va}`);
assert((await P(buyer, "GET", "draft-audit", undefined, T)).data.entries.some(e => e.action === "Bozza scaricata"));
ok("anche gli scarichi sono registrati");
console.log(`\n${passed} controlli superati`);
await pool.end();
