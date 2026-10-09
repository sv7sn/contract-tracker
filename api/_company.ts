// Verifica dell'azienda presso fonti esterne: esistenza, stato di attività, situazione economica e altre criticità.
// - Italia: Openapi "Company IT-advanced" (Registro Imprese; circa 0,10 € a verifica, 30 gratuite al mese) con OPENAPI_COMPANY_TOKEN.
// - Tutti i paesi: GLEIF (registro mondiale dei codici LEI, gratuito, senza chiave) per le aziende che hanno un LEI.
import type { CheckStatus } from "../src/types.ts";
import { normTax } from "./_supplier-rules.js";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
export interface CompanyCheck { status: CheckStatus; detail: string; facts: Record<string, string>; source: string }

const pick = (o: Row | undefined, ...paths: string[]): any => { // eslint-disable-line @typescript-eslint/no-explicit-any
  for (const p of paths) {
    let v: any = o; // eslint-disable-line @typescript-eslint/no-explicit-any
    for (const k of p.split(".")) v = v?.[k];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
};
const eur = (n: number) => n >= 1e6 ? `${(n / 1e6).toLocaleString("it-IT", { maximumFractionDigits: 1 })} M€` : `${Math.round(n).toLocaleString("it-IT")} €`;
const toDate = (v: unknown): Date | null => {
  if (v === undefined || v === null || v === "") return null;
  const d = typeof v === "number" ? new Date(v < 1e12 ? v * 1000 : v) : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
};
const sameName = (a: string, b: string) => {
  const n = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\b(S\.?R\.?L\.?S?|S\.?P\.?A\.?|S\.?A\.?S\.?|S\.?N\.?C\.?|SOCIETA|COOPERATIVA|A RESPONSABILITA LIMITATA|PER AZIONI)\b/g, " ").replace(/[^A-Z0-9]+/g, "");
  const x = n(a), y = n(b);
  return !x || !y || x.includes(y) || y.includes(x);
};
// Stati che indicano un'azienda non operativa o in crisi.
const BAD = /(LIQUIDAZ|FALLIM|CESSAT|SCIOLT|INATTIV|CANCELLAT|PROCEDUR|CONCORDAT|AMMINISTRAZIONE STRAORD|INSOLV|BANKRUP|DISSOLV|CEASED|INACTIVE|LIQUIDATION)/i;

/** Registro Imprese tramite Openapi: stato di attività, data di costituzione, capitale, fatturato e dipendenti dall'ultimo bilancio. */
async function openapiItaly(vat: string, legalName: string, token: string): Promise<CompanyCheck> {
  const base = process.env.OPENAPI_COMPANY_URL?.trim() || "https://company.openapi.com";
  const res = await fetch(`${base}/IT-advanced/${encodeURIComponent(vat)}`, { signal: AbortSignal.timeout(10_000), headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 404) return { status: "fail", detail: "Partita IVA non trovata nel Registro Imprese", facts: {}, source: "Registro Imprese (Openapi)" };
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = (await res.json()) as Row;
  const d: Row | undefined = Array.isArray(j.data) ? j.data[0] : j.data;
  if (!d) return { status: "fail", detail: "Partita IVA non trovata nel Registro Imprese", facts: {}, source: "Registro Imprese (Openapi)" };
  const facts: Record<string, string> = {};
  const issues: string[] = [], warns: string[] = [];
  const state = String(pick(d, "activityStatus", "status", "companyStatus", "statoAttivita") ?? "");
  if (state) facts["Stato"] = state;
  const name = String(pick(d, "companyName", "denominazione", "name") ?? "");
  if (name) facts["Denominazione"] = name;
  const form = pick(d, "detailedLegalForm.description", "legalForm.description", "legalForm", "formaGiuridica");
  if (form) facts["Forma giuridica"] = String(form);
  const start = toDate(pick(d, "registrationDate", "startDate", "incorporationDate", "dataIscrizione", "creationTimestamp"));
  if (start) facts["Costituita il"] = start.toISOString().slice(0, 10);
  const capital = Number(pick(d, "shareCapital", "balanceSheets.last.shareCapital", "capitaleSociale"));
  if (Number.isFinite(capital) && capital > 0) facts["Capitale sociale"] = eur(capital);
  const turnover = Number(pick(d, "balanceSheets.last.turnover", "turnover", "fatturato", "ecofin.turnover"));
  const year = pick(d, "balanceSheets.last.year", "turnoverYear", "ecofin.turnoverYear");
  if (Number.isFinite(turnover) && turnover > 0) facts[`Fatturato${year ? ` ${year}` : ""}`] = eur(turnover);
  const employees = Number(pick(d, "balanceSheets.last.employees", "employees", "dipendenti", "ecofin.employees"));
  if (Number.isFinite(employees) && employees >= 0 && pick(d, "balanceSheets.last.employees", "employees", "dipendenti", "ecofin.employees") !== undefined) facts["Dipendenti"] = String(employees);
  const netWorth = Number(pick(d, "balanceSheets.last.netWorth", "netWorth", "patrimonioNetto"));
  if (Number.isFinite(netWorth) && pick(d, "balanceSheets.last.netWorth", "netWorth", "patrimonioNetto") !== undefined) facts["Patrimonio netto"] = eur(netWorth);
  const pec = pick(d, "pec", "PEC");
  if (pec) facts["PEC"] = String(pec);

  if (!state) warns.push("stato di attività non disponibile");
  else if (BAD.test(state)) issues.push(`stato "${state}"`);
  else if (!/ATTIV|ACTIVE/i.test(state)) warns.push(`stato "${state}"`);
  if (name && legalName && !sameName(name, legalName)) warns.push(`denominazione registrata "${name}" diversa da quella indicata`);
  if (start && Date.now() - start.getTime() < 365 * 864e5) warns.push("costituita da meno di un anno");
  if (Number.isFinite(netWorth) && netWorth < 0 && facts["Patrimonio netto"]) issues.push("patrimonio netto negativo");
  const summary = Object.entries(facts).filter(([k]) => k !== "Denominazione" && k !== "PEC").map(([k, v]) => `${k}: ${v}`).join(" · ");
  if (issues.length) return { status: "fail", detail: `Criticità: ${issues.join(", ")}. ${summary}`, facts, source: "Registro Imprese (Openapi)" };
  if (warns.length) return { status: "warn", detail: `Da verificare: ${warns.join(", ")}. ${summary}`, facts, source: "Registro Imprese (Openapi)" };
  return { status: "ok", detail: summary || "Azienda attiva", facts, source: "Registro Imprese (Openapi)" };
}

/** GLEIF: registro mondiale dei codici LEI, gratuito. Dice se l'azienda risulta attiva e se il codice è rinnovato. */
async function gleif(ids: string[], country: string | undefined): Promise<CompanyCheck | null> {
  for (const id of ids.filter(Boolean)) {
    const q = new URLSearchParams({ "filter[entity.registeredAs]": id, "page[size]": "1" });
    if (country) q.set("filter[entity.legalAddress.country]", country);
    const res = await fetch(`https://api.gleif.org/api/v1/lei-records?${q}`, { signal: AbortSignal.timeout(8000), headers: { Accept: "application/vnd.api+json" } });
    if (!res.ok) throw new Error(`GLEIF HTTP ${res.status}`);
    const r = ((await res.json()) as Row).data?.[0];
    if (!r) continue;
    const a = r.attributes ?? {};
    const status = String(a.entity?.status ?? ""), reg = String(a.registration?.status ?? "");
    const facts: Record<string, string> = { LEI: String(a.lei ?? r.id ?? ""), "Stato LEI": `${status || "—"} / ${reg || "—"}`, Denominazione: String(a.entity?.legalName?.name ?? "") };
    if (status === "INACTIVE" || /RETIRED|ANNULLED|MERGED|DUPLICATE/.test(reg)) return { status: "fail", detail: `Registro LEI: azienda non attiva (${status}, ${reg})`, facts, source: "GLEIF" };
    if (reg === "LAPSED") return { status: "warn", detail: `Registro LEI: azienda attiva ma codice LEI non rinnovato (${facts.LEI})`, facts, source: "GLEIF" };
    return { status: "ok", detail: `Registro LEI: azienda attiva (${facts.LEI})`, facts, source: "GLEIF" };
  }
  return null;
}

/** Verifica l'azienda con le fonti disponibili. Senza fonti utilizzabili il controllo risulta "non applicabile" e non blocca nulla. */
export async function checkCompany(country: string | undefined, vat: string | undefined, fiscal: string | undefined, legalName: string): Promise<CompanyCheck> {
  const mode = process.env.COMPANY_CHECK_MODE ?? "live";
  if (mode === "off") return { status: "na", detail: "Verifica dell'azienda disattivata", facts: {}, source: "" };
  const v = normTax(vat).replace(/^[A-Z]{2}/, ""), f = normTax(fiscal).replace(/^[A-Z]{2}/, "");
  const token = process.env.OPENAPI_COMPANY_TOKEN?.trim();
  const parts: CompanyCheck[] = [];
  const errors: string[] = [];
  if (country === "IT" && token && (v || f)) {
    try { parts.push(await openapiItaly(v || f, legalName, token)); } catch (err) { errors.push(`Registro Imprese non raggiungibile (${err instanceof Error ? err.message : "errore"})`); }
  }
  try { const g = await gleif([f, v], country); if (g) parts.push(g); } catch (err) { errors.push(err instanceof Error ? err.message : "GLEIF non raggiungibile"); }
  if (!parts.length) {
    if (errors.length && country === "IT" && token) return { status: "todo", detail: `${errors.join("; ")}: riprova più tardi`, facts: {}, source: "" };
    return { status: "na", detail: country === "IT" && !token
      ? "Nessun dato disponibile: per stato di attività, bilancio e criticità dal Registro Imprese collega Openapi (Configurazione → Verifiche esterne)"
      : "L'azienda non ha un codice LEI e per questo paese non c'è un registro collegato", facts: {}, source: "" };
  }
  const rank: Record<string, number> = { fail: 3, warn: 2, todo: 1, ok: 0, na: 0 };
  const worst = parts.reduce((a, b) => (rank[b.status] > rank[a.status] ? b : a));
  return { status: worst.status, detail: [...parts.map(p => p.detail), ...errors].join(" | "), facts: Object.assign({}, ...parts.map(p => p.facts)), source: parts.map(p => p.source).join(", ") };
}
