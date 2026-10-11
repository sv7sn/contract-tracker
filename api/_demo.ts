// Fornitore di prova: già registrato e in regola su tutto, per provare contratti, acquisti e rinnovi senza fare l'intero onboarding.
import { randomBytes, randomUUID } from "node:crypto";
import { put } from "@vercel/blob";
import type { SupplierData, User } from "../src/types.ts";
import { hashPassword } from "./_crypto.js";
import { getPool, inTransaction } from "./_db.js";
import { loadCatalog } from "./_docs.js";
import { HttpError } from "./_http.js";
import { accountGroup, resolveDocTypes } from "./_supplier-rules.js";

/** Partita IVA italiana con cifra di controllo corretta. */
function vatIT(): string {
  const d = Array.from({ length: 10 }, (_, i) => (i === 0 ? 1 + Math.floor(Math.random() * 9) : Math.floor(Math.random() * 10)));
  let s = 0;
  d.forEach((x, i) => { if (i % 2 === 0) s += x; else { const y = x * 2; s += y > 9 ? y - 9 : y; } });
  return d.join("") + String((10 - (s % 10)) % 10);
}
/** IBAN italiano con codici di controllo corretti (CIN e check digits). */
function ibanIT(): string {
  const abi = "05428", cab = "11101", acc = String(Math.floor(Math.random() * 1e12)).padStart(12, "0");
  const odd = [1, 0, 5, 7, 9, 13, 15, 17, 19, 21, 2, 4, 18, 20, 11, 3, 6, 8, 12, 14, 16, 10, 22, 25, 24, 23];
  const val = (c: string) => (/\d/.test(c) ? Number(c) : c.charCodeAt(0) - 65);
  const body = abi + cab + acc;
  let sum = 0;
  for (let i = 0; i < body.length; i++) sum += i % 2 === 0 ? odd[val(body[i])] : val(body[i]);
  const bban = String.fromCharCode(65 + (sum % 26)) + body;
  const num = (bban + "IT00").replace(/[A-Z]/g, c => String(c.charCodeAt(0) - 55));
  let m = 0; for (const ch of num) m = (m * 10 + Number(ch)) % 97;
  return `IT${String(98 - m).padStart(2, "0")}${bban}`;
}
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");

export async function createDemoSupplier(user: User, opts: { name?: string; sapCode?: string } = {}): Promise<{ id: number; name: string; email: string; password: string }> {
  if (user.role !== "manager") throw new HttpError(403, "Solo il Manager crea fornitori di prova");
  const db = getPool();
  const company = (await db.query("select code from buying_companies order by code limit 1")).rows[0]?.code as string | undefined;
  const industry = (await db.query("select code from industry_codes order by code limit 1")).rows[0]?.code as string | undefined;
  if (!company || !industry) throw new HttpError(409, "Configura prima almeno una società acquirente e un codice merceologico (Amministrazione → Configurazione)");
  const terms = (await db.query("select code from payment_terms order by code limit 1")).rows[0]?.code ?? null;
  const buyer = (await db.query("select user_id from industry_buyers where industry_code = $1 limit 1", [industry])).rows[0]?.user_id ?? user.id;
  const n = (await db.query("select count(*)::int + 1 as n from suppliers where name like 'Fornitore di Prova%'")).rows[0].n as number;
  const name = opts.name ?? `Fornitore di Prova ${n} Srl`, vat = vatIT(), tag = randomBytes(3).toString("hex");
  const email = `prova-${tag}@example.com`, now = new Date().toISOString();
  const data: SupplierData = {
    company: { legalName: name, vatCode: vat, fiscalCode: vat },
    address: { street: "Via Roma", houseNumber: "1", postalCode: "20121", city: "Milano", region: "MI", country: "IT" },
    payment: { iban: ibanIT(), swift: "BCITITMM", bankName: "Banca di Prova", accountNumber: String(Math.floor(Math.random() * 1e8)), currency: "EUR", withholdingTax: false },
    contacts: { language: "IT", ordersEmail: `ordini-${tag}@example.com`, adminEmail: `amministrazione-${tag}@example.com`, phone: "+39 02 0000000" },
    declarations: { conflictOfInterest: false, noSanctions: true, privacyAccepted: true, privacyAcceptedAt: now },
    acceptedTerms: true,
  };
  // Un documento valido per ogni tipo previsto (obbligatorio o facoltativo), con scadenza tra un anno dove serve.
  const cat = await loadCatalog(db);
  const docTypes = resolveDocTypes(cat.types, cat.rules, "IT", industry);
  const validUntil = new Date(Date.now() + 365 * 864e5).toISOString().slice(0, 10);
  const files: { type: string; name: string; path: string; expires: boolean }[] = [];
  for (const t of docTypes) {
    const path = `suppliers/${randomUUID()}/${t.key}.pdf`;
    await put(path, PDF, { access: "private", contentType: "application/pdf", addRandomSuffix: false });
    files.push({ type: t.key, name: `${t.label} (prova).pdf`, path, expires: t.expires });
  }
  const password = `Prova-${randomBytes(4).toString("hex")}!`;
  const hash = await hashPassword(password);
  const id = await inTransaction(async tx => {
    const u = (await tx.query("insert into users (email, name, role, title, password_hash) values ($1,$2,'supplier','Fornitore',$3) returning id", [email, name, hash])).rows[0].id;
    const compliance = {
      checkedAt: now,
      vies: { status: "ok", detail: "Fornitore di prova: partita IVA formalmente corretta, non verificata su VIES" },
      sanctions: { status: "ok", detail: "Fornitore di prova: nessuna corrispondenza" },
      company: { status: "ok", detail: "Fornitore di prova: azienda attiva", facts: {}, source: "prova" },
    };
    const sid = (await tx.query(`insert into suppliers (email, name, company_codes, industry_code, reference_buyer_id, status, data, payment_terms, sap_code, sap_account_group,
        user_id, invited_by, submitted_at, approved_data, approved_at, compliance, lifecycle)
      values ($1,$2,$3,$4,$5,'registered',$6,$7,$8,$9,$10,$11,now(),$6,now(),$12,'active') returning id`,
      [email, name, [company], industry, buyer, JSON.stringify(data), terms, opts.sapCode ?? `PROVA${String(n).padStart(4, "0")}`, accountGroup(data), u, user.id, JSON.stringify(compliance)])).rows[0].id as number;
    for (const f of files)
      await tx.query("insert into supplier_documents (supplier_id, type, file_name, file_path, size, valid_until, uploaded_by) values ($1,$2,$3,$4,$5,$6,$7)", [sid, f.type, f.name, f.path, PDF.length, f.expires ? validUntil : null, user.name]);
    await tx.query("insert into supplier_events (supplier_id, actor, action, detail) values ($1,$2,'Fornitore di prova creato',$3)", [sid, user.name, "Registrato direttamente, con dati e documenti di prova, per provare le funzionalità"]);
    return sid;
  });
  return { id, name, email, password };
}

/** I fornitori di prova (creati col pulsante o dalla simulazione), riconoscibili da nome o codice SAP. */
export const isTestSupplier = (name: string, sapCode: string | null) => /^Fornitore di Prova/i.test(name) || /^(PROVA|SIMV)/.test(sapCode ?? "");

/** Nuova password per l'accesso di un fornitore di prova, per vedere l'area fornitore. Mai per i fornitori veri. */
export async function resetTestSupplierAccess(user: User, supplierId: number): Promise<{ email: string; password: string }> {
  if (user.role !== "manager") throw new HttpError(403, "Solo il Manager genera l'accesso di prova");
  const db = getPool();
  const s = (await db.query("select s.name, s.sap_code, u.id as uid, u.email from suppliers s left join users u on u.id = s.user_id and u.role = 'supplier' where s.id = $1", [supplierId])).rows[0];
  if (!s) throw new HttpError(404, "Fornitore non trovato");
  if (!isTestSupplier(s.name, s.sap_code)) throw new HttpError(403, "L'accesso si può generare solo per i fornitori di prova: per quelli veri il fornitore imposta la password dal suo invito");
  if (!s.uid) throw new HttpError(409, "Questo fornitore non ha ancora un accesso");
  const password = `Prova-${randomBytes(4).toString("hex")}!`;
  await db.query("update users set password_hash = $1 where id = $2", [await hashPassword(password), s.uid]);
  await db.query("insert into config_audit (actor, area, action, subject, detail) values ($1,'user','update',$2,'Accesso di prova generato')", [user.name, s.email]);
  return { email: s.email as string, password };
}

// ─── Accessi di prova per ruolo ──────────────────────────────
export interface TestAccess { role: string; label: string; name: string; email: string; password: string }
const TEST_USERS = [
  { role: "buyer", label: "Buyer", name: "Prova Buyer", email: "prova.buyer@procurementlab.test", sap: "" },
  { role: "bo", label: "Business Owner / Richiedente", name: "Prova Business Owner", email: "prova.bo@procurementlab.test", sap: "PROVA" },
  { role: "viewer", label: "Controlling / CFO (sola lettura)", name: "Prova Controlling", email: "prova.controlling@procurementlab.test", sap: "" },
  { role: "finance", label: "Finance", name: "Prova Finance", email: "prova.finance@procurementlab.test", sap: "" },
] as const;

/** Un utente di prova per ogni ruolo (password nuova a ogni chiamata, mostrata una sola volta), più l'accesso di un fornitore di prova. */
export async function createTestAccesses(user: User): Promise<TestAccess[]> {
  if (user.role !== "manager") throw new HttpError(403, "Solo il Manager crea gli accessi di prova");
  const db = getPool(), out: TestAccess[] = [], ids: Record<string, number> = {};
  for (const t of TEST_USERS) {
    const password = `Prova-${randomBytes(5).toString("hex")}!`, hash = await hashPassword(password);
    const ex = (await db.query("select id from users where lower(email) = $1", [t.email])).rows[0];
    if (ex) { await db.query("update users set password_hash = $2, active = true, role = $3, sap_user = $4 where id = $1", [ex.id, hash, t.role, t.sap]); ids[t.role] = ex.id; }
    else ids[t.role] = (await db.query("insert into users (email, name, role, title, password_hash, sap_user) values ($1,$2,$3,'Accesso di prova',$4,$5) returning id", [t.email, t.name, t.role, hash, t.sap])).rows[0].id;
    out.push({ role: t.role, label: t.label, name: t.name, email: t.email, password });
  }
  // Qualcosa da vedere subito: task senza responsabile al buyer; due contratti della simulazione, uno come owner e due come BO.
  await db.query("update tasks set assignee_id = $1, assignee_auto = false where id in (select id from tasks where status = 'open' and assignee_id is null order by due nulls last limit 4)", [ids.buyer]);
  await db.query("update contracts set owner = 'Prova Buyer', owner_id = $1 where id in (select id from contracts where category = 'Simulazione' and ceased = false order by id limit 1)", [ids.buyer]);
  await db.query("update contracts set bo_user_id = $1, bo_email = 'prova.bo@procurementlab.test' where id in (select id from contracts where category = 'Simulazione' and ceased = false and bo_user_id is null order by id desc limit 2)", [ids.bo]);
  // Fornitore di prova: se non c'è lo crea; in ogni caso password nuova.
  const rows = (await db.query("select s.id, s.name, s.sap_code from suppliers s join users u on u.id = s.user_id and u.role = 'supplier' order by s.id")).rows;
  const found = rows.find(r => isTestSupplier(r.name, r.sap_code));
  const sup = found ? { id: found.id as number, name: found.name as string } : await createDemoSupplier(user);
  const acc = await resetTestSupplierAccess(user, sup.id);
  out.push({ role: "supplier", label: "Fornitore", name: sup.name, email: acc.email, password: acc.password });
  await db.query("insert into config_audit (actor, area, action, subject, detail) values ($1,'user','create','accessi di prova','Accessi di prova generati per ogni ruolo')", [user.name]);
  return out;
}

/** Toglie gli utenti di prova: i loro task e contratti tornano senza responsabile. */
export async function removeTestAccesses(user: User): Promise<number> {
  if (user.role !== "manager") throw new HttpError(403, "Solo il Manager elimina gli accessi di prova");
  const db = getPool(), emails = TEST_USERS.map(t => t.email);
  const ids = (await db.query("select id from users where lower(email) = any($1)", [emails])).rows.map(r => r.id as number);
  if (!ids.length) return 0;
  await db.query("update tasks set assignee_id = null where assignee_id = any($1)", [ids]);
  await db.query("update contracts set owner_id = null where owner_id = any($1)", [ids]);
  await db.query("update contracts set bo_user_id = null, bo_email = '' where bo_user_id = any($1)", [ids]);
  let n = 0;
  for (const id of ids) {
    try { await db.query("delete from users where id = $1", [id]); n++; }
    catch { await db.query("update users set active = false, password_hash = 'x' where id = $1", [id]); n++; }
  }
  await db.query("insert into config_audit (actor, area, action, subject, detail) values ($1,'user','delete','accessi di prova',$2)", [user.name, `Eliminati ${n} accessi di prova`]);
  return n;
}
