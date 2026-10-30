import assert from "node:assert/strict";
const B = process.env.API_BUILD + "/api/";
process.env.DATABASE_URL = process.env.TEST_DB_URL;
process.env.ADMIN_EMAIL = "admin@test.it";
process.env.ADMIN_PASSWORD = "Admin-pass-123!";
process.env.SESSION_SECRET = "x".repeat(40);
const portal = await import(B + "portal.js"),
  login = await import(B + "login.js"),
  db = await import(B + "_db.js"),
  stateApi = await import(B + "state.js");
await db.ensureSchema();
let passed = 0;
const ok = n => {
  passed++;
  console.log("  ✓", n);
};
const call = async (cookie, method, qs, body, headers = {}, mod = portal) => {
  const raw = body instanceof Uint8Array;
  const r = new Request("https://a/x" + qs, {
    method,
    headers: { ...(raw ? {} : { "content-type": "application/json" }), cookie, ...headers },
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
  });
  const res = await mod[method](r);
  const ab = await res.arrayBuffer();
  let data = null;
  try {
    data = JSON.parse(Buffer.from(ab).toString());
  } catch {}
  return { status: res.status, data, bytes: new Uint8Array(ab) };
};
const admin = (
  await login.POST(
    new Request("https://a/x", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "admin@test.it", password: "Admin-pass-123!" }),
    }),
  )
).headers
  .get("set-cookie")
  .split(";")[0];
let r = await call(admin, "POST", "?op=budget-demo", {});
assert.equal(r.status, 201, JSON.stringify(r.data));
assert.equal(r.data.suppliers, 8);
ok("simulazione caricata (anche senza configurazione)");
assert.equal((await call(admin, "POST", "?op=budget-demo", {})).status, 409);
const vendors = (await call(admin, "GET", "?op=vendors")).data.vendors;
assert.equal(vendors.filter(x => x.sapCode?.startsWith("SIMV") && x.status === "registered" && x.qualification === "valid").length, 8);
ok("8 fornitori registrati e qualificati");
let tasks = (await call(admin, "GET", "?op=tasks")).data.tasks;
const open = tasks.filter(t => t.source === "rda" && t.status === "open");
assert.equal(open.length, 6);
assert(open.some(t => t.sourcingStatus === "missing"));
assert(open.some(t => t.sourcingStatus === "ok" && t.saving));
assert(open.some(t => t.sourcingStatus === "pending"));
assert(open.some(t => !t.sourcingRequired));
assert(open.some(t => t.pos.length));
ok("RDA aperte: da confrontare, confrontata con saving, eccezione in attesa, sotto soglia, con PO già emesso");
const renew = tasks.filter(t => t.source === "contract");
assert.equal(renew.length, 2);
ok("rinnovi: contratto in scadenza e contratto scaduto senza esito");
assert(tasks.some(t => t.kind === "purchase") && tasks.some(t => t.kind === "activity"));
ok("acquisti in previsione e un'attività");
const st = (await call(admin, "GET", "", undefined, {}, stateApi)).data;
const sims = st.contracts.filter(c => c.category === "Simulazione");
assert.equal(sims.length, 6);
assert(sims.every(c => c.supplierId && c.internalOrder));
assert(sims.every(c => st.plans[c.id]?.length === 7));
ok("contratti collegati a fornitore e internal order, con piano");
const v26 = (await call(admin, "GET", "?op=budget&year=2026")).data;
assert.equal(v26.lines.find(l => l.io === "SIM2600000003").committed, 262500);
assert(v26.lines.find(l => l.io === "SIM2600000009").residual < 0);
assert.equal(v26.unassigned.length, 1);
ok("Master Plan: impegnato da RDA ordinate e aperte, sforamenti, RDA senza IO");
// File SAP di prova
const pr = (await call(admin, "GET", "?op=budget-demo-file&kind=pr")).bytes,
  po = (await call(admin, "GET", "?op=budget-demo-file&kind=po")).bytes;
r = await call(admin, "POST", "?op=rda-import", pr, { "x-file-name": "OPEN_PR_PROVA.XLS" });
assert.equal(r.status, 200, JSON.stringify(r.data));
assert.equal(r.data.created, 4);
assert.equal(r.data.closedPo, 0);
ok("file RDA di prova: 4 nuove RDA; quella con PO resta aperta finché non sono fatti tutti i passaggi");
r = await call(admin, "POST", "?op=rda-import", po, { "x-file-name": "PO_LAST_7D_PROVA.XLS" });
assert.equal(r.status, 200, JSON.stringify(r.data));
assert.equal(r.data.linked, 1);
ok("file ordini di prova: PO collegato alla RDA");
tasks = (await call(admin, "GET", "?op=tasks")).data.tasks;
const t1 = tasks.find(t => t.sourceKey === "SIM-8200001");
assert.equal(t1.pos[0].po, "SIMPO3001");
assert.deepEqual(Object.keys(t1.meta.io), ["SIM2600000010"]);
assert.equal(tasks.filter(t => t.source === "rda" && t.status === "open").length, 10);
const k = (await call(admin, "GET", "?op=kpis")).data;
assert(k.sourcing.saving12m > 0);
ok("indicatori popolati (saving)");
r = await call(admin, "DELETE", "?op=budget-demo");
assert(r.data.deleted > 0);
assert.equal((await call(admin, "GET", "?op=tasks")).data.tasks.length, 0);
assert.equal((await call(admin, "GET", "?op=vendors")).data.vendors.length, 0);
assert.equal((await call(admin, "GET", "", undefined, {}, stateApi)).data.contracts.length, 0);
assert(!(await call(admin, "GET", "?op=budget&year=2026")).data.demo);
ok("eliminazione completa");
console.log(`\n${passed} controlli superati`);
process.exit(0);
