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
await pool.query(
  "insert into buying_companies (code, name, sap_company_code, purch_org) values ('C1','Soc','1000','1000') on conflict do nothing",
);
await pool.query("insert into industry_codes (code, name) values ('I1','Ind') on conflict do nothing");
const demoMod = await import(B + "_demo.js");
const mgr = { id: 1, role: "manager", name: "Admin" };
const SUP = (await demoMod.createDemoSupplier(mgr, { name: "Fornitore Buono Srl" })).id;
const BAD = (await demoMod.createDemoSupplier(mgr, { name: "Fornitore Scaduto Srl" })).id;
await pool.query("delete from supplier_documents where supplier_id = $1", [BAD]);
const PEND = (
  await pool.query(
    "insert into suppliers (email, name, company_codes, industry_code, status) values ('x@y.it','Non Registrato Srl','{C1}','I1','invited') returning id",
  )
).rows[0].id;
const mkRda = async (pr, value, io = false) => {
  await pool.query(
    "insert into tasks (source, source_key, title, due, assignee_id, meta, created_by) values ('rda',$1,$2,$3,$4,$5,'SAP')",
    [
      pr,
      `RDA ${pr} · prova`,
      day(5),
      b1,
      JSON.stringify({ value, currency: "EUR", requestedBy: "XX", ...(io ? { io: { IO1: value } } : {}) }),
    ],
  );
  await pool.query("insert into rda_lines (pr, item, short_text, value) values ($1,'10','prova',$2)", [pr, value]);
  return (await pool.query("select id from tasks where source_key = $1", [pr])).rows[0].id;
};
const get = async id => (await P(buyer, "GET", "task", undefined, `&id=${id}`)).data.task;
const stepOf = (t, k) => t.steps.find(s => s.key === k);

// ─── Fornitore sempre scelto, registrato e qualificato
const small = await mkRda("7001", 4000);
let t = await get(small);
assert.equal(t.sourcingRequired, false);
assert.equal(stepOf(t, "received").state, "current");
assert.match(t.blocker, /internal order/);
assert.equal(stepOf(t, "supplier").state, "todo");
ok("RDA sotto soglia: il fornitore va comunque scelto");
let r = await P(buyer, "POST", "task-supplier", { supplierId: PEND }, `&id=${small}`);
assert.equal(r.status, 409);
ok("fornitore non registrato: rifiutato");
r = await P(buyer, "POST", "task-supplier", { supplierId: BAD }, `&id=${small}`);
assert.equal(r.status, 409);
ok("fornitore con qualifica scaduta: rifiutato");
r = await P(buyer, "POST", "task-supplier", { supplierId: SUP }, `&id=${small}`);
assert.equal(r.status, 200);
assert.equal(r.data.task.chosenSupplierId, SUP);
assert.equal(stepOf(r.data.task, "supplier").state, "done");
ok("fornitore registrato e qualificato: scelto");
const elig = (await P(buyer, "GET", "task-suppliers")).data.suppliers;
assert(elig.some(x => x.id === SUP));
assert(!elig.some(x => x.id === BAD || x.id === PEND));
ok("l'elenco dei fornitori scegliibili esclude i non qualificati");

// ─── Sopra soglia: serve anche come è stato scelto
const big = await mkRda("7002", 25000, true);
await P(buyer, "POST", "task-supplier", { supplierId: SUP }, `&id=${big}`);
t = await get(big);
assert.equal(stepOf(t, "supplier").state, "current");
assert.match(t.blocker, /sopra soglia|confronto/i);
ok("sopra soglia: fornitore scelto non basta, serve il confronto");
await P(buyer, "POST", "task-sourcing", { mode: "strategic", justification: "Fornitura strategica di prova" }, `&id=${big}`);
t = await get(big);
assert.equal(stepOf(t, "supplier").state, "done");
ok("dopo il confronto (o motivazione) il passaggio è fatto");

// ─── Contratto: non serve / in negoziazione / firmato
assert.equal((await P(buyer, "POST", "task-links", { contractStatus: "not_needed" }, `&id=${small}`)).status, 400);
ok("'non serve' senza motivo: rifiutato");
r = await P(buyer, "POST", "task-links", { contractStatus: "negotiating", contractNote: "trattativa in corso" }, `&id=${small}`);
t = r.data.task;
assert.notEqual(stepOf(t, "contract").state, "done");
assert.equal(stepOf(t, "contract").detail, "in negoziazione");
assert.match(t.blocker, /internal order|negoziazione/);
ok("in negoziazione: resta un passaggio aperto");
assert.equal((await P(buyer, "POST", "task-links", { contractStatus: "signed" }, `&id=${small}`)).status, 400);
ok("'firmato' senza documento: rifiutato");
await P(
  buyer,
  "POST",
  "task-doc",
  { kind: "contract", fileName: "c.pdf", filePath: `contracts/${globalThis.crypto.randomUUID()}/c.pdf`, size: 4 },
  `&id=${small}`,
);
r = await P(buyer, "POST", "task-links", { contractStatus: "signed" }, `&id=${small}`);
assert.equal(r.status, 200, JSON.stringify(r.data));
assert.equal(stepOf(r.data.task, "contract").state, "done");
ok("con il documento: firmato");

// ─── Ordine emesso con passaggi mancanti: il task non si chiude
await pool.query("insert into sap_pos (po, pr, supplier_code, supplier_name, doc_date) values ('4500000001','7001','1','X', current_date)");
await pool.query("delete from rda_lines where pr = '7001'");
const tasksMod = await import(B + "_tasks.js");
const res = () => ({ closedPo: 0, closedGone: 0 });
let x = res();
await tasksMod.reconcile(pool, x);
t = await get(small);
assert.equal(x.closedPo, 0);
assert.equal(t.status, "open");
assert.equal(t.pos.length, 1);
assert(t.blocker);
ok("RDA sparita con ordine in SAP ma internal order mancante: resta aperta");
const work = (await P(buyer, "GET", "my-work")).data.items;
assert(work.some(i => i.kind === "po_gap" && i.target.taskId === small && /internal order/i.test(i.detail)));
ok("in 'Da fare adesso' compare 'ordine emesso, manca…'");
await P(buyer, "POST", "task-links", { internalOrder: "IO1" }, `&id=${small}`);
t = await get(small);
assert.equal(t.status, "done");
assert.equal(t.doneReason, "po_created");
ok("ultimo passaggio fatto con ordine già in SAP: la RDA si chiude subito, da sola");
x = res();
await tasksMod.reconcile(pool, x);
assert.equal(x.closedPo, 0);
ok("e il caricamento successivo non cambia nulla");

// ─── RDA sparita senza ordine (annullata/respinta): chiusa; se poi arriva l'ordine con passaggi mancanti si riapre
const gone = await mkRda("7003", 3000);
await pool.query("delete from rda_lines where pr = '7003'");
x = res();
await tasksMod.reconcile(pool, x);
t = await get(gone);
assert.equal(t.status, "done");
assert.equal(t.doneReason, "removed_from_sap");
ok("RDA sparita senza ordine: chiusa come 'non più aperta'");
await pool.query("insert into sap_pos (po, pr, supplier_code, supplier_name, doc_date) values ('4500000002','7003','1','X', current_date)");
x = res();
await tasksMod.reconcile(pool, x);
t = await get(gone);
assert.equal(t.status, "open");
ok("ordine arrivato dopo con passaggi mancanti: si riapre");

// ─── Chiusura manuale di una RDA incompleta: serve conferma
r = await P(buyer, "POST", "task-update", { status: "done" }, `&id=${big}`);
assert.equal(r.status, 409);
assert(r.data.needsConfirm || /passaggi|manca|confronto/i.test(r.data.error));
ok("chiudere a mano una RDA incompleta chiede conferma");

// ─── Acquisto manuale: si chiude solo con tutti i passaggi
const created = (await P(buyer, "POST", "task-create", { title: "Arredi", kind: "purchase", value: 3000, supplier: "x" })).data.task;
assert.match(created.blocker, /internal order/);
ok("acquisto manuale: parte dall'internal order, poi il fornitore");
await P(buyer, "POST", "task-supplier", { supplierId: SUP }, `&id=${created.id}`);
await P(buyer, "POST", "task-links", { internalOrder: "IO2" }, `&id=${created.id}`);
await P(buyer, "POST", "task-links", { contractStatus: "not_needed", contractNote: "Ordine semplice" }, `&id=${created.id}`);
t = await get(created.id);
assert.match(t.blocker, /PO/);
assert.equal(t.status, "open");
t = (await P(buyer, "POST", "task-links", { poNumbers: ["4500009999"] }, `&id=${created.id}`)).data.task;
assert.equal(t.status, "done");
ok("acquisto manuale completo: il PO chiude la pratica");

// ─── Contratto firmato registrato una volta sola dal task
const rc = await mkRda("7004", 8000, true);
await P(buyer, "POST", "task-supplier", { supplierId: SUP }, `&id=${rc}`);
const cfile = `contracts/${globalThis.crypto.randomUUID()}/c.pdf`;
blob.store.set(cfile, Buffer.from("%PDF"));
const body = {
  contract: {
    supplier: "Fornitore Buono Srl",
    object: "Servizio prova",
    category: "IT",
    country: "Italia",
    value: 8000,
    currency: "EUR",
    start: day(0),
    end: day(365),
    owner: "Marta Buyer",
    boEmail: "",
    renewal: "Non definito",
    type: "Servizi",
    notes: "",
    ceased: false,
    fileName: "c.pdf",
    filePath: cfile,
    noticeDays: 60,
    noticeDate: "",
  },
};
r = await P(buyer, "POST", "task-contract-register", body, `&id=${rc}`);
assert.equal(r.status, 200, JSON.stringify(r.data));
t = r.data.task;
assert(t.newContractId);
assert.equal(t.contractStatus, "signed");
assert.equal(stepOf(t, "contract").state, "done");
ok("il contratto registrato dal task: passaggio contratto fatto");
const ct = (await pool.query("select id, supplier, internal_order, supplier_id, owner from contracts where id = $1", [t.newContractId]))
  .rows[0];
assert.equal(ct.supplier, "Fornitore Buono Srl");
assert.equal(ct.internal_order, "IO1");
assert.equal(ct.supplier_id, SUP);
assert.equal(ct.owner, "Marta Buyer");
ok("nasce nel registro contratti con fornitore, internal order e responsabile");
assert((await pool.query("select count(*)::int n from plan_steps where contract_id = $1", [ct.id])).rows[0].n > 0);
assert(t.documents.some(d => d.kind === "contract"));
ok("con il suo piano di rinnovo e il documento allegato al task");
assert.equal((await P(buyer, "POST", "task-contract-register", body, `&id=${rc}`)).status, 409);
ok("registrarlo una seconda volta: rifiutato");

// ─── Archivio
const arch = (await P(buyer, "GET", "tasks-archive", undefined, "&q=prova")).data.tasks;
assert(arch.length >= 1 && arch.every(x => x.status === "done"));
ok("archivio: i task chiusi si cercano per testo");
const none = (await P(buyer, "GET", "tasks-archive", undefined, "&q=zzzinesistente")).data.tasks;
assert.equal(none.length, 0);
ok("archivio: nessun risultato se non c'è corrispondenza");
console.log(`\n${passed} controlli superati`);
process.exit(0);
