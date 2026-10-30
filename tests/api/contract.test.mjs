import assert from "node:assert/strict";
const B = process.env.API_BUILD + "/api/";
process.env.DATABASE_URL = process.env.TEST_DB_URL;
process.env.ADMIN_EMAIL = "admin@test.it";
process.env.ADMIN_PASSWORD = "Admin-pass-123!";
process.env.SESSION_SECRET = "x".repeat(40);
const commit = await import(B + "commit.js"),
  state = await import(B + "state.js"),
  login = await import(B + "login.js");
const call = async (mod, cookie, method, body) => {
  const r = new Request("https://app.test/api/x", {
    method,
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
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
const lg = await call(login, null, "POST", { email: "admin@test.it", password: "Admin-pass-123!" });
const admin = lg.cookie;
let passed = 0;
const ok = n => {
  passed++;
  console.log("  ✓", n);
};
const base0 = {
  supplier: "ACME",
  object: "Test",
  category: "IT",
  country: "Italia",
  value: 100,
  currency: "EUR",
  start: "2026-01-01",
  end: "2026-12-31",
  owner: lg.data.user.name,
  boEmail: "",
  renewal: "Non definito",
  type: "Servizi",
  notes: "",
  ceased: false,
  fileName: null,
  filePath: null,
};
const base = base0;
let r = await call(commit, admin, "POST", { contract: { ...base, noticeDays: 90, noticeDate: "" } });
assert.equal(r.status, 200, JSON.stringify(r.data));
let s = (await call(state, admin, "GET")).data;
let c = s.contracts.find(x => x.id === r.data.contractId);
assert.equal(c.noticeDays, 90);
assert.equal(c.noticeDate, "2026-10-02");
ok("con i soli giorni di preavviso la data limite si calcola dalla scadenza");
r = await call(commit, admin, "POST", { contract: { ...base, noticeDays: 60, noticeDate: "2026-11-01" } });
assert.equal(r.status, 200);
c = (await call(state, admin, "GET")).data.contracts.find(x => x.id === r.data.contractId);
assert.equal(c.noticeDate, "2026-11-01");
ok("data limite indicata: salvata così com'è");
r = await call(commit, admin, "POST", { contract: { ...base, noticeDate: "2027-01-10" } });
assert.equal(r.status, 400);
ok("data limite dopo la scadenza: rifiutata");
r = await call(commit, admin, "POST", { contract: { ...base, noticeDays: -3 } });
assert.equal(r.status, 400);
ok("giorni non validi: rifiutati");
r = await call(commit, admin, "POST", { contract: { ...base } });
assert.equal(r.status, 200);
c = (await call(state, admin, "GET")).data.contracts.find(x => x.id === r.data.contractId);
assert.equal(c.noticeDays, null);
assert.equal(c.noticeDate, "");
ok("senza preavviso: nessuna data limite");
console.log(`\n${passed} controlli superati`);
process.exit(0);
