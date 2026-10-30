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
await pool.query("insert into buying_companies (code, name, sap_company_code, purch_org) values ('C1','Soc','1000','1000')");
await pool.query("insert into industry_codes (code, name) values ('I1','Ind')");
const mgr = { id: 1, role: "manager", name: "Admin" };
const a = await demo.createDemoSupplier(mgr, { name: "Alfa Srl", sapCode: "SAPA" }),
  b = await demo.createDemoSupplier(mgr, { name: "Beta Srl", sapCode: "SAPB" });
const hash = await crypto.hashPassword("Buyer-pass-123!");
const buyerId = (
  await pool.query("insert into users (email, name, role, password_hash) values ('buyer@t.it','Buyer Uno','buyer',$1) returning id", [hash])
).rows[0].id;
const buyer2 = (
  await pool.query("insert into users (email, name, role, password_hash) values ('buyer2@t.it','Buyer Due','buyer',$1) returning id", [
    hash,
  ])
).rows[0].id;
void buyer2;
const cb = await lg("buyer@t.it", "Buyer-pass-123!"),
  cb2 = await lg("buyer2@t.it", "Buyer-pass-123!"),
  cs = await lg(a.email, a.password);
const R = (c, id, body) => call(c, "POST", `?op=vendor-rating-add&id=${id}`, body);
let r = await call(cb, "GET", `?op=vendor-rating&id=${a.id}`);
assert.equal(r.status, 200);
assert.equal(r.data.scorecard.overall, null);
assert.equal(r.data.scorecard.count, 0);
ok("fornitore senza voti: nessun punteggio");
assert.equal((await R(cb, a.id, { quality: 5, delivery: 4, service: 5 })).status, 400);
assert.equal((await R(cb, a.id, { quality: 6, delivery: 4, service: 5, price: 3 })).status, 400);
assert.equal((await R(cb, a.id, { quality: 2, delivery: 4, service: 5, price: 3 })).status, 400);
ok("servono quattro voti da 1 a 5; con 1 o 2 il commento");
assert.equal((await R(cs, a.id, { quality: 5, delivery: 5, service: 5, price: 5 })).status, 403);
assert.equal((await call(cs, "GET", `?op=vendor-rating&id=${a.id}`)).status, 403);
ok("il fornitore non vede né dà valutazioni");
r = await R(cb, a.id, { quality: 5, delivery: 4, service: 5, price: 3, comment: "Ottimo servizio", po: "4500001" });
assert.equal(r.status, 201);
await R(cb2, a.id, { quality: 4, delivery: 4, service: 4, price: 4 });
let sc = (await call(cb, "GET", `?op=vendor-rating&id=${a.id}`)).data.scorecard;
assert.equal(sc.count, 2);
assert.equal(sc.criteria.quality, 4.5);
assert.equal(sc.criteria.price, 3.5);
assert.equal(sc.overall, 4.1);
assert.equal(sc.ratings.filter(x => x.mine).length, 1);
ok("medie per criterio e complessiva");
await pool.query("update supplier_ratings set created_at = now() - interval '30 months' where rater_name = 'Buyer Due'");
sc = (await call(cb, "GET", `?op=vendor-rating&id=${a.id}`)).data.scorecard;
assert.equal(sc.count, 1);
assert.equal(sc.overall, 4.3);
assert.equal(sc.ratings.length, 2);
ok("contano solo gli ultimi 24 mesi");
const sum = (await call(cb, "GET", "?op=vendor-ratings")).data.ratings;
assert.equal(sum[a.id].count, 1);
assert.equal(sum[a.id].overall, 4.3);
assert(!sum[b.id]);
ok("riepilogo per la lista");
await pool.query(
  "insert into po_lines (po, item, doc_date, supplier_code, value, currency) values ('P1','10', current_date - 10, 'SAPA', 12000, 'EUR'), ('P1','20', current_date - 10, 'SAPA', 3000, 'EUR'), ('P0','10', current_date - 400, 'SAPA', 9999, 'EUR')",
);
sc = (await call(cb, "GET", `?op=vendor-rating&id=${a.id}`)).data.scorecard;
assert.equal(sc.spend12m, 15000);
assert.equal(sc.pos12m, 1);
ok("ordini degli ultimi 12 mesi dai file SAP");
const sid = (await pool.query("select id from supplier_ratings where rater_name = 'Buyer Uno'")).rows[0].id;
assert.equal((await call(cb2, "DELETE", `?op=vendor-rating&id=${sid}`)).status, 403);
assert.equal((await call(cb, "DELETE", `?op=vendor-rating&id=${sid}`)).status, 200);
ok("ognuno elimina solo le proprie valutazioni");
await pool.query("update suppliers set status = 'draft' where id = $1", [b.id]);
assert.equal((await R(admin, b.id, { quality: 5, delivery: 5, service: 5, price: 5 })).status, 400);
ok("si valutano solo i fornitori registrati");
console.log(`\n${passed} controlli superati`);
process.exit(0);
