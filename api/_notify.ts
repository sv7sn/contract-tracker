import type { Queryable } from "./_db.js";

// Email del portale. Ogni messaggio viene salvato nella tabella `notifications`; l'invio reale avviene se sono
// configurati RESEND_API_KEY e MAIL_FROM (servizio Resend), altrimenti lo stato resta "logged" (non inviato).

export type Template = "invitation" | "new_registration" | "supplier_modified" | "revision_requested" | "rejection" | "buyer_approved" | "vendor_created" | "sap_code" | "doc_reminder" | "doc_unresponsive" | "bank_change_alert" | "rfq_invite" | "rfq_quote";
export type Lang = "IT" | "EN";

interface Vars { items?: string; name?: string; link?: string; reason?: string; sapCode?: string; expires?: string; companies?: string; deadline?: string; detail?: string }

const T: Record<Template, Record<Lang, (v: Vars) => { subject: string; body: string }>> = {
  invitation: {
    IT: v => ({ subject: "Invito alla registrazione come fornitore", body: `Gentile ${v.name},\n\nsei stato invitato a registrare la tua azienda come fornitore${v.companies ? ` per ${v.companies}` : ""}.\n\nCompleta la registrazione da questo link personale (valido fino al ${v.expires}):\n${v.link}\n\nTi serviranno: dati societari e fiscali, coordinate bancarie e i documenti di qualifica (visura camerale, lettera della banca, certificazioni).\n\nPer qualsiasi domanda rispondi a questa email.` }),
    EN: v => ({ subject: "Invitation to register as a supplier", body: `Dear ${v.name},\n\nyou have been invited to register your company as a supplier${v.companies ? ` for ${v.companies}` : ""}.\n\nComplete the registration with this personal link (valid until ${v.expires}):\n${v.link}\n\nYou will need: company and tax data, bank details and qualification documents (chamber certificate, bank letter, certifications).\n\nIf you have questions, just reply to this email.` }),
  },
  new_registration: {
    IT: v => ({ subject: `Nuova registrazione fornitore: ${v.name}`, body: `Il fornitore ${v.name} ha completato la registrazione ed è in attesa della tua verifica.\n\nApri la scheda: ${v.link}` }),
    EN: v => ({ subject: `New supplier registration: ${v.name}`, body: `Supplier ${v.name} completed the registration and is waiting for your review.\n\nOpen it: ${v.link}` }),
  },
  supplier_modified: {
    IT: v => ({ subject: `Dati fornitore modificati: ${v.name}`, body: `Il fornitore ${v.name} ha modificato i propri dati: serve una nuova approvazione.\n\nApri la scheda: ${v.link}` }),
    EN: v => ({ subject: `Supplier data changed: ${v.name}`, body: `Supplier ${v.name} changed their data: a new approval is required.\n\nOpen it: ${v.link}` }),
  },
  revision_requested: {
    IT: v => ({ subject: "Registrazione fornitore: servono modifiche", body: `Gentile ${v.name},\n\nla tua registrazione richiede alcune modifiche prima di poter proseguire:\n\n${v.reason}\n\nAccedi per aggiornare i dati: ${v.link}` }),
    EN: v => ({ subject: "Supplier registration: changes needed", body: `Dear ${v.name},\n\nyour registration needs some changes before we can proceed:\n\n${v.reason}\n\nSign in to update your data: ${v.link}` }),
  },
  rejection: {
    IT: v => ({ subject: "Registrazione fornitore non approvata", body: `Gentile ${v.name},\n\npurtroppo la tua registrazione non è stata approvata.\n\nMotivo: ${v.reason}\n\nPuoi correggere i dati e inviare di nuovo la richiesta: ${v.link}` }),
    EN: v => ({ subject: "Supplier registration not approved", body: `Dear ${v.name},\n\nunfortunately your registration was not approved.\n\nReason: ${v.reason}\n\nYou can fix your data and submit again: ${v.link}` }),
  },
  buyer_approved: {
    IT: v => ({ subject: `Fornitore da verificare (Finance): ${v.name}`, body: `Il Buyer ha approvato la registrazione di ${v.name}. Servono la tua verifica delle coordinate bancarie e dei requisiti fiscali.\n\nApri la scheda: ${v.link}` }),
    EN: v => ({ subject: `Supplier to review (Finance): ${v.name}`, body: `The Buyer approved the registration of ${v.name}. Your review of bank details and tax requirements is needed.\n\nOpen it: ${v.link}` }),
  },
  vendor_created: {
    IT: v => ({ subject: `Fornitore creato in SAP: ${v.name}`, body: `Il fornitore ${v.name} è stato creato in SAP con il codice ${v.sapCode}.\n\nScheda: ${v.link}` }),
    EN: v => ({ subject: `Supplier created in SAP: ${v.name}`, body: `Supplier ${v.name} was created in SAP with code ${v.sapCode}.\n\nRecord: ${v.link}` }),
  },
  sap_code: {
    IT: v => ({ subject: "Registrazione completata: il tuo codice fornitore", body: `Gentile ${v.name},\n\nla registrazione è completata. Il tuo codice fornitore è ${v.sapCode}.\n\nPuoi consultare e aggiornare i tuoi dati nella tua area personale: ${v.link}` }),
    EN: v => ({ subject: "Registration completed: your supplier code", body: `Dear ${v.name},\n\nyour registration is complete. Your supplier code is ${v.sapCode}.\n\nYou can view and update your data in your personal area: ${v.link}` }),
  },
  doc_reminder: {
    IT: v => ({ subject: "Documenti di qualifica da aggiornare", body: `Gentile ${v.name},\n\nalcuni documenti della tua azienda richiedono il tuo intervento:\n\n${v.items}\n\nAccedi alla tua area personale per caricare i documenti aggiornati: ${v.link}\n\nSe hai già provveduto o hai dubbi, rispondi a questa email.` }),
    EN: v => ({ subject: "Qualification documents to update", body: `Dear ${v.name},\n\nsome of your company's documents need your attention:\n\n${v.items}\n\nSign in to your personal area to upload the updated documents: ${v.link}\n\nIf you have already done so or have questions, just reply to this email.` }),
  },
  doc_unresponsive: {
    IT: v => ({ subject: `Fornitore che non risponde ai reminder: ${v.name}`, body: `Il fornitore ${v.name} non ha aggiornato i documenti nonostante i solleciti:\n\n${v.items}\n\nServe un tuo intervento (telefonata, contatto diretto o altra azione): ${v.link}` }),
    EN: v => ({ subject: `Supplier not answering reminders: ${v.name}`, body: `Supplier ${v.name} has not updated its documents despite the reminders:\n\n${v.items}\n\nYour action is needed (phone call, direct contact or other): ${v.link}` }),
  },
  bank_change_alert: {
    IT: v => ({ subject: "Richiesta di modifica delle coordinate bancarie", body: `Gentile ${v.name},\n\nabbiamo ricevuto dal portale fornitori una richiesta di modifica delle coordinate bancarie della vostra azienda.\n\nSe la richiesta è stata fatta da voi non serve fare nulla: vi contatteremo per una verifica prima di applicarla.\nSe NON l'avete fatta voi, rispondete subito a questa email: potrebbe trattarsi di un tentativo di frode.` }),
    EN: v => ({ subject: "Bank details change request", body: `Dear ${v.name},\n\nwe received through the supplier portal a request to change your company's bank details.\n\nIf you made this request, no action is needed: we will contact you to verify it before applying it.\nIf you did NOT make it, reply to this email immediately: it could be a fraud attempt.` }),
  },
  rfq_invite: {
    IT: v => ({ subject: `Richiesta di offerta: ${v.reason}`, body: `Gentile ${v.name},\n\nvi chiediamo di presentare un'offerta per: ${v.reason}.\n${v.detail ? `\n${v.detail}\n` : ""}\nL'offerta si inserisce nella vostra area personale entro il ${v.deadline}: ${v.link}\n\nPer chiarimenti rispondete a questa email.` }),
    EN: v => ({ subject: `Request for quotation: ${v.reason}`, body: `Dear ${v.name},\n\nwe kindly ask you to submit a quotation for: ${v.reason}.\n${v.detail ? `\n${v.detail}\n` : ""}\nYou can enter your quotation in your personal area by ${v.deadline}: ${v.link}\n\nFor any questions, just reply to this email.` }),
  },
  rfq_quote: {
    IT: v => ({ subject: `Offerta ricevuta: ${v.reason}`, body: `${v.name} ha risposto alla richiesta di offerta "${v.reason}": ${v.detail}.\n\nApri la pratica: ${v.link}` }),
    EN: v => ({ subject: `Quotation received: ${v.reason}`, body: `${v.name} replied to the request for quotation "${v.reason}": ${v.detail}.\n\nOpen it: ${v.link}` }),
  },
};

export interface Mail { to: string; template: Template; lang?: Lang; supplierId?: number; vars: Vars }

/** Salva e (se configurato) invia un'email. Un errore di invio non interrompe mai l'operazione che l'ha generata. */
export async function sendMail(db: Queryable, mail: Mail): Promise<"sent" | "logged" | "failed"> {
  const { subject, body } = T[mail.template][mail.lang ?? "IT"](mail.vars);
  const key = process.env.RESEND_API_KEY, from = process.env.MAIL_FROM;
  let status: "sent" | "logged" | "failed" = "logged", error: string | null = null;
  if (key && from) {
    try {
      const res = await fetch("https://api.resend.com/emails", { method: "POST", signal: AbortSignal.timeout(8000), headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ from, to: [mail.to], subject, text: body }) });
      status = res.ok ? "sent" : "failed";
      if (!res.ok) error = `HTTP ${res.status}`;
    } catch (err) { status = "failed"; error = err instanceof Error ? err.message : "errore di rete"; }
  }
  await db.query("insert into notifications (supplier_id, to_email, template, subject, body, status, error) values ($1,$2,$3,$4,$5,$6,$7)", [mail.supplierId ?? null, mail.to, mail.template, subject, body, status, error]);
  return status;
}
