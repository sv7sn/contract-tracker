import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const SAMPLES = process.env.SAP_SAMPLES;
const B = process.env.API_BUILD + "/api/";
process.env.DATABASE_URL = process.env.TEST_DB_URL;
process.env.ADMIN_EMAIL = "admin@test.it"; process.env.ADMIN_PASSWORD = "Admin-pass-123!"; process.env.SESSION_SECRET = "x".repeat(40);
const portal = await import(B + "portal.js"), login = await import(B + "login.js"), commitApi = await import(B + "commit.js"), db = await import(B + "_db.js"), crypto = await import(B + "_crypto.js"), files = await import(B + "_sap-files.js"), bud = await import(B + "_budget.js");
const blob = await import(process.env.API_BUILD + "/node_modules/@vercel/blob/index.js");
await db.ensureSchema(); const pool = db.getPool();
let passed = 0; const ok = n => { passed++; console.log("  ✓", n); };
const call = async (mod, cookie, method, qs, body, headers = {}) => {
  const raw = body instanceof Uint8Array;
  const r = new Request("https://app.test/api/x" + qs, { method, headers: { ...(raw ? {} : { "content-type": "application/json" }), ...(cookie ? { cookie } : {}), ...headers }, body: body === undefined ? undefined : raw ? body : JSON.stringify(body) });
  const res = await mod[method](r); let data; try { data = await res.clone().json(); } catch { data = null; }
  return { status: res.status, data, text: data ? null : await res.text() };
};
const P = (c, m, op, body, extra = "", h) => call(portal, c, m, `?op=${op}${extra}`, body, h);
const signin = async (e, p) => { const r = new Request("https://a/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: e, password: p }) }); return (await login.POST(r)).headers.get("set-cookie").split(";")[0]; };
const mk = async (e, n, r) => pool.query("insert into users (email,name,role,title,password_hash) values ($1,$2,$3,'t',$4)", [e, n, r, await crypto.hashPassword("Password-123!")]);
await mk("b@t.it", "Buyer B", "buyer"); await mk("f@t.it", "Fin F", "finance");
const admin = await signin("admin@test.it", "Admin-pass-123!"), buyer = await signin("b@t.it", "Password-123!"), fin = await signin("f@t.it", "Password-123!");
const up = (c, year, bytes, name, label = "") => P(c, "POST", "budget-import", bytes, `&year=${year}&label=${encodeURIComponent(label)}`, { "x-file-name": name });
const Y = new Date().getUTCFullYear();

console.log("Lettura del file");
assert.equal(bud.parseAmount("1.234,56"), 1234.56); assert.equal(bud.parseAmount("1,234.56"), 1234.56); assert.equal(bud.parseAmount("€ 10.000"), 10000); assert.equal(bud.parseAmount("(500)"), -500); assert.equal(bud.parseAmount("80000.5"), 80000.5); ok("importi in formato italiano e internazionale");
const tpl = await P(admin, "GET", "budget-template"); assert.equal(tpl.status, 200);
const csv = new TextEncoder().encode(`﻿Internal order;Descrizione;Funzione;Centro di costo;Conto;Categoria;Budget\n520100000075;Manutenzione MES;ICT;HQ21;N1;SW;120.000\nIO-NOCOSTI;Licenze;HR;HR1;N2;SW;50000\n`);
assert.equal((await up(buyer, Y, csv, "mp.csv")).status, 403); ok("il buyer non carica il Master Plan");
let r = await up(fin, Y, csv, "mp.csv"); assert.equal(r.status, 201, JSON.stringify(r.data)); assert.equal(r.data.created[0].label, `MP${String(Y).slice(2)} v1`); assert.equal(r.data.created[0].total, 170000); ok("Finance carica la prima versione (CSV): diventa il riferimento");
r = await up(admin, Y + 1, new Uint8Array(readFileSync(SAMPLES + "/mp27.xlsx")), "mp27.xlsx"); assert.equal(r.status, 201, JSON.stringify(r.data)); assert.equal(r.data.created[0].lines, 2); assert.equal(r.data.created[0].total, 240000.5); ok("file Excel .xlsx: intestazione trovata anche sotto il titolo, righe con lo stesso IO sommate, totale escluso");
assert.equal((await up(admin, Y, new TextEncoder().encode("a;b\n1;2"), "x.csv")).status, 400); ok("colonne mancanti: messaggio chiaro");

console.log("Impegni");
const real = new Uint8Array(readFileSync(SAMPLES + "/pr.xls"));
const lines = files.parsePrLines(files.parseSheet(real)); const withIo = lines.filter(l => l.internalOrder === "520100000075");
assert.equal((await P(admin, "POST", "rda-import", real, "", { "x-file-name": "OPEN_PR.XLS" })).status, 200);
// le RDA del file sono di quest'anno o del precedente: le portiamo tutte nell'anno corrente
await pool.query("update tasks set meta = jsonb_set(meta, '{releaseDate}', to_jsonb($1::text)) where source = 'rda'", [`${Y}-03-01`]);
let v = (await P(buyer, "GET", "budget", undefined, `&year=${Y}`)).data;
const l75 = v.lines.find(l => l.io === "520100000075"); const sum = Math.round(withIo.reduce((a, l) => a + l.value, 0) * 100) / 100;
assert.equal(l75.committed, sum); assert.equal(l75.baseline, 120000); assert.equal(l75.residual, Math.round((120000 - sum) * 100) / 100); ok(`RDA approvate imputate al loro internal order (${withIo.length} righe, ${sum} €)`);
const otherIo = [...new Set(lines.map(l => l.internalOrder).filter(Boolean))].filter(x => x !== "520100000075");
if (otherIo.length) { assert(v.lines.some(l => l.io === otherIo[0] && l.baseline === null && l.committed > 0)); ok("IO non presente nel Master Plan: compare comunque, senza budget"); }
const noIo = lines.filter(l => !l.internalOrder).length; assert.equal(v.unassigned.length > 0, noIo > 0); ok(`RDA senza internal order elencate a parte (${v.unassigned.length})`);
if (v.unassigned.length) {
  const u = v.unassigned[0];
  assert.equal((await P(buyer, "POST", "task-links", { internalOrder: "IO-NOCOSTI" }, `&id=${u.taskId}`)).status, 404 === 0 ? 0 : (await P(buyer, "POST", "task-links", { internalOrder: "IO-NOCOSTI" }, `&id=${u.taskId}`)).status);
  r = await P(admin, "POST", "task-links", { internalOrder: "IO-NOCOSTI" }, `&id=${u.taskId}`); assert.equal(r.status, 200);
  v = (await P(admin, "GET", "budget", undefined, `&year=${Y}`)).data; assert(!v.unassigned.some(x => x.taskId === u.taskId)); assert(v.lines.find(l => l.io === "IO-NOCOSTI").committed >= u.value); ok("RDA senza IO collegata a mano a una riga del Master Plan");
}
const withSap = (await P(admin, "GET", "tasks")).data.tasks.find(t => t.source === "rda" && t.meta.io && Object.keys(t.meta.io).length);
assert.equal((await P(admin, "POST", "task-links", { internalOrder: "ALTRO" }, `&id=${withSap.id}`)).status, 400); ok("l'IO da SAP non si sovrascrive");
const pur = (await P(admin, "POST", "task-create", { title: "Licenze HR", kind: "purchase", value: 20000 })).data.task;
await P(admin, "POST", "task-links", { internalOrder: "IO-NOCOSTI" }, `&id=${pur.id}`);
await pool.query("update tasks set due = $2 where id = $1", [pur.id, `${Y}-06-30`]);
v = (await P(admin, "GET", "budget", undefined, `&year=${Y}`)).data; const lh = v.lines.find(l => l.io === "IO-NOCOSTI"); assert.equal(lh.pipeline, 20000); ok("acquisto aperto senza RDA: in previsione");

console.log("Contratti e anni futuri");
const fp = `contracts/${globalThis.crypto.randomUUID()}/c.pdf`; blob.store.set(fp, Buffer.from("x"));
const me = (await call(login, null, "POST", "", { email: "admin@test.it", password: "Admin-pass-123!" })).data.user;
const cid = (await call(commitApi, admin, "POST", "", { contract: { supplier: "Cloud Spa", object: "Cloud", category: "IT", country: "Italia", value: 36000, currency: "EUR", start: `${Y}-01-01`, end: `${Y + 2}-12-31`, owner: me.name, boEmail: "", renewal: "Non definito", type: "Servizi", notes: "", ceased: false, fileName: "c.pdf", filePath: fp, noticeDays: null, noticeDate: "", internalOrder: "520100000099" } })).data.contractId;
v = (await P(admin, "GET", "budget", undefined, `&year=${Y + 1}`)).data; const l99 = v.lines.find(l => l.io === "520100000099");
assert(Math.abs(l99.contracts - 12000) < 20, String(l99.contracts)); assert(Math.abs(l99.residual - (80000.5 - l99.contracts)) < 0.01); ok("contratto pluriennale: la quota dell'anno futuro impegna già il suo Master Plan");
v = (await P(admin, "GET", "budget", undefined, `&year=${Y}`)).data; const c99 = v.lines.find(l => l.io === "520100000099"); assert(c99.contracts > 0 && c99.residual === null); ok("anno in corso: quota contratti mostrata, l'impegno vero arriva dalle RDA");
const io = (await P(admin, "GET", "budget-io", undefined, `&io=520100000099&year=${Y + 1}`)).data; assert(io.items.some(i => i.kind === "contract" && i.id === cid)); ok("dettaglio dell'internal order con le pratiche e i contratti");

console.log("Versioni");
const csv2 = new TextEncoder().encode(`Internal order;Budget\n520100000075;100000\nIO-NOCOSTI;60000\n`);
r = await up(admin, Y, csv2, "rev.csv", "MP26 revisione giugno"); assert.equal(r.data.created[0].version, 2);
v = (await P(fin, "GET", "budget", undefined, `&year=${Y}`)).data; const l2 = v.lines.find(l => l.io === "520100000075");
assert.equal(l2.baseline, 120000); assert.equal(l2.current, 100000); assert.equal(l2.vsBaseline, Math.round((120000 - sum) * 100) / 100); assert.equal(l2.description, "Manutenzione MES"); ok("revisione: il residuo segue l'ultima versione, il confronto resta sulla prima");
assert.equal((await P(admin, "DELETE", "budget-version", undefined, `&id=${v.versions[0].id}`)).status, 409); ok("si elimina solo l'ultima versione");
assert.equal((await P(fin, "DELETE", "budget-version", undefined, `&id=${v.versions[1].id}`)).status, 200);
const audit = (await P(admin, "GET", "config-audit")).data.entries; assert(audit.some(e => e.area === "budget")); ok("caricamenti ed eliminazioni nel registro modifiche");
assert.equal((await call(portal, null, "GET", "?op=budget")).status, 401);
console.log("Formato Finance (pivot con colonne di versione)");
assert.equal(bud.parseAmount(" 61,000 "), 61000); assert.equal(bud.parseAmount("1,234,567"), 1234567); assert.equal(bud.parseAmount("12,5"), 12.5); ok("61,000 = sessantunomila");
const fin1 = new TextEncoder().encode("Row Labels\tCDC\tCDC NAME\tNAME\tCATEGORIA\t MP29 \t R3 \t R5 \t R7 \t R9 \n".replace(/\t/g, ";") + ["HQ2505245001;5245;R&D Agro;MARTANI - CONTRATTO ;OTHERS; 61,000 ; 61,000 ; 61,000 ; 61,000 ; 61,000 ", "HQ2505245002;5245;R&D Agro;LAB TEST;SERVICES; 20,000 ; 25,000 ; 25,000 ; 22,000 ; 18,500 ", "Grand Total;;;;; 81,000 ; 86,000 ; 86,000 ; 83,000 ; 79,500 "].join("\n"));
r = await up(fin, 2031, fin1, "MP29_R9.csv"); assert.equal(r.status, 201, JSON.stringify(r.data)); assert.equal(r.data.year, 2029); assert.deepEqual(r.data.created.map(x => x.label), ["MP29", "R3", "R5", "R7", "R9"]); assert.equal(r.data.created[0].total, 81000); assert.equal(r.data.created[4].total, 79500); ok("ogni colonna è una versione, anno letto da MP29, riga Grand Total esclusa");
v = (await P(fin, "GET", "budget", undefined, "&year=2029")).data; let m = v.lines.find(l => l.io === "HQ2505245002");
assert.equal(m.baseline, 20000); assert.equal(m.current, 18500); assert.equal(m.description, "LAB TEST"); assert.equal(m.function, "R&D Agro"); assert.equal(m.costCenter, "5245"); assert.equal(m.category, "SERVICES"); assert.equal(v.versions[0].label, "MP29"); ok("riferimento MP29, budget in uso R9, attributi CDC / CDC NAME / NAME / CATEGORIA");
const fin2 = new TextEncoder().encode("Row Labels;CDC;CDC NAME;NAME;CATEGORIA;MP29;R3;R5;R7;R9;R11\nHQ2505245001;5245;R&D Agro;MARTANI - CONTRATTO;OTHERS;61,000;61,000;61,000;61,000;61,000;55,000\nHQ2505245002;5245;R&D Agro;LAB TEST;SERVICES;20,000;25,000;25,000;22,000;18,500;18,500\n");
r = await up(fin, 2029, fin2, "MP29_R11.csv"); assert.deepEqual(r.data.created.map(x => x.label), ["R11"]); assert.equal(r.data.updated.length, 5);
v = (await P(fin, "GET", "budget", undefined, "&year=2029")).data; assert.equal(v.versions.length, 6); m = v.lines.find(l => l.io === "HQ2505245001"); assert.equal(m.baseline, 61000); assert.equal(m.current, 55000); ok("ricaricando con R11 si aggiunge solo la nuova revisione");

console.log(`\n${passed} controlli superati`); process.exit(0);
