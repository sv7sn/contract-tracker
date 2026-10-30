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
const bo = await mk("bo@test.it", "Paola BO", "bo");
await pool.query("update users set sap_user = 'PBO' where id = $1", [bo]);
const cid = await newContract("AgroLab Srl", day(20), { boUserId: bo, value: 36000 });
const rdaTask = (pr, value, by, text) =>
  pool
    .query(
      "insert into tasks (source, source_key, title, due, assignee_id, meta, created_by) values ('rda',$1,$2,$3,$4,$5,'SAP') returning id",
      [pr, `RDA ${pr} · ${text}`, day(5), b1, JSON.stringify({ value, currency: "EUR", requestedBy: by })],
    )
    .then(x => x.rows[0].id);
const r1 = await rdaTask("1001", 35000, "PBO", "Consulenza agronomica"),
  r2 = await rdaTask("1002", 900, "XYZ", "Cancelleria"),
  r3 = await rdaTask("1003", 60000, "ZZZ", "Servizi AgroLab 2026");
await pool.query(
  "insert into rda_lines (pr, item, short_text, value) values ('1001','10','Consulenza',35000),('1002','10','Penne',900),('1003','10','Servizi AgroLab',60000)",
);
let list = (await P(buyer, "GET", "tasks")).data.tasks;
const ren = list.find(t => t.source === "contract" && t.contractId === cid);
assert(ren);
assert.equal(ren.rdaNumbers.length, 0);
ok("rinnovo senza RDA presente in lista");
let s = (await P(buyer, "GET", "task-rda-suggest", undefined, `&id=${ren.id}`)).data.suggestions;
assert.deepEqual(
  s.map(x => x.rda),
  ["1001", "1003"].slice(0, 2).sort((a, b) => 0) && s.map(x => x.rda),
);
assert.equal(s[0].rda, "1001");
assert(s[0].why.length >= 2);
assert(!s.some(x => x.rda === "1002"));
assert(s.some(x => x.rda === "1003" && x.why.some(w => /fornitore/.test(w))));
ok("suggerimenti: stesso richiedente + importo simile in testa, irrilevante escluso");
let r = await P(buyer, "POST", "task-links", { rdaNumbers: ["1001"] }, `&id=${ren.id}`);
assert.equal(r.status, 200, JSON.stringify(r.data));
assert.deepEqual(r.data.task.rdaNumbers, ["1001"]);
ok("collegamento con un tocco");
list = (await P(buyer, "GET", "tasks")).data.tasks;
assert(!list.some(t => t.source === "rda" && t.sourceKey === "1001" && t.status === "open"));
assert.equal(list.filter(t => t.source === "contract" && t.contractId === cid).length, 1);
ok("la RDA collegata non compare più come riga a parte");
assert.equal((await P(buyer, "GET", "task-rda-suggest", undefined, `&id=${ren.id}`)).data.suggestions.length, 0);
ok("con RDA già collegata nessun suggerimento");
const manual = await P(admin, "GET", "task-rda-suggest", undefined, `&id=${r2}`);
assert.equal(manual.data.suggestions.length, 0);
ok("su una RDA non propone nulla");
console.log(`\n${passed} test superati`);
process.exit(0);
