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
const lg = await mk("legal@test.it", "Laura Legal", "legal"),
  lg2 = await mk("legal2@test.it", "Luigi Legal", "legal"),
  cmp = await mk("comp@test.it", "Carla Compliance", "compliance"),
  its = await mk("it@test.it", "Ivo ITSec", "itsec");
const bo = await mk("bo@test.it", "Bruno BO", "bo"),
  bo2 = await mk("bo2@test.it", "Altro BO", "bo"),
  vw = await mk("viewer@test.it", "Vera Viewer", "viewer");
const legal = await signin("legal@test.it", "Password-123!"),
  legal2 = await signin("legal2@test.it", "Password-123!"),
  comp = await signin("comp@test.it", "Password-123!"),
  itsec = await signin("it@test.it", "Password-123!");
const boC = await signin("bo@test.it", "Password-123!"),
  bo2C = await signin("bo2@test.it", "Password-123!"),
  viewer = await signin("viewer@test.it", "Password-123!");
ok("nuovi ruoli legal/compliance/itsec: utenti creati e accesso");

const task = (await P(buyer, "POST", "task-create", { title: "Contratto servizi IT", kind: "purchase", value: 20000, supplier: "x" })).data
  .task;
const T = `&id=${task.id}`;
const paras = [
  "1. Oggetto del contratto",
  "Il fornitore eroga servizi di assistenza.",
  "2. Penali e responsabilità",
  "Le penali sono pari al 10% del corrispettivo.",
];

// ─── Caricamento e testo
let r = await P(buyer, "POST", "draft-upload", { fileName: "bozza.txt", filePath: file("bozza.txt"), size: 4 }, T);
assert.equal(r.status, 400);
ok("solo Word o PDF");
r = await P(buyer, "POST", "draft-upload", { fileName: "bozza.docx", filePath: docxFile(paras), size: 900, note: "Prima bozza" }, T);
assert.equal(r.status, 201, JSON.stringify(r.data));
assert.equal(r.data.drafts.length, 1);
assert.equal(r.data.drafts[0].version, 1);
assert.deepEqual(r.data.paras, paras);
ok("bozza v1 caricata: testo estratto dal Word");
const D1 = r.data.draftId;
assert.equal((await P(buyer2, "GET", "drafts", undefined, T)).status, 404);
ok("un altro buyer non vede la bozza");

// ─── Riservatezza
for (const [n, c] of [
  ["viewer (Controlling/CFO)", viewer],
  ["Compliance non invitata", comp],
  ["BO non invitato", boC],
])
  assert.ok([403, 404].includes((await P(c, "GET", "drafts", undefined, T)).status), n);
assert.equal((await P(admin, "GET", "drafts", undefined, T)).status, 200);
ok("bozza riservata: non la vedono Controlling/CFO né funzioni non invitate; il Manager sì");

// ─── Blocco firma senza revisioni
await P(buyer, "POST", "task-doc", { kind: "contract", fileName: "c.pdf", filePath: file("c.pdf"), size: 4 }, T);
r = await P(buyer, "POST", "task-links", { contractStatus: "signed" }, T);
assert.equal(r.status, 409);
assert.match(r.data.error, /Legal non ha ancora approvato/);
ok("firma bloccata: Legal è richiesto dalle regole, invitato da solo, e non ha ancora approvato");

// ─── Inviti
assert.equal((await P(buyer, "POST", "draft-invite", { funcs: [] }, T)).status, 400);
assert.equal((await P(buyer, "POST", "draft-invite", { funcs: [{ func: "requester" }] }, T)).status, 400);
ok("richiedente senza persona: rifiutato");
r = await P(
  buyer,
  "POST",
  "draft-invite",
  {
    funcs: [{ func: "requester", userId: bo }, { func: "legal" }, { func: "compliance" }, { func: "itsec" }],
    message: "Controllate penali",
  },
  T,
);
assert.equal(r.status, 200, JSON.stringify(r.data));
assert.equal(r.data.reviews.length, 4);
assert(r.data.reviews.every(x => x.status === "pending" && x.due));
ok("invitate 4 funzioni, con scadenza derivata dallo SLA");
const mails = (await pool.query("select to_email from notifications where template = 'review_invite'")).rows.map(x => x.to_email).sort();
assert.deepEqual(mails, ["bo@test.it", "comp@test.it", "it@test.it", "legal2@test.it", "legal@test.it"]);
ok("email a tutti gli utenti della funzione e al richiedente scelto");
assert.equal((await P(bo2C, "GET", "drafts", undefined, T)).status, 404);
ok("un BO diverso dal richiedente invitato non vede la bozza");
assert.equal((await P(viewer, "GET", "drafts", undefined, T)).status, 403);
assert.equal((await P(legal2, "GET", "drafts", undefined, T)).status, 200);
ok("qualsiasi utente Legal vede la bozza");

// ─── Commenti
r = await P(legal, "POST", "draft-comment", { para: 3, start: 0, end: 20, quote: paras[3].slice(0, 20), body: "Penale troppo bassa" }, T);
assert.equal(r.status, 200);
let c1 = r.data.comments[0];
assert.equal(c1.func, "legal");
assert.equal(c1.para, 3);
assert.equal(c1.mine, true);
ok("commento di Legal ancorato al testo");
r = await P(buyer, "POST", "draft-comment", { body: "Ne parlo col fornitore", parentId: c1.id }, T);
assert.equal(r.data.comments.length, 2);
assert.equal(r.data.comments[1].parentId, c1.id);
assert.equal(r.data.comments[1].func, "buyer");
ok("risposta del buyer nel filo");
assert.equal((await P(buyer, "POST", "draft-comment", { body: "" }, T)).status, 400);
assert.equal((await P(legal2, "POST", "draft-comment-resolve", { resolved: true }, `&id=${c1.id}`)).status, 403);
ok("solo l'autore o il buyer chiude un commento");
r = await P(buyer, "POST", "draft-comment-resolve", { resolved: true }, `&id=${c1.id}`);
assert.equal(r.data.comments[0].status, "resolved");
ok("il buyer chiude il commento");

// ─── Pareri
assert.equal((await P(buyer, "POST", "draft-decide", { decision: "approved" }, T)).status, 403);
ok("il buyer non dà il parere al posto delle funzioni");
assert.equal((await P(legal, "POST", "draft-decide", { decision: "changes" }, T)).status, 400);
ok("'chiedo modifiche' richiede il motivo");
r = await P(legal, "POST", "draft-decide", { decision: "changes", note: "Alzare le penali al 20%" }, T);
assert.equal(r.status, 200);
assert.equal((await P(buyer, "POST", "task-links", { contractStatus: "signed" }, T)).status, 409);
ok("Legal chiede modifiche: firma bloccata");
r = await P(legal2, "POST", "draft-decide", { decision: "approved" }, T);
assert.equal(r.data.reviews.find(x => x.func === "legal").status, "approved");
assert.equal(r.data.reviews.find(x => x.func === "legal").decidedBy, "Luigi Legal");
ok("vale il parere di uno qualsiasi degli utenti della funzione");
assert((await pool.query("select 1 from notifications where template = 'review_decided' and to_email = 'buyer@test.it'")).rows.length >= 2);
ok("il buyer riceve l'esito di ogni parere");
await P(comp, "POST", "draft-decide", { decision: "approved_comments", note: "ok, vedi commenti" }, T);
await P(itsec, "POST", "draft-decide", { decision: "approved" }, T);
r = await P(buyer, "GET", "drafts", undefined, T);
assert.match(r.data.gate, /Richiedente/);
ok("manca solo il Richiedente: firma ancora bloccata");
assert.equal((await P(bo2C, "POST", "draft-decide", { decision: "approved" }, T)).status, 404);
await P(boC, "POST", "draft-decide", { decision: "approved" }, T);
r = await P(buyer, "GET", "drafts", undefined, T);
assert.equal(r.data.gate, null);
ok("tutte le funzioni approvano: via libera");

// ─── Nuova versione azzera i pareri
r = await P(buyer, "POST", "draft-upload", { fileName: "bozza v2.docx", filePath: docxFile([...paras, "3. Durata"]), size: 950 }, T);
assert.equal(r.status, 201);
assert.equal(r.data.drafts.length, 2);
assert.equal(r.data.drafts[0].version, 2);
assert(r.data.reviews.length === 4 && r.data.reviews.every(x => x.status === "pending"));
ok("v2: i pareri ripartono da zero per le stesse funzioni");
assert.match(r.data.gate, /Firma bloccata/);
assert.equal((await P(buyer, "POST", "task-links", { contractStatus: "signed" }, T)).status, 409);
ok("v2 non ancora approvata: firma bloccata");
r = await P(buyer, "GET", "drafts", undefined, `${T}&draft=${D1}`);
assert.equal(r.data.draftId, D1);
assert.equal(r.data.canDecide, false);
assert.equal(r.data.comments.length, 2);
ok("le versioni precedenti restano consultabili, con i loro commenti");

// ─── Coda delle funzioni e priorità
r = await P(legal, "GET", "my-reviews");
assert.equal(r.data.reviews.length, 1);
assert.equal(r.data.reviews[0].status, "pending");
assert.equal(r.data.reviews[0].version, 2);
ok("Legal vede la revisione in coda");
assert.equal((await P(boC, "GET", "my-reviews")).data.reviews.length, 1);
assert.equal((await P(bo2C, "GET", "my-reviews")).data.reviews.length, 0);
assert.equal((await P(viewer, "GET", "my-reviews")).status, 403);
assert.equal((await P(buyer, "GET", "my-reviews")).status, 403);
ok("la coda è delle funzioni: viewer e buyer no");

// ─── Solleciti ed escalation
await pool.query("update draft_reviews set due = $1 where func = 'legal' and status = 'pending'", [day(-3)]);
await pool.query("delete from notifications");
const cron = process.env.CRON_SECRET;
const clm = await import(B + "_clm.js");
let run = await clm.runReviewReminders("https://app.test");
assert(run.reminders >= 1);
assert(run.escalations >= 1);
ok("revisione scaduta: sollecito alla funzione ed escalation al Manager");
assert(
  (await pool.query("select 1 from notifications where template = 'review_reminder' and to_email = 'admin@test.it'")).rows.length === 1,
);
run = await clm.runReviewReminders("https://app.test");
assert.equal(run.reminders, 0);
ok("niente solleciti ripetuti lo stesso giorno");
r = await P(buyer, "GET", "my-work");
const it = r.data.items.find(x => x.kind === "review_late");
assert(it);
assert.match(it.detail, /Legal/);
assert.equal(it.urgency, 3);
ok("il buyer vede 'in attesa di Legal' tra le cose da seguire");
assert.equal(
  (await P(buyer2, "GET", "my-work")).data.items.some(x => x.kind === "review_late"),
  false,
);
ok("e solo sui propri task");
const lr = (await P(legal, "GET", "my-reviews")).data.reviews[0];
assert(lr.overdueDays >= 3);
ok("la funzione vede il ritardo");

// ─── Gate sulla registrazione del contratto
r = await P(buyer, "POST", "task-contract-register", { contract: { supplier: "X", object: "Y", end: day(300) } }, T);
assert.equal(r.status, 409);
ok("registrazione contratto firmato bloccata dalla revisione");

// ─── Task senza bozza: flusso invariato
const t2 = (await P(buyer, "POST", "task-create", { title: "Altro acquisto", kind: "purchase", value: 1000, supplier: "x" })).data.task;
await P(buyer, "POST", "task-doc", { kind: "contract", fileName: "c.pdf", filePath: file("c.pdf"), size: 4 }, `&id=${t2.id}`);
assert.equal((await P(buyer, "POST", "task-links", { contractStatus: "signed" }, `&id=${t2.id}`)).status, 200);
ok("senza bozza il flusso resta quello di prima");

// ─── File
r = await P(legal, "GET", "draft-file", undefined, `&id=${D1}`);
assert.equal(r.status, 200);
ok("la funzione invitata scarica la bozza");
assert.equal((await P(viewer, "GET", "draft-file", undefined, `&id=${D1}`)).status, 403);
console.log(`\n${passed} controlli superati`);
await pool.end();
