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
const day2 = day;
// dati minimi: società e codice merceologico per il fornitore di prova
await pool.query(
  "insert into buying_companies (code, name, sap_company_code, purch_org) values ('C1','Soc','1000','1000') on conflict do nothing",
);
await pool.query("insert into industry_codes (code, name) values ('I1','Ind') on conflict do nothing");
await pool.query(
  "insert into tasks (source, source_key, title, due, meta, created_by) values ('rda','9001','RDA 9001 · prova',$1,'{}','SAP')",
  [day2(3)],
);
let r = await P(buyer, "POST", "test-accesses", {});
assert.equal(r.status, 403);
ok("solo il Manager crea gli accessi");
r = await P(admin, "POST", "test-accesses", {});
assert.equal(r.status, 200, JSON.stringify(r.data));
const acc = r.data.accesses;
assert.deepEqual(
  acc.map(a => a.role),
  ["buyer", "bo", "viewer", "finance", "legal", "compliance", "itsec", "supplier"],
);
assert(acc.every(a => a.password.length >= 12));
ok("un accesso per ruolo, supplier incluso");
for (const a of acc) {
  const l = await call(login, null, "POST", "", { email: a.email, password: a.password });
  assert.equal(l.status, 200, "login " + a.role);
  assert.equal(l.data.user.role, a.role);
}
ok("ogni accesso entra con il ruolo giusto");
const bc = await signin(acc[0].email, acc[0].password);
assert((await P(bc, "GET", "tasks")).data.tasks.some(t => t.sourceKey === "9001"));
ok("il buyer di prova ha già un task da vedere");
const vs = (await P(bc, "GET", "vendors")).data;
assert(vs.vendors.length >= 1, "il buyer di prova vede il fornitore di prova");
ok("il buyer di prova vede almeno un fornitore (può invitarlo a un'offerta)");
const sc = await signin(acc[7].email, acc[7].password);
const me = (await P(sc, "GET", "supplier-me")).data.supplier;
assert(Array.isArray(me.companyNames));
ok("l'area fornitore riceve i nomi delle società");
const old = acc[0].password;
r = await P(admin, "POST", "test-accesses", {});
assert(!(await signin(acc[0].email, old)));
assert(await signin(acc[0].email, r.data.accesses[0].password));
ok("rigenerando cambiano le password");
r = await P(admin, "POST", "test-accesses-remove", {});
assert.equal(r.data.removed, 7);
assert(!(await signin(acc[0].email, r.data?.x ?? "boh")));
ok("eliminati i 4 utenti di prova");
assert.equal((await pool.query("select count(*)::int n from users where email like 'prova.%@procurementlab.test'")).rows[0].n, 0);
assert.equal((await pool.query("select count(*)::int n from tasks where assignee_id is not null and source_key = '9001'")).rows[0].n, 0);
ok("nessun utente rimasto e task tornato senza responsabile");
console.log(`\n${passed} controlli superati`);
process.exit(0);
