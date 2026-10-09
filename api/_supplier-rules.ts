// Regole di business sull'anagrafica fornitore, condivise tra server (che le fa rispettare) e interfaccia (che le mostra subito).
import type { DocRule, DocTypeDef, ResolvedDocType, SupplierData } from "../src/types.ts";

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
/** Documenti predefiniti: gli amministratori li possono cambiare dalla pagina Configurazione. */
export const DEFAULT_DOC_TYPES: DocTypeDef[] = [
  { key: "bank_letter", label: "Lettera della banca", help: "Lettera della banca che certifica l'intestazione e le coordinate del conto.", expires: false, multiple: false },
  { key: "chamber_certificate", label: "Visura camerale / certificato di iscrizione", help: "Documento ufficiale di iscrizione dell'azienda, emesso negli ultimi 6 mesi.", expires: true, multiple: false },
  { key: "durc", label: "DURC (regolarità contributiva)", help: "Documento Unico di Regolarità Contributiva in corso di validità.", expires: true, multiple: false },
  { key: "company_presentation", label: "Presentazione aziendale", help: "Presentazione, brochure o catalogo (facoltativo).", expires: false, multiple: false },
  { key: "quality_certificates", label: "Altre certificazioni (ISO 14001, 45001…)", help: "Altre certificazioni di qualità, ambiente e sicurezza, con data di scadenza.", expires: true, multiple: true },
  { key: "iso_9001", label: "Certificazione ISO 9001 (qualità)", help: "Certificato di conformità ISO 9001 in corso di validità.", expires: true, multiple: false },
  { key: "iso_17025", label: "Accreditamento ISO/IEC 17025 (laboratori)", help: "Accreditamento del laboratorio di prova o taratura.", expires: true, multiple: false },
  { key: "iso_27001", label: "Certificazione ISO/IEC 27001 (sicurezza delle informazioni)", help: "Certificato di conformità ISO/IEC 27001 in corso di validità.", expires: true, multiple: false },
  { key: "insurance", label: "Polizza assicurativa (RC)", help: "Polizza di responsabilità civile, con data di scadenza.", expires: true, multiple: false },
  { key: "code_of_conduct", label: "Codice di condotta fornitori firmato", help: "Codice di condotta sottoscritto dal legale rappresentante.", expires: false, multiple: false },
  { key: "receita_federal", label: "Certificato Receita Federal", help: "Cartão CNPJ rilasciato dalla Receita Federal.", expires: true, multiple: false },
  { key: "jucerja", label: "Certificato JUCERJA (o della Junta Comercial dello Stato)", help: "Certidão simplificada della Junta Comercial.", expires: true, multiple: false },
  { key: "bank_contract", label: "Contratto bancario", help: "Contratto o dichiarazione della banca per verificare i dati bancari.", expires: false, multiple: false },
];
/** Regole predefinite. Le ISO non hanno regole: si attivano per codice merceologico dalla Configurazione. */
export const DEFAULT_DOC_RULES: DocRule[] = [
  { docType: "bank_letter", scope: "all", value: "", level: "required" },
  { docType: "chamber_certificate", scope: "all", value: "", level: "required" },
  { docType: "code_of_conduct", scope: "all", value: "", level: "required" },
  { docType: "company_presentation", scope: "all", value: "", level: "optional" },
  { docType: "quality_certificates", scope: "all", value: "", level: "optional" },
  { docType: "insurance", scope: "all", value: "", level: "optional" },
  { docType: "durc", scope: "country", value: "IT", level: "required" },
  { docType: "receita_federal", scope: "country", value: "BR", level: "required" },
  { docType: "jucerja", scope: "country", value: "BR", level: "required" },
  { docType: "bank_contract", scope: "country", value: "BR", level: "required" },
];

/** Documenti da chiedere a un fornitore: quelli con almeno una regola valida per il suo paese o codice merceologico (obbligatorio se una regola lo è). */
export function resolveDocTypes(types: DocTypeDef[], rules: DocRule[], country?: string, industry?: string): ResolvedDocType[] {
  const out: ResolvedDocType[] = [];
  for (const t of types) {
    const hit = rules.filter(r => r.docType === t.key && (r.scope === "all" || (r.scope === "country" && !!country && r.value === country) || (r.scope === "industry" && !!industry && r.value === industry)));
    if (hit.length) out.push({ ...t, required: hit.some(r => r.level === "required") });
  }
  return out;
}

/** Documenti obbligatori che mancano (quelli scaduti contano come mancanti). */
export function missingRequired(resolved: ResolvedDocType[], docs: { type: string; validUntil: string | null }[]): string[] {
  return resolved.filter(t => t.required && !docs.some(d => d.type === t.key && docValidity(d.validUntil) !== "expired")).map(t => t.key);
}

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

/** Gruppo conti SAP: assunzione da confermare con Finance (IT senza ritenuta ITD1, con ritenuta ITW1, estero ITF3, Brasile BRD6). */
export function accountGroup(d: SupplierData): "ITD1" | "ITW1" | "ITF3" | "BRD6" {
  const country = d.address?.country;
  if (country === "BR") return "BRD6";
  if (country === "IT") return d.payment?.withholdingTax ? "ITW1" : "ITD1";
  return "ITF3";
}

/** Normalizzazioni usate per riconoscere i doppioni. */
export const normName = (s?: string) => (s ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .replace(/\b(s\.?\s?p\.?\s?a|s\.?\s?r\.?\s?l(\.?\s?s)?|s\.?\s?n\.?\s?c|s\.?\s?a\.?\s?s|gmbh|ltda|ltd|limited|inc|llc|b\.?v|a\.?g|s\.?l|s\.?a)\b\.?/g, " ")
  .replace(/[^a-z0-9]+/g, " ").trim();
export const normTax = (s?: string) => (s ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase().replace(/^[A-Z]{2}(?=\d)/, "");

/** Paesi UE per il controllo della partita IVA (VIES); la Grecia in VIES è "EL". */
export const EU_COUNTRIES = ["AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "GR", "ES", "FI", "FR", "HR", "HU", "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PL", "PT", "RO", "SE", "SI", "SK"];

/** Dichiarazioni obbligatorie del fornitore, controllate al momento dell'invio. */
export function validateDeclarations(d: SupplierData): Record<string, string> {
  const e: Record<string, string> = {}; const x = d.declarations ?? {};
  if (x.conflictOfInterest !== true && x.conflictOfInterest !== false) e["declarations.conflictOfInterest"] = "Rispondi sì o no";
  else if (x.conflictOfInterest && (x.conflictDetails ?? "").trim().length < 5) e["declarations.conflictDetails"] = "Descrivi il rapporto";
  if (x.noSanctions !== true) e["declarations.noSanctions"] = "Dichiarazione obbligatoria";
  if (x.privacyAccepted !== true) e["declarations.privacyAccepted"] = "Devi prendere visione dell'informativa privacy";
  return e;
}

export const STATUS_LABELS: Record<string, string> = {
  invited: "Invitato", draft: "In compilazione", pending: "In verifica (Buyer)", pending_revision: "Modifiche richieste",
  approved: "Approvato (attesa Finance)", rejected: "Rifiutato", registered: "Registrato in SAP",
};
