// Simulazione completa per i test: Master Plan MP26 (R3…R9) e MP27, fornitori registrati, RDA aperte e ordinate con PO,
// acquisti e attività manuali, contratti (anche in scadenza e scaduti) — tutto sugli stessi internal order "SIM…".
// Si elimina con un clic. In più due file SAP di prova (RDA aperte e ordini) per provare l'importazione dal modulo Task.
import type { User } from "../src/types.ts";
import { deleteDocuments } from "./_blob.js";
import { importBudget } from "./_budget.js";
import { getPool, inTransaction, type Queryable } from "./_db.js";
import { createDemoSupplier } from "./_demo.js";
import { HttpError } from "./_http.js";
import { makePlan } from "./_plan-rules.js";
import { ensureRenewalTasks } from "./_tasks.js";

export const SIM_FILE = "simulazione-master-plan.csv";
const SIM_TAG = "Simulazione Master Plan";
const day = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

// Internal order: [IO, CDC, CDC NAME, NAME, CATEGORIA, MP26, R3, R5, R7, R9, MP27]
const LINES: [string, string, string, string, string, number, number, number, number, number, number][] = [
  ["SIM2600000001", "5245", "R&D Agro", "Prove di laboratorio esterne", "SERVICES", 120000, 120000, 110000, 110000, 105000, 125000],
  ["SIM2600000002", "5245", "R&D Agro", "Consulenza agronomica", "CONSULTING", 60000, 60000, 60000, 55000, 55000, 60000],
  ["SIM2600000003", "5828", "ICT", "Licenze software e cloud", "SOFTWARE", 250000, 260000, 260000, 270000, 270000, 280000],
  ["SIM2600000004", "5828", "ICT", "Manutenzione MES", "MAINTENANCE", 140000, 140000, 150000, 150000, 150000, 150000],
  ["SIM2600000005", "5825", "HR", "Formazione manageriale", "TRAINING", 80000, 70000, 70000, 60000, 60000, 85000],
  ["SIM2600000006", "5825", "HR", "Ricerca e selezione", "SERVICES", 45000, 45000, 45000, 45000, 40000, 45000],
  ["SIM2600000007", "5831", "Facility", "Pulizie uffici e stabilimento", "FACILITY", 95000, 95000, 95000, 95000, 95000, 98000],
  ["SIM2600000008", "5831", "Facility", "Vigilanza", "FACILITY", 70000, 70000, 72000, 72000, 72000, 74000],
  ["SIM2600000009", "5810", "Marketing", "Eventi e fiere", "MARKETING", 150000, 130000, 130000, 120000, 120000, 140000],
  ["SIM2600000010", "5821", "Legal", "Consulenze legali", "CONSULTING", 90000, 90000, 90000, 100000, 100000, 90000],
];
// Fornitori registrati (codice SAP fittizio) usati da RDA, PO e contratti.
const SUPPLIERS: [string, string][] = [
  ["AgroLab Srl", "SIMV0001"], ["Software Point Srl", "SIMV0002"], ["CloudItalia Spa", "SIMV0003"], ["Rockwell Automation Srl", "SIMV0004"],
  ["Pulito Spa", "SIMV0005"], ["Sicurezza Nord Srl", "SIMV0006"], ["Expo Service Srl", "SIMV0007"], ["Academy Srl", "SIMV0008"],
];
const SAP_CODE = Object.fromEntries(SUPPLIERS);
// RDA già ordinate: [IO, titolo, fornitore, valore, mese di rilascio]
const ORDERED: [string, string, string, number, number][] = [
  ["SIM2600000001", "Analisi suolo campagna primavera", "AgroLab Srl", 38000, 3],
  ["SIM2600000001", "Prove di germinazione", "AgroLab Srl", 27500, 6],
  ["SIM2600000003", "Rinnovo licenze CAD", "Software Point Srl", 82000, 2],
  ["SIM2600000003", "Estensione cloud storage", "CloudItalia Spa", 64000, 5],
  ["SIM2600000003", "Licenze cybersecurity", "Software Point Srl", 98000, 9],
  ["SIM2600000004", "Interventi straordinari MES", "Rockwell Automation Srl", 40000, 4],
  ["SIM2600000005", "Percorso leadership", "Academy Srl", 52000, 3],
  ["SIM2600000006", "Selezione 3 ingegneri", "Academy Srl", 21000, 5],
  ["SIM2600000008", "Vigilanza estiva aggiuntiva", "Sicurezza Nord Srl", 9000, 7],
  ["SIM2600000009", "Fiera EIMA", "Expo Service Srl", 74000, 4],
  ["SIM2600000009", "Evento clienti", "Expo Service Srl", 61000, 9],
  ["SIM2600000010", "Parere contrattualistica", "Expo Service Srl", 35000, 6],
];
// RDA aperte (approvate, da lavorare): [IO, titolo, valore, giorni dal rilascio, situazione]
type OpenCase = "to_compare" | "compared" | "exception" | "small" | "has_po" | "no_io";
const OPEN: [string, string, number, number, OpenCase][] = [
  ["SIM2600000002", "Consulenza piano concimazione", 24000, 3, "to_compare"],
  ["SIM2600000003", "Licenze strumenti di sviluppo", 18500, 12, "compared"],
  ["SIM2600000009", "Stand fiera Agritechnica", 42000, 9, "exception"],
  ["SIM2600000006", "Annuncio offerte di lavoro", 3500, 2, "small"],
  ["SIM2600000004", "Ricambi MES urgenti", 15800, 15, "has_po"],
  ["", "Abbonamento banca dati normativa", 12000, 20, "no_io"],
];
// Acquisti manuali in previsione: [IO, titolo, fornitore, valore, mese]
const PURCHASES: [string, string, string, number, number][] = [
  ["SIM2600000001", "Analisi campagna autunno", "AgroLab Srl", 30000, 11],
  ["SIM2600000003", "Strumento di BI", "CloudItalia Spa", 45000, 12],
  ["SIM2600000005", "Corsi lingua inglese", "Academy Srl", 18000, 11],
];
// Contratti: [IO, fornitore, oggetto, valore totale, inizio, fine, preavviso (giorni)]
const CONTRACTS: [string, string, string, number, string, string, number | null][] = [
  ["SIM2600000004", "Rockwell Automation Srl", "Manutenzione MES 2026-2028", 330000, "2026-01-01", "2028-12-31", 90],
  ["SIM2600000007", "Pulito Spa", "Pulizie uffici e stabilimento", 186000, "2026-04-01", "2027-12-31", null],
  ["SIM2600000008", "Sicurezza Nord Srl", "Servizio di vigilanza", 210000, "2026-01-01", "2028-12-31", 60],
  ["SIM2600000003", "CloudItalia Spa", "Piattaforma cloud 2027-2029", 300000, "2027-01-01", "2029-12-31", null],
  ["SIM2600000010", "Expo Service Srl", "Supporto eventi e allestimenti", 48000, day(-670), day(45), null], // in scadenza: nasce il rinnovo
  ["SIM2600000002", "AgroLab Srl", "Consulenza agronomica 2025", 36000, day(-380), day(-15), null], // scaduto senza esito
];

function mpCsv(year: 26 | 27): Uint8Array {
  const head = year === 26 ? "Row Labels;CDC;CDC NAME;NAME;CATEGORIA;MP26;R3;R5;R7;R9" : "Row Labels;CDC;CDC NAME;NAME;CATEGORIA;MP27";
  const rows = LINES.map(l => (year === 26 ? [...l.slice(0, 10)] : [...l.slice(0, 5), l[10]]).join(";"));
  return new TextEncoder().encode([head, ...rows, `Grand Total;;;;;${year === 26 ? "0;0;0;0;0" : "0"}`].join("\n"));
}

async function ensureConfig(db: Queryable): Promise<void> {
  if (!(await db.query("select 1 from buying_companies limit 1")).rows.length) await db.query("insert into buying_companies (code, name, sap_company_code, purch_org) values ('SIMCO', 'Società di prova (simulazione)', '9999', '9999')");
  if (!(await db.query("select 1 from industry_codes limit 1")).rows.length) await db.query("insert into industry_codes (code, name) values ('SIM01', 'Codice merceologico di prova')");
}

export async function loadBudgetDemo(user: User): Promise<{ years: number[]; tasks: number; contracts: number; suppliers: number }> {
  if (user.role !== "manager") throw new HttpError(403, "Solo il Manager carica la simulazione");
  const db = getPool();
  if ((await db.query("select 1 from tasks where created_by = $1 limit 1", [SIM_TAG])).rows.length) throw new HttpError(409, "La simulazione è già caricata: eliminala prima di ricaricarla");
  const real = (await db.query("select distinct year from mp_versions where year in (2026, 2027) and file_name <> $1", [SIM_FILE])).rows.map(r => r.year as number);
  if (real.length) throw new HttpError(409, `Esiste già un Master Plan reale per il ${real.join(" e ")}: la simulazione non lo sovrascrive`);
  await ensureConfig(db);
  await importBudget(user, 2026, "", SIM_FILE, mpCsv(26));
  await importBudget(user, 2027, "", SIM_FILE, mpCsv(27));
  // Fornitori registrati e in regola (con documenti e accesso al portale).
  const supplierId: Record<string, number> = {};
  for (const [name, sapCode] of SUPPLIERS) supplierId[name] = (await createDemoSupplier(user, { name, sapCode })).id;
  const buyers = (await db.query("select id from users where active and role in ('buyer','manager') order by role = 'buyer' desc, id")).rows.map(r => r.id as number);
  const who = (i: number) => buyers[i % buyers.length] ?? user.id;
  let tasks = 0;
  await inTransaction(async tx => {
    // RDA già diventate ordine, con PO in SAP collegato al fornitore.
    for (const [i, [io, title, supplier, value, month]] of ORDERED.entries()) {
      const pr = `SIM-${8000001 + i}`, po = `SIMPO${String(1001 + i)}`, release = `2026-${String(month).padStart(2, "0")}-15`;
      const sourcing = value > 10000 ? JSON.stringify({ mode: "comparison", quotes: [{ supplier, amount: Math.round(value * 1.06), chosen: true }, { supplier: "Concorrente Srl", amount: Math.round(value * 1.15), chosen: false }], justification: "", recordedBy: user.name, recordedAt: release, approval: null, approvedBy: "", approvedAt: null, approvalNote: "", baseline: null, finalAmount: value }) : null;
      await tx.query(`insert into tasks (source, source_key, title, due, assignee_id, status, done_at, done_reason, done_by, meta, sourcing, created_by, created_at)
        values ('rda', $1, $2, ($3::date + 7), $4, 'done', ($3::date + 20), 'po_created', 'SAP', $5, $6, $7, $3::date)`,
        [pr, `RDA ${pr} · ${title}`, release, who(i), JSON.stringify({ io: { [io]: value }, value, currency: "EUR", releaseDate: release, requestedBy: "SIMULAZIONE", pgr: "SIM", lines: 1 }), sourcing, SIM_TAG]);
      await tx.query("insert into sap_pos (po, pr, supplier_code, supplier_name, doc_date, pgr) values ($1,$2,$3,$4,($5::date + 20),'SIM') on conflict do nothing", [po, pr, SAP_CODE[supplier], supplier.toUpperCase(), release]);
      tasks++;
    }
    // RDA aperte, approvate e da lavorare, in situazioni diverse.
    for (const [i, [io, title, value, ago, kase]] of OPEN.entries()) {
      const pr = `SIM-${8100001 + i}`, release = day(-ago);
      const meta = { io: io ? { [io]: value } : {}, value, currency: "EUR", releaseDate: release, requestedBy: "SIMULAZIONE", pgr: "SIM", lines: 1, costCenter: io ? "" : "5821", firstSeen: new Date().toISOString() };
      const sourcing = kase === "compared" ? { mode: "comparison", quotes: [{ supplier: "Software Point Srl", amount: 18500, chosen: true }, { supplier: "CloudItalia Spa", amount: 21000, chosen: false }], justification: "", recordedBy: user.name, recordedAt: new Date().toISOString(), approval: null, approvedBy: "", approvedAt: null, approvalNote: "", baseline: 20000, finalAmount: 17900 }
        : kase === "exception" ? { mode: "exception", quotes: [], justification: "Unico allestitore disponibile con i tempi della fiera", recordedBy: "Buyer di prova", recordedAt: new Date().toISOString(), approval: "pending", approvedBy: "", approvedAt: null, approvalNote: "" } : null;
      const id = (await tx.query(`insert into tasks (source, source_key, title, due, assignee_id, assignee_auto, group_key, meta, sourcing, created_by) values ('rda',$1,$2,($3::date + 7),$4,false,'SIM',$5,$6,$7) returning id`,
        [pr, `RDA ${pr} · ${title}`, release, who(i + 1), JSON.stringify(meta), sourcing ? JSON.stringify(sourcing) : null, SIM_TAG])).rows[0].id;
      await tx.query(`insert into rda_lines (pr, item, pgr, short_text, qty, unit, price, per, currency, release_date, requested_by, created_by, plant, cost_center, gl_account, value, internal_order)
        values ($1,'10','SIM',$2,1,'PZ',$3,1,'EUR',$4,'SIMULAZIONE','SIMULAZIONE','SIM1',$5,'N00000',$3,$6)`, [pr, title, value, release, io ? "" : "5821", io]);
      if (kase === "has_po") await tx.query("insert into sap_pos (po, pr, supplier_code, supplier_name, doc_date, pgr) values ($1,$2,'SIMV0004','ROCKWELL AUTOMATION SRL',current_date,'SIM') on conflict do nothing", ["SIMPO2001", pr]);
      void id; tasks++;
    }
    // Acquisti manuali in previsione (senza RDA) e un'attività semplice.
    for (const [i, [io, title, supplier, value, month]] of PURCHASES.entries()) {
      await tx.query(`insert into tasks (source, kind, title, detail, due, assignee_id, meta, created_by) values ('manual','purchase',$1,$2,$3,$4,$5,$6)`,
        [title, "Pratica di prova della simulazione", `2026-${String(month).padStart(2, "0")}-15`, who(i), JSON.stringify({ value, currency: "EUR", supplier, supplierId: supplierId[supplier] ?? null, object: title, internalOrder: io }), SIM_TAG]);
      tasks++;
    }
    await tx.query(`insert into tasks (source, kind, title, detail, due, assignee_id, created_by) values ('manual','activity','Chiamare AgroLab per il listino 2027','Attività di prova della simulazione',$1,$2,$3)`, [day(5), user.id, SIM_TAG]);
    tasks++;
    // Contratti collegati a fornitori e internal order, con il loro piano di rinnovo.
    for (const [io, supplier, object, value, start, end, notice] of CONTRACTS) {
      let noticeDate = "";
      if (notice) { const d = new Date(`${end}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - notice); noticeDate = d.toISOString().slice(0, 10); }
      const cid = (await tx.query(`insert into contracts (supplier, object, category, country, value, currency, start_date, end_date, owner, bo_email, renewal, type, notes, internal_order, supplier_id, notice_days, notice_date)
        values ($1,$2,'Simulazione','Italia',$3,'EUR',$4,$5,$6,'','Non definito','Servizi',$7,$8,$9,$10,$11) returning id`, [supplier, object, value, start, end, user.name, SIM_TAG, io, supplierId[supplier] ?? null, notice, noticeDate])).rows[0].id as number;
      for (const s of makePlan(cid, noticeDate || end))
        await tx.query(`insert into plan_steps (contract_id, step_id, scheduled_date, original_date, status, completed_at, completed_by, bo_decision, bo_notes, bo_responded_at, modified, modified_reason) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [cid, s.stepId, s.scheduledDate, s.originalDate, s.status, s.completedAt, s.completedBy, s.boDecision, s.boNotes, s.boRespondedAt, s.modified, s.modifiedReason]);
    }
  });
  await ensureRenewalTasks(db);
  return { years: [2026, 2027], tasks, contracts: CONTRACTS.length, suppliers: SUPPLIERS.length };
}

export async function deleteBudgetDemo(user: User): Promise<{ deleted: number }> {
  if (user.role !== "manager") throw new HttpError(403, "Solo il Manager elimina la simulazione");
  const files: string[] = [];
  const res = await inTransaction(async tx => {
    let n = 0;
    const count = (r: { rowCount: number | null }) => { n += r.rowCount ?? 0; };
    count(await tx.query("delete from tasks where created_by = $1 or source_key like 'SIM-%'", [SIM_TAG]));
    count(await tx.query("delete from contracts where notes = $1 and category = 'Simulazione'", [SIM_TAG]));
    count(await tx.query("delete from mp_versions where file_name = $1", [SIM_FILE]));
    count(await tx.query("delete from sap_pos where pr like 'SIM-%' or po like 'SIMPO%'"));
    count(await tx.query("delete from rda_lines where pr like 'SIM-%'"));
    const sups = (await tx.query("select id, user_id from suppliers where sap_code like 'SIMV%'")).rows;
    if (sups.length) {
      files.push(...(await tx.query("select file_path from supplier_documents where supplier_id = any($1)", [sups.map(s => s.id)])).rows.map(r => r.file_path as string));
      count(await tx.query("delete from suppliers where id = any($1)", [sups.map(s => s.id)]));
      await tx.query("delete from users where id = any($1) and role = 'supplier'", [sups.map(s => s.user_id).filter(Boolean)]);
    }
    await tx.query("delete from buying_companies where code = 'SIMCO' and not exists (select 1 from suppliers where 'SIMCO' = any(company_codes))");
    await tx.query("delete from industry_codes where code = 'SIM01' and not exists (select 1 from suppliers where industry_code = 'SIM01')");
    return { deleted: n };
  });
  await deleteDocuments(files);
  return res;
}

// ─── File SAP di prova ───────────────────────────────────────
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function sheet(rows: (string | number | null)[][]): Uint8Array {
  const xml = `<?xml version="1.0" encoding="utf-16"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="Sheet1"><Table>${rows.map(r => `<Row>${r.map(c => c === null ? "<Cell/>" : `<Cell><Data ss:Type="String">${esc(String(c))}</Data></Cell>`).join("")}</Row>`).join("")}</Table></Worksheet></Workbook>`;
  const b = Buffer.alloc(2 + xml.length * 2); b[0] = 0xff; b[1] = 0xfe; b.write(xml, 2, "utf16le");
  return new Uint8Array(b);
}
/** RDA aperte di prova (formato OPEN_PR di SAP): nuove RDA su internal order SIM, da importare dal modulo Task. */
export function demoPrFile(): Uint8Array {
  const head = ["PGr", "Purch.Req.", "Item", "Document Type", "Plnt", "Material", "Short Text", "Qty Requested", "Un", "Ordered", "Un", "Valn Price", "Crcy", "Per", "Req.Date", "Deliv. Date", "Release Dt", "Requested By", "Created By", "S", "A", "PO", "Item", "Order", "Cost Ctr", "G/L Acct"];
  const rows: [string, string, number, string, number][] = [
    ["SIM-8200001", "Servizio di traduzione tecnica", 8500, "SIM2600000010", 1],
    ["SIM-8200002", "Workshop innovazione digitale", 26000, "SIM2600000003", 2],
    ["SIM-8200003", "Pulizia straordinaria magazzino", 6400, "SIM2600000007", 3],
    ["SIM-8200004", "Assessment competenze", 31000, "SIM2600000005", 1],
  ];
  // Le RDA aperte della simulazione restano nel file (altrimenti l'import le chiuderebbe come "non più aperte"),
  // tranne quella che ha già il PO: uscendo dall'elenco si chiude da sola come "PO creato".
  const all: [string, string, number, string, number][] = [...OPEN.flatMap(([io, text, value, ago, kase], i) => kase === "has_po" ? [] : [[`SIM-${8100001 + i}`, text, value, io, ago] as [string, string, number, string, number]]), ...rows];
  return sheet([head, ...all.map(([pr, text, value, io, ago]) => ["SIM", pr, "10", "EC", "SIM1", null, text, String(value), "NR", "0", "NR", "1.00", "EUR", "1", day(-ago), day(30), day(-ago), "SIMULAZIONE", "SIMULAZIONE", "N", io ? "F" : "K", null, "0", io || null, io ? null : "5821", "N00000"])]);
}
/** Ordini di prova (formato PO_LAST_7D): il PO della prima RDA del file RDA di prova, che così si chiude da sola. */
export function demoPoFile(): Uint8Array {
  const head = ["CoCd", "POrg", "Supplier", "PGr", "Doc. Date", "Type", "Purch.Doc.", "Item", "Name 1", "Created by", "Purch.Req.", "PR VALUE", "Order Number"];
  return sheet([head, ["9999", "9999", "SIMV0007", "SIM", day(0), "EB", "SIMPO3001", "10", "EXPO SERVICE SRL", "SIMULAZIONE", "SIM-8200001", "8500.00", "SIM2600000010"]]);
}
