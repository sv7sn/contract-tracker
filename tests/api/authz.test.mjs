import assert from "node:assert/strict";
const B = process.env.API_BUILD + "/api/";
process.env.DATABASE_URL = process.env.TEST_DB_URL;
process.env.ADMIN_EMAIL = "admin@test.it"; process.env.ADMIN_PASSWORD = "Admin-pass-123!"; process.env.SESSION_SECRET = "x".repeat(40);
const portal = await import(B + "portal.js"), login = await import(B + "login.js"), commitApi = await import(B + "commit.js"), stateApi = await import(B + "state.js");
const db = await import(B + "_db.js"), crypto = await import(B + "_crypto.js"), blob = await import(process.env.API_BUILD + "/node_modules/@vercel/blob/index.js");
await db.ensureSchema(); const pool = db.getPool();
let passed = 0; const ok = n => { passed++; console.log("  ✓", n); };
const call = async (mod, cookie, method, qs, body) => {
  const r = new Request("https://app.test/api/x" + qs, { method, headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const res = await mod[method](r); const sc = res.headers.get("set-cookie"); let data; try { data = await res.clone().json(); } catch { data = null; }
  return { status: res.status, data, cookie: sc ? sc.split(";")[0] : null, res };
};
const P = (c, m, op, body, extra = "") => call(portal, c, m, `?op=${op}${extra}`, body);
const signin = async (e, p) => (await call(login, null, "POST", "", { email: e, password: p })).cookie;
const mk = async (e, n, r) => pool.query("insert into users (email,name,role,title,password_hash) values ($1,$2,$3,'t',$4) returning id", [e, n, r, await crypto.hashPassword("Password-123!")]).then(x => x.rows[0].id);
const b1 = await mk("buyer@test.it", "Marta Buyer", "buyer"); await mk("buyer2@test.it", "Luca Buyer", "buyer");
const admin = await signin("admin@test.it", "Admin-pass-123!"), buyer = await signin("buyer@test.it", "Password-123!"), buyer2 = await signin("buyer2@test.it", "Password-123!");
const day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const file = n => { const p = `contracts/${globalThis.crypto.randomUUID()}/${n}`; blob.store.set(p, Buffer.from("%PDF")); return p; };
const newContract = async (supplier, end, extra = {}) => (await call(commitApi, admin, "POST", "", { contract: { supplier, object: "Servizio " + supplier, category: "IT", country: "Italia", value: 50000, currency: "EUR", start: day(-700), end, owner: "Marta Buyer", boEmail: "", renewal: "Non definito", type: "Servizi", notes: "", ceased: false, fileName: "c.pdf", filePath: file("c.pdf"), noticeDays: null, noticeDate: "", ...extra } })).data.contractId;
await pool.query("insert into buying_companies (code, name, sap_company_code, purch_org) values ('C1','Soc','1000','1000') on conflict do nothing"); await pool.query("insert into industry_codes (code, name) values ('I1','Ind') on conflict do nothing");
import fs from "node:fs";
// Verifica di sicurezza interna e automatica: permessi per ogni operazione e ruolo, dati ostili, accessi ai dati di altri.
// Non sostituisce un test di penetrazione indipendente.
const demoMod = await import(B + "_demo.js"); const mgr = { id: 1, role: "manager", name: "Admin" };
const supA = await demoMod.createDemoSupplier(mgr, { name: "Fornitore Authz A Srl" }), supB = await demoMod.createDemoSupplier(mgr, { name: "Fornitore Authz B Srl" });
const cookies = { manager: admin, buyer, anon: null };
for (const r of ["finance", "bo", "viewer", "legal", "compliance", "itsec"]) { await mk(`${r}@test.it`, `Utente ${r}`, r); cookies[r] = await signin(`${r}@test.it`, "Password-123!"); }
cookies.supplier = await signin(supA.email, supA.password); const supBc = await signin(supB.email, supB.password);
const src = fs.readFileSync(new URL("../../api/portal.ts", import.meta.url), "utf8");
const found = new Set([...src.matchAll(/op === "([a-z0-9-]+)"/g)].map(m => m[1]));
for (const l of src.split("\n")) if (l.includes(".includes(op)")) for (const m of l.matchAll(/"([a-z0-9-]+)"/g)) found.add(m[1]);
const OPS = [...found].filter(o => !["GET", "POST", "DELETE"].includes(o)).sort();
assert(OPS.length > 100, `operazioni trovate: ${OPS.length}`); ok(`${OPS.length} operazioni del router individuate dal codice`);
const SKIP = new Set(["reset-run", "cron-reminders", "rda-ingest", "sessions-revoke"]);
const hit = async (role, op, method, extra = "&id=1", cookie = cookies[role]) => {
  const res = await portal[method](new Request(`https://app.test/api/portal?op=${op}${extra}`, { method, headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: method === "GET" ? undefined : "{}" }));
  await res.arrayBuffer().catch(() => undefined); return res.status;
};
const ORDER = ["anon", "supplier", "viewer", "legal", "compliance", "itsec", "bo", "finance", "buyer", "manager"];
const res = []; const t0 = Date.now();
for (const role of ORDER) for (const op of OPS) for (const method of ["GET", "POST", "DELETE"]) if (!SKIP.has(op)) res.push({ role, op, method, status: await hit(role, op, method) });
const by = (role, pred) => res.filter(r => r.role === role && pred(r)).map(r => `${r.method} ${r.op}`).sort();

// 1. Senza accesso
assert.deepEqual([...new Set(by("anon", r => r.status !== 401).map(x => x.split(" ")[1]))].sort(), ["activate", "health", "invite-info", "sso-callback", "sso-config", "sso-start"]); ok("senza accesso rispondono solo invito, attivazione, salute e i passaggi dell'accesso aziendale: tutto il resto è 401");
// 2. Nessun errore del server con dati vuoti, per nessun ruolo
const five = res.filter(r => r.status >= 500).map(r => `${r.role} ${r.method} ${r.op}`); assert.deepEqual(five, []); ok(`nessuna risposta 500 su ${res.length} chiamate con dati vuoti, per ogni ruolo e metodo`);
// 3. Il fornitore esce solo dalla sua area
assert.deepEqual([...new Set(by("supplier", r => !r.op.startsWith("supplier-") && ![403, 404, 405].includes(r.status)).map(x => x.split(" ")[1]))].sort(), ["activate", "doc-download", "health", "my-lang", "sso-config"]); ok("il fornitore non raggiunge nessuna operazione dello staff (solo i propri documenti)");
// 4. Ruoli senza permessi di scrittura
const writable = role => [...new Set(by(role, r => r.method !== "GET" && ![403, 404, 405].includes(r.status)))].sort();
const base = ["POST activate", "POST my-lang"]; // attivazione dell'invito e lingua del proprio profilo: consentite a tutti
assert.deepEqual(writable("viewer"), base); assert.deepEqual(writable("bo"), base); assert.deepEqual(writable("compliance"), base); assert.deepEqual(writable("itsec"), base);
assert.deepEqual(writable("legal"), [...base, "POST clause-save"].sort());
assert.deepEqual(writable("finance"), [...base, "POST budget-import", "POST doc-remind", "POST vendor-action", "POST vendor-checks"].sort()); ok("Controlling/CFO, Business Owner, Compliance e IT Security non scrivono; Legal e Finance solo dove previsto");

// 5. Dati ostili
const evil = ["' OR '1'='1", "'); DROP TABLE users; --", "<script>alert(1)</script>", "1; select pg_sleep(5)", "../../etc/passwd", "\u0000", "%00", "x".repeat(5000)];
let bad500 = [];
for (const p of evil) for (const [role, op, extra] of [["buyer", "tasks-archive", `&q=${encodeURIComponent(p)}`], ["buyer", "task", `&id=${encodeURIComponent(p)}`], ["admin", "vendors", `&q=${encodeURIComponent(p)}`], ["buyer", "drafts", `&id=${encodeURIComponent(p)}`], ["manager", "spend-lines", `&year=2026&supplier=${encodeURIComponent(p)}`]]) { const s = await hit(role === "admin" ? "manager" : role, op, "GET", extra); if (s >= 500) bad500.push(`${op}:${s}`); }
for (const id of ["abc", "-1", "0", "99999999999999", "1.5", "NaN"]) for (const op of ["task", "vendor", "contract-obligations", "obligations", "drafts", "draft-file", "clauses", "doc-download", "task-doc-download"]) for (const role of ["manager", "buyer", "supplier"]) { const s = await hit(role, op, "GET", `&id=${id}`); if (s >= 500) bad500.push(`${role} ${op}?id=${id}:${s}`); }
assert.deepEqual(bad500, []); ok("testi ostili (SQL, script, percorsi, byte nulli, 5000 caratteri) e identificativi non validi: mai un errore del server");
const t = await P(buyer, "POST", "task-create", { title: "x'); DROP TABLE tasks; -- <b>t</b>", kind: "activity" }); assert.equal(t.status, 201);
assert.equal((await pool.query("select title from tasks where id = $1", [t.data.task.id])).rows[0].title, "x'); DROP TABLE tasks; -- <b>t</b>"); for (const tb of ["users", "tasks", "contracts", "suppliers"]) assert.equal((await pool.query("select to_regclass($1) as t", [tb])).rows[0].t, tb); ok("un testo con SQL dentro viene salvato così com'è: le tabelle restano");

// 6. Dati di altri
const tk = (await P(buyer, "POST", "task-create", { title: "Pratica riservata di Marta", kind: "activity" })).data.task;
assert.equal((await P(buyer2, "GET", "task", undefined, `&id=${tk.id}`)).status, 404); assert.equal((await P(buyer2, "POST", "task-update", { title: "rubata" }, `&id=${tk.id}`)).status, 404); assert.equal((await P(buyer2, "DELETE", "task", undefined, `&id=${tk.id}`)).status, 404); ok("un buyer non vede, modifica né elimina le pratiche di un altro");
const dr = await P(buyer, "POST", "draft-upload", { fileName: "a.docx", filePath: file("a.docx"), size: 1 }, `&id=${tk.id}`);
for (const [n, c] of [["buyer2", buyer2], ["viewer", cookies.viewer], ["compliance non invitato", cookies.compliance]]) for (const op of ["drafts", "draft-audit", "draft-findings"]) { const s = await portal.GET(new Request(`https://app.test/api/portal?op=${op}&id=${tk.id}`, { headers: { cookie: c } })); assert([403, 404].includes(s.status), `${n} ${op}: ${s.status}`); }
assert.equal((await portal.GET(new Request(`https://app.test/api/portal?op=draft-file&id=${dr.data.draftId}`, { headers: { cookie: buyer2 } }))).status, 404); ok("le bozze riservate non si leggono né si scaricano senza essere invitati");
await pool.query("insert into supplier_documents (supplier_id, type, file_name, file_path, uploaded_by) values ($1,'visura','riservato.pdf',$2,'t')", [supA.id, file("riservato.pdf")]);
const docA = (await pool.query("select id from supplier_documents where supplier_id = $1 order by id desc limit 1", [supA.id])).rows[0].id;
assert.equal(await hit("supplier", "doc-download", "GET", `&id=${docA}`), 200); assert.equal(await hit("supplier", "doc-download", "GET", `&id=${docA}`, supBc), 404); assert.equal(await hit("supplier", "supplier-doc", "DELETE", `&id=${docA}`, supBc), 404); ok("un fornitore non scarica né elimina i documenti di un altro fornitore");
assert.equal(await hit("supplier", "supplier-negotiation", "GET", `&id=${tk.id}`, supBc), 404); ok("né le trattative");
console.log(`\n${passed} controlli superati (${Math.round((Date.now() - t0) / 1000)} s)`); await pool.end();
