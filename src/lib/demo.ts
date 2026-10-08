// Dati dimostrativi, tutti fittizi. Servono solo in modalità locale (quando l'API non è raggiungibile, es. `npm run dev`).
import type { AppState, AuditLogs, Contract, Plans, User } from "../types.ts";
import { addDays, fmtDate, isoDate, NOW } from "./format.ts";
import { makePlan } from "./plan.ts";

export const DEMO_PASSWORD = "demo1234";

export const DEMO_USERS: User[] = [
  { id: 1,  email: "manager@example.com",        name: "Manager Demo",   role: "manager", title: "Responsabile Acquisti Indiretti", active: true },
  { id: 2,  email: "buyer.senior@example.com",   name: "Buyer Senior",   role: "buyer",   title: "Senior Buyer", active: true },
  { id: 3,  email: "buyer.generale@example.com", name: "Buyer Generale", role: "buyer",   title: "Buyer", active: true },
  { id: 4,  email: "buyer.ict@example.com",      name: "Buyer ICT",      role: "buyer",   title: "Buyer ICT", active: true },
  { id: 5,  email: "buyer.facility@example.com", name: "Buyer Facility", role: "buyer",   title: "Buyer Facility", active: true },
  { id: 6,  email: "buyer.asia@example.com",     name: "Buyer Asia",     role: "buyer",   title: "Buyer - Hub Asia", active: true },
  { id: 7,  email: "bo.operations@example.com",  name: "BO Operations",  role: "bo",      title: "Direttore Operations", active: true },
  { id: 8,  email: "bo.it@example.com",          name: "BO IT",          role: "bo",      title: "Responsabile IT", active: true },
  { id: 9,  email: "bo.supply@example.com",      name: "BO Supply Chain",role: "bo",      title: "Direttore Supply Chain", active: true },
  { id: 10, email: "bo.hr@example.com",          name: "BO HR",          role: "bo",      title: "Direttore HR", active: true },
  { id: 11, email: "bo.facility@example.com",    name: "BO Facility",    role: "bo",      title: "Facility Manager", active: true },
];

// Le date sono relative a oggi, così la demo mostra sempre un mix realistico di scadenze.
const rel = (days: number) => isoDate(addDays(NOW, days));
const c = (id: number, supplier: string, object: string, category: string, country: string, value: number, currency: string, start: number, end: number, owner: string, boEmail: string, renewal: string, type: string, fileName: string | null): Contract =>
  ({ id, supplier, object, category, country, value, currency, start: rel(start), end: rel(end), owner, boEmail, renewal, type, notes: "", ceased: false, fileName });

export const MOCK_CONTRACTS: Contract[] = [
  c(1,  "Macchinari Orient Ltd",   "Macchinari - Linea estero",  "Capex",    "Cina",     2400000, "EUR", -480,  -15, "Buyer Senior",   "bo.operations@example.com", "Da rilanciare a gara", "Fornitura", "contratto-macchinari.pdf"),
  c(2,  "Consulenza Digitale Spa", "Implementazione ERP",        "IT",       "Italia",   850000,  "EUR", -700,  25,  "Manager Demo",   "bo.it@example.com",         "In negoziazione",      "Servizi",  null),
  c(3,  "Trasporti Europa Srl",    "Logistica outbound Europa",  "Logistica","Germania", 320000,  "EUR", -850,  40,  "Buyer Generale", "bo.supply@example.com",     "In negoziazione",      "Servizi",  "contratto-logistica.pdf"),
  c(4,  "Software Database Srl",   "Licenze database AMS",       "ICT",      "Italia",   180000,  "EUR", -1390, 70,  "Buyer ICT",      "bo.it@example.com",         "Da rescindere",        "AMS",      null),
  c(5,  "Materie Prime Asia Co.",  "Fornitura materie prime",    "Mat.Prime","Cina",     5600000, "USD", -490,  240, "Buyer Asia",     "bo.operations@example.com", "Rinnovo automatico",   "Fornitura","contratto-materie-prime.pdf"),
  c(6,  "Vigilanza Italia Srl",    "Vigilanza stabilimenti",     "Facility", "Italia",   95000,   "EUR", -1770, 55,  "Buyer Facility", "bo.facility@example.com",   "Da rilanciare a gara", "Servizi",  null),
  c(7,  "Cloud Services Inc.",     "Cloud e produttività",       "ICT",      "USA",      240000,  "EUR", -640,  420, "Buyer ICT",      "bo.it@example.com",         "Rinnovo automatico",   "SaaS",     null),
  c(8,  "Lavoro Temporaneo Spa",   "Somministrazione lavoro",    "HR",       "Italia",   410000,  "EUR", -630,  100, "Buyer Generale", "bo.hr@example.com",         "In negoziazione",      "Servizi",  null),
  c(9,  "Selezione Personale Srl", "Ricerca e selezione",        "HR",       "Italia",   85000,   "EUR", -620,  110, "Buyer Generale", "bo.hr@example.com",         "In negoziazione",      "Servizi",  null),
  c(10, "Assistenza Sistemi Srl",  "Manutenzione server legacy", "ICT",      "Italia",   120000,  "EUR", -1000, 85,  "Buyer ICT",      "bo.it@example.com",         "Da rescindere",        "AMS",      null),
];

export function demoState(): AppState {
  const plans: Plans = Object.fromEntries(MOCK_CONTRACTS.map(x => [x.id, makePlan(x.id, x.end)]));
  const auditLogs: AuditLogs = Object.fromEntries(MOCK_CONTRACTS.map(x => [x.id, [{ ts: `${fmtDate(x.start)}, 09:00`, user: x.owner, action: "Contratto creato", detail: `${x.supplier} · ${x.object}` }]]));
  return { contracts: MOCK_CONTRACTS, plans, auditLogs };
}

// ─── Salvataggio nel browser (solo modalità locale) ──────────
const STORAGE_KEY = "contract-tracker:demo:v2";
export function loadLocal(): AppState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as AppState;
    return Array.isArray(data.contracts) && data.plans && data.auditLogs ? data : null;
  } catch { return null; }
}
export function saveLocal(state: AppState) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* storage pieno o non disponibile */ }
}
export function clearLocal() {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}
