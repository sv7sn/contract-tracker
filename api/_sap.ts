import type { BuyingCompany, SapSettings, SupplierData } from "../src/types.ts";
import { accountGroup } from "./_supplier-rules.js";
import { HttpError } from "./_http.js";

// Creazione/aggiornamento del fornitore in SAP S/4HANA.
// Il collegamento reale dipende da come il team SAP espone il servizio: qui c'è un adattatore con due modalità.
//   SAP_MODE=simulated (predefinita)  genera un codice fittizio: serve per provare tutto il percorso senza SAP.
//   SAP_MODE=http                     invia il payload (JSON) a SAP_ENDPOINT con SAP_TOKEN come Bearer e si aspetta { "vendorCode": "..." }.
//                                     SAP_ENDPOINT deve essere un servizio che incapsula RFC/OData (es. un iFlow di Integration Suite).

export interface SapVendorPayload {
  mode: "create" | "update";
  vendorCode?: string;
  accountGroup: string; reconciliationAccount: string;
  companyCodes: { companyCode: string; purchasingOrg: string }[];
  name: string; street: string; postalCode: string; city: string; country: string; region: string;
  taxNumber1: string; taxNumber2: string;
  iban: string; swift: string; bankName: string; accountNumber: string; currency: string;
  language: string; email: string; ordersEmail: string; phone: string;
  paymentTerms: string; tradingPartner: string; sortKey: string; cashManagementGroup: string; releaseGroup: string;
  withholdingTax: boolean; withholdingType: string;
  checkDoubleInvoice: boolean; searchTerm: string;
}

export interface SupplierForSap { id: number; email: string; companyCodes: string[]; paymentTerms: string | null; sapCode: string | null; data: SupplierData }

export function buildVendorPayload(s: SupplierForSap, sap: SapSettings, companies: BuyingCompany[]): SapVendorPayload {
  const d = s.data, group = accountGroup(d);
  const picked = companies.filter(c => s.companyCodes.includes(c.code));
  return {
    mode: s.sapCode ? "update" : "create", vendorCode: s.sapCode ?? undefined,
    accountGroup: group, reconciliationAccount: sap.reconciliationAccounts[group] ?? "",
    companyCodes: picked.map(c => ({ companyCode: c.sapCompanyCode, purchasingOrg: c.purchOrg })),
    name: d.company?.legalName ?? "", street: [d.address?.street, d.address?.houseNumber].filter(Boolean).join(" "), postalCode: d.address?.postalCode ?? "", city: d.address?.city ?? "",
    country: d.address?.country ?? "", region: d.address?.region ?? "",
    taxNumber1: d.company?.vatCode ?? "", taxNumber2: d.company?.fiscalCode || d.company?.vatCode || "",
    iban: d.payment?.iban ?? "", swift: d.payment?.swift ?? "", bankName: d.payment?.bankName ?? "", accountNumber: d.payment?.accountNumber ?? "", currency: d.payment?.currency ?? "",
    language: d.contacts?.language ?? "IT", email: s.email, ordersEmail: d.contacts?.ordersEmail ?? "", phone: d.contacts?.phone ?? "",
    paymentTerms: s.paymentTerms ?? "", tradingPartner: sap.tradingPartner, sortKey: sap.sortKey, cashManagementGroup: sap.cashManagementGroup, releaseGroup: sap.releaseGroup,
    withholdingTax: !!d.payment?.withholdingTax, withholdingType: d.payment?.withholdingType ?? "",
    checkDoubleInvoice: true, searchTerm: (d.company?.legalName ?? "").slice(0, 20).toUpperCase(),
  };
}

/** Verifica che il fornitore possa essere inviato a SAP; altrimenti spiega cosa manca (messaggio mostrato al Finance). */
export function assertReadyForSap(p: SapVendorPayload) {
  if (p.country === "BR") throw new HttpError(422, "I fornitori brasiliani richiedono i dati fiscali locali (LC 116/NCM, ISS, ICMS…): questa parte non è ancora disponibile nel portale");
  if (!p.companyCodes.length || p.companyCodes.some(c => !c.companyCode || !c.purchasingOrg)) throw new HttpError(422, "Configura codice società SAP e organizzazione acquisti delle società selezionate (pagina Configurazione)");
  if (!p.reconciliationAccount) throw new HttpError(422, `Configura il conto di riconciliazione per il gruppo conti ${p.accountGroup} (pagina Configurazione, parametri SAP)`);
  if (!p.paymentTerms) throw new HttpError(422, "Mancano le condizioni di pagamento");
}

export async function sendToSap(p: SapVendorPayload, supplierId: number): Promise<{ vendorCode: string; mode: string; response: unknown }> {
  const mode = process.env.SAP_MODE === "http" ? "http" : "simulated";
  if (mode === "simulated") {
    const vendorCode = p.vendorCode ?? String(100000 + supplierId).padStart(10, "0");
    return { vendorCode, mode, response: { simulated: true, vendorCode } };
  }
  const endpoint = process.env.SAP_ENDPOINT;
  if (!endpoint) throw new HttpError(503, "SAP_ENDPOINT non configurato");
  let res: Response;
  try {
    res = await fetch(endpoint, { method: "POST", signal: AbortSignal.timeout(25000), headers: { "Content-Type": "application/json", ...(process.env.SAP_TOKEN ? { Authorization: `Bearer ${process.env.SAP_TOKEN}` } : {}) }, body: JSON.stringify(p) });
  } catch { throw new HttpError(502, "SAP non raggiungibile: riprova più tardi"); }
  const body = (await res.json().catch(() => ({}))) as { vendorCode?: string; error?: string; message?: string };
  if (!res.ok || !body.vendorCode) throw new HttpError(502, `SAP ha rifiutato la richiesta: ${body.error ?? body.message ?? `HTTP ${res.status}`}`);
  return { vendorCode: String(body.vendorCode), mode, response: body };
}
