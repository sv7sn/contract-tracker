// Simulazione del Master Plan: MP26 (con le revisioni R3…R9) e MP27, più RDA, acquisti e contratti finti collegati,
// per vedere come si comportano impegnato, previsione, impegni futuri e sforamenti. Tutto si elimina con un clic.
import type { User } from "../src/types.ts";
import { importBudget } from "./_budget.js";
import { getPool, inTransaction } from "./_db.js";
import { HttpError } from "./_http.js";

export const SIM_FILE = "simulazione-master-plan.csv";
const SIM_TAG = "Simulazione Master Plan";

// Internal order di prova: [IO, CDC, CDC NAME, NAME, CATEGORIA, MP26, R3, R5, R7, R9, MP27]
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
// Pratiche: [IO, titolo, fornitore, valore, mese di rilascio (1-12), tipo] — rda = già ordinata, purchase = in previsione
const ITEMS: [string, string, string, number, number, "rda" | "purchase"][] = [
  ["SIM2600000001", "Analisi suolo campagna primavera", "AgroLab Srl", 38000, 3, "rda"],
  ["SIM2600000001", "Prove di germinazione", "Seed Test Spa", 27500, 6, "rda"],
  ["SIM2600000001", "Analisi campagna autunno", "AgroLab Srl", 30000, 11, "purchase"],
  ["SIM2600000003", "Rinnovo licenze CAD", "Software Point Srl", 82000, 2, "rda"],
  ["SIM2600000003", "Estensione cloud storage", "CloudItalia Spa", 64000, 5, "rda"],
  ["SIM2600000003", "Licenze cybersecurity", "SecureNet Srl", 98000, 9, "rda"],
  ["SIM2600000003", "Strumento di BI", "DataViz Srl", 45000, 12, "purchase"],
  ["SIM2600000004", "Interventi straordinari MES", "Rockwell Automation Srl", 40000, 4, "rda"],
  ["SIM2600000005", "Percorso leadership", "Academy Srl", 52000, 3, "rda"],
  ["SIM2600000005", "Corsi lingua inglese", "Language Lab Srl", 18000, 10, "purchase"],
  ["SIM2600000006", "Selezione 3 ingegneri", "Talent Search Srl", 21000, 5, "rda"],
  ["SIM2600000008", "Vigilanza estiva aggiuntiva", "Sicurezza Nord Srl", 9000, 7, "rda"],
  ["SIM2600000009", "Fiera EIMA", "Expo Service Srl", 74000, 4, "rda"],
  ["SIM2600000009", "Evento clienti", "Event Lab Srl", 61000, 9, "rda"],
  ["SIM2600000010", "Parere contrattualistica", "Studio Legale Rossi", 35000, 6, "rda"],
  ["", "Abbonamento banca dati normativa", "Wolters Srl", 12000, 2, "rda"],
];
// Contratti pluriennali: [IO, fornitore, oggetto, valore totale, inizio, fine]
const CONTRACTS: [string, string, string, number, string, string][] = [
  ["SIM2600000004", "Rockwell Automation Srl", "Manutenzione MES 2026-2028", 330000, "2026-01-01", "2028-12-31"],
  ["SIM2600000007", "Pulito Spa", "Pulizie uffici e stabilimento", 186000, "2026-04-01", "2027-12-31"],
  ["SIM2600000008", "Sicurezza Nord Srl", "Servizio di vigilanza", 210000, "2026-01-01", "2028-12-31"],
  ["SIM2600000003", "CloudItalia Spa", "Piattaforma cloud 2027-2029", 300000, "2027-01-01", "2029-12-31"],
];

function csv(year: 26 | 27): Uint8Array {
  const head = year === 26 ? "Row Labels;CDC;CDC NAME;NAME;CATEGORIA;MP26;R3;R5;R7;R9" : "Row Labels;CDC;CDC NAME;NAME;CATEGORIA;MP27";
  const rows = LINES.map(l => (year === 26 ? [...l.slice(0, 10)] : [...l.slice(0, 5), l[10]]).join(";"));
  return new TextEncoder().encode([head, ...rows, `Grand Total;;;;;${year === 26 ? "0;0;0;0;0" : "0"}`].join("\n"));
}

export async function loadBudgetDemo(user: User): Promise<{ years: number[]; tasks: number; contracts: number }> {
  if (user.role !== "manager") throw new HttpError(403, "Solo il Manager carica la simulazione");
  const db = getPool();
  if ((await db.query("select 1 from tasks where created_by = $1 limit 1", [SIM_TAG])).rows.length) throw new HttpError(409, "La simulazione è già caricata: eliminala prima di ricaricarla");
  const real = (await db.query("select distinct year from mp_versions where year in (2026, 2027) and file_name <> $1", [SIM_FILE])).rows.map(r => r.year as number);
  if (real.length) throw new HttpError(409, `Esiste già un Master Plan reale per il ${real.join(" e ")}: la simulazione non lo sovrascrive`);
  await importBudget(user, 2026, "", SIM_FILE, csv(26));
  await importBudget(user, 2027, "", SIM_FILE, csv(27));
  let n = 0;
  await inTransaction(async tx => {
    for (const [io, title, supplier, value, month, kind] of ITEMS) {
      n++;
      const release = `2026-${String(month).padStart(2, "0")}-15`;
      if (kind === "rda") {
        // RDA già diventata ordine: resta stabile anche quando si importano i file SAP veri.
        const sourcing = value > 10000 ? JSON.stringify({ mode: "comparison", quotes: [{ supplier, amount: Math.round(value * 1.06), chosen: true }, { supplier: "Concorrente Srl", amount: Math.round(value * 1.15), chosen: false }], justification: "", recordedBy: user.name, recordedAt: release, approval: null, approvedBy: "", approvedAt: null, approvalNote: "", baseline: null, finalAmount: value }) : null;
        await tx.query(`insert into tasks (source, source_key, title, due, assignee_id, status, done_at, done_reason, done_by, meta, sourcing, po_numbers, created_by, created_at)
          values ('rda', $1, $2, ($3::date + 7), $4, 'done', ($3::date + 20), 'po_created', 'SAP', $5, $6, $7, $8, $3::date)`,
          [`SIM-${8000000 + n}`, `RDA SIM-${8000000 + n} · ${title}`, release, user.id,
            JSON.stringify({ io: io ? { [io]: value } : {}, value, currency: "EUR", releaseDate: release, requestedBy: "SIMULAZIONE", pgr: "SIM", costCenter: io ? "" : "5821" }), sourcing, [`45${String(9000000 + n)}`], SIM_TAG]);
      } else {
        await tx.query(`insert into tasks (source, kind, title, detail, due, assignee_id, meta, created_by) values ('manual', 'purchase', $1, $2, $3, $4, $5, $6)`,
          [title, "Pratica di prova della simulazione Master Plan", release, user.id, JSON.stringify({ value, currency: "EUR", supplier, object: title, internalOrder: io }), SIM_TAG]);
      }
    }
    for (const [io, supplier, object, value, start, end] of CONTRACTS)
      await tx.query(`insert into contracts (supplier, object, category, country, value, currency, start_date, end_date, owner, renewal, type, notes, internal_order)
        values ($1,$2,'Simulazione','Italia',$3,'EUR',$4,$5,$6,'Non definito','Servizi',$7,$8)`, [supplier, object, value, start, end, user.name, SIM_TAG, io]);
  });
  return { years: [2026, 2027], tasks: ITEMS.length, contracts: CONTRACTS.length };
}

export async function deleteBudgetDemo(user: User): Promise<{ deleted: number }> {
  if (user.role !== "manager") throw new HttpError(403, "Solo il Manager elimina la simulazione");
  return inTransaction(async tx => {
    const t = await tx.query("delete from tasks where created_by = $1", [SIM_TAG]);
    const c = await tx.query("delete from contracts where notes = $1 and category = 'Simulazione'", [SIM_TAG]);
    const v = await tx.query("delete from mp_versions where file_name = $1", [SIM_FILE]);
    return { deleted: (t.rowCount ?? 0) + (c.rowCount ?? 0) + (v.rowCount ?? 0) };
  });
}

export async function hasBudgetDemo(): Promise<boolean> {
  return (await getPool().query("select 1 from mp_versions where file_name = $1 limit 1", [SIM_FILE])).rows.length > 0;
}
