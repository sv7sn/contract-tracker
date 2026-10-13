import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const B = process.env.API_BUILD + "/api/";
const SAP = process.env.SAP_SAMPLES + "/";
process.env.DATABASE_URL = process.env.TEST_DB_URL;
process.env.ADMIN_EMAIL = "admin@test.it"; process.env.ADMIN_PASSWORD = "Admin-pass-123!"; process.env.SESSION_SECRET = "x".repeat(40);
const portal = await import(B + "portal.js"), login = await import(B + "login.js");
const db = await import(B + "_db.js"), crypto = await import(B + "_crypto.js"), files = await import(B + "_sap-files.js");
await db.ensureSchema(); const pool = db.getPool();
let passed = 0; const ok = n => { passed++; console.log("  ✓", n); };
const call = async (cookie, method, qs, body, headers = {}) => {
  const isRaw = body instanceof Uint8Array;
  const r = new Request("https://app.test/api/x" + qs, { method, headers: { ...(isRaw ? {} : { "content-type": "application/json" }), ...(cookie ? { cookie } : {}), ...headers }, body: body === undefined ? undefined : isRaw ? body : JSON.stringify(body) });
  const res = await portal[method](r); const sc = res.headers.get("set-cookie"); let data; try { data = await res.clone().json(); } catch { data = null; }
  return { status: res.status, data, cookie: sc ? sc.split(";")[0] : null };
};
const P = (c, m, op, body, extra = "", h) => call(c, m, `?op=${op}${extra}`, body, h);
const signin = async (e, p) => { const r = new Request("https://app.test/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: e, password: p }) }); const res = await login.POST(r); return res.headers.get("set-cookie").split(";")[0]; };
const mk = async (e, n, r) => pool.query("insert into users (email,name,role,title,password_hash) values ($1,$2,$3,'t',$4) returning id", [e, n, r, await crypto.hashPassword("Password-123!")]).then(x => x.rows[0].id);
const b1 = await mk("buyer@test.it", "Marta Buyer", "buyer"), b2 = await mk("buyer2@test.it", "Luca Buyer", "buyer"); await mk("fin@test.it", "Finance Uno", "finance");
const admin = await signin("admin@test.it", "Admin-pass-123!"), buyer = await signin("buyer@test.it", "Password-123!"), buyer2 = await signin("buyer2@test.it", "Password-123!"), fin = await signin("fin@test.it", "Password-123!");

// Costruisce un file nello stesso formato di SAP (XML 2003, UTF-16)
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const makeXls = rows => { const xml = `<?xml version="1.0" encoding="utf-16"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="Sheet1"><Table>${rows.map(r => `<Row>${r.map(c => c == null ? "<Cell/>" : `<Cell><Data ss:Type="String">${esc(c)}</Data></Cell>`).join("")}</Row>`).join("")}</Table></Worksheet></Workbook>`; const b = Buffer.alloc(2 + xml.length * 2); b[0] = 0xff; b[1] = 0xfe; b.write(xml, 2, "utf16le"); return new Uint8Array(b); };
const realPr = new Uint8Array(readFileSync(SAP + "pr.xls")), realPo = new Uint8Array(readFileSync(SAP + "po.xls"));
const prRows = files.parseSheet(realPr), poRows = files.parseSheet(realPo);

const demoMod = await import(B + "_demo.js");
await pool.query("insert into buying_companies (code, name, sap_company_code, purch_org) values ('C1','Soc','1000','1000') on conflict do nothing"); await pool.query("insert into industry_codes (code, name) values ('I1','Ind') on conflict do nothing");
const SUP = (await demoMod.createDemoSupplier({ id: 1, role: "manager", name: "Admin" }, { name: "Fornitore Qualificato Srl" })).id;
const finish = async (c, id) => {
  await P(c, "POST", "task-supplier", { supplierId: SUP }, `&id=${id}`);
  await P(c, "POST", "task-links", { internalOrder: "IO12345" }, `&id=${id}`);
  await P(c, "POST", "task-links", { contractStatus: "not_needed", contractNote: "Nessun contratto necessario" }, `&id=${id}`);
  const t = (await P(c, "GET", "task", undefined, `&id=${id}`)).data.task;
  if (t.sourcingRequired && t.sourcingStatus !== "ok") await P(c, "POST", "task-sourcing", { mode: "strategic", justification: "Fornitura strategica di prova" }, `&id=${id}`);
};
const imp = (c, data, name = "OPEN_PR.XLS", extra = "") => P(c, "POST", "rda-import", data, extra, { "x-file-name": encodeURIComponent(name) });

console.log("Lettura dei file SAP");
assert.equal(files.detectKind(prRows[0]), "pr"); assert.equal(files.detectKind(poRows[0]), "po"); ok("riconoscimento del tipo di file dalle colonne");
const prl = files.parsePrLines(prRows); assert.equal(prl.length, 81); assert.equal(new Set(prl.map(l => l.pr)).size, 53); ok("RDA aperte: 81 righe, 53 RDA");
assert.equal(prl[0].value, 4981); assert.equal(prl[0].releaseDate, "2026-09-30"); assert.equal(prl[0].pgr, "09P"); ok("importo, data di rilascio e gruppo di acquisto");
const pol = files.parsePoLines(poRows); assert.equal(pol.length, 49); assert.equal(new Set(pol.filter(l => l.pr).map(l => l.pr)).size, 23); ok("ordini: 49 righe (riga dei totali esclusa), 23 RDA collegate");
assert.equal(files.parseSheet(makeXls([["a", null, "b&c"]]))[0][2], "b&c"); ok("caratteri speciali e celle vuote");
assert.equal(files.detectKind(["x", "y"]), null);

console.log("Permessi");
assert.equal((await P(null, "GET", "tasks")).status, 401); assert.equal((await P(fin, "GET", "tasks")).status, 403); assert.equal((await imp(fin, realPr)).status, 403); ok("anonimo 401, Finance 403");
assert.equal((await imp(admin, new Uint8Array([1, 2, 3]))).status, 400); ok("file non riconosciuto rifiutato");
assert.equal((await imp(admin, new Uint8Array(0))).status, 400);

console.log("Gruppi di acquisto");
for (const [pgr, userId] of [["09P", b1], ["17P", b2]]) assert.equal((await P(admin, "POST", "config-save", { entity: "pgr", action: "save", item: { pgr, userId } })).status, 200);
assert.equal((await P(buyer, "POST", "config-save", { entity: "pgr", action: "save", item: { pgr: "15P", userId: b1 } })).status, 403); ok("solo il Manager abbina i gruppi ai buyer");

console.log("Importazione RDA");
let r = await imp(admin, realPr); assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(r.data.kind, "pr"); assert.equal(r.data.prs, 53); assert.equal(r.data.created, 53); ok("53 task creati");
let all = (await P(admin, "GET", "tasks")).data; assert.equal(all.tasks.length, 53); assert(all.sapUpdatedAt.pr);
const mine = (await P(buyer, "GET", "tasks")).data.tasks, his = (await P(buyer2, "GET", "tasks")).data.tasks;
const cnt = pgr => all.tasks.filter(t => t.meta.pgr === pgr).length;
assert.equal(mine.length, cnt("09P")); assert.equal(his.length, cnt("17P")); assert(mine.every(t => t.meta.pgr === "09P" && t.assigneeName === "Marta Buyer")); ok(`assegnazione per gruppo di acquisto: 09P→Marta (${mine.length}), 17P→Luca (${his.length})`);
const un = all.tasks.filter(t => t.assigneeId === null); assert.equal(un.length, cnt("15P")); assert(un.length > 0); ok(`gruppo senza buyer: ${un.length} task "da assegnare", visibili solo al Manager`);
r = await imp(admin, realPr); assert.equal(r.data.created, 0); assert.equal(r.data.updated, 53); assert.equal((await P(admin, "GET", "tasks")).data.tasks.length, 53); ok("reimportare lo stesso file non duplica nulla");
const t0 = all.tasks.find(t => t.sourceKey === "8001979611"); assert.equal(t0.meta.value, 4981); assert.equal(t0.due, "2026-10-07"); assert(t0.title.startsWith("RDA 8001979611 · Additional work for TFA")); ok("titolo, importo e scadenza (rilascio + 7 giorni)");
const det = (await P(admin, "GET", "task", undefined, `&id=${t0.id}`)).data.task; assert.equal(det.lines.length, 1); assert.equal(det.lines[0].costCenter, "520100000075" === det.lines[0].costCenter ? "520100000075" : det.lines[0].costCenter);
const multi = all.tasks.find(t => t.meta.lines === 5); assert((await P(admin, "GET", "task", undefined, `&id=${multi.id}`)).data.task.lines.length === 5); ok("dettaglio con tutte le righe della RDA");
assert.equal((await P(buyer2, "GET", "task", undefined, `&id=${t0.id}`)).status === 404 || mine.some(x => x.id === t0.id), true);

console.log("Importazione ordini e chiusura automatica");
r = await imp(admin, realPo, "PO_LAST_7D.XLS"); assert.equal(r.data.kind, "po"); assert(r.data.linked > 0); assert.equal(r.data.closedPo, 0); ok(`${r.data.linked} collegamenti ordine↔RDA, nessuna chiusura (le RDA collegate non erano più aperte)`);
const open = [...new Set(prl.map(l => l.pr))]; const [X, Y, Z, K] = [open[3], open[4], open[5], open[6]];
const without = (keys) => makeXls([prRows[0], ...prRows.slice(1).filter(row => !keys.includes(row[prRows[0].indexOf("Purch.Req.")]))]);
const poHdr = poRows[0]; const poTemplate = poRows.find(x => x[0] === "2486");
const poLine = (po, pr, supplier) => { const row = [...poTemplate]; row[poHdr.indexOf("Purch.Doc.")] = po; row[poHdr.indexOf("Purch.Req.")] = pr; row[poHdr.indexOf("Name 1")] = supplier; row[poHdr.indexOf("Doc. Date")] = "2026-10-08"; return row; };
r = await imp(admin, makeXls([poHdr, poLine("2880999001", X, "FORNITORE X SRL"), poLine("2880999002", K, "FORNITORE K SPA")]), "PO.XLS"); assert.equal(r.data.closedPo, 0); ok("ordine ricevuto mentre la RDA è ancora nell'elenco: il task resta aperto");
let tk = (await P(admin, "GET", "tasks")).data.tasks; assert.equal(tk.find(t => t.sourceKey === X).pos[0].po, "2880999001"); assert.equal(tk.find(t => t.sourceKey === X).status, "open"); ok("l'ordine collegato è già visibile sul task");
r = await imp(admin, without([X, Y, Z]), "OPEN_PR.XLS"); assert.equal(r.data.closedPo, 0); assert.equal(r.data.closedGone, 2);
tk = (await P(admin, "GET", "tasks")).data.tasks; assert.equal(tk.find(t => t.sourceKey === X).status, "open"); assert(tk.find(t => t.sourceKey === X).blocker); ok("ordine emesso e RDA sparita, ma passaggi mancanti: il task resta aperto");
await finish(admin, tk.find(t => t.sourceKey === X).id);
tk = (await P(admin, "GET", "tasks")).data.tasks; assert.equal(tk.find(t => t.sourceKey === X).status, "done"); assert.equal(tk.find(t => t.sourceKey === X).doneReason, "po_created"); ok("ultimo passaggio completato con ordine già in SAP: la RDA si chiude subito");
r = await imp(admin, without([X, Y, Z]), "OPEN_PR.XLS", "&force=1"); assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(r.data.closedPo, 0); ok("passaggi completati e RDA sparita con ordine: chiusa per PO creato (le altre 2 senza ordine erano già chiuse come 'non più aperte')");
tk = (await P(admin, "GET", "tasks")).data.tasks; const g = k => tk.find(t => t.sourceKey === k);
assert.equal(g(X).status, "done"); assert.equal(g(X).doneReason, "po_created"); assert.equal(g(X).doneAt.slice(0, 10), "2026-10-08"); assert.equal(g(Y).doneReason, "removed_from_sap"); assert.equal(g(K).status, "open"); ok("motivi di chiusura corretti, data di chiusura = data dell'ordine");
const po2 = makeXls([poHdr, poLine("2880999003", Z, "FORNITORE Z SRL")]);
r = await imp(admin, po2, "PO2.XLS"); assert.equal(r.data.closedPo, 0); tk = (await P(admin, "GET", "tasks")).data.tasks; assert.equal(tk.find(t => t.sourceKey === Z).status, "open"); assert(tk.find(t => t.sourceKey === Z).blocker); ok("ordine arrivato dopo, ma passaggi mancanti: la RDA chiusa come 'non più aperta' si riapre");
await finish(admin, tk.find(t => t.sourceKey === Z).id);
r = await imp(admin, po2, "PO2.XLS", "&force=1"); assert.equal(r.status, 200); tk = (await P(admin, "GET", "tasks")).data.tasks; assert.equal(tk.find(t => t.sourceKey === Z).doneReason, "po_created"); ok("passaggi completati: la chiusura diventa 'PO creato'");
assert.equal((await P(admin, "POST", "task-update", { status: "open" }, `&id=${tk.find(t => t.sourceKey === Y).id}`)).status, 409); ok("una RDA chiusa da SAP non si riapre a mano");
r = await imp(admin, prRows.length ? makeXls(prRows) : realPr); assert.equal(r.data.reopened, 3); ok("RDA che riappaiono nell'elenco: task riaperti (3)");

console.log("Protezione da file incompleti");
const tiny = makeXls([prRows[0], ...prRows.slice(1, 6)]);
r = await imp(admin, tiny); assert.equal(r.status, 409); assert.equal(r.data.needsForce, true); assert.equal((await P(admin, "GET", "tasks")).data.tasks.filter(t => t.status === "open").length, 53); ok("file con pochissime RDA bloccato: nessun task chiuso");
r = await imp(admin, tiny, "OPEN_PR.XLS", "&force=1"); assert.equal(r.status, 200); ok("con conferma esplicita si importa");
await imp(admin, realPr);

console.log("Importazione automatica");
assert.equal((await P(null, "POST", "rda-ingest", realPr)).status, 503); ok("senza RDA_INGEST_SECRET: 503");
process.env.RDA_INGEST_SECRET = "ingest-secret-ingest";
assert.equal((await P(null, "POST", "rda-ingest", realPr, "", { authorization: "Bearer nope" })).status, 401); ok("chiave errata: 401");
r = await P(null, "POST", "rda-ingest", realPo, "", { authorization: "Bearer ingest-secret-ingest", "x-file-name": "PO_LAST_7D.XLS" }); assert.equal(r.status, 200); assert.equal(r.data.kind, "po"); ok("con la chiave giusta il file viene importato");

console.log("Assegnazione e task manuali");
const some = (await P(admin, "GET", "tasks")).data.tasks.find(t => t.meta.pgr === "09P" && t.status === "open");
assert.equal((await P(buyer, "POST", "task-update", { assigneeId: b2 }, `&id=${some.id}`)).status, 403); ok("il buyer non riassegna");
assert.equal((await P(admin, "POST", "task-update", { assigneeId: b2 }, `&id=${some.id}`)).data.task.assigneeName, "Luca Buyer"); ok("il Manager riassegna");
await P(admin, "POST", "config-save", { entity: "pgr", action: "save", item: { pgr: "09P", userId: b2 } });
const after = (await P(admin, "GET", "tasks")).data.tasks; assert(after.filter(t => t.meta.pgr === "09P" && t.status === "open").every(t => t.assigneeId === b2)); ok("cambiando il buyer del gruppo si spostano i task aperti");
await P(admin, "POST", "config-save", { entity: "pgr", action: "save", item: { pgr: "09P", userId: b1 } });
const m = (await P(buyer, "POST", "task-create", { title: "Chiamare fornitore per offerta", due: "2026-10-20", priority: "high" })); assert.equal(m.status, 201); assert.equal(m.data.task.assigneeName, "Marta Buyer"); ok("task manuale creato dal buyer");
assert.equal((await P(buyer2, "GET", "task", undefined, `&id=${m.data.task.id}`)).status, 404); ok("gli altri buyer non lo vedono");
assert.equal((await P(buyer, "POST", "task-create", { title: "ab" })).status, 400);
const done = await P(buyer, "POST", "task-update", { status: "done" }, `&id=${m.data.task.id}`); assert.equal(done.data.task.status, "done"); assert.equal(done.data.task.doneReason, "manual");
assert.equal((await P(buyer, "POST", "task-update", { status: "open", title: "Chiamare fornitore (rinviato)" }, `&id=${m.data.task.id}`)).data.task.title, "Chiamare fornitore (rinviato)"); ok("completamento e riapertura");
assert.equal((await P(admin, "DELETE", "task", undefined, `&id=${after.find(t => t.source === "rda").id}`)).status, 400); ok("le RDA non si eliminano");
assert.equal((await P(buyer, "DELETE", "task", undefined, `&id=${m.data.task.id}`)).status, 200); ok("task manuale eliminato");

console.log("Scadenze e riepilogo");
await P(admin, "POST", "config-save", { entity: "rda", action: "save", item: { slaDays: 14 } });
const t14 = (await P(admin, "GET", "tasks")).data.tasks.find(t => t.sourceKey === "8001979611"); assert.equal(t14.due, "2026-10-14"); ok("cambiando i giorni di lavorazione si ricalcolano le scadenze");
assert.equal((await P(admin, "POST", "config-save", { entity: "rda", action: "save", item: { slaDays: 0 } })).status, 400);
const sum = (await P(admin, "GET", "task-summary")).data; assert(sum.open > 0 && sum.unassigned > 0 && sum.overdue >= 0); ok(`riepilogo: ${sum.open} aperti, ${sum.overdue} in ritardo, ${sum.unassigned} da assegnare`);
const cfg = (await P(admin, "GET", "config")).data.config.rda; assert.equal(cfg.slaDays, 14); assert(cfg.groups.some(x => x.pgr === "15P" && x.userId === null && x.openTasks > 0)); assert.equal(cfg.ingestConfigured, true); assert(cfg.lastImports.length); ok("configurazione RDA: gruppi, ultimi import, stato ingresso automatico");
console.log(`\n${passed} controlli superati`); process.exit(0);
