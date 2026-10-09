import type { CheckStatus, ComplianceCheck, DuplicateMatch, FieldChange, Lifecycle, Qualification, ResolvedDocType, SupplierData, SupplierDocument } from "../src/types.ts";
import type { Queryable } from "./_db.js";
import { screenName } from "./_sanctions.js";
import { checkCompany, type CompanyCheck } from "./_company.js";
import { countryName, docValidity, EU_COUNTRIES, missingRequired, normalizeIban, normName, normTax } from "./_supplier-rules.js";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

// ─── Doppioni ────────────────────────────────────────────────
export interface DupTarget { id?: number; name?: string; email?: string; data?: SupplierData; confirmed?: number[] }

const keysOf = (name: string | undefined, d: SupplierData | undefined) => ({
  name: normName(d?.company?.legalName || name), vat: normTax(d?.company?.vatCode), fiscal: normTax(d?.company?.fiscalCode), iban: normalizeIban(d?.payment?.iban ?? ""),
});

/** Altri fornitori con stessa partita IVA/codice fiscale, stesso IBAN o stessa ragione sociale. Un IBAN condiviso con un'altra azienda o un fornitore escluso sono segnalazioni gravi. */
export async function findDuplicates(db: Queryable, t: DupTarget): Promise<DuplicateMatch[]> {
  const me = keysOf(t.name, t.data);
  const rows = (await db.query("select id, name, email, data, status, lifecycle, sap_code, dup_confirmed from suppliers where ($1::int is null or id <> $1)", [t.id ?? null])).rows;
  const out: DuplicateMatch[] = [];
  for (const r of rows) {
    const o = keysOf(r.name, r.data);
    const fields: string[] = [];
    const taxes = [o.vat, o.fiscal].filter(Boolean);
    if (me.vat && taxes.includes(me.vat)) fields.push("Partita IVA");
    else if (me.fiscal && taxes.includes(me.fiscal)) fields.push("Codice fiscale");
    if (me.iban && me.iban === o.iban) fields.push("IBAN");
    if (me.name.length >= 3 && me.name === o.name) fields.push("Ragione sociale");
    if (t.email && r.email && t.email.toLowerCase() === String(r.email).toLowerCase()) fields.push("Email");
    if (!fields.length) continue;
    const sameCompany = fields.includes("Partita IVA") || fields.includes("Codice fiscale");
    const severe = r.lifecycle === "excluded" || (fields.includes("IBAN") && !sameCompany && !!me.vat && !!o.vat);
    // Già verificato come fornitore distinto (da una parte o dall'altra): non va riconfermato a ogni aggiornamento.
    const confirmed = !severe && ((t.confirmed ?? []).includes(r.id) || (t.id !== undefined && (r.dup_confirmed ?? []).includes(t.id)));
    out.push({ supplierId: r.id, name: r.data?.company?.legalName || r.name, status: r.status, lifecycle: r.lifecycle ?? "active", sapCode: r.sap_code, fields, severe, confirmed });
  }
  return out.sort((a, b) => Number(b.severe) - Number(a.severe) || b.fields.length - a.fields.length);
}

/** Per l'elenco: id dei fornitori che hanno almeno un possibile doppione (calcolo unico su tutti i fornitori). */
export async function duplicateIds(db: Queryable): Promise<Set<number>> {
  const rows = (await db.query("select id, name, data from suppliers")).rows;
  const seen = new Map<string, number[]>();
  const add = (k: string, id: number) => { if (!k) return; const a = seen.get(k) ?? []; a.push(id); seen.set(k, a); };
  for (const r of rows) {
    const k = keysOf(r.name, r.data);
    add(k.vat && `t:${k.vat}`, r.id); if (k.fiscal && k.fiscal !== k.vat) add(`t:${k.fiscal}`, r.id);
    add(k.iban && `i:${k.iban}`, r.id); add(k.name.length >= 3 ? `n:${k.name}` : "", r.id);
  }
  const out = new Set<number>();
  for (const ids of seen.values()) { const u = [...new Set(ids)]; if (u.length > 1) u.forEach(i => out.add(i)); }
  return out;
}

// ─── Modifiche rispetto ai dati approvati ────────────────────
const FIELDS: [string, string, boolean][] = [
  ["company.legalName", "Ragione sociale", false], ["company.vatCode", "Partita IVA", false], ["company.fiscalCode", "Codice fiscale", false],
  ["address.street", "Indirizzo", false], ["address.houseNumber", "Numero civico", false], ["address.postalCode", "CAP", false], ["address.city", "Città", false], ["address.region", "Regione / provincia", false], ["address.country", "Paese", false],
  ["payment.iban", "IBAN", true], ["payment.swift", "SWIFT / BIC", true], ["payment.accountNumber", "Numero di conto", true], ["payment.bankName", "Banca", true], ["payment.currency", "Valuta", true],
  ["payment.withholdingTax", "Ritenuta d'acconto", false], ["payment.withholdingType", "Tipo di ritenuta", false],
  ["contacts.ordersEmail", "Email ordini", false], ["contacts.adminEmail", "Email amministrativa", false], ["contacts.phone", "Telefono", false], ["contacts.language", "Lingua", false],
];
const get = (d: SupplierData | undefined, path: string): string => {
  const [a, b] = path.split(".");
  const v = (d as Row | undefined)?.[a]?.[b];
  return v === undefined || v === null ? "" : typeof v === "boolean" ? (v ? "Sì" : "No") : String(v);
};
export function diffData(before: SupplierData | null | undefined, after: SupplierData | undefined): FieldChange[] {
  if (!before) return [];
  return FIELDS.filter(([p]) => get(before, p) !== get(after, p)).map(([p, label, bank]) => ({ field: p, label, before: get(before, p), after: get(after, p), bank }));
}
export const bankKey = (d: SupplierData | undefined) => ["iban", "swift", "accountNumber", "bankName", "currency"].map(k => String((d?.payment as Row | undefined)?.[k] ?? "")).join("|");

// ─── Qualifica documentale ───────────────────────────────────
export function qualificationOf(status: string, resolved: ResolvedDocType[], docs: Pick<SupplierDocument, "type" | "validUntil">[]): Qualification {
  if (status !== "registered") return "na";
  if (missingRequired(resolved, docs).length) return "lapsed";
  const required = new Set(resolved.filter(t => t.required).map(t => t.key));
  return docs.some(d => required.has(d.type) && docValidity(d.validUntil) === "expiring") ? "expiring" : "valid";
}

// ─── Controlli di conformità ─────────────────────────────────
export interface StoredCompliance { checkedAt?: string; vies?: { status: CheckStatus; detail: string }; sanctions?: { status: CheckStatus; detail: string }; company?: CompanyCheck; manualSanctions?: { by: string; at: string; note: string } }

const VIES_CODE = (c: string) => (c === "GR" ? "EL" : c);
/** Verifica della partita IVA nel sistema europeo VIES. VIES_MODE=off la disattiva, mock serve ai test. */
async function checkVies(country: string | undefined, vat: string | undefined, legalName: string): Promise<{ status: CheckStatus; detail: string }> {
  if (!country || !EU_COUNTRIES.includes(country)) return { status: "na", detail: `${countryName(country) || "Paese"} fuori dall'UE: verifica VIES non applicabile` };
  const num = normTax(vat);
  if (!num) return { status: "todo", detail: "Partita IVA non indicata" };
  const mode = process.env.VIES_MODE ?? "live";
  if (mode === "off") return { status: "todo", detail: "Verifica VIES disattivata" };
  try {
    let valid: boolean, name = "";
    if (mode === "mock") { valid = !num.endsWith("0000"); name = valid ? legalName : ""; }
    else {
      const res = await fetch(`https://ec.europa.eu/taxation_customs/vies/rest-api/ms/${VIES_CODE(country)}/vat/${encodeURIComponent(num)}`, { signal: AbortSignal.timeout(6000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = (await res.json()) as { isValid?: boolean; name?: string; userError?: string };
      if (j.isValid === undefined || (j.userError && !["VALID", "INVALID"].includes(j.userError))) throw new Error(j.userError ?? "risposta non valida");
      valid = !!j.isValid; name = j.name && j.name !== "---" ? j.name : "";
    }
    if (!valid) return { status: "fail", detail: `Partita IVA ${country}${num} non valida secondo VIES` };
    if (name && normName(name) && normName(legalName) && !normName(name).includes(normName(legalName)) && !normName(legalName).includes(normName(name))) return { status: "warn", detail: `Partita IVA valida, ma registrata a "${name}"` };
    return { status: "ok", detail: `Partita IVA valida${name ? ` (${name})` : ""}` };
  } catch (err) {
    return { status: "todo", detail: `Servizio VIES non raggiungibile (${err instanceof Error ? err.message : "errore"}): riprova più tardi` };
  }
}

/** Ricerca nelle liste di sanzioni: di base le liste ufficiali UE, ONU e OFAC scaricate ogni notte; in alternativa OpenSanctions (a pagamento). */
async function checkSanctions(db: Queryable, legalName: string, country: string | undefined): Promise<{ status: CheckStatus; detail: string }> {
  const provider = process.env.SANCTIONS_PROVIDER ?? "";
  if (provider === "mock") return /sanction/i.test(legalName) ? { status: "fail", detail: `Possibile corrispondenza in lista sanzioni: "${legalName}"` } : { status: "ok", detail: "Nessuna corrispondenza nelle liste sanzioni" };
  if (provider !== "opensanctions" || !process.env.OPENSANCTIONS_API_KEY) return screenName(db, legalName);
  try {
    const res = await fetch("https://api.opensanctions.org/match/sanctions", {
      method: "POST", signal: AbortSignal.timeout(8000), headers: { Authorization: `ApiKey ${process.env.OPENSANCTIONS_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ queries: { q: { schema: "Company", properties: { name: [legalName], ...(country ? { country: [country.toLowerCase()] } : {}) } } } }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = (await res.json()) as { responses?: { q?: { results?: { caption: string; score: number }[] } } };
    const hit = (j.responses?.q?.results ?? []).find(r => r.score >= 0.7);
    return hit ? { status: "fail", detail: `Possibile corrispondenza: "${hit.caption}" (punteggio ${Math.round(hit.score * 100)}%)` } : { status: "ok", detail: "Nessuna corrispondenza nelle liste sanzioni" };
  } catch (err) {
    return { status: "todo", detail: `Servizio sanzioni non raggiungibile (${err instanceof Error ? err.message : "errore"})` };
  }
}

/** Esegue i controlli che richiedono servizi esterni e ne salva l'esito sul fornitore. */
export async function runExternalChecks(db: Queryable, supplierId: number): Promise<void> {
  const r = (await db.query("select data, name, compliance from suppliers where id = $1", [supplierId])).rows[0];
  if (!r) return;
  const d: SupplierData = r.data ?? {};
  const legal = d.company?.legalName || r.name;
  const [vies, sanctions, company] = await Promise.all([
    checkVies(d.address?.country, d.company?.vatCode, legal), checkSanctions(db, legal, d.address?.country),
    checkCompany(d.address?.country, d.company?.vatCode, d.company?.fiscalCode, legal),
  ]);
  const next: StoredCompliance = { ...(r.compliance ?? {}), checkedAt: new Date().toISOString(), vies, sanctions, company };
  await db.query("update suppliers set compliance = $1 where id = $2", [JSON.stringify(next), supplierId]);
}

/** Elenco completo dei controlli: quelli salvati (VIES, sanzioni) più quelli calcolati sul momento. */
export function complianceChecks(d: SupplierData, stored: StoredCompliance | null, dups: DuplicateMatch[], qualification: Qualification, missingDocs: number, lifecycle: Lifecycle): ComplianceCheck[] {
  const s = stored ?? {};
  const country = d.address?.country, iban = normalizeIban(d.payment?.iban ?? "");
  const ibanCc = iban.slice(0, 2);
  const decl = d.declarations ?? {};
  const checks: ComplianceCheck[] = [
    { key: "vies", label: "Partita IVA (VIES)", ...(s.vies ?? { status: "todo", detail: "Controllo non ancora eseguito" }) },
    { key: "company", label: "Situazione dell'azienda", ...(s.company ? { status: s.company.status, detail: s.company.detail } : { status: "todo" as const, detail: "Controllo non ancora eseguito" }) },
    { key: "iban_country", label: "Paese del conto bancario", ...(!iban ? { status: country === "BR" ? "na" as const : "todo" as const, detail: "IBAN non indicato" } : ibanCc === country ? { status: "ok" as const, detail: `Conto nello stesso paese della sede (${ibanCc})` } : { status: "warn" as const, detail: `Conto in ${countryName(ibanCc) || ibanCc}, sede in ${countryName(country) || country || "—"}: verifica il motivo` }) },
    { key: "duplicates", label: "Doppioni", ...(dups.length === 0 ? { status: "ok" as const, detail: "Nessun altro fornitore con gli stessi dati" } : dups.every(x => x.confirmed) ? { status: "ok" as const, detail: `Verificati dal Buyer come fornitori distinti: ${dups.map(x => x.name).join(", ")}` } : { status: dups.some(x => x.severe) ? "fail" as const : "warn" as const, detail: dups.map(x => `${x.name} (${x.fields.join(", ")}${x.lifecycle === "excluded" ? ", ESCLUSO" : ""})`).join("; ") }) },
    { key: "documents", label: "Documenti di qualifica", ...(qualification === "lapsed" || missingDocs > 0 ? { status: "fail" as const, detail: "Documenti obbligatori scaduti o mancanti" } : qualification === "expiring" ? { status: "warn" as const, detail: "Documenti obbligatori in scadenza entro 30 giorni" } : { status: "ok" as const, detail: "Documenti obbligatori presenti e validi" }) },
    { key: "declarations", label: "Dichiarazioni del fornitore", ...(decl.noSanctions !== true || (decl.conflictOfInterest !== true && decl.conflictOfInterest !== false) ? { status: "todo" as const, detail: "Dichiarazioni non ancora rese dal fornitore" } : decl.conflictOfInterest ? { status: "warn" as const, detail: `Dichiara un possibile conflitto d'interessi: ${decl.conflictDetails ?? ""}` } : { status: "ok" as const, detail: "Nessun conflitto d'interessi; dichiara di non essere soggetto a sanzioni" }) },
    { key: "sanctions", label: "Liste sanzioni internazionali", ...(s.manualSanctions && (s.sanctions?.status ?? "todo") === "todo" ? { status: "ok" as const, detail: `Verificato manualmente da ${s.manualSanctions.by} il ${s.manualSanctions.at.slice(0, 10)}: ${s.manualSanctions.note}` } : (s.sanctions ?? { status: "todo" as const, detail: "Controllo non ancora eseguito" })) },
  ];
  if (lifecycle !== "active") checks.unshift({ key: "lifecycle", label: "Stato del fornitore", status: "fail", detail: lifecycle === "blocked" ? "Fornitore bloccato" : lifecycle === "inactive" ? "Fornitore disattivato" : "Fornitore escluso" });
  return checks;
}
