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
const b2 = (await pool.query("select id from users where email = $1", ["buyer2@test.it"])).rows[0].id;
const tasksMod = await import(B + "_tasks.js");
const ver = (
  await pool.query("insert into mp_versions (year, version, label) values (extract(year from current_date)::int, 1, 'v1') returning id")
).rows[0].id;
await pool.query(
  "insert into mp_lines (version_id, io, description, category, amount) values ($1,'IO1','Linea 1','CatA',1000), ($1,'IO2','Linea 2','CatB',500)",
  [ver],
);
const cat = (await pool.query("insert into categories (name) values ('CatA') returning id")).rows[0].id;
await pool.query("insert into category_map (kind, key, category_id) values ('mp','CatA',$1)", [cat]);
await pool.query("insert into category_buyers (category_id, user_id) values ($1,$2)", [cat, b2]);
const pgr = new Map([["G1", b1]]);
assert.equal(await tasksMod.assigneeFor(pool, [], "G1", pgr), b1);
ok("senza internal order: gruppo acquisti");
assert.equal(await tasksMod.assigneeFor(pool, ["IO2"], "G1", pgr), b1);
ok("internal order senza buyer né categoria con buyer: gruppo acquisti");
assert.equal(await tasksMod.assigneeFor(pool, ["IO1"], "G1", pgr), b2);
ok("categoria della riga di budget con un solo buyer: va a lui");
assert.equal((await P(buyer, "POST", "io-buyer", { io: "IO1", userId: b1 })).status, 403);
ok("solo il Manager assegna le righe di budget");
await pool.query(
  "insert into tasks (source, source_key, title, assignee_id, assignee_auto, meta, created_by) values ('rda','8001','RDA 8001 · auto',$1,true,$2,'SAP'), ('rda','8002','RDA 8002 · a mano',$1,false,$2,'SAP')",
  [b2, JSON.stringify({ io: { IO1: 100 } })],
);
let r = await P(admin, "POST", "io-buyer", { io: "IO1", userId: b1 });
assert.equal(r.status, 200, JSON.stringify(r.data));
assert.equal(r.data.moved, 1);
ok("assegnazione manuale: le RDA aperte non assegnate a mano passano al buyer");
const who = async k => (await pool.query("select assignee_id from tasks where source_key = $1", [k])).rows[0].assignee_id;
assert.equal(await who("8001"), b1);
assert.equal(await who("8002"), b2);
ok("quelle assegnate a mano restano dove sono");
assert.equal(await tasksMod.assigneeFor(pool, ["IO1"], "G1", new Map([["G1", b2]])), b1);
ok("l'assegnazione diretta vale più di categoria e gruppo");
const bv = (await P(admin, "GET", "budget")).data;
const l1 = bv.lines.find(x => x.io === "IO1");
assert.equal(l1.buyerVia, "io");
assert.equal(l1.buyerId, b1);
ok("il Budget mostra il buyer della riga");
r = await P(admin, "POST", "io-buyer", { io: "IO1", userId: null });
assert.equal(r.status, 200);
assert.equal(await tasksMod.assigneeFor(pool, ["IO1"], "G1", pgr), b2);
ok("tolta l'assegnazione: torna la categoria");

// ─── Caricamento massivo con il file del Master Plan
await pool.query(
  "insert into tasks (source, source_key, title, assignee_id, assignee_auto, meta, created_by) values ('rda','8003','RDA 8003 · da file',null,false,$1,'SAP')",
  [JSON.stringify({ io: { IOX: 50 } })],
);
const rawPost = async (c, qs, text, name) => {
  const rs = await portal.POST(
    new Request("https://app.test/api/x?" + qs, { method: "POST", headers: { cookie: c, "x-file-name": name }, body: text }),
  );
  return { status: rs.status, data: await rs.json() };
};
const csv =
  "Row Labels;NAME;CATEGORIA;BUYER;MP26\nIOX;Linea X;CatA;luca buyer;1000\nIOY;Linea Y;CatB;buyer@test.it;500\nIOZ;Linea Z;CatB;Nome Inesistente;300\nIOW;Linea W;CatB;;200\n";
const res = await rawPost(admin, "op=budget-import&year=2026", csv, "mp.csv");
assert.equal(res.status, 201, JSON.stringify(res.data));
assert.equal(res.data.buyersAssigned, 2);
assert.deepEqual(res.data.buyersUnmatched, ["Nome Inesistente"]);
ok("file con colonna Buyer: assegnate le righe riconosciute (nome o email), segnalati i nomi non riconosciuti");
const ass = Object.fromEntries((await pool.query("select io, user_id from io_buyers")).rows.map(r => [r.io, r.user_id]));
assert.equal(ass.IOX, b2);
assert.equal(ass.IOY, b1);
assert.equal(ass.IOZ, undefined);
assert.equal(ass.IOW, undefined);
ok("righe senza buyer o con buyer sconosciuto: nessuna assegnazione");
assert.equal(res.data.buyersMoved, 1);
assert.equal((await pool.query("select assignee_id from tasks where source_key = '8003'")).rows[0].assignee_id, b2);
ok("l'RDA aperta senza responsabile passa al buyer della riga");
const noCol = await rawPost(admin, "op=budget-import&year=2026", "Row Labels;MP26\nIOQ;100\n", "mp2.csv");
assert.equal(noCol.status, 201);
assert.equal(noCol.data.buyersAssigned, 0);
ok("file senza colonna Buyer: nessun cambiamento alle assegnazioni");
console.log(`\n${passed} controlli superati`);
process.exit(0);
