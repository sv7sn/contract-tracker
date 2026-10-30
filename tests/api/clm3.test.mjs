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
const lg = await mk("legal@test.it", "Laura Legal", "legal"),
  cmp = await mk("comp@test.it", "Carla Compliance", "compliance"),
  vw = await mk("viewer@test.it", "Vera Viewer", "viewer");
const legal = await signin("legal@test.it", "Password-123!"),
  comp = await signin("comp@test.it", "Password-123!"),
  viewer = await signin("viewer@test.it", "Password-123!");
const tasks = async c => (await P(c, "GET", "tasks")).data.tasks.filter(t => t.source === "contract");
const notes = async (tpl, to) =>
  (await pool.query("select body from notifications where template = $1 and to_email = $2 order by id desc", [tpl, to])).rows.map(
    r => r.body,
  );

// ─── Regole su chi rivede
let r = await P(admin, "GET", "review-rules");
assert.equal(r.status, 200);
assert.deepEqual(
  r.data.rules.map(x => x.func),
  ["legal", "compliance", "itsec"],
);
ok("regole di partenza: Legal sempre, Compliance sopra 50.000, IT Security con dati personali");
assert.equal((await P(buyer, "GET", "review-rules")).status, 403);
assert.equal((await P(viewer, "GET", "review-rules")).status, 403);
ok("le regole le gestisce solo il Manager");
assert.equal((await P(admin, "POST", "review-rule-save", { func: "requester" })).status, 400);
assert.equal((await P(admin, "POST", "review-rule-save", { func: "legal", countries: "Brasile" })).status, 400);
ok("regola non valida: rifiutata");
r = await P(admin, "POST", "review-rule-save", { func: "compliance", countries: "BR, CN", label: "Compliance per paesi a rischio" });
assert.equal(r.data.rules.length, 4);
const extra = r.data.rules[3].id;
r = await P(admin, "POST", "review-rule-delete", {}, `&id=${extra}`);
assert.equal(r.data.rules.length, 3);
ok("il Manager aggiunge e toglie regole");

// ─── Invito automatico e blocco
const big = (await P(buyer, "POST", "task-create", { title: "Fornitura grande", kind: "purchase", value: 80000, supplier: "x" })).data.task;
const TB = `&id=${big.id}`;
await P(buyer, "POST", "task-supplier", { supplierId: SUP }, TB);
r = await P(
  buyer,
  "POST",
  "draft-upload",
  { fileName: "g.docx", filePath: docxFile(["Premessa del contratto tra le parti per la fornitura."]), size: 5 },
  TB,
);
assert.equal(r.status, 201);
assert.deepEqual(r.data.reviews.map(x => x.func).sort(), ["compliance", "legal"]);
assert.equal(r.data.required.length, 2);
assert(r.data.required.every(x => x.invited));
ok("sopra 50.000 la bozza invita da sola Legal e Compliance, non IT Security");
assert.equal((await notes("review_invite", "legal@test.it")).length, 1);
assert.match((await notes("review_invite", "legal@test.it"))[0], /\/\?review=\d+/);
ok("email di invito con link diretto alla revisione");
const small = (await P(buyer, "POST", "task-create", { title: "Fornitura piccola", kind: "purchase", value: 3000, supplier: "x" })).data
  .task;
const TS = `&id=${small.id}`;
await P(buyer, "POST", "task-supplier", { supplierId: SUP }, TS);
r = await P(
  buyer,
  "POST",
  "draft-upload",
  { fileName: "s.docx", filePath: docxFile(["Premessa breve del contratto tra le parti."]), size: 5 },
  TS,
);
assert.deepEqual(
  r.data.reviews.map(x => x.func),
  ["legal"],
);
ok("sotto soglia: solo Legal");

// ─── Dati personali: IT Security richiesta, ma senza utenti il blocco lo dice
const svc = {
  company: "Prometeon Srl",
  counterparty: "Fornitore Buono Srl",
  object: "Servizi cloud",
  value: 3000,
  currency: "EUR",
  paymentDays: "60",
  startDate: day(0),
  endDate: day(365),
  autoRenew: false,
  penalties: false,
  dataProtection: true,
  governingLaw: "it",
  city: "Torino",
};
r = await P(buyer, "POST", "draft-from-template", { template: "SERVICES", langs: ["it"], answers: svc }, TS);
assert.equal(r.status, 201, JSON.stringify(r.data));
assert(r.data.required.some(x => x.func === "itsec" && !x.invited));
assert(!r.data.reviews.some(x => x.func === "itsec"));
assert.match(r.data.gate, /manca la revisione di IT Security/);
ok("dati personali: IT Security è richiesta; senza utenti con quel ruolo il blocco lo segnala");
const its = await mk("it@test.it", "Ivo ITSec", "itsec");
const itsec = await signin("it@test.it", "Password-123!");
r = await P(buyer, "POST", "draft-invite", { funcs: [{ func: "itsec" }] }, TS);
assert.equal(r.status, 200);
assert(r.data.reviews.some(x => x.func === "itsec"));
ok("creato l'utente, il buyer invita IT Security");
await P(legal, "POST", "draft-decide", { decision: "approved" }, TS);
await P(itsec, "POST", "draft-decide", { decision: "approved" }, TS);
r = await P(buyer, "GET", "drafts", undefined, TS);
assert.equal(r.data.gate, null);
ok("tutte le funzioni richieste approvano: via libera");

// ─── Fornitore non qualificato
await pool.query("delete from supplier_documents where supplier_id = $1", [SUP]);
r = await P(buyer, "GET", "drafts", undefined, TS);
assert.match(r.data.gate, /fornitore.*non è attivo e qualificato/);
ok("fornitore con documenti scaduti: firma bloccata anche con tutti i pareri");
assert.equal((await P(buyer, "POST", "task-links", { contractStatus: "signed" }, TS)).status, 409);

// ─── Rinnovi e addendum
const cX = await newContract("Zeta Srl", day(60));
const tX = (await tasks(buyer)).find(t => t.title.includes("Zeta"));
const TX = `&id=${tX.id}`;
r = await P(buyer, "GET", "draft-templates", undefined, TX);
assert.equal(r.status, 200);
const add = r.data.templates.find(x => x.code === "ADDENDUM");
const av = k => add.questions.find(x => x.key === k).value;
assert.equal(av("counterparty"), "Zeta Srl");
assert.match(av("originalObject"), /Zeta/);
assert.equal(av("originalEnd"), day(60));
ok("rinnovo: l'addendum si precompila dal contratto esistente");
assert.equal(
  (await P(buyer, "POST", "draft-from-template", { template: "ADDENDUM", langs: ["it"], answers: { company: "Prometeon Srl" } }, TX))
    .status,
  400,
);
r = await P(
  buyer,
  "POST",
  "draft-from-template",
  {
    template: "ADDENDUM",
    langs: ["it", "en"],
    answers: {
      company: "Prometeon Srl",
      counterparty: "Zeta Srl",
      originalObject: "Servizio Zeta Srl",
      originalEnd: day(60),
      newEnd: day(425),
      date: day(0),
      priceNote: "aumento del 3% (indicizzazione)",
    },
  },
  TX,
);
assert.equal(r.status, 201, JSON.stringify(r.data));
assert(
  r.data.paras.some(p => /prorogata fino al/.test(p)) &&
    r.data.paras.some(p => /extended until/.test(p)) &&
    r.data.paras.some(p => /aumento del 3%/.test(p)),
);
ok("addendum bilingue con la variazione di prezzo quando indicata");
r = await P(
  buyer,
  "POST",
  "task-outcome",
  { outcome: "extended", end: day(425), document: { fileName: "addendum.pdf", filePath: file("addendum.pdf"), size: 10 } },
  TX,
);
assert.equal(r.status, 409);
assert.match(r.data.error, /Firma bloccata/);
ok("proroga con addendum in revisione: registrazione bloccata");
await P(legal, "POST", "draft-decide", { decision: "approved" }, TX);
r = await P(
  buyer,
  "POST",
  "task-outcome",
  { outcome: "extended", end: day(425), document: { fileName: "addendum.pdf", filePath: file("addendum.pdf"), size: 10 } },
  TX,
);
assert.equal(r.status, 409);
assert.match(r.data.error, /Compliance/);
ok("Legal ha approvato ma il valore (50.000) richiede anche Compliance: ancora bloccato");
await P(comp, "POST", "draft-decide", { decision: "approved" }, TX);
r = await P(
  buyer,
  "POST",
  "task-outcome",
  { outcome: "extended", end: day(425), document: { fileName: "addendum.pdf", filePath: file("addendum.pdf"), size: 10 } },
  TX,
);
assert.equal(r.status, 200, JSON.stringify(r.data));
ok("approvato dal Legal: la proroga si registra");

// ─── Link nelle email e indicatori
assert((await notes("review_decided", "buyer@test.it")).every(b => /\/\?task=\d+/.test(b)));
ok("l'esito al buyer porta direttamente al task");
r = await P(admin, "GET", "clm-kpis");
assert.equal(r.status, 200);
assert.equal(r.data.funcs.length, 4);
const lf = r.data.funcs.find(f => f.func === "legal");
assert(lf.decided >= 2 && lf.pending >= 1 && lf.avgDays !== null);
assert(r.data.drafts >= 3 && r.data.avgVersions >= 1);
ok("indicatori: decisioni, tempo medio e scadenze per funzione");
assert.equal((await P(viewer, "GET", "clm-kpis")).status, 403);
assert.equal((await P(buyer, "GET", "clm-kpis")).status, 403);
assert.equal((await P(legal, "GET", "clm-kpis")).status, 403);
ok("gli indicatori li vede solo il Manager");
console.log(`\n${passed} controlli superati`);
await pool.end();
