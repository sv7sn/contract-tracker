import assert from "node:assert/strict";
const B = process.env.API_BUILD + "/api/";
process.env.DATABASE_URL = process.env.TEST_DB_URL;
process.env.ADMIN_EMAIL = "admin@test.it";
process.env.ADMIN_PASSWORD = "Admin-pass-123!";
process.env.SESSION_SECRET = "x".repeat(40);
const blob = await import(process.env.API_BUILD + "/node_modules/@vercel/blob/index.js");
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
const n = async sql => (await pool.query(sql)).rows[0].n;
assert.equal((await call(admin, "POST", "?op=budget-demo", {})).status, 201);
const mgr = { id: 1, role: "manager", name: "Admin" };
const real = await demo.createDemoSupplier(mgr, { name: "Vero Fornitore Srl", sapCode: "REAL1" });
const extra = await demo.createDemoSupplier(mgr);
await call(admin, "POST", "?op=category-save", { name: "Servizi" });
const hash = await crypto.hashPassword("Buyer-pass-123!");
await pool.query("insert into users (email, name, role, password_hash) values ('b@t.it','Buyer','buyer',$1)", [hash]);
const cb = await lg("b@t.it", "Buyer-pass-123!");
const pv = (await call(admin, "GET", "?op=reset-preview")).data.counts;
assert(
  pv.tasks > 10 &&
    pv.contracts === 6 &&
    pv.suppliers_all === 10 &&
    pv.suppliers_test === 9 &&
    pv.budget === 6 &&
    pv.categories === 1 &&
    pv.sap > 0,
);
ok("anteprima: quanto c'è da eliminare per ogni area");
assert.equal((await call(cb, "GET", "?op=reset-preview")).status, 403);
assert.equal((await call(cb, "POST", "?op=reset-run", { areas: ["tasks"], confirm: "ELIMINA" })).status, 403);
assert.equal((await call(admin, "POST", "?op=reset-run", { areas: ["tasks"] })).status, 400);
assert.equal((await call(admin, "POST", "?op=reset-run", { areas: [], confirm: "ELIMINA" })).status, 400);
assert.equal((await call(admin, "POST", "?op=reset-run", { areas: ["users"], confirm: "ELIMINA" })).status, 400);
ok("solo il Manager, con conferma e almeno un'area");
const ta = await call(admin, "POST", `?op=vendor-test-access&id=${extra.id}`);
assert.equal(ta.status, 200);
assert.equal(ta.data.email, extra.email);
assert.notEqual(ta.data.password, extra.password);
await lg(extra.email, ta.data.password);
await assert.rejects(lg(extra.email, extra.password));
ok("accesso di prova: nuova password per un fornitore di prova");
assert.equal((await call(admin, "POST", `?op=vendor-test-access&id=${real.id}`)).status, 403);
assert.equal((await call(cb, "POST", `?op=vendor-test-access&id=${extra.id}`)).status, 403);
ok("mai per i fornitori veri; solo il Manager");
const docPaths = (
  await pool.query(
    "select file_path from supplier_documents sd join suppliers s on s.id = sd.supplier_id where s.sap_code like 'SIMV%' limit 3",
  )
).rows.map(r => r.file_path);
assert(docPaths.length === 3 && docPaths.every(p => blob.store.has(p)));
let r = await call(admin, "POST", "?op=reset-run", { areas: ["suppliers_test"], confirm: "ELIMINA" });
assert.equal(r.status, 200);
assert.equal(r.data.deleted.suppliers_test, 9);
assert.equal(await n("select count(*)::int n from suppliers"), 1);
assert.equal((await pool.query("select name from suppliers")).rows[0].name, "Vero Fornitore Srl");
assert.equal(await n("select count(*)::int n from users where role = 'supplier'"), 1);
assert(docPaths.every(p => !blob.store.has(p)));
ok("fornitori di prova eliminati con accessi e documenti; quello vero resta");
assert.equal(await n("select count(*)::int n from contracts where supplier_id is not null"), 0);
assert.equal(await n("select count(*)::int n from contracts"), 6);
ok("i contratti restano, scollegati dal fornitore eliminato");
const cfgBefore = [
  await n("select count(*)::int n from buying_companies"),
  await n("select count(*)::int n from industry_codes"),
  await n("select count(*)::int n from doc_types"),
];
r = await call(admin, "POST", "?op=reset-run", { areas: ["tasks", "sap", "budget", "categories"], confirm: "ELIMINA" });
assert.equal(r.status, 200);
for (const t of ["tasks", "rfqs", "rda_lines", "po_lines", "sap_pos", "sap_imports", "mp_versions", "mp_lines", "categories"])
  assert.equal(await n(`select count(*)::int n from ${t}`), 0, t);
assert.equal(await n("select count(*)::int n from contracts"), 6);
ok("task, dati SAP, Master Plan e categorie svuotati");
r = await call(admin, "POST", "?op=reset-run", { areas: ["contracts", "suppliers_all"], confirm: "ELIMINA" });
assert.equal(r.data.deleted.contracts, 6);
assert.equal(r.data.deleted.suppliers_all, 1);
for (const t of ["contracts", "plan_steps", "suppliers", "supplier_documents"])
  assert.equal(await n(`select count(*)::int n from ${t}`), 0, t);
ok("contratti e tutti i fornitori eliminati");
assert.deepEqual(
  [
    await n("select count(*)::int n from buying_companies"),
    await n("select count(*)::int n from industry_codes"),
    await n("select count(*)::int n from doc_types"),
  ],
  cfgBefore,
);
assert.equal(await n("select count(*)::int n from users where role in ('manager','buyer')"), 2);
ok("configurazione e utenti del team intatti");
const audit = (await pool.query("select detail from config_audit where area = 'reset' order by id")).rows;
assert.equal(audit.length, 3);
assert(/Task e pratiche: \d+ → 0/.test(audit[1].detail));
ok("ogni pulizia è nel registro modifiche");
assert.equal((await call(admin, "POST", "?op=reset-run", { areas: ["tasks"], confirm: "ELIMINA" })).status, 200);
ok("ripetibile anche con aree già vuote");
console.log(`\n${passed} controlli superati`);
process.exit(0);
