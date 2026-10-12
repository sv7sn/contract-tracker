// Modelli di contratto con questionario: le risposte compilano il testo, in una o in due lingue affiancate (colonne).
// I testi qui sono di partenza e vanno validati dal Legal; le clausole con un codice si leggono dalla libreria (testo approvato).
import { HttpError } from "./_http.js";

export type Lang = "it" | "en";
export const LANGS: Lang[] = ["it", "en"];
type L = Record<Lang, string>;
export interface Question {
  key: string; label: L; type: "text" | "longtext" | "date" | "number" | "select" | "bool"; required?: boolean; default?: string;
  options?: { value: string; label: L }[];
  /** Dato che si compila da solo dal task o dall'anagrafica fornitore. */
  prefill?: "supplier" | "supplierVat" | "supplierAddress" | "value" | "currency" | "title" | "today" | "paymentTerms" | "contractObject" | "contractEnd";
}
interface Section { id: string; title: L; text?: L; clause?: string; when?: { key: string; equals: string | boolean }; whenFilled?: string }
export interface Template { code: string; name: L; description: L; kind: "nda" | "services" | "addendum"; questions: Question[]; sections: Section[] }

/** Clausole di partenza della libreria: testo standard, alternativa accettabile (ripiego) e frasi non ammesse. */
export interface ClauseSeed { code: string; title: string; category: string; text: L; fallback: L; forbidden: string[] }
const GUIDANCE = "Testo di esempio: da validare dal Legal prima dell'uso.";
export const SEED_GUIDANCE = GUIDANCE;
export const CLAUSE_SEEDS: ClauseSeed[] = [
  { code: "CONF", title: "Riservatezza", category: "Generale",
    text: { it: "Ciascuna Parte si impegna a mantenere riservate le Informazioni Riservate dell'altra Parte, a utilizzarle esclusivamente per le finalità del presente contratto e a non divulgarle a terzi senza il preventivo consenso scritto della Parte divulgante, salvo che a propri dipendenti e consulenti che ne abbiano necessità e siano vincolati da analoghi obblighi di riservatezza. L'obbligo resta in vigore per cinque anni dopo la cessazione del contratto.",
      en: "Each Party undertakes to keep the other Party's Confidential Information confidential, to use it solely for the purposes of this agreement and not to disclose it to third parties without the disclosing Party's prior written consent, except to its employees and advisers who need to know it and are bound by equivalent confidentiality obligations. This obligation survives for five years after the termination of the agreement." },
    fallback: { it: "Ciascuna Parte si impegna a mantenere riservate le Informazioni Riservate dell'altra Parte, a utilizzarle esclusivamente per le finalità del presente contratto e a non divulgarle a terzi senza il preventivo consenso scritto della Parte divulgante, salvo che a propri dipendenti e consulenti che ne abbiano necessità e siano vincolati da analoghi obblighi di riservatezza. L'obbligo resta in vigore per tre anni dopo la cessazione del contratto.",
      en: "Each Party undertakes to keep the other Party's Confidential Information confidential, to use it solely for the purposes of this agreement and not to disclose it to third parties without the disclosing Party's prior written consent, except to its employees and advisers who need to know it and are bound by equivalent confidentiality obligations. This obligation survives for three years after the termination of the agreement." },
    forbidden: ["senza obbligo di riservatezza", "without any obligation of confidentiality"] },
  { code: "TERMINATION", title: "Recesso e risoluzione", category: "Generale",
    text: { it: "Ciascuna Parte può recedere dal contratto con un preavviso scritto di sessanta giorni. In caso di grave inadempimento non sanato entro trenta giorni dalla diffida scritta, la Parte adempiente può risolvere il contratto con effetto immediato.",
      en: "Either Party may terminate this agreement with sixty days' written notice. In the event of a material breach not remedied within thirty days of written notice, the non-breaching Party may terminate the agreement with immediate effect." },
    fallback: { it: "Ciascuna Parte può recedere dal contratto con un preavviso scritto di novanta giorni. In caso di grave inadempimento non sanato entro trenta giorni dalla diffida scritta, la Parte adempiente può risolvere il contratto con effetto immediato.",
      en: "Either Party may terminate this agreement with ninety days' written notice. In the event of a material breach not remedied within thirty days of written notice, the non-breaching Party may terminate the agreement with immediate effect." },
    forbidden: ["rinnovo tacito senza possibilità di disdetta", "automatic renewal without the possibility of termination", "recesso solo a favore del fornitore"] },
  { code: "LIABILITY", title: "Limitazione di responsabilità", category: "Rischio",
    text: { it: "La responsabilità di ciascuna Parte per i danni derivanti dal contratto è limitata ai danni diretti e non può superare, per ciascun anno contrattuale, il corrispettivo annuo pattuito, salvo dolo o colpa grave.",
      en: "Each Party's liability for damages arising from the agreement is limited to direct damages and shall not exceed, for each contract year, the annual fee agreed, save in the case of wilful misconduct or gross negligence." },
    fallback: { it: "La responsabilità di ciascuna Parte per i danni derivanti dal contratto è limitata ai danni diretti e non può superare, per ciascun anno contrattuale, il doppio del corrispettivo annuo pattuito, salvo dolo o colpa grave.",
      en: "Each Party's liability for damages arising from the agreement is limited to direct damages and shall not exceed, for each contract year, twice the annual fee agreed, save in the case of wilful misconduct or gross negligence." },
    forbidden: ["responsabilità illimitata", "unlimited liability", "esclusione di ogni responsabilità del fornitore", "exclusion of all liability of the supplier"] },
  { code: "DATA-PROTECTION", title: "Protezione dei dati personali", category: "Privacy",
    text: { it: "Le Parti trattano i dati personali nel rispetto del Regolamento (UE) 2016/679 e della normativa applicabile. Il Fornitore, ove tratti dati personali per conto del Cliente, agisce come responsabile del trattamento ai sensi dell'art. 28 GDPR, adotta misure di sicurezza adeguate, non trasferisce i dati fuori dallo Spazio Economico Europeo senza garanzie adeguate e notifica al Cliente senza ritardo ogni violazione dei dati.",
      en: "The Parties shall process personal data in compliance with Regulation (EU) 2016/679 and applicable law. Where the Supplier processes personal data on behalf of the Customer, it acts as data processor under Article 28 GDPR, adopts appropriate security measures, does not transfer data outside the European Economic Area without adequate safeguards and notifies the Customer without delay of any data breach." },
    fallback: { it: "Le Parti trattano i dati personali nel rispetto del Regolamento (UE) 2016/679 e della normativa applicabile. Il Fornitore, ove tratti dati personali per conto del Cliente, agisce come responsabile del trattamento ai sensi dell'art. 28 GDPR, adotta misure di sicurezza adeguate, non trasferisce i dati fuori dallo Spazio Economico Europeo senza garanzie adeguate e notifica al Cliente ogni violazione dei dati entro settantadue ore.",
      en: "The Parties shall process personal data in compliance with Regulation (EU) 2016/679 and applicable law. Where the Supplier processes personal data on behalf of the Customer, it acts as data processor under Article 28 GDPR, adopts appropriate security measures, does not transfer data outside the European Economic Area without adequate safeguards and notifies the Customer of any data breach within seventy-two hours." },
    forbidden: ["trasferire i dati personali senza garanzie", "transfer personal data without safeguards"] },
  { code: "ANTI-CORRUPTION", title: "Anticorruzione ed etica", category: "Compliance",
    text: { it: "Ciascuna Parte dichiara di rispettare le leggi anticorruzione applicabili, di non offrire né accettare vantaggi indebiti e di rispettare il Codice Etico del Cliente, la cui violazione costituisce grave inadempimento.",
      en: "Each Party represents that it complies with applicable anti-corruption laws, will not offer or accept undue advantages and will comply with the Customer's Code of Ethics, a breach of which constitutes a material breach." },
    fallback: { it: "Ciascuna Parte dichiara di rispettare le leggi anticorruzione applicabili, di non offrire né accettare vantaggi indebiti e di rispettare principi etici equivalenti a quelli del Codice Etico del Cliente, la cui violazione costituisce grave inadempimento.",
      en: "Each Party represents that it complies with applicable anti-corruption laws, will not offer or accept undue advantages and will comply with ethical principles equivalent to the Customer's Code of Ethics, a breach of which constitutes a material breach." },
    forbidden: ["pagamenti di facilitazione", "facilitation payments"] },
];

const LAW = [
  { value: "it", label: { it: "legge italiana", en: "Italian law" } },
  { value: "br", label: { it: "legge brasiliana", en: "Brazilian law" } },
  { value: "uk", label: { it: "legge inglese", en: "English law" } },
];
const q = (key: string, it: string, en: string, type: Question["type"], extra: Partial<Question> = {}): Question => ({ key, label: { it, en }, type, ...extra });
const t = (it: string, en: string): L => ({ it, en });
const SIGN: Section = { id: "sign", title: t("Firme", "Signatures"), text: t("Letto, confermato e sottoscritto.\n{{company}}: ______________________\n{{counterparty}}: ______________________", "Read, confirmed and signed.\n{{company}}: ______________________\n{{counterparty}}: ______________________") };

export const TEMPLATES: Template[] = [
  {
    code: "NDA", kind: "nda", name: t("Accordo di riservatezza (NDA)", "Non-disclosure agreement (NDA)"),
    description: t("NDA reciproco, anche con le due lingue affiancate.", "Mutual NDA, optionally with the two languages side by side."),
    questions: [
      q("company", "La nostra società (ragione sociale)", "Our company (legal name)", "text", { required: true }),
      q("counterparty", "Controparte", "Counterparty", "text", { required: true, prefill: "supplier" }),
      q("counterpartyVat", "Partita IVA / codice fiscale della controparte", "Counterparty VAT / tax code", "text", { prefill: "supplierVat" }),
      q("counterpartyAddress", "Sede della controparte", "Counterparty address", "text", { prefill: "supplierAddress" }),
      q("purpose", "Finalità dello scambio di informazioni", "Purpose of the information exchange", "longtext", { required: true }),
      q("date", "Data dell'accordo", "Agreement date", "date", { required: true, prefill: "today" }),
      q("termYears", "Durata dell'accordo (anni)", "Term of the agreement (years)", "number", { required: true, default: "3" }),
      q("governingLaw", "Legge applicabile", "Governing law", "select", { required: true, options: LAW, default: "it" }),
      q("city", "Foro competente (città)", "Competent court (city)", "text", { required: true }),
    ],
    sections: [
      { id: "parties", title: t("Parti", "Parties"), text: t("Il presente accordo è concluso in data {{date}} tra {{company}} (la \"Società\") e {{counterparty}}, con sede in {{counterpartyAddress}}, P. IVA / C.F. {{counterpartyVat}} (la \"Controparte\"), di seguito congiuntamente le \"Parti\".", "This agreement is entered into on {{date}} between {{company}} (the \"Company\") and {{counterparty}}, with registered office at {{counterpartyAddress}}, VAT / tax no. {{counterpartyVat}} (the \"Counterparty\"), together the \"Parties\".") },
      { id: "definition", title: t("Definizione di Informazione Riservata", "Definition of Confidential Information"), text: t("Per \"Informazioni Riservate\" si intendono tutti i dati, documenti, know-how, specifiche tecniche, formule, processi e altre informazioni, in qualsiasi forma, che una Parte comunica all'altra per la seguente finalità: {{purpose}}.", "\"Confidential Information\" means all data, documents, know-how, technical specifications, formulas, processes and other information, in any form, that one Party discloses to the other for the following purpose: {{purpose}}.") },
      { id: "obligations", title: t("Obblighi delle Parti", "Obligations of the Parties"), clause: "CONF" },
      { id: "exceptions", title: t("Eccezioni", "Exceptions"), text: t("Non sono Informazioni Riservate quelle che siano o diventino di pubblico dominio senza violazione del presente accordo, che fossero già note alla Parte ricevente, che siano sviluppate in modo indipendente o che debbano essere comunicate per obbligo di legge o ordine di un'autorità, previo avviso alla Parte divulgante ove consentito.", "Information is not Confidential Information if it is or becomes public without breach of this agreement, was already known to the receiving Party, is independently developed or must be disclosed by law or order of an authority, after notice to the disclosing Party where permitted.") },
      { id: "term", title: t("Durata", "Term"), text: t("Il presente accordo ha durata di {{termYears}} anni dalla data di sottoscrizione. Alla cessazione ciascuna Parte restituisce o distrugge le Informazioni Riservate ricevute, su richiesta dell'altra.", "This agreement lasts {{termYears}} years from the date of signature. Upon termination each Party shall return or destroy the Confidential Information received, upon the other's request.") },
      { id: "law", title: t("Legge applicabile e foro", "Governing law and jurisdiction"), text: t("Il presente accordo è regolato dalla {{governingLaw}}. Per ogni controversia è competente in via esclusiva il foro di {{city}}.", "This agreement is governed by {{governingLaw}}. The courts of {{city}} have exclusive jurisdiction over any dispute.") },
      SIGN,
    ],
  },
  {
    code: "ADDENDUM", kind: "addendum", name: t("Addendum / proroga", "Addendum / extension"),
    description: t("Proroga o modifica di un contratto esistente, precompilata dal contratto.", "Extension or amendment of an existing contract, prefilled from the contract."),
    questions: [
      q("company", "La nostra società (ragione sociale)", "Our company (legal name)", "text", { required: true }),
      q("counterparty", "Fornitore", "Supplier", "text", { required: true, prefill: "supplier" }),
      q("originalObject", "Oggetto del contratto originario", "Subject of the original contract", "longtext", { required: true, prefill: "contractObject" }),
      q("originalEnd", "Scadenza attuale", "Current end date", "date", { required: true, prefill: "contractEnd" }),
      q("newEnd", "Nuova scadenza", "New end date", "date", { required: true }),
      q("priceNote", "Variazione del corrispettivo (lascia vuoto se invariato)", "Fee change (leave empty if unchanged)", "text"),
      q("date", "Data dell'addendum", "Addendum date", "date", { required: true, prefill: "today" }),
    ],
    sections: [
      { id: "parties", title: t("Parti e premesse", "Parties and recitals"), text: t("Tra {{company}} e {{counterparty}} si conviene il presente addendum al contratto avente ad oggetto: {{originalObject}}.", "Between {{company}} and {{counterparty}} this addendum is agreed to the contract relating to: {{originalObject}}.") },
      { id: "extension", title: t("Proroga", "Extension"), text: t("La scadenza del contratto, fissata al {{originalEnd}}, è prorogata fino al {{newEnd}}.", "The end date of the contract, set at {{originalEnd}}, is extended until {{newEnd}}.") },
      { id: "fees", title: t("Corrispettivo", "Fees"), whenFilled: "priceNote", text: t("Il corrispettivo è modificato come segue: {{priceNote}}.", "The fee is amended as follows: {{priceNote}}.") },
      { id: "rest", title: t("Condizioni invariate", "Unchanged terms"), text: t("Restano ferme tutte le altre condizioni del contratto non espressamente modificate dal presente addendum.", "All other terms of the contract not expressly amended by this addendum remain unchanged.") },
      { id: "sign", title: t("Firme", "Signatures"), text: t("Letto, confermato e sottoscritto in data {{date}}.\n{{company}}: ______________________\n{{counterparty}}: ______________________", "Read, confirmed and signed on {{date}}.\n{{company}}: ______________________\n{{counterparty}}: ______________________") },
    ],
  },
  {
    code: "SERVICES", kind: "services", name: t("Contratto di fornitura di servizi", "Services agreement"),
    description: t("Contratto esterno per servizi, con penali, rinnovo e protezione dei dati opzionali.", "External services contract, with optional penalties, renewal and data protection."),
    questions: [
      q("company", "La nostra società (ragione sociale)", "Our company (legal name)", "text", { required: true }),
      q("counterparty", "Fornitore", "Supplier", "text", { required: true, prefill: "supplier" }),
      q("counterpartyVat", "Partita IVA / codice fiscale del fornitore", "Supplier VAT / tax code", "text", { prefill: "supplierVat" }),
      q("counterpartyAddress", "Sede del fornitore", "Supplier address", "text", { prefill: "supplierAddress" }),
      q("object", "Oggetto del servizio", "Subject of the services", "longtext", { required: true, prefill: "title" }),
      q("value", "Corrispettivo annuo", "Annual fee", "number", { required: true, prefill: "value" }),
      q("currency", "Valuta", "Currency", "text", { required: true, default: "EUR", prefill: "currency" }),
      q("paymentDays", "Pagamento (giorni data fattura)", "Payment (days from invoice date)", "select", { required: true, default: "60", prefill: "paymentTerms", options: [30, 60, 90].map(n => ({ value: String(n), label: t(`${n} giorni`, `${n} days`) })) }),
      q("startDate", "Data di inizio", "Start date", "date", { required: true, prefill: "today" }),
      q("endDate", "Data di fine", "End date", "date", { required: true }),
      q("autoRenew", "Rinnovo automatico?", "Automatic renewal?", "bool"),
      q("noticeDays", "Preavviso di disdetta (giorni)", "Notice of non-renewal (days)", "number", { default: "60" }),
      q("penalties", "Penali per ritardo?", "Late-delivery penalties?", "bool"),
      q("penaltyPct", "Penale (% per settimana di ritardo, massimo 10%)", "Penalty (% per week of delay, capped at 10%)", "number", { default: "1" }),
      q("dataProtection", "Il fornitore tratta dati personali per nostro conto?", "Does the supplier process personal data on our behalf?", "bool"),
      q("governingLaw", "Legge applicabile", "Governing law", "select", { required: true, options: LAW, default: "it" }),
      q("city", "Foro competente (città)", "Competent court (city)", "text", { required: true }),
    ],
    sections: [
      { id: "parties", title: t("Parti", "Parties"), text: t("Tra {{company}} (il \"Cliente\") e {{counterparty}}, con sede in {{counterpartyAddress}}, P. IVA / C.F. {{counterpartyVat}} (il \"Fornitore\") si conviene quanto segue.", "Between {{company}} (the \"Customer\") and {{counterparty}}, with registered office at {{counterpartyAddress}}, VAT / tax no. {{counterpartyVat}} (the \"Supplier\"), the following is agreed.") },
      { id: "object", title: t("Oggetto", "Subject"), text: t("Il Fornitore si obbliga a prestare al Cliente i seguenti servizi: {{object}}.", "The Supplier undertakes to provide the Customer with the following services: {{object}}.") },
      { id: "term-fixed", title: t("Durata", "Term"), when: { key: "autoRenew", equals: false }, text: t("Il contratto decorre dal {{startDate}} e termina il {{endDate}}, senza rinnovo tacito.", "The agreement starts on {{startDate}} and ends on {{endDate}}, with no tacit renewal.") },
      { id: "term-renew", title: t("Durata e rinnovo", "Term and renewal"), when: { key: "autoRenew", equals: true }, text: t("Il contratto decorre dal {{startDate}} e termina il {{endDate}}; si rinnova di anno in anno salvo disdetta scritta di una Parte da inviare con preavviso di {{noticeDays}} giorni.", "The agreement starts on {{startDate}} and ends on {{endDate}}; it renews year by year unless either Party gives written notice of non-renewal at least {{noticeDays}} days in advance.") },
      { id: "fees", title: t("Corrispettivo e pagamento", "Fees and payment"), text: t("Il corrispettivo annuo è di {{value}} {{currency}}, oltre IVA se dovuta. Le fatture sono pagate a {{paymentDays}} giorni data fattura.", "The annual fee is {{value}} {{currency}}, plus VAT where due. Invoices are payable {{paymentDays}} days from the invoice date.") },
      { id: "penalties", title: t("Penali", "Penalties"), when: { key: "penalties", equals: true }, text: t("In caso di ritardo nell'esecuzione il Fornitore è tenuto a una penale pari all'{{penaltyPct}}% del corrispettivo per ogni settimana di ritardo, fino a un massimo del 10%, fatto salvo il maggior danno.", "In case of delay in performance the Supplier shall pay a penalty of {{penaltyPct}}% of the fee for each week of delay, up to a maximum of 10%, without prejudice to further damages.") },
      { id: "conf", title: t("Riservatezza", "Confidentiality"), clause: "CONF" },
      { id: "dpa", title: t("Protezione dei dati personali", "Data protection"), clause: "DATA-PROTECTION", when: { key: "dataProtection", equals: true } },
      { id: "ethics", title: t("Anticorruzione ed etica", "Anti-corruption and ethics"), clause: "ANTI-CORRUPTION" },
      { id: "liability", title: t("Limitazione di responsabilità", "Limitation of liability"), clause: "LIABILITY" },
      { id: "termination", title: t("Recesso e risoluzione", "Termination"), clause: "TERMINATION" },
      { id: "law", title: t("Legge applicabile e foro", "Governing law and jurisdiction"), text: t("Il contratto è regolato dalla {{governingLaw}}. Per ogni controversia è competente in via esclusiva il foro di {{city}}.", "The agreement is governed by {{governingLaw}}. The courts of {{city}} have exclusive jurisdiction over any dispute.") },
      SIGN,
    ],
  },
];

const fmtDate = (v: string, lang: Lang) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00Z`).toLocaleDateString(lang === "it" ? "it-IT" : "en-GB", { day: "numeric", month: lang === "it" ? "2-digit" : "long", year: "numeric", timeZone: "UTC" }) : v);
const fmtNum = (v: string, lang: Lang) => (Number.isFinite(Number(v)) && v !== "" ? Number(v).toLocaleString(lang === "it" ? "it-IT" : "en-GB") : v);

export interface Rendered { paras: string[]; heads: number[]; cols: 1 | 2; langs: Lang[]; title: string }
/** Compone il testo. `clauseText(code, lang)` dà il testo approvato della libreria; se manca si usa lo standard di partenza. */
export function renderTemplate(tpl: Template, answers: Record<string, unknown>, langs: Lang[], clauseText: (code: string, lang: Lang) => string | null): Rendered {
  if (!langs.length || langs.length > 2 || langs.some(l => !LANGS.includes(l))) throw new HttpError(400, "Scegli una o due lingue (italiano, inglese)");
  const miss = tpl.questions.filter(x => x.required && (answers[x.key] === undefined || String(answers[x.key]).trim() === "")).map(x => x.label.it);
  if (miss.length) throw new HttpError(400, `Compila: ${miss.join(", ")}`);
  const val = (k: string, lang: Lang): string => {
    const qn = tpl.questions.find(x => x.key === k);
    const raw = String(answers[k] ?? qn?.default ?? "").trim();
    if (!qn) return raw;
    if (qn.type === "date") return fmtDate(raw, lang);
    if (qn.type === "number") return fmtNum(raw, lang);
    if (qn.type === "select") return qn.options?.find(o => o.value === raw)?.label[lang] ?? raw;
    return raw;
  };
  const fill = (s: string, lang: Lang) => s.replace(/\{\{(\w+)\}\}/g, (_, k: string) => val(k, lang) || "[…]");
  const on = (s: Section) => (s.whenFilled ? String(answers[s.whenFilled] ?? "").trim() !== "" : true) && (!s.when || Boolean(answers[s.when.key] ?? false) === s.when.equals || String(answers[s.when.key]) === String(s.when.equals));
  const secs = tpl.sections.filter(on);
  const bodyOf = (s: Section, lang: Lang) => fill(s.clause ? clauseText(s.clause, lang) ?? CLAUSE_SEEDS.find(c => c.code === s.clause)!.text[lang] : s.text![lang], lang);
  // Per ogni sezione: titolo + paragrafi; con due lingue le coppie hanno lo stesso numero di righe.
  const out: { rows: [string, string][]; heads: number[] } = { rows: [], heads: [] };
  secs.forEach((s, i) => {
    const bodies = langs.map(l => bodyOf(s, l).split("\n").filter(x => x.trim()));
    const n = Math.max(...bodies.map(b => b.length));
    const num = (l: Lang) => `${i + 1}. ${s.title[l]}`;
    out.heads.push(out.rows.length);
    out.rows.push([num(langs[0]), langs[1] ? num(langs[1]) : ""]);
    for (let k = 0; k < n; k++) out.rows.push([bodies[0][k] ?? "", langs[1] ? bodies[1][k] ?? "" : ""]);
  });
  const paras: string[] = [], heads: number[] = [];
  out.rows.forEach((r, ri) => { if (out.heads.includes(ri)) heads.push(paras.length); paras.push(r[0]); if (langs[1]) { if (out.heads.includes(ri)) heads.push(paras.length); paras.push(r[1]); } });
  return { paras, heads, cols: langs.length === 2 ? 2 : 1, langs, title: tpl.name[langs[0]] };
}
