// Regole di business sull'anagrafica fornitore, condivise tra server (che le fa rispettare) e interfaccia (che le mostra subito).
import type { SupplierData } from "../src/types.ts";

export const COUNTRIES: { code: string; name: string }[] = [
  ["IT", "Italia"], ["DE", "Germania"], ["FR", "Francia"], ["ES", "Spagna"], ["PT", "Portogallo"], ["NL", "Paesi Bassi"], ["BE", "Belgio"], ["AT", "Austria"],
  ["CH", "Svizzera"], ["GB", "Regno Unito"], ["IE", "Irlanda"], ["PL", "Polonia"], ["CZ", "Repubblica Ceca"], ["RO", "Romania"], ["HU", "Ungheria"], ["GR", "Grecia"],
  ["SE", "Svezia"], ["DK", "Danimarca"], ["FI", "Finlandia"], ["NO", "Norvegia"], ["TR", "Turchia"], ["US", "Stati Uniti"], ["CA", "Canada"], ["MX", "Messico"],
  ["BR", "Brasile"], ["AR", "Argentina"], ["CN", "Cina"], ["IN", "India"], ["JP", "Giappone"], ["KR", "Corea del Sud"], ["SG", "Singapore"], ["ID", "Indonesia"],
  ["TH", "Thailandia"], ["VN", "Vietnam"], ["AE", "Emirati Arabi Uniti"], ["ZA", "Sudafrica"], ["EG", "Egitto"], ["MA", "Marocco"],
].map(([code, name]) => ({ code, name }));
export const countryName = (code?: string) => COUNTRIES.find(c => c.code === code)?.name ?? code ?? "";
export const CURRENCIES = ["EUR", "USD", "GBP", "BRL", "CHF", "CNY", "JPY", "PLN", "CZK", "RON", "TRY", "MXN", "INR"];
/** Paesi in cui la regione/provincia è obbligatoria. */
export const REGION_REQUIRED = ["IT", "BR"];

export const WITHHOLDING_TYPES = [
  { code: "autonomo", label: "Lavoro autonomo / professionisti" }, { code: "provvigioni", label: "Provvigioni e agenti" },
  { code: "occasionale", label: "Prestazione occasionale" }, { code: "other", label: "Altro" },
];

// ─── Documenti di qualifica ──────────────────────────────────
export interface DocType { key: string; label: string; help: string; required: boolean; countries?: string[]; expires: boolean; multiple?: boolean }

/** Catalogo dei documenti. `required` vale per i paesi indicati (o per tutti, se `countries` manca). */
export const DOC_TYPES: DocType[] = [
  { key: "bank_letter", label: "Lettera della banca", help: "Lettera della banca che certifica l'intestazione e le coordinate del conto.", required: true, expires: false },
  { key: "chamber_certificate", label: "Visura camerale / certificato di iscrizione", help: "Documento ufficiale di iscrizione dell'azienda, emesso negli ultimi 6 mesi.", required: true, expires: true },
  { key: "durc", label: "DURC (regolarità contributiva)", help: "Documento Unico di Regolarità Contributiva in corso di validità.", required: true, countries: ["IT"], expires: true },
  { key: "company_presentation", label: "Presentazione aziendale", help: "Presentazione, brochure o catalogo (facoltativo).", required: false, expires: false },
  { key: "quality_certificates", label: "Certificazioni (ISO 9001, 14001, 45001…)", help: "Certificazioni di qualità, ambiente e sicurezza, con data di scadenza.", required: false, expires: true, multiple: true },
  { key: "insurance", label: "Polizza assicurativa (RC)", help: "Polizza di responsabilità civile, con data di scadenza.", required: false, expires: true },
  { key: "code_of_conduct", label: "Codice di condotta fornitori firmato", help: "Codice di condotta sottoscritto dal legale rappresentante.", required: true, expires: false },
  { key: "receita_federal", label: "Certificato Receita Federal", help: "Cartão CNPJ rilasciato dalla Receita Federal.", required: true, countries: ["BR"], expires: true },
  { key: "jucerja", label: "Certificato JUCERJA (o della Junta Comercial dello Stato)", help: "Certidão simplificada della Junta Comercial.", required: true, countries: ["BR"], expires: true },
  { key: "bank_contract", label: "Contratto bancario", help: "Contratto o dichiarazione della banca per verificare i dati bancari.", required: true, countries: ["BR"], expires: false },
];
export const docType = (key: string) => DOC_TYPES.find(d => d.key === key);
/** Documenti da mostrare per un paese (esclude quelli specifici di altri paesi). */
export const docTypesFor = (country?: string) => DOC_TYPES.filter(d => !d.countries || (!!country && d.countries.includes(country)));
export const requiredDocTypes = (country?: string) => docTypesFor(country).filter(d => d.required);

export const MAX_DOC_BYTES = 10 * 1024 * 1024;
export const DOC_EXTENSIONS = ["pdf", "doc", "docx", "ppt", "pptx", "jpg", "jpeg", "png"];
export const DOC_MIME: Record<string, string> = {
  pdf: "application/pdf", doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
};
export const SUPPLIER_FILE_PATH_RE = /^suppliers\/[0-9a-f-]{36}\/[^/\\]{1,150}$/;

/** Stato di validità di un documento con scadenza. */
export function docValidity(validUntil: string | null, now = new Date()): "none" | "valid" | "expiring" | "expired" {
  if (!validUntil) return "none";
  const days = Math.ceil((new Date(validUntil).getTime() - now.getTime()) / 864e5);
  return days < 0 ? "expired" : days <= 30 ? "expiring" : "valid";
}

// ─── Validazioni di formato ──────────────────────────────────
const clean = (s?: string) => (s ?? "").replace(/\s+/g, "").toUpperCase();
export const normalizeIban = clean;

export function validIban(raw?: string): boolean {
  const s = clean(raw);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s) || s.length > 34) return false;
  if (s.startsWith("IT") && s.length !== 27) return false;
  const moved = s.slice(4) + s.slice(0, 4);
  let rem = 0;
  for (const ch of moved) rem = Number(String(rem) + (/\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55))) % 97;
  return rem === 1;
}
export const validSwift = (raw?: string) => /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(clean(raw));

function validCnpj(raw: string): boolean {
  const d = raw.replace(/\D/g, "");
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false;
  const calc = (len: number) => { let sum = 0, pos = len - 7; for (let i = len; i >= 1; i--) { sum += Number(d[len - i]) * pos--; if (pos < 2) pos = 9; } const r = sum % 11; return r < 2 ? 0 : 11 - r; };
  return calc(12) === Number(d[12]) && calc(13) === Number(d[13]);
}

/** Formato della partita IVA / identificativo fiscale in base al paese. */
export function validVat(country: string | undefined, raw?: string): boolean {
  const s = clean(raw);
  if (!s) return false;
  switch (country) {
    case "IT": return /^(IT)?\d{11}$/.test(s);
    case "BR": return validCnpj(s);
    case "DE": return /^(DE)?\d{9}$/.test(s);
    case "FR": return /^(FR)?[A-Z0-9]{2}\d{9}$/.test(s);
    case "ES": return /^(ES)?[A-Z0-9]\d{7}[A-Z0-9]$/.test(s);
    default: return /^[A-Z0-9]{4,20}$/.test(s.replace(/[-./]/g, ""));
  }
}
export function validFiscal(country: string | undefined, raw?: string): boolean {
  const s = clean(raw);
  if (!s) return false;
  if (country === "IT") return /^(\d{11}|[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z])$/.test(s);
  return /^[A-Z0-9]{4,20}$/.test(s.replace(/[-./]/g, ""));
}
export const validEmail = (v?: string) => !!v && v.length <= 200 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
export const validPhone = (v?: string) => !!v && /^\+?[0-9][0-9 ()./-]{5,19}$/.test(v.trim());

export const PASSWORD_HELP = "Almeno 10 caratteri, con maiuscole, minuscole, numeri e un simbolo.";
export function validatePassword(p: string): string | null {
  if (p.length < 10) return "La password deve avere almeno 10 caratteri";
  if (p.length > 200) return "Password troppo lunga";
  if (!/[a-z]/.test(p) || !/[A-Z]/.test(p) || !/\d/.test(p) || !/[^A-Za-z0-9]/.test(p)) return "Servono maiuscole, minuscole, numeri e un simbolo";
  return null;
}

/** Controlla tutti i campi come richiesto all'invio. Restituisce gli errori per campo (chiavi tipo "payment.iban"). */
export function validateSupplierData(d: SupplierData): Record<string, string> {
  const e: Record<string, string> = {};
  const c = d.company ?? {}, a = d.address ?? {}, p = d.payment ?? {}, k = d.contacts ?? {};
  const country = a.country;
  const need = (key: string, v: string | undefined, msg = "Obbligatorio") => { if (!v || !v.trim()) e[key] = msg; };

  need("company.legalName", c.legalName);
  need("address.street", a.street); need("address.postalCode", a.postalCode); need("address.city", a.city); need("address.country", a.country);
  if (country && REGION_REQUIRED.includes(country)) need("address.region", a.region, "Obbligatorio per questo paese");
  if (!c.vatCode?.trim()) e["company.vatCode"] = "Obbligatorio";
  else if (!validVat(country, c.vatCode)) e["company.vatCode"] = "Formato non valido per il paese indicato";
  if (!c.fiscalCode?.trim()) e["company.fiscalCode"] = "Obbligatorio (se non lo hai, ripeti la partita IVA)";
  else if (!validFiscal(country, c.fiscalCode)) e["company.fiscalCode"] = "Formato non valido";

  if (country === "BR") { if (p.iban?.trim() && !validIban(p.iban)) e["payment.iban"] = "IBAN non valido"; }
  else if (!p.iban?.trim()) e["payment.iban"] = "Obbligatorio";
  else if (!validIban(p.iban)) e["payment.iban"] = "IBAN non valido: controlla le cifre";
  if (!p.swift?.trim()) e["payment.swift"] = "Obbligatorio";
  else if (!validSwift(p.swift)) e["payment.swift"] = "Il codice SWIFT ha 8 o 11 caratteri";
  need("payment.bankName", p.bankName); need("payment.accountNumber", p.accountNumber); need("payment.currency", p.currency);
  if (country === "IT") {
    if (p.withholdingTax === undefined || p.withholdingTax === null) e["payment.withholdingTax"] = "Seleziona sì o no";
    else if (p.withholdingTax) {
      need("payment.withholdingType", p.withholdingType);
      if (p.withholdingType === "other") need("payment.withholdingSpec", p.withholdingSpec, "Specifica il tipo di ritenuta");
    }
  }

  if (k.language !== "IT" && k.language !== "EN") e["contacts.language"] = "Obbligatorio";
  if (!validEmail(k.ordersEmail)) e["contacts.ordersEmail"] = "Email non valida";
  if (!validEmail(k.adminEmail)) e["contacts.adminEmail"] = "Email non valida";
  if (!validPhone(k.phone)) e["contacts.phone"] = "Numero non valido (usa il formato internazionale, es. +39 02 1234567)";
  return e;
}

/** Documenti obbligatori che mancano (considerando anche quelli scaduti come mancanti). */
export function missingDocuments(docs: { type: string; validUntil: string | null }[], country?: string): string[] {
  return requiredDocTypes(country).filter(t => !docs.some(d => d.type === t.key && docValidity(d.validUntil) !== "expired")).map(t => t.key);
}

/** Gruppo conti SAP: assunzione da confermare con Finance (IT senza ritenuta ITD1, con ritenuta ITW1, estero ITF3, Brasile BRD6). */
export function accountGroup(d: SupplierData): "ITD1" | "ITW1" | "ITF3" | "BRD6" {
  const country = d.address?.country;
  if (country === "BR") return "BRD6";
  if (country === "IT") return d.payment?.withholdingTax ? "ITW1" : "ITD1";
  return "ITF3";
}

export const STATUS_LABELS: Record<string, string> = {
  invited: "Invitato", draft: "In compilazione", pending: "In verifica (Buyer)", pending_revision: "Modifiche richieste",
  approved: "Approvato (attesa Finance)", rejected: "Rifiutato", registered: "Registrato in SAP",
};
