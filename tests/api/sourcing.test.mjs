import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const B = process.env.API_BUILD + "/api/";
const SAP = process.env.SAP_SAMPLES + "/";
process.env.DATABASE_URL = process.env.TEST_DB_URL;
process.env.ADMIN_EMAIL = "admin@test.it";
process.env.ADMIN_PASSWORD = "Admin-pass-123!";
process.env.SESSION_SECRET = "x".repeat(40);
const portal = await import(B + "portal.js"),
  login = await import(B + "login.js");
const db = await import(B + "_db.js"),
  crypto = await import(B + "_crypto.js"),
  files = await import(B + "_sap-files.js");
await db.ensureSchema();
const pool = db.getPool();
let passed = 0;
const ok = n => {
  passed++;
  console.log("  ✓", n);
};
const call = async (cookie, method, qs, body, headers = {}) => {
  const isRaw = body instanceof Uint8Array;
  const r = new Request("https://app.test/api/x" + qs, {
    method,
    headers: { ...(isRaw ? {} : { "content-type": "application/json" }), ...(cookie ? { cookie } : {}), ...headers },
    body: body === undefined ? undefined : isRaw ? body : JSON.stringify(body),
  });
  const res = await portal[method](r);
  const sc = res.headers.get("set-cookie");
  let data;
  try {
    data = await res.clone().json();
  } catch {
    data = null;
  }
  return { status: res.status, data, cookie: sc ? sc.split(";")[0] : null };
};
const P = (c, m, op, body, extra = "", h) => call(c, m, `?op=${op}${extra}`, body, h);
const signin = async (e, p) => {
  const r = new Request("https://app.test/x", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: e, password: p }),
  });
  const res = await login.POST(r);
  return res.headers.get("set-cookie").split(";")[0];
};
const mk = async (e, n, r) =>
  pool
    .query("insert into users (email,name,role,title,password_hash) values ($1,$2,$3,'t',$4) returning id", [
      e,
      n,
      r,
      await crypto.hashPassword("Password-123!"),
    ])
    .then(x => x.rows[0].id);
const b1 = await mk("buyer@test.it", "Marta Buyer", "buyer"),
  b2 = await mk("buyer2@test.it", "Luca Buyer", "buyer");
await mk("fin@test.it", "Finance Uno", "finance");
const admin = await signin("admin@test.it", "Admin-pass-123!"),
  buyer = await signin("buyer@test.it", "Password-123!"),
  buyer2 = await signin("buyer2@test.it", "Password-123!"),
  fin = await signin("fin@test.it", "Password-123!");

const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const makeXls = rows => {
  const xml = `<?xml version="1.0" encoding="utf-16"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="Sheet1"><Table>${rows.map(r => `<Row>${r.map(c => (c == null ? "<Cell/>" : `<Cell><Data ss:Type="String">${esc(c)}</Data></Cell>`)).join("")}</Row>`).join("")}</Table></Worksheet></Workbook>`;
  const b = Buffer.alloc(2 + xml.length * 2);
  b[0] = 0xff;
  b[1] = 0xfe;
  b.write(xml, 2, "utf16le");
  return new Uint8Array(b);
};
const realPr = new Uint8Array(readFileSync(SAP + "pr.xls")),
  realPo = new Uint8Array(readFileSync(SAP + "po.xls"));
const imp = (c, data, name = "OPEN_PR.XLS", extra = "") =>
  P(c, "POST", "rda-import", data, extra, { "x-file-name": encodeURIComponent(name) });
const prRows = files.parseSheet(realPr);
assert.equal((await imp(admin, realPr)).status, 200);
let list = (await P(admin, "GET", "tasks")).data.tasks;
const big = list.filter(t => t.meta.value > 10000),
  small = list.filter(t => t.meta.value <= 10000);
assert(big.length >= 4 && small.length);
assert(big.every(t => t.sourcingRequired && t.sourcingStatus === "missing"));
assert(small.every(t => !t.sourcingRequired && t.sourcingStatus === "na"));
ok(`RDA sopra 10.000: ${big.length} richiedono il confronto, le altre no`);
let sum = (await P(admin, "GET", "task-summary")).data;
assert.equal(sum.sourcingMissing, big.length);
assert.equal(sum.exceptionsPending, 0);
ok("riepilogo: RDA senza confronto");
const [t1, t2, t3, t4] = big;
let r = await P(admin, "POST", "task-update", { status: "done", force: true }, `&id=${t1.id}`);
assert.equal(r.status, 409);
assert.equal(r.data.needsSourcing, true);
ok("RDA sopra soglia: non si chiude senza confronto");
assert.equal((await P(admin, "POST", "task-update", { status: "done" }, `&id=${small[0].id}`)).status, 409);
ok("RDA sotto soglia: senza i passaggi serve una conferma");
assert.equal((await P(admin, "POST", "task-update", { status: "done", force: true }, `&id=${small[0].id}`)).status, 200);
ok("RDA sotto soglia: chiusa a mano su conferma (annullata o respinta)");
const S = (c, id, body) => P(c, "POST", "task-sourcing", body, `&id=${id}`);
assert.equal((await S(admin, t1.id, { mode: "comparison", quotes: [{ supplier: "Alfa", amount: 100, chosen: true }] })).status, 400);
ok("una sola offerta: rifiutato");
assert.equal(
  (
    await S(admin, t1.id, {
      mode: "comparison",
      quotes: [
        { supplier: "Alfa Srl", amount: 100, chosen: true },
        { supplier: "alfa srl", amount: 90, chosen: false },
      ],
    })
  ).status,
  400,
);
ok("stesso fornitore due volte: rifiutato");
assert.equal(
  (
    await S(admin, t1.id, {
      mode: "comparison",
      quotes: [
        { supplier: "Alfa", amount: 100, chosen: true },
        { supplier: "Beta", amount: 90, chosen: false },
      ],
    })
  ).status,
  400,
);
ok("scelta l'offerta più cara senza motivo: rifiutato");
assert.equal(
  (
    await S(admin, t1.id, {
      mode: "comparison",
      quotes: [
        { supplier: "Alfa", amount: 100, chosen: false },
        { supplier: "Beta", amount: 90, chosen: false },
      ],
    })
  ).status,
  400,
);
ok("nessuna offerta scelta: rifiutato");
r = await S(admin, t1.id, {
  mode: "comparison",
  quotes: [
    { supplier: "Alfa", amount: 100, chosen: true },
    { supplier: "Beta", amount: 90, chosen: false },
  ],
  justification: "Beta non garantisce i tempi di consegna",
});
assert.equal(r.status, 200);
assert.equal(r.data.task.sourcingStatus, "ok");
assert.equal(r.data.task.sourcing.recordedBy.length > 0, true);
ok("confronto con motivazione: registrato");
assert.equal((await P(admin, "POST", "task-update", { status: "done", force: true }, `&id=${t1.id}`)).status, 200);
ok("con il confronto registrato la RDA si chiude");
assert.equal((await S(admin, t2.id, { mode: "strategic", justification: "corto" })).status, 400);
assert.equal(
  (await S(admin, t2.id, { mode: "single_source", justification: "Unico distributore autorizzato del macchinario" })).data.task
    .sourcingStatus,
  "ok",
);
ok("single source / strategica: serve la motivazione");

// Eccezione chiesta dal buyer: serve l'approvazione del Manager
await P(admin, "POST", "task-update", { assigneeId: b1 }, `&id=${t3.id}`);
r = await S(buyer, t3.id, { mode: "exception", justification: "Urgenza di produzione: fermo linea" });
assert.equal(r.data.task.sourcingStatus, "pending");
assert.equal(r.data.task.sourcing.approval, "pending");
ok("eccezione del buyer: in attesa del Manager");
assert.equal((await P(admin, "GET", "task-summary")).data.exceptionsPending, 1);
r = await P(buyer, "POST", "task-update", { status: "done", force: true }, `&id=${t3.id}`);
assert.equal(r.status, 409);
ok("finché non è approvata la RDA non si chiude");
assert.equal((await P(buyer, "POST", "task-sourcing-approve", { approve: true }, `&id=${t3.id}`)).status, 403);
ok("il buyer non approva la propria eccezione");
assert.equal((await P(admin, "POST", "task-sourcing-approve", { approve: false }, `&id=${t3.id}`)).status, 400);
ok("rifiuto senza motivo: non ammesso");
r = await P(admin, "POST", "task-sourcing-approve", { approve: false, note: "Chiedi almeno un preventivo" }, `&id=${t3.id}`);
assert.equal(r.data.task.sourcing.approval, "rejected");
assert.equal(r.data.task.sourcingStatus, "missing");
ok("eccezione respinta: torna da documentare");
await S(buyer, t3.id, { mode: "exception", justification: "Fermo linea, nessun altro fornitore disponibile in 24 ore" });
r = await P(admin, "POST", "task-sourcing-approve", { approve: true }, `&id=${t3.id}`);
assert.equal(r.data.task.sourcingStatus, "ok");
assert(r.data.task.sourcing.approvedBy);
ok("eccezione approvata dal Manager");
assert.equal((await P(buyer, "POST", "task-update", { status: "done", force: true }, `&id=${t3.id}`)).status, 200);
ok("poi la RDA si chiude");
r = await S(admin, t4.id, { mode: "exception", justification: "Eccezione decisa dal Manager" });
assert.equal(r.data.task.sourcingStatus, "ok");
ok("eccezione registrata dal Manager: approvata subito");
assert.equal((await S(admin, small[1].id, { mode: "strategic", justification: "Fornitore strategico per il gruppo" })).status, 200);
ok("si può documentare anche sotto soglia");

// Soglia configurabile
const cfgSave = item => P(admin, "POST", "config-save", { entity: "rda", action: "save", item });
assert.equal((await cfgSave({ sourcingThreshold: -1 })).status, 400);
r = await cfgSave({ sourcingThreshold: 50000 });
assert.equal(r.status, 200);
assert.equal(r.data.config.rda.sourcingThreshold, 50000);
assert.equal(r.data.config.rda.slaDays, 7);
ok("soglia modificabile, i giorni di lavorazione restano");
list = (await P(admin, "GET", "tasks")).data.tasks;
assert(list.filter(t => t.sourcingRequired).every(t => t.meta.value > 50000));
ok("la nuova soglia si applica subito");
r = await cfgSave({ slaDays: 5 });
assert.equal(r.data.config.rda.sourcingThreshold, 50000);
ok("salvare i giorni non cambia la soglia");
await cfgSave({ sourcingThreshold: 10000 });

// Chiusa da SAP con il PO senza confronto: resta segnalata e si può documentare dopo
const keys = new Set(big.map(t => t.sourceKey));
const real = files.parsePrLines(prRows);
const prCol = prRows[0].findIndex((_, i) => prRows.slice(1).some(row => row[i] === real[0].pr));
const kept = [prRows[0], ...prRows.slice(1).filter(row => !(row[prCol] && keys.has(row[prCol])))];
assert.equal((await imp(admin, makeXls(kept), "OPEN_PR.XLS", "&force=1")).status, 200);
list = (await P(admin, "GET", "tasks")).data.tasks;
const closed = list.filter(t => keys.has(t.sourceKey) && t.status === "done" && t.doneBy === "SAP");
assert(closed.length >= 1);
const gap = closed.filter(t => t.sourcingStatus === "missing");
assert(gap.length >= 1);
ok(`RDA chiuse da SAP senza confronto: ${gap.length} restano segnalate`);
r = await S(admin, gap[0].id, {
  mode: "comparison",
  quotes: [
    { supplier: "Uno", amount: 10, chosen: true },
    { supplier: "Due", amount: 12, chosen: false },
  ],
});
assert.equal(r.data.task.sourcingStatus, "ok");
ok("e si possono documentare anche dopo la chiusura");
assert.equal((await P(admin, "POST", "task-sourcing", { mode: "strategic", justification: "xxxxxxxxxxxx" }, `&id=999999`)).status, 404);
const man = (await P(admin, "POST", "task-create", { title: "Task manuale" })).data.task;
assert.equal((await S(admin, man.id, { mode: "strategic", justification: "xxxxxxxxxxxx" })).status, 400);
ok("solo sulle RDA");
const kp = await P(admin, "GET", "kpis");
assert.equal(kp.status, 200);
assert.equal(kp.data.sourcing.threshold, 10000);
assert(kp.data.sourcing.byMode.find(m => m.label === "Confronto tra offerte").n >= 2);
assert.equal(
  kp.data.rda.aging.reduce((a, x) => a + x.n, 0),
  kp.data.rda.open,
);
ok("indicatori: confronto fornitori e età delle RDA coerenti");
assert.equal((await P(buyer, "GET", "kpis")).status, 403);
ok("indicatori solo per il Manager");
console.log(`\n${passed} controlli superati`);
process.exit(0);
