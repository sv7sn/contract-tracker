import assert from "node:assert/strict";
const B = process.env.API_BUILD + "/api/";
process.env.DATABASE_URL = process.env.TEST_DB_URL;
process.env.ADMIN_EMAIL = "admin@test.it";
process.env.ADMIN_PASSWORD = "Admin-pass-123!";
process.env.SESSION_SECRET = "x".repeat(40);
const portal = await import(B + "portal.js"),
  login = await import(B + "login.js"),
  db = await import(B + "_db.js"),
  demo = await import(B + "_demo.js"),
  crypto = await import(B + "_crypto.js");
await db.ensureSchema();
const pool = db.getPool();
let passed = 0;
const ok = n => {
  passed++;
  console.log("  ✓", n);
};
const call = async (cookie, method, qs, body) => {
  const r = new Request("https://a/x" + qs, {
    method,
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const res = await portal[method](r);
  let data;
  try {
    data = await res.clone().json();
  } catch {
    data = null;
  }
  return { status: res.status, data };
};
const lg = async (email, password) =>
  (
    await login.POST(
      new Request("https://a/x", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      }),
    )
  ).headers
    .get("set-cookie")
    .split(";")[0];
const admin = await lg("admin@test.it", "Admin-pass-123!");
const day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
let r = await call(admin, "GET", "?op=my-work");
assert.equal(r.status, 200);
assert.deepEqual(r.data.items, []);
ok("nessuna attività: lista vuota");
await pool.query("insert into buying_companies (code, name, sap_company_code, purch_org) values ('C1','Soc','1000','1000')");
await pool.query("insert into industry_codes (code, name) values ('I1','Ind')");
const hash = await crypto.hashPassword("Buyer-pass-123!");
const b1 = (
  await pool.query("insert into users (email, name, role, password_hash) values ('b1@t.it','Buyer Uno','buyer',$1) returning id", [hash])
).rows[0].id;
const b2 = (
  await pool.query("insert into users (email, name, role, password_hash) values ('b2@t.it','Buyer Due','buyer',$1) returning id", [hash])
).rows[0].id;
void b2;
const c1 = await lg("b1@t.it", "Buyer-pass-123!"),
  c2 = await lg("b2@t.it", "Buyer-pass-123!");
const mk = (title, due, assignee, extra = {}) =>
  pool
    .query(
      "insert into tasks (source, kind, title, due, assignee_id, meta, created_by) values ('manual','purchase',$1,$2,$3,$4,'x') returning id",
      [title, due, assignee, JSON.stringify({ value: 25000, currency: "EUR", supplier: "X", ...extra })],
    )
    .then(x => x.rows[0].id);
const late = await mk("Acquisto in ritardo", day(-10), b1),
  soon = await mk("Acquisto in scadenza", day(2), b1),
  other = await mk("Acquisto altro buyer", day(-20), b2),
  free = await mk("Acquisto libero", day(20), null);
void other;
void free;
r = await call(c1, "GET", "?op=my-work");
let items = r.data.items;
assert(
  items.some(
    i => i.kind === "task_late" && i.title === "Acquisto in ritardo" && i.urgency === 3 && i.days === 10 && i.target.taskId === late,
  ),
);
assert(items.some(i => i.target.taskId === soon && /entro 2 giorni/.test(i.detail) && i.urgency === 2));
assert(items.some(i => i.title === "Acquisto in ritardo" && /manca il confronto/.test(i.detail)));
assert.equal(items.filter(i => i.title === "Acquisto in ritardo").length, 1);
assert(!items.some(i => i.title === "Acquisto altro buyer"));
assert(!items.some(i => i.kind === "unassigned"));
ok("buyer: solo le proprie pratiche, ritardi e confronto mancante");
assert.equal(items[0].urgency, 3);
assert(items.every((i, k) => k === 0 || items[k - 1].urgency >= i.urgency));
ok("ordine per urgenza");
items = (await call(admin, "GET", "?op=my-work")).data.items;
assert(items.some(i => i.title === "Acquisto altro buyer" && /Buyer Due/.test(i.detail)));
assert(items.some(i => i.kind === "unassigned" && /1 task/.test(i.title)));
ok("manager: tutto il team e i task da assegnare");
await pool.query("update tasks set sourcing = $2 where id = $1", [
  late,
  JSON.stringify({
    mode: "exception",
    quotes: [],
    justification: "xxxxxxxxxxxxx",
    recordedBy: "Buyer Uno",
    recordedAt: new Date().toISOString(),
    approval: "pending",
    approvedBy: "",
    approvedAt: null,
    approvalNote: "",
  }),
]);
assert(!(await call(c1, "GET", "?op=my-work")).data.items.some(i => /Eccezione/.test(i.detail)));
assert((await call(admin, "GET", "?op=my-work")).data.items.some(i => /Eccezione al confronto/.test(i.detail) && i.urgency === 3));
ok("le eccezioni da approvare le vede solo il Manager");
const mgr = { id: 1, role: "manager", name: "Admin" };
const s1 = await demo.createDemoSupplier(mgr, { name: "Alfa Srl" }),
  s2 = await demo.createDemoSupplier(mgr, { name: "Beta Srl" });
await pool.query("update suppliers set reference_buyer_id = $1 where id = $2", [b1, s1.id]);
await pool.query("update suppliers set reference_buyer_id = $1, status = 'pending' where id = $2", [b2, s2.id]);
items = (await call(c1, "GET", "?op=my-work")).data.items;
assert(!items.some(i => i.target.vendorId === s2.id));
items = (await call(c2, "GET", "?op=my-work")).data.items;
assert(items.some(i => i.kind === "vendor_review" && i.target.vendorId === s2.id));
ok("fornitori da verificare: solo quelli del proprio buyer");
await pool.query(
  "delete from supplier_documents where supplier_id = $1 and type in (select type from supplier_documents where supplier_id = $1 limit 1)",
  [s1.id],
);
await pool.query("update supplier_documents set valid_until = current_date - 5 where supplier_id = $1 and valid_until is not null", [
  s1.id,
]);
items = (await call(c1, "GET", "?op=my-work")).data.items;
assert(items.some(i => i.kind === "vendor_lapsed" && i.target.vendorId === s1.id));
ok("qualifica scaduta del proprio fornitore");
// richieste di offerta
const t = await mk("Arredi", day(10), b1);
const cr = await call(c1, "POST", "rfq-create".replace(/^/, "?op="), {
  taskId: t,
  title: "Arredi",
  description: "",
  deadline: day(3),
  supplierIds: [s1.id, s2.id],
});
assert.equal(cr.status, 400); // s2 non è registrato
await pool.query("update suppliers set status = 'registered' where id = $1", [s2.id]);
const rid = (
  await call(c1, "POST", "?op=rfq-create", { taskId: t, title: "Arredi", description: "", deadline: day(3), supplierIds: [s1.id, s2.id] })
).data.rfqs[0].id;
await pool.query("update rfq_invites set amount = 1000 where rfq_id = $1 and supplier_id = $2", [rid, s1.id]);
assert((await call(c1, "GET", "?op=my-work")).data.items.some(i => /1 offerta ricevuta su 2/.test(i.detail)));
ok("offerte ricevute su una richiesta aperta");
await pool.query("update rfq_invites set amount = 1100 where rfq_id = $1 and supplier_id = $2", [rid, s2.id]);
await pool.query("update rfqs set deadline = current_date - 1 where id = $1", [rid]);
assert((await call(c1, "GET", "?op=my-work")).data.items.some(i => /scegli il fornitore/.test(i.detail)));
assert(!(await call(c2, "GET", "?op=my-work")).data.items.some(i => /scegli il fornitore/.test(i.detail)));
ok("richiesta chiusa con due offerte: scegli il fornitore");
for (const who of [ca => ca]) void who;
const sup = await lg(s1.email, s1.password);
assert.equal((await call(sup, "GET", "?op=my-work")).status, 403);
ok("i fornitori non vedono il lavoro del buyer");
console.log(`\n${passed} controlli superati`);
process.exit(0);
