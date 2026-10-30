import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const B = process.env.API_BUILD + "/api/";
process.env.DATABASE_URL = process.env.TEST_DB_URL;
process.env.ADMIN_EMAIL = "admin@test.it";
process.env.ADMIN_PASSWORD = "Admin-pass-123!";
process.env.SESSION_SECRET = "x".repeat(40);
const portal = await import(B + "portal.js"),
  login = await import(B + "login.js"),
  stateApi = await import(B + "state.js");
const db = await import(B + "_db.js"),
  crypto = await import(B + "_crypto.js"),
  files = await import(B + "_sap-files.js"),
  tasksMod = await import(B + "_tasks.js");
const blob = await import(process.env.API_BUILD + "/node_modules/@vercel/blob/index.js");
await db.ensureSchema();
const pool = db.getPool();
let passed = 0;
const ok = n => {
  passed++;
  console.log("  ✓", n);
};
const call = async (mod, cookie, method, qs, body, headers = {}) => {
  const raw = body instanceof Uint8Array;
  const r = new Request("https://app.test/api/x" + qs, {
    method,
    headers: { ...(raw ? {} : { "content-type": "application/json" }), ...(cookie ? { cookie } : {}), ...headers },
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
  });
  const res = await mod[method](r);
  let data;
  try {
    data = await res.clone().json();
  } catch {
    data = null;
  }
  return { status: res.status, data, cookie: res.headers.get("set-cookie")?.split(";")[0] };
};
const P = (c, m, op, body, extra = "", h) => call(portal, c, m, `?op=${op}${extra}`, body, h);
const admin = (await call(login, null, "POST", "", { email: "admin@test.it", password: "Admin-pass-123!" })).cookie;
const day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const file = n => {
  const p = `contracts/${globalThis.crypto.randomUUID()}/${n}`;
  blob.store.set(p, Buffer.from("%PDF"));
  return p;
};
const create = body => P(admin, "POST", "task-create", body);
const get = async id => (await P(admin, "GET", "task", undefined, `&id=${id}`)).data.task;

const demoMod = await import(B + "_demo.js");
await pool.query(
  "insert into buying_companies (code, name, sap_company_code, purch_org) values ('C1','Soc','1000','1000') on conflict do nothing",
);
await pool.query("insert into industry_codes (code, name) values ('I1','Ind') on conflict do nothing");
const SUP = (await demoMod.createDemoSupplier({ id: 1, role: "manager", name: "Admin" }, { name: "Fornitore Qualificato Srl" })).id;
/** Completa i passaggi di una pratica: fornitore, internal order, contratto non necessario, confronto se serve. */
const finish = async (c, id) => {
  await P(c, "POST", "task-supplier", { supplierId: SUP }, `&id=${id}`);
  await P(c, "POST", "task-links", { internalOrder: "IO12345" }, `&id=${id}`);
  await P(c, "POST", "task-links", { contractStatus: "not_needed", contractNote: "Nessun contratto necessario" }, `&id=${id}`);
  const t = (await P(c, "GET", "task", undefined, `&id=${id}`)).data.task;
  if (t.sourcingRequired && t.sourcingStatus !== "ok")
    await P(c, "POST", "task-sourcing", { mode: "strategic", justification: "Fornitura strategica di prova" }, `&id=${id}`);
};

console.log("Attività e acquisti");
let a = (await create({ title: "Chiamare fornitore X" })).data.task;
assert.equal(a.kind, "activity");
assert.equal((await P(admin, "POST", "task-sourcing", { mode: "strategic", justification: "xxxxxxxxxxxxx" }, `&id=${a.id}`)).status, 400);
assert.equal((await P(admin, "POST", "task-links", { poNumbers: ["4500001"] }, `&id=${a.id}`)).status, 400);
assert.equal((await P(admin, "POST", "task-update", { status: "done" }, `&id=${a.id}`)).status, 200);
ok("attività: resta un semplice promemoria");
assert.equal((await create({ title: "Arredi sala riunioni", kind: "purchase" })).status, 400);
ok("acquisto senza importo stimato: rifiutato");
let t = (await create({ title: "Arredi sala riunioni", kind: "purchase", value: 25000, supplier: "Mobili Srl" })).data.task;
assert.equal(t.kind, "purchase");
assert.equal(t.sourcingRequired, true);
assert.equal(t.meta.value, 25000);
ok("acquisto: pratica con importo stimato, sopra soglia serve il confronto");
let r = await P(admin, "POST", "task-update", { status: "done" }, `&id=${t.id}`);
assert.equal(r.status, 409);
assert.match(r.data.error, /internal order/);
ok("senza internal order la pratica non si chiude (è il primo dato)");
await P(admin, "POST", "task-links", { internalOrder: "IO777" }, `&id=${t.id}`);
r = await P(admin, "POST", "task-update", { status: "done" }, `&id=${t.id}`);
assert.equal(r.status, 409);
assert.match(r.data.error, /fornitore/);
await P(admin, "POST", "task-supplier", { supplierId: SUP }, `&id=${t.id}`);
r = await P(admin, "POST", "task-update", { status: "done" }, `&id=${t.id}`);
assert.equal(r.status, 409);
assert.match(r.data.error, /confronto/);
await P(
  admin,
  "POST",
  "task-sourcing",
  {
    mode: "comparison",
    quotes: [
      { supplier: "Mobili Srl", amount: 24000, chosen: true },
      { supplier: "Arreda Spa", amount: 27000, chosen: false },
    ],
  },
  `&id=${t.id}`,
);
r = await P(admin, "POST", "task-update", { status: "done" }, `&id=${t.id}`);
assert.equal(r.status, 409);
assert.match(r.data.error, /contratto/);
ok("poi il contratto");
assert.equal((await P(admin, "POST", "task-links", { contractStatus: "signed" }, `&id=${t.id}`)).status, 400);
ok("contratto firmato senza documento: rifiutato");
await P(admin, "POST", "task-doc", { kind: "offer", fileName: "offerta.pdf", filePath: file("offerta.pdf"), size: 10 }, `&id=${t.id}`);
await P(admin, "POST", "task-links", { contractStatus: "signed" }, `&id=${t.id}`);
r = await P(admin, "POST", "task-update", { status: "done" }, `&id=${t.id}`);
assert.equal(r.status, 409);
assert.match(r.data.error, /PO/);
ok("e il PO");
t = (await P(admin, "POST", "task-links", { poNumbers: ["4500007777"] }, `&id=${t.id}`)).data.task;
assert.equal(t.status, "done");
assert.equal(t.saving.vsAverage, 3000);
ok("pratica completa: si chiude da sola, con il saving");
const sum = (await P(admin, "GET", "task-summary")).data;
assert.equal(typeof sum.sourcingMissing, "number");

console.log("Acquisto con contratto");
t = (await create({ title: "Manutenzione impianti", kind: "purchase", value: 8000, supplier: "Termo Srl" })).data.task;
assert.equal(t.sourcingRequired, false);
assert.equal((await P(admin, "POST", "task-contract", { contract: { end: day(365), value: 8000 } }, `&id=${t.id}`)).status, 400);
ok("contratto senza documento: rifiutato");
r = await P(
  admin,
  "POST",
  "task-contract",
  { contract: { end: day(365), start: day(1), value: 7800, noticeDays: 60, fileName: "contratto.pdf", filePath: file("contratto.pdf") } },
  `&id=${t.id}`,
);
t = r.data.task;
assert.equal(t.outcome, "new_contract");
assert(t.newContractId);
assert.equal(t.status, "open");
const st = (await call(stateApi, admin, "GET", "")).data;
const nc = st.contracts.find(c => c.id === t.newContractId);
assert.equal(nc.supplier, "Termo Srl");
assert.equal(nc.object, "Manutenzione impianti");
assert.equal(nc.value, 7800);
assert.equal(nc.noticeDate, day(305));
assert.equal(st.plans[nc.id].length, 7);
ok("il contratto entra nel registro con il suo piano di rinnovo");
assert.equal(
  (
    await P(
      admin,
      "POST",
      "task-contract",
      { contract: { end: day(365), value: 1, fileName: "c.pdf", filePath: file("c.pdf") } },
      `&id=${t.id}`,
    )
  ).status,
  409,
);
await P(admin, "POST", "task-supplier", { supplierId: SUP }, `&id=${t.id}`);
await P(admin, "POST", "task-links", { internalOrder: "IO888" }, `&id=${t.id}`);
t = (await P(admin, "POST", "task-links", { noPoReason: "Contratto quadro con ordini a chiamata" }, `&id=${t.id}`)).data.task;
assert.equal(t.status, "done");
ok("senza PO con motivo: pratica chiusa");
assert.equal((await P(admin, "POST", "task-update", { status: "open" }, `&id=${t.id}`)).status, 409);
ok("con contratto registrato non si riapre");

console.log("Niente doppioni con SAP");
const real = new Uint8Array(readFileSync(process.env.SAP_SAMPLES + "/pr.xls"));
const prs = [...new Set(files.parsePrLines(files.parseSheet(real)).map(l => l.pr))];
const pre = (await create({ title: "Acquisto anticipato", kind: "purchase", value: 3000, rdaNumbers: [prs[0]] })).data.task;
assert.deepEqual(pre.rdaNumbers, [prs[0]]);
assert.equal((await P(admin, "POST", "rda-import", real, "", { "x-file-name": "OPEN_PR.XLS" })).status, 200);
let list = (await P(admin, "GET", "tasks")).data.tasks;
assert(!list.some(x => x.source === "rda" && x.sourceKey === prs[0]));
assert(list.some(x => x.source === "rda" && x.sourceKey === prs[1]));
ok("RDA già indicata in una pratica: SAP non crea un secondo task");
const rdaTask = list.find(x => x.source === "rda" && x.sourceKey === prs[1]);
const later = (await create({ title: "Pratica dopo l'RDA", kind: "purchase", value: 3000, rdaNumbers: [prs[1]] })).data.task;
assert.equal((await get(rdaTask.id)).doneReason, "merged");
assert.equal((await get(rdaTask.id)).meta.mergedInto, later.id);
ok("RDA arrivata prima: il suo task viene unito alla pratica");
assert.equal((await P(admin, "POST", "rda-import", real, "", { "x-file-name": "OPEN_PR.XLS" })).status, 200);
assert.equal((await get(rdaTask.id)).status, "done");
ok("al nuovo import non si riapre");
assert.equal((await create({ title: "Doppia", kind: "purchase", value: 100, rdaNumbers: [prs[1]] })).status, 409);
assert(!(await P(admin, "GET", "tasks")).data.tasks.some(x => x.title === "Doppia"));
ok("la stessa RDA non può stare in due pratiche aperte (e la pratica non resta a metà)");
const r3 = list.find(x => x.source === "rda" && x.sourceKey === prs[2]);
await P(admin, "POST", "task-sourcing", { mode: "strategic", justification: "Fornitore strategico di gruppo" }, `&id=${r3.id}`);
assert.equal((await create({ title: "Su RDA lavorata", kind: "purchase", value: 100, rdaNumbers: [prs[2]] })).status, 409);
ok("RDA già lavorata nel suo task: si continua da lì");
await pool.query("insert into sap_pos (po, pr, supplier_code, supplier_name, doc_date) values ('4500123456',$1,'99','X', current_date)", [
  prs[0],
]);
await P(
  admin,
  "POST",
  "task-sourcing",
  {
    mode: "comparison",
    quotes: [
      { supplier: "Aa", amount: 1, chosen: true },
      { supplier: "Bb", amount: 2, chosen: false },
    ],
  },
  `&id=${pre.id}`,
);
await P(admin, "POST", "task-doc", { kind: "offer", fileName: "o.pdf", filePath: file("o.pdf") }, `&id=${pre.id}`);
await finish(admin, pre.id);
await tasksMod.autoLinkPos(pool);
const pd = await get(pre.id);
assert.deepEqual(pd.poNumbers, ["4500123456"]);
assert.equal(pd.status, "done");
ok("PO della sua RDA agganciato da SAP: pratica chiusa");
console.log(`\n${passed} controlli superati`);
process.exit(0);
