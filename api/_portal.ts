import { createHash, randomBytes } from "node:crypto";
import type { Lifecycle, BuyingCompany, IndustryCode, InviteInput, PaymentTerm, PortalConfig, SapSettings, Supplier, SupplierData, SupplierDocument, SupplierEvent, SupplierStatus, SupplierSummary, User, VendorAction } from "../src/types.ts";
import { getPool, inTransaction, type Queryable } from "./_db.js";
import { HttpError } from "./_http.js";
import { hashPassword } from "./_crypto.js";
import { sendMail, type Lang } from "./_notify.js";
import { buildVendorPayload, assertReadyForSap, sendToSap } from "./_sap.js";
import { accountGroup, COUNTRIES, MAX_DOC_BYTES, missingRequired, resolveDocTypes, SUPPLIER_FILE_PATH_RE, validateDeclarations, validateSupplierData, validatePassword, validEmail, DOC_EXTENSIONS, normalizeIban } from "./_supplier-rules.js";
import { canInviteSuppliers } from "./_permissions.js";
import { visibleWhere } from "./_access.js";
import { docConfig, loadCatalog, loadPolicy, saveDocType, savePolicy } from "./_docs.js";
import { loadRdaConfig, saveRda } from "./_tasks.js";
import { bankKey, complianceChecks, diffData, duplicateIds, findDuplicates, qualificationOf, runExternalChecks, type StoredCompliance } from "./_governance.js";

const bad = (msg: string): never => { throw new HttpError(400, msg); };
const INVITE_DAYS = Number(process.env.INVITE_DAYS) > 0 ? Number(process.env.INVITE_DAYS) : 14;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const iso = (d: unknown) => (d ? new Date(d as string).toISOString() : null);
const str = (v: unknown, max = 300) => (typeof v === "string" ? v.trim().slice(0, max) : "");

// ─── Lettura ─────────────────────────────────────────────────
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

type Base = Omit<Supplier, "documents" | "events" | "docTypes" | "qualification" | "changes" | "bankChanged" | "bankLetterAfterChange" | "duplicates" | "compliance" | "complianceCheckedAt">;
function mapSupplier(r: Row): Base {
  return {
    id: r.id, email: r.email, name: r.name, companyCodes: r.company_codes, industryCode: r.industry_code, customerCode: r.customer_code,
    referenceBuyerId: r.reference_buyer_id, referenceBuyerName: r.reference_buyer_name ?? "", status: r.status, data: r.data ?? {},
    paymentTerms: r.payment_terms, sapCode: r.sap_code, sapAccountGroup: r.sap_account_group, rejectionReason: r.rejection_reason, isUpdate: r.is_update,
    invitedAt: iso(r.created_at)!, expiresAt: iso(r.token_expires), submittedAt: iso(r.submitted_at), updatedAt: iso(r.updated_at)!,
    lifecycle: r.lifecycle ?? "active", lifecycleReason: r.lifecycle_reason ?? "", approvedAt: iso(r.approved_at),
  };
}

const SELECT = "select s.*, rb.name as reference_buyer_name from suppliers s left join users rb on rb.id = s.reference_buyer_id";

export async function listVendors(user: User): Promise<SupplierSummary[]> {
  const db = getPool();
  const { rows } = await db.query(`select s.*, rb.name as reference_buyer_name from suppliers s left join users rb on rb.id = s.reference_buyer_id where ${visibleWhere(user)} order by s.updated_at desc`);
  const ids = rows.map(r => r.id);
  const docs = ids.length ? (await db.query("select supplier_id, type, valid_until from supplier_documents where supplier_id = any($1)", [ids])).rows : [];
  const cat = await loadCatalog(db);
  const dup = await duplicateIds(db);
  return rows.map(r => {
    const { data, ...rest } = mapSupplier(r);
    const mine = docs.filter(d => d.supplier_id === r.id).map(d => ({ type: d.type, validUntil: d.valid_until ? new Date(d.valid_until).toISOString().slice(0, 10) : null }));
    const qualification = qualificationOf(r.status, resolveDocTypes(cat.types, cat.rules, data.address?.country, r.industry_code), mine);
    return { ...rest, qualification, bankChanged: false, country: data.address?.country ?? "", legalName: data.company?.legalName ?? r.name, documentCount: mine.length, duplicate: dup.has(r.id) };
  });
}

async function loadFull(db: Queryable, id: number, forSupplier = false): Promise<Supplier | undefined> {
  const r = (await db.query(`${SELECT} where s.id = $1`, [id])).rows[0];
  if (!r) return undefined;
  const docs = (await db.query("select * from supplier_documents where supplier_id = $1 order by uploaded_at", [id])).rows;
  const ev = (await db.query(`select * from supplier_events where supplier_id = $1 ${forSupplier ? "and public" : ""} order by id`, [id])).rows;
  const cat = await loadCatalog(db);
  const labels = new Map(cat.types.map(t => [t.key, t.label]));
  const documents: SupplierDocument[] = docs.map(d => ({ id: d.id, type: d.type, typeLabel: labels.get(d.type) ?? d.type, ai: d.ai_result ? { ...d.ai_result, status: d.ai_status } : null, fileName: d.file_name, size: d.size, validUntil: d.valid_until ? new Date(d.valid_until).toISOString().slice(0, 10) : null, uploadedAt: iso(d.uploaded_at)!, uploadedBy: d.uploaded_by }));
  const events: SupplierEvent[] = ev.map(e => ({ at: iso(e.at)!, actor: e.actor, action: e.action, detail: e.detail }));
  const s = mapSupplier(r);
  // Documenti applicabili (paese e codice merceologico) più quelli già caricati di tipi non più richiesti.
  const resolved = resolveDocTypes(cat.types, cat.rules, s.data.address?.country, s.industryCode);
  const docTypes = [...resolved, ...cat.types.filter(t => !resolved.some(x => x.key === t.key) && docs.some(d => d.type === t.key)).map(t => ({ ...t, required: false }))];
  const qualification = qualificationOf(r.status, resolved, documents);
  const changes = r.approved_data && r.status !== "registered" ? diffData(r.approved_data, s.data) : [];
  const bankChanged = changes.some(c => c.bank);
  const bankLetterAfterChange = bankChanged && docs.some(d => d.type === "bank_letter" && (!r.approved_at || new Date(d.uploaded_at) > new Date(r.approved_at)));
  if (forSupplier) {
    // Il fornitore non vede dati interni (condizioni di pagamento, buyer di riferimento, controlli e doppioni).
    return { ...s, paymentTerms: null, referenceBuyerName: "", lifecycleReason: "", documents, events, docTypes, qualification, changes: [], bankChanged: false, bankLetterAfterChange: false, duplicates: [], compliance: [], complianceCheckedAt: null };
  }
  const duplicates = await findDuplicates(db, { id: r.id, name: r.name, data: s.data, confirmed: r.dup_confirmed ?? [] });
  const stored = (r.compliance ?? null) as StoredCompliance | null;
  const compliance = complianceChecks(s.data, stored, duplicates, qualification, missingRequired(resolved, documents).length, s.lifecycle);
  return { ...s, documents, events, docTypes, qualification, changes, bankChanged, bankLetterAfterChange, duplicates, compliance, complianceCheckedAt: stored?.checkedAt ?? null };
}

export async function getVendor(user: User, id: number): Promise<Supplier> {
  const ok = (await getPool().query(`select 1 from suppliers s where s.id = $1 and ${visibleWhere(user)}`, [id])).rows.length > 0;
  const s = ok ? await loadFull(getPool(), id) : undefined;
  if (!s) throw new HttpError(404, "Fornitore non trovato");
  return s;
}

const addEvent = (db: Queryable, supplierId: number, actor: string, action: string, detail = "", isPublic = false) =>
  db.query("insert into supplier_events (supplier_id, actor, action, detail, public) values ($1,$2,$3,$4,$5)", [supplierId, actor, action, detail, isPublic]);
const touch = (db: Queryable, id: number) => db.query("update suppliers set updated_at = now() where id = $1", [id]);

// ─── Configurazione ──────────────────────────────────────────
export async function loadConfig(): Promise<PortalConfig> {
  const db = getPool();
  const [c, i, ib, pt, st, b] = await Promise.all([
    db.query("select * from buying_companies order by name"), db.query("select * from industry_codes order by code"),
    db.query("select * from industry_buyers"), db.query("select * from payment_terms order by code"),
    db.query("select value from settings where key = 'sap'"), db.query("select id, name, active from users where role in ('buyer','manager') order by name"),
  ]);
  const companies: BuyingCompany[] = c.rows.map(r => ({ code: r.code, name: r.name, sapCompanyCode: r.sap_company_code, purchOrg: r.purch_org }));
  const industryCodes: IndustryCode[] = i.rows.map(r => ({ code: r.code, name: r.name, buyerIds: ib.rows.filter(x => x.industry_code === r.code).map(x => x.user_id) }));
  const paymentTerms: PaymentTerm[] = pt.rows.map(r => ({ code: r.code, label: r.label }));
  const cat = await loadCatalog(db);
  return { companies, industryCodes, paymentTerms, sap: st.rows[0]?.value as SapSettings, buyers: b.rows, ...docConfig(cat, await loadPolicy(db)), rda: await loadRdaConfig(db) };
}

const CODE_RE = /^[A-Za-z0-9_.-]{1,20}$/;
export async function saveConfig(entity: string, action: string, item: Row): Promise<void> {
  const db = getPool();
  const code = str(item?.code, 20);
  const del = action === "delete";
  if (entity === "rda" || entity === "pgr") return saveRda(entity, item);
  if (entity === "doc_type") return saveDocType(action, item);
  if (entity === "reminders") return savePolicy(item);
  if (entity === "sap") {
    const cur = (await db.query("select value from settings where key = 'sap'")).rows[0]?.value as SapSettings;
    const rec: Record<string, string> = {};
    for (const g of ["ITD1", "ITW1", "ITF3", "BRD6"]) rec[g] = str(item?.reconciliationAccounts?.[g], 20);
    const next: SapSettings = { tradingPartner: str(item?.tradingPartner, 20) || cur.tradingPartner, sortKey: str(item?.sortKey, 10) || cur.sortKey, cashManagementGroup: str(item?.cashManagementGroup, 20) || cur.cashManagementGroup, releaseGroup: str(item?.releaseGroup, 10) || cur.releaseGroup, reconciliationAccounts: rec };
    await db.query("insert into settings (key, value) values ('sap', $1) on conflict (key) do update set value = excluded.value", [JSON.stringify(next)]);
    return;
  }
  if (!CODE_RE.test(code)) bad("Codice non valido: usa lettere, numeri, trattino o punto (max 20 caratteri)");
  const inUse = async (sql: string) => (await db.query(sql, [code])).rows[0].n > 0;
  if (entity === "company") {
    if (del) { if (await inUse("select count(*)::int as n from suppliers where $1 = any(company_codes)")) throw new HttpError(409, "Società usata da fornitori: non si può eliminare"); await db.query("delete from buying_companies where code = $1", [code]); return; }
    const name = str(item?.name, 120); if (!name) bad("Il nome è obbligatorio");
    await db.query("insert into buying_companies (code, name, sap_company_code, purch_org) values ($1,$2,$3,$4) on conflict (code) do update set name = excluded.name, sap_company_code = excluded.sap_company_code, purch_org = excluded.purch_org", [code, name, str(item?.sapCompanyCode, 10), str(item?.purchOrg, 10)]);
  } else if (entity === "industry") {
    if (del) { if (await inUse("select count(*)::int as n from suppliers where industry_code = $1")) throw new HttpError(409, "Codice usato da fornitori: non si può eliminare"); await db.query("delete from industry_codes where code = $1", [code]); return; }
    const name = str(item?.name, 120); if (!name) bad("Il nome è obbligatorio");
    const ids: number[] = Array.isArray(item?.buyerIds) ? item.buyerIds.filter((n: unknown) => Number.isInteger(n)) : [];
    await inTransaction(async tx => {
      await tx.query("insert into industry_codes (code, name) values ($1,$2) on conflict (code) do update set name = excluded.name", [code, name]);
      await tx.query("delete from industry_buyers where industry_code = $1", [code]);
      for (const id of ids) await tx.query("insert into industry_buyers (industry_code, user_id) select $1, id from users where id = $2 and active and role in ('buyer','manager')", [code, id]);
    });
  } else if (entity === "payment_term") {
    if (del) { if (await inUse("select count(*)::int as n from suppliers where payment_terms = $1")) throw new HttpError(409, "Condizione usata da fornitori: non si può eliminare"); await db.query("delete from payment_terms where code = $1", [code]); return; }
    const label = str(item?.label, 120); if (!label) bad("La descrizione è obbligatoria");
    await db.query("insert into payment_terms (code, label) values ($1,$2) on conflict (code) do update set label = excluded.label", [code, label]);
  } else bad("Elemento non valido");
}

// ─── Destinatari e link ──────────────────────────────────────
async function buyersFor(db: Queryable, s: Row): Promise<{ email: string }[]> {
  const { rows } = await db.query(`select distinct u.email from users u where u.active and u.role in ('buyer','manager') and (u.id = $1 or u.id in (select user_id from industry_buyers where industry_code = $2))`, [s.reference_buyer_id, s.industry_code]);
  if (rows.length) return rows;
  return (await db.query("select email from users where active and role = 'manager'")).rows;
}
async function financeUsers(db: Queryable): Promise<{ email: string }[]> {
  const { rows } = await db.query("select email from users where active and role = 'finance'");
  return rows.length ? rows : (await db.query("select email from users where active and role = 'manager'")).rows;
}
const langOf = (data: SupplierData): Lang => (data.contacts?.language === "EN" ? "EN" : "IT");
const fmtDay = (d: Date) => d.toLocaleDateString("it-IT", { day: "2-digit", month: "long", year: "numeric" });

// ─── Inviti ──────────────────────────────────────────────────
export async function inviteSupplier(actor: User, input: unknown, origin: string): Promise<{ supplier: Supplier; link: string }> {
  if (!canInviteSuppliers(actor)) throw new HttpError(403, "Operazione non consentita");
  const i = (input ?? {}) as Partial<InviteInput>;
  const email = str(i.email, 200).toLowerCase(), name = str(i.name, 200);
  if (!validEmail(email)) bad("Email non valida");
  if (name.length < 2) bad("Il nome del fornitore è obbligatorio");
  const companyCodes = Array.isArray(i.companyCodes) ? i.companyCodes.map(c => str(c, 20)).filter(Boolean) : [];
  if (!companyCodes.length) bad("Seleziona almeno una società");
  const industryCode = str(i.industryCode, 20);
  if (!industryCode) bad("Seleziona il codice merceologico");
  const customerCode = str(i.customerCode, 40);
  if (industryCode === "CT00" && !customerCode) bad("Il codice cliente è obbligatorio per il codice merceologico CT00");
  const refId = Number(i.referenceBuyerId);
  const confirmDup = (input as Row)?.confirmDuplicates === true;

  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + INVITE_DAYS * 864e5);
  const link = `${origin}/?invite=${token}`;
  const id = await inTransaction(async db => {
    const ok = (await db.query("select count(*)::int as n from buying_companies where code = any($1)", [companyCodes])).rows[0].n === companyCodes.length;
    if (!ok) bad("Società non valida");
    if (!(await db.query("select 1 from industry_codes where code = $1", [industryCode])).rows.length) bad("Codice merceologico non valido");
    if (!(await db.query("select 1 from users where id = $1 and active and role in ('buyer','manager')", [refId])).rows.length) bad("Seleziona un buyer di riferimento attivo");
    if ((await db.query("select 1 from suppliers where lower(email) = $1", [email])).rows.length) throw new HttpError(409, "Questo fornitore è già stato invitato o registrato");
    if ((await db.query("select 1 from users where lower(email) = $1", [email])).rows.length) throw new HttpError(409, "Questa email appartiene già a un utente");
    // Controllo doppioni prima di creare un nuovo fornitore: stessa ragione sociale di uno esistente.
    const dups = await findDuplicates(db, { name, data: { company: { legalName: name } } });
    if (dups.some(d => d.lifecycle === "excluded") && actor.role !== "manager") throw new HttpError(409, "Esiste un fornitore escluso con lo stesso nome: solo un Manager può invitarlo", { duplicates: dups });
    if (dups.length && !confirmDup) throw new HttpError(409, "Esiste già un fornitore con lo stesso nome: controlla che non sia un doppione", { duplicates: dups, needsConfirm: true });
    const r = await db.query(`insert into suppliers (email, name, company_codes, industry_code, customer_code, reference_buyer_id, status, token_hash, token_expires, invited_by, data)
      values ($1,$2,$3,$4,$5,$6,'invited',$7,$8,$9,$10) returning id`, [email, name, companyCodes, industryCode, customerCode, refId, sha(token), expires, actor.id, JSON.stringify({ company: { legalName: name }, contacts: { language: "IT", ordersEmail: email, adminEmail: email } })]);
    const sid = r.rows[0].id as number;
    await addEvent(db, sid, actor.name, "Invito creato", `Inviato a ${email}`, true);
    if (confirmDup) await addEvent(db, sid, actor.name, "Possibile doppione confermato all'invito", "Esisteva già un fornitore con lo stesso nome");
    const names = (await db.query("select name from buying_companies where code = any($1) order by name", [companyCodes])).rows.map(x => x.name).join(", ");
    const status = await sendMail(db, { to: email, template: "invitation", supplierId: sid, vars: { name, link, expires: fmtDay(expires), companies: names } });
    await addEvent(db, sid, "Sistema", status === "sent" ? "Email di invito inviata" : status === "failed" ? "Invio email non riuscito" : "Email di invito non inviata (servizio email non configurato): usa il link", "");
    return sid;
  });
  return { supplier: (await loadFull(getPool(), id))!, link };
}

export async function reinviteSupplier(actor: User, id: number, origin: string): Promise<{ supplier: Supplier; link: string }> {
  if (!canInviteSuppliers(actor)) throw new HttpError(403, "Operazione non consentita");
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + INVITE_DAYS * 864e5);
  const link = `${origin}/?invite=${token}`;
  await inTransaction(async db => {
    const r = (await db.query(`${SELECT} where s.id = $1 and ${visibleWhere(actor)} for update of s`, [id])).rows[0];
    if (!r) throw new HttpError(404, "Fornitore non trovato");
    if (r.status !== "invited") throw new HttpError(409, "Il fornitore ha già iniziato la registrazione");
    await db.query("update suppliers set token_hash = $1, token_expires = $2, updated_at = now() where id = $3", [sha(token), expires, id]);
    await addEvent(db, id, actor.name, "Nuovo invito generato", "Il link precedente non è più valido", true);
    const names = (await db.query("select name from buying_companies where code = any($1)", [r.company_codes])).rows.map(x => x.name).join(", ");
    await sendMail(db, { to: r.email, template: "invitation", supplierId: id, vars: { name: r.name, link, expires: fmtDay(expires), companies: names } });
  });
  return { supplier: (await loadFull(getPool(), id))!, link };
}

export async function deleteInvite(actor: User, id: number): Promise<void> {
  if (!canInviteSuppliers(actor)) throw new HttpError(403, "Operazione non consentita");
  const r = await getPool().query(`delete from suppliers s where s.id = $1 and s.status = 'invited' and ${visibleWhere(actor)}`, [id]);
  if (!r.rowCount) throw new HttpError(409, "Si può eliminare solo un invito non ancora usato");
}

// ─── Accesso del fornitore tramite invito ────────────────────
export async function inviteInfo(token: string): Promise<{ name: string; email: string; companies: string[] }> {
  const r = (await getPool().query("select name, email, company_codes from suppliers where token_hash = $1 and status = 'invited' and token_expires > now()", [sha(token || "-")])).rows[0];
  if (!r) throw new HttpError(404, "Invito non valido o scaduto: chiedi al tuo referente di inviarne uno nuovo");
  const companies = (await getPool().query("select name from buying_companies where code = any($1) order by name", [r.company_codes])).rows.map(x => x.name);
  return { name: r.name, email: r.email, companies };
}

export async function activateInvite(token: string, password: string): Promise<User> {
  const pwErr = validatePassword(password);
  if (pwErr) bad(pwErr);
  const hash = await hashPassword(password);
  return inTransaction(async db => {
    const r = (await db.query("select * from suppliers where token_hash = $1 and status = 'invited' and token_expires > now() for update", [sha(token || "-")])).rows[0];
    if (!r) throw new HttpError(404, "Invito non valido o scaduto: chiedi al tuo referente di inviarne uno nuovo");
    const u = (await db.query("insert into users (email, name, role, title, password_hash) values ($1,$2,'supplier','Fornitore',$3) returning *", [r.email, r.name, hash])).rows[0];
    await db.query("update suppliers set user_id = $1, status = 'draft', token_hash = null, token_expires = null, updated_at = now() where id = $2", [u.id, r.id]);
    await addEvent(db, r.id, r.name, "Account creato", "Il fornitore ha attivato l'invito", true);
    return { id: u.id, email: u.email, name: u.name, role: "supplier" as const, title: u.title, active: true };
  });
}

// ─── Area del fornitore ──────────────────────────────────────
const EDITABLE: SupplierStatus[] = ["draft", "pending_revision", "rejected", "registered"];
/** Un fornitore già registrato che ha avviato un aggiornamento può continuare a completarlo (altri documenti, altri dati) finché il Buyer non decide. */
const canEdit = (r: Row) => EDITABLE.includes(r.status) || (r.status === "pending" && r.is_update === true);

async function ownSupplierRow(db: Queryable, user: User, lock = false): Promise<Row> {
  const r = (await db.query(`${SELECT} where s.user_id = $1 ${lock ? "for update of s" : ""}`, [user.id])).rows[0];
  if (!r) throw new HttpError(404, "Scheda fornitore non trovata");
  return r;
}
export async function getMySupplier(user: User): Promise<Supplier> {
  const r = await ownSupplierRow(getPool(), user);
  return (await loadFull(getPool(), r.id, true))!;
}

function sanitizeData(input: unknown): SupplierData {
  const x = (input ?? {}) as Row;
  const out: SupplierData = {};
  const s = (v: unknown, n = 200) => str(v, n);
  if (x.company && typeof x.company === "object") out.company = { legalName: s(x.company.legalName), vatCode: s(x.company.vatCode, 30).toUpperCase(), fiscalCode: s(x.company.fiscalCode, 30).toUpperCase() };
  if (x.address && typeof x.address === "object") {
    const country = s(x.address.country, 2).toUpperCase();
    out.address = { street: s(x.address.street), houseNumber: s(x.address.houseNumber, 20), postalCode: s(x.address.postalCode, 20), city: s(x.address.city, 100), country: COUNTRIES.some(c => c.code === country) ? country : "", region: s(x.address.region, 100) };
  }
  if (x.payment && typeof x.payment === "object") {
    const p = x.payment;
    out.payment = { iban: normalizeIban(s(p.iban, 40)), swift: s(p.swift, 11).toUpperCase().replace(/\s+/g, ""), accountNumber: s(p.accountNumber, 40), bankName: s(p.bankName, 120), currency: s(p.currency, 3).toUpperCase(), withholdingTax: typeof p.withholdingTax === "boolean" ? p.withholdingTax : null, withholdingType: s(p.withholdingType, 30), withholdingSpec: s(p.withholdingSpec, 200) };
  }
  if (x.contacts && typeof x.contacts === "object") out.contacts = { language: x.contacts.language === "EN" ? "EN" : "IT", ordersEmail: s(x.contacts.ordersEmail).toLowerCase(), adminEmail: s(x.contacts.adminEmail).toLowerCase(), phone: s(x.contacts.phone, 30) };
  if (typeof x.acceptedTerms === "boolean") out.acceptedTerms = x.acceptedTerms;
  if (x.declarations && typeof x.declarations === "object") {
    const d = x.declarations;
    out.declarations = { conflictOfInterest: typeof d.conflictOfInterest === "boolean" ? d.conflictOfInterest : null, conflictDetails: s(d.conflictDetails, 1000), noSanctions: d.noSanctions === true, privacyAccepted: d.privacyAccepted === true };
  }
  return out;
}
const merge = (a: SupplierData, b: SupplierData): SupplierData => {
  const out: SupplierData = { ...a, ...b, company: { ...a.company, ...b.company }, address: { ...a.address, ...b.address }, payment: { ...a.payment, ...b.payment }, contacts: { ...a.contacts, ...b.contacts }, declarations: { ...a.declarations, ...b.declarations } };
  // Data della presa visione dell'informativa privacy: si registra la prima volta.
  if (out.declarations?.privacyAccepted && !out.declarations.privacyAcceptedAt) out.declarations.privacyAcceptedAt = new Date().toISOString();
  if (out.declarations && !out.declarations.privacyAccepted) delete out.declarations.privacyAcceptedAt;
  return out;
};
const stable = (o: unknown): string => JSON.stringify(o, (_k, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v));

/** Un fornitore già approvato che modifica i dati torna "in verifica" e il buyer deve riapprovare. */
async function reopenIfRegistered(db: Queryable, r: Row, actor: string, what: string, origin?: string) {
  if (r.status !== "registered") return;
  await db.query("update suppliers set status = 'pending', is_update = true, submitted_at = now(), updated_at = now() where id = $1", [r.id]);
  await addEvent(db, r.id, actor, "Dati modificati dal fornitore", `${what}: serve una nuova approvazione`, true);
  for (const b of await buyersFor(db, r)) await sendMail(db, { to: b.email, template: "supplier_modified", supplierId: r.id, vars: { name: r.name, link: `${origin ?? ""}/` } });
}

export async function saveMyData(user: User, input: unknown, origin?: string): Promise<Supplier> {
  await inTransaction(async db => {
    const r = await ownSupplierRow(db, user, true);
    if (!canEdit(r)) throw new HttpError(409, "La registrazione è in verifica: non si può modificare finché Buyer e Finance non decidono");
    const merged = merge(r.data ?? {}, sanitizeData(input));
    if (stable(merged) === stable(r.data ?? {})) return;
    await db.query("update suppliers set data = $1, updated_at = now() where id = $2", [JSON.stringify(merged), r.id]);
    await reopenIfRegistered(db, r, user.name, "Modifica dei dati", origin);
    // Cambio delle coordinate bancarie di un fornitore già approvato: avviso ai contatti già noti (protezione dalle frodi).
    if (r.approved_data && bankKey(merged) !== bankKey(r.data) && bankKey(merged) !== bankKey(r.approved_data)) {
      const known = [...new Set([r.approved_data?.contacts?.adminEmail, r.email].filter(Boolean).map((e: string) => e.toLowerCase()))];
      for (const to of known) await sendMail(db, { to, template: "bank_change_alert", lang: langOf(r.approved_data), supplierId: r.id, vars: { name: r.name } });
      await addEvent(db, r.id, "Sistema", "Coordinate bancarie modificate dal fornitore", `Avviso di sicurezza inviato a ${known.join(", ")}`);
    }
  });
  return getMySupplier(user);
}

export async function submitMyRegistration(user: User, origin: string): Promise<Supplier> {
  await inTransaction(async db => {
    const r = await ownSupplierRow(db, user, true);
    if (!["draft", "pending_revision", "rejected"].includes(r.status)) throw new HttpError(409, "La registrazione non può essere inviata in questo stato");
    const data: SupplierData = r.data ?? {};
    const errors = validateSupplierData(data);
    if (data.acceptedTerms !== true) errors["acceptedTerms"] = "Devi accettare i termini e le condizioni";
    Object.assign(errors, validateDeclarations(data));
    const docs = (await db.query("select type, valid_until from supplier_documents where supplier_id = $1", [r.id])).rows.map(d => ({ type: d.type, validUntil: d.valid_until ? new Date(d.valid_until).toISOString().slice(0, 10) : null }));
    const cat = await loadCatalog(db);
    const missing = missingRequired(resolveDocTypes(cat.types, cat.rules, data.address?.country, r.industry_code), docs);
    if (Object.keys(errors).length || missing.length) throw new HttpError(422, "Completa i dati richiesti prima di inviare", { fieldErrors: errors, missingDocuments: missing });
    await db.query("update suppliers set status = 'pending', is_update = $2, submitted_at = now(), updated_at = now(), rejection_reason = '' where id = $1", [r.id, !!r.sap_code]);
    await addEvent(db, r.id, user.name, r.sap_code ? "Aggiornamento inviato" : "Registrazione inviata", "In attesa della verifica del Buyer", true);
    for (const b of await buyersFor(db, r)) await sendMail(db, { to: b.email, template: r.sap_code ? "supplier_modified" : "new_registration", supplierId: r.id, vars: { name: r.name, link: `${origin}/` } });
  });
  // Controlli esterni (VIES, sanzioni) dopo il salvataggio: un servizio lento non deve bloccare l'invio.
  try { await runExternalChecks(getPool(), (await ownSupplierRow(getPool(), user)).id); } catch (err) { console.error("Controlli di conformità non riusciti", err); }
  return getMySupplier(user);
}

export interface DocInput { type: string; fileName: string; filePath: string; size: number; validUntil: string | null }
export async function addMyDocument(user: User, input: unknown, origin?: string): Promise<{ supplier: Supplier; staleFiles: string[]; docId: number }> {
  const i = (input ?? {}) as Partial<DocInput>;
  const typeKey = str(i.type, 40);
  const fileName = str(i.fileName, 200), filePath = str(i.filePath, 300);
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  if (!DOC_EXTENSIONS.includes(ext)) bad("Formato non supportato: usa PDF, Word, PowerPoint o immagini");
  if (!SUPPLIER_FILE_PATH_RE.test(filePath)) bad("Percorso del documento non valido");
  const size = Number(i.size);
  if (!Number.isFinite(size) || size <= 0 || size > MAX_DOC_BYTES) bad(`Il file deve pesare al massimo ${MAX_DOC_BYTES / 1024 / 1024} MB`);
  const validUntil = i.validUntil ? (/^\d{4}-\d{2}-\d{2}$/.test(i.validUntil) ? i.validUntil : bad("Data di validità non valida")) : null;
  const stale: string[] = [];
  let docId = 0;
  await inTransaction(async db => {
    const r = await ownSupplierRow(db, user, true);
    if (!canEdit(r)) throw new HttpError(409, "La registrazione è in verifica: non si possono cambiare i documenti");
    const cat = await loadCatalog(db);
    const type = resolveDocTypes(cat.types, cat.rules, r.data?.address?.country, r.industry_code).find(t => t.key === typeKey);
    if (!type) return bad("Questo documento non è richiesto per la tua azienda");
    if (type.expires && !validUntil) return bad("Indica la data di scadenza del documento");
    if ((await db.query("select count(*)::int as n from supplier_documents where supplier_id = $1", [r.id])).rows[0].n >= 30) bad("Troppi documenti caricati");
    if (!type.multiple) { const old = await db.query("delete from supplier_documents where supplier_id = $1 and type = $2 returning file_path", [r.id, type.key]); stale.push(...old.rows.map(x => x.file_path)); }
    docId = (await db.query("insert into supplier_documents (supplier_id, type, file_name, file_path, size, valid_until, uploaded_by) values ($1,$2,$3,$4,$5,$6,$7) returning id", [r.id, type.key, fileName, filePath, size, validUntil, user.name])).rows[0].id;
    await addEvent(db, r.id, user.name, "Documento caricato", `${type.label}: ${fileName}`, false);
    await touch(db, r.id);
    await reopenIfRegistered(db, r, user.name, `Nuovo documento (${type.label})`, origin);
  });
  return { supplier: await getMySupplier(user), staleFiles: stale, docId };
}

export async function deleteMyDocument(user: User, docId: number, origin?: string): Promise<{ supplier: Supplier; staleFiles: string[] }> {
  const stale: string[] = [];
  await inTransaction(async db => {
    const r = await ownSupplierRow(db, user, true);
    if (!canEdit(r)) throw new HttpError(409, "La registrazione è in verifica: non si possono cambiare i documenti");
    const d = (await db.query("delete from supplier_documents where id = $1 and supplier_id = $2 returning file_path, type, file_name", [docId, r.id])).rows[0];
    if (!d) throw new HttpError(404, "Documento non trovato");
    stale.push(d.file_path);
    await addEvent(db, r.id, user.name, "Documento rimosso", `${(await db.query("select label from doc_types where key = $1", [d.type])).rows[0]?.label ?? d.type}: ${d.file_name}`, false);
    await touch(db, r.id);
    await reopenIfRegistered(db, r, user.name, "Documento rimosso", origin);
  });
  return { supplier: await getMySupplier(user), staleFiles: stale };
}

export async function documentOwner(docId: number): Promise<number> {
  const r = (await getPool().query("select supplier_id from supplier_documents where id = $1", [docId])).rows[0];
  if (!r) throw new HttpError(404, "Documento non trovato");
  return r.supplier_id;
}

/** Il fornitore può scaricare solo i propri documenti; lo staff solo quelli dei fornitori che può vedere. */
export async function documentForDownload(user: User, docId: number): Promise<{ filePath: string; fileName: string }> {
  const db = getPool();
  const d = (await db.query("select d.file_path, d.file_name, d.supplier_id, s.user_id from supplier_documents d join suppliers s on s.id = d.supplier_id where d.id = $1", [docId])).rows[0];
  if (!d) throw new HttpError(404, "Documento non trovato");
  if (user.role === "supplier") { if (d.user_id !== user.id) throw new HttpError(404, "Documento non trovato"); }
  else if (!(await db.query(`select 1 from suppliers s where s.id = $1 and ${visibleWhere(user)}`, [d.supplier_id])).rows.length) throw new HttpError(404, "Documento non trovato");
  return { filePath: d.file_path, fileName: d.file_name };
}

// ─── Azioni dello staff (verifica, approvazione, SAP) ────────
const isBuyerStep = (u: User) => u.role === "buyer" || u.role === "manager";
const isFinanceStep = (u: User) => u.role === "finance" || u.role === "manager";

export async function vendorAction(user: User, id: number, action: VendorAction, input: Row, origin: string): Promise<Supplier> {
  const db = getPool();
  const base = (await db.query(`${SELECT} where s.id = $1 and ${visibleWhere(user)}`, [id])).rows[0];
  if (!base) throw new HttpError(404, "Fornitore non trovato");
  const reason = str(input?.reason, 1000);
  const link = `${origin}/`;
  const statusIn = (...s: SupplierStatus[]) => { if (!s.includes(base.status)) throw new HttpError(409, `Azione non possibile nello stato "${base.status}"`); };
  const termsOk = async (code: string | null) => { if (!code || !(await db.query("select 1 from payment_terms where code = $1", [code])).rows.length) bad("Seleziona le condizioni di pagamento prima di approvare"); };

  const full = async () => (await loadFull(db, id))!;
  const lifecycleOk = () => { if ((base.lifecycle ?? "active") !== "active") throw new HttpError(409, "Il fornitore è bloccato, disattivato o escluso: riattivalo prima di procedere"); };

  if (action === "block" || action === "deactivate" || action === "exclude" || action === "reactivate") {
    // Blocco temporaneo: Buyer o Manager. Disattivazione, esclusione e riattivazione: solo Manager.
    if (action === "block" ? !isBuyerStep(user) : user.role !== "manager") throw new HttpError(403, action === "block" ? "Operazione non consentita" : "Solo un Manager può farlo");
    if (reason.length < 3) bad("Scrivi il motivo: resta nello storico del fornitore");
    const to: Lifecycle = action === "block" ? "blocked" : action === "deactivate" ? "inactive" : action === "exclude" ? "excluded" : "active";
    if ((base.lifecycle ?? "active") === to) throw new HttpError(409, "Il fornitore è già in questo stato");
    const label = { blocked: "Fornitore bloccato", inactive: "Fornitore disattivato", excluded: "Fornitore escluso", active: "Fornitore riattivato" }[to];
    await inTransaction(async tx => {
      await tx.query("update suppliers set lifecycle = $1, lifecycle_reason = $2, updated_at = now() where id = $3", [to, to === "active" ? "" : reason, id]);
      // Disattivato o escluso: non può più accedere all'area personale. Bloccato: accede ma non viene approvato.
      if (base.user_id) await tx.query("update users set active = $1 where id = $2", [to === "active" || to === "blocked", base.user_id]);
      await addEvent(tx, id, user.name, label, reason);
    });
    return full();
  }
  if (action === "sanctions_manual") {
    if (!isFinanceStep(user) && user.role !== "buyer") throw new HttpError(403, "Operazione non consentita");
    if (reason.length < 5) bad("Descrivi la verifica fatta (fonte consultata ed esito)");
    const stored: StoredCompliance = { ...(base.compliance ?? {}), manualSanctions: { by: user.name, at: new Date().toISOString(), note: reason } };
    await inTransaction(async tx => { await tx.query("update suppliers set compliance = $1 where id = $2", [JSON.stringify(stored), id]); await addEvent(tx, id, user.name, "Verifica sanzioni manuale", reason); });
    return full();
  }

  if (action === "set_payment_terms") {
    if (!isBuyerStep(user)) throw new HttpError(403, "Solo il Buyer può modificare le condizioni di pagamento");
    const code = str(input?.paymentTerms, 20); await termsOk(code);
    await inTransaction(async tx => { await tx.query("update suppliers set payment_terms = $1, updated_at = now() where id = $2", [code, id]); await addEvent(tx, id, user.name, "Condizioni di pagamento", code); });
  } else if (action === "approve" && base.status === "pending") {
    if (!isBuyerStep(user)) throw new HttpError(403, "Il passaggio spetta al Buyer");
    lifecycleOk();
    await termsOk(str(input?.paymentTerms, 20) || base.payment_terms);
    // Possibili doppioni: il Buyer deve confermare che si tratta di un fornitore diverso, spiegando perché.
    const all = await findDuplicates(db, { id, name: base.name, data: base.data ?? {}, confirmed: base.dup_confirmed ?? [] });
    if (all.some(d => d.lifecycle === "excluded")) throw new HttpError(409, "Lo stesso fornitore risulta escluso: non si può approvare", { duplicates: all });
    const dups = all.filter(d => !d.confirmed);
    if (dups.length && !(input?.confirmDuplicates === true && str(input?.duplicateReason, 500).length >= 5)) throw new HttpError(409, "Possibile doppione: conferma che è un fornitore diverso e spiega il motivo", { duplicates: dups, needsDuplicateConfirm: true });
    const fb = await full();
    if (fb.bankChanged && !fb.bankLetterAfterChange) throw new HttpError(409, "Le coordinate bancarie sono cambiate ma manca la nuova lettera della banca: chiedi modifiche al fornitore");
    if (dups.length) {
      await db.query("update suppliers set dup_confirmed = array(select distinct unnest(dup_confirmed || $1::int[])) where id = $2", [dups.map(d => d.supplierId), id]);
      await addEvent(db, id, user.name, "Doppione verificato dal Buyer", `${dups.map(d => d.name).join(", ")}: ${str(input?.duplicateReason, 500)}`);
    }
    await inTransaction(async tx => {
      const pt = str(input?.paymentTerms, 20) || base.payment_terms;
      await tx.query("update suppliers set status = 'approved', payment_terms = $1, updated_at = now() where id = $2", [pt, id]);
      await addEvent(tx, id, user.name, "Approvato dal Buyer", `Condizioni di pagamento ${pt}`);
      for (const f of await financeUsers(tx)) await sendMail(tx, { to: f.email, template: "buyer_approved", supplierId: id, vars: { name: base.name, link } });
    });
  } else if (action === "approve" && base.status === "approved") {
    if (!isFinanceStep(user)) throw new HttpError(403, "Il passaggio spetta al Finance");
    lifecycleOk();
    const f = await full();
    // Coordinate bancarie cambiate: servono la nuova lettera della banca e la verifica telefonica a un contatto già noto.
    if (f.bankChanged) {
      if (!f.bankLetterAfterChange) throw new HttpError(409, "Le coordinate bancarie sono cambiate: serve una nuova lettera della banca caricata dal fornitore");
      const v = input?.bankVerification ?? {};
      if (str(v.contact, 200).length < 3 || str(v.note, 1000).length < 5) bad("Le coordinate bancarie sono cambiate: indica chi hai chiamato (a un numero già noto, non preso dalla richiesta) e l'esito della verifica");
      await addEvent(db, id, user.name, "Coordinate bancarie verificate", `Telefonata a ${str(v.contact, 200)}: ${str(v.note, 1000)}`);
    }
    // Controlli di conformità non tutti superati: il Finance conferma di averli valutati.
    const open = f.compliance.filter(c => c.status === "fail" || c.status === "warn" || c.status === "todo");
    if (open.length) {
      if (input?.complianceAck !== true || str(input?.complianceNote, 1000).length < 5) throw new HttpError(409, `Controlli da valutare: ${open.map(c => c.label).join(", ")}. Conferma di averli verificati e scrivi una nota`, { needsComplianceAck: true });
      await addEvent(db, id, user.name, "Controlli di conformità valutati", `${open.map(c => `${c.label}: ${c.detail}`).join(" | ")} — Nota: ${str(input?.complianceNote, 1000)}`);
    }
    await createInSap(user, base, origin);
  } else if (action === "approve") {
    throw new HttpError(409, `Non c'è nulla da approvare nello stato "${base.status}"`);
  } else if (action === "reject" || action === "request_revision") {
    statusIn("pending", "approved");
    if (base.status === "pending" ? !isBuyerStep(user) : !isFinanceStep(user)) throw new HttpError(403, "Non puoi decidere in questo passaggio");
    if (reason.length < 3) bad("Scrivi il motivo: il fornitore lo riceverà per email");
    const next: SupplierStatus = action === "reject" ? "rejected" : "pending_revision";
    await inTransaction(async tx => {
      await tx.query("update suppliers set status = $1, rejection_reason = $2, updated_at = now() where id = $3", [next, reason, id]);
      await addEvent(tx, id, user.name, action === "reject" ? "Rifiutato" : "Modifiche richieste", reason, true);
      await sendMail(tx, { to: base.email, template: action === "reject" ? "rejection" : "revision_requested", lang: langOf(base.data ?? {}), supplierId: id, vars: { name: base.name, reason, link } });
    });
  } else if (action === "change_status") {
    if (!isBuyerStep(user)) throw new HttpError(403, "Solo Buyer e Manager possono forzare lo stato");
    const to = str(input?.status, 20) as SupplierStatus;
    if (!["draft", "pending", "pending_revision", "approved", "rejected"].includes(to)) bad("Stato non valido");
    if (base.status === "invited" || base.status === "registered") throw new HttpError(409, "Non si può cambiare lo stato di un invito o di un fornitore già registrato");
    if (reason.length < 3) bad("Scrivi il motivo del cambio di stato");
    await inTransaction(async tx => { await tx.query("update suppliers set status = $1, updated_at = now() where id = $2", [to, id]); await addEvent(tx, id, user.name, "Stato modificato manualmente", `${base.status} → ${to}: ${reason}`); });
  } else bad("Azione non valida");
  return (await loadFull(getPool(), id))!;
}

/** Passaggio finale: prepara i dati, li invia a SAP e registra il codice. Un blocco evita doppie creazioni se si clicca due volte. */
async function createInSap(user: User, base: Row, origin: string): Promise<void> {
  const db = getPool();
  const locked = await db.query("update suppliers set sap_lock = now() where id = $1 and status = 'approved' and (sap_lock is null or sap_lock < now() - interval '2 minutes') returning id", [base.id]);
  if (!locked.rowCount) throw new HttpError(409, "Creazione in SAP già in corso");
  const release = () => db.query("update suppliers set sap_lock = null where id = $1", [base.id]);
  try {
    const cfg = await loadConfig();
    const payload = buildVendorPayload({ id: base.id, email: base.email, companyCodes: base.company_codes, paymentTerms: base.payment_terms, sapCode: base.sap_code, data: base.data ?? {} }, cfg.sap, cfg.companies);
    try { assertReadyForSap(payload); }
    catch (err) { await addEvent(db, base.id, "Sistema", "Creazione in SAP non possibile", err instanceof Error ? err.message : ""); throw err; }
    let result: Awaited<ReturnType<typeof sendToSap>>;
    try { result = await sendToSap(payload, base.id); }
    catch (err) {
      const msg = err instanceof Error ? err.message : "errore";
      await db.query("insert into sap_requests (supplier_id, mode, payload, response, ok) values ($1,$2,$3,$4,false)", [base.id, process.env.SAP_MODE === "http" ? "http" : "simulated", JSON.stringify(payload), JSON.stringify({ error: msg })]);
      await addEvent(db, base.id, "Sistema", "Creazione in SAP non riuscita", msg);
      throw err;
    }
    await inTransaction(async tx => {
      await tx.query("insert into sap_requests (supplier_id, mode, payload, response, ok) values ($1,$2,$3,$4,true)", [base.id, result.mode, JSON.stringify(payload), JSON.stringify(result.response)]);
      await tx.query("update suppliers set status = 'registered', sap_code = $1, sap_account_group = $2, is_update = false, rejection_reason = '', sap_lock = null, approved_data = data, approved_at = now(), updated_at = now() where id = $3", [result.vendorCode, accountGroup(base.data ?? {}), base.id]);
      await addEvent(tx, base.id, user.name, payload.mode === "create" ? "Creato in SAP" : "Aggiornato in SAP", `Codice fornitore ${result.vendorCode}${result.mode === "simulated" ? " (simulato)" : ""}`, true);
      const link = `${origin}/`;
      for (const x of [...(await buyersFor(tx, base)), ...(await financeUsers(tx))]) await sendMail(tx, { to: x.email, template: "vendor_created", supplierId: base.id, vars: { name: base.name, sapCode: result.vendorCode, link } });
      await sendMail(tx, { to: base.email, template: "sap_code", lang: langOf(base.data ?? {}), supplierId: base.id, vars: { name: base.name, sapCode: result.vendorCode, link } });
    });
  } finally { await release(); }
}
