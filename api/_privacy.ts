// Privacy: testo dell'informativa, tempi di conservazione, export dei dati e anonimizzazione dei fornitori.
import type { PrivacySettings, User } from "../src/types.ts";
import { getPool, inTransaction, type Queryable } from "./_db.js";
import { HttpError } from "./_http.js";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const bad = (msg: string): never => { throw new HttpError(400, msg); };

export const DEFAULT_NOTICE = "I dati di contatto e i documenti caricati sono trattati solo per la qualifica e la gestione del rapporto di fornitura, " +
  "conservati per la durata del rapporto e degli obblighi di legge, e accessibili solo al personale acquisti e amministrazione autorizzato. " +
  "Puoi chiederne in ogni momento accesso, rettifica o cancellazione al Buyer di riferimento.";
const DEFAULTS: PrivacySettings = { notice: DEFAULT_NOTICE, inviteDays: 90, retentionMonths: 24 };

export async function loadPrivacy(db: Queryable): Promise<PrivacySettings> {
  const v = (await db.query("select value from settings where key = 'privacy'")).rows[0]?.value as Partial<PrivacySettings> | undefined;
  return {
    notice: v?.notice?.trim() || DEFAULTS.notice,
    inviteDays: Number.isInteger(v?.inviteDays) && v!.inviteDays! > 0 ? v!.inviteDays! : DEFAULTS.inviteDays,
    retentionMonths: Number.isInteger(v?.retentionMonths) && v!.retentionMonths! > 0 ? v!.retentionMonths! : DEFAULTS.retentionMonths,
  };
}

export async function savePrivacy(item: Row): Promise<void> {
  const cur = await loadPrivacy(getPool());
  const notice = typeof item?.notice === "string" ? item.notice.trim().slice(0, 4000) : cur.notice;
  if (notice.length < 40) bad("Il testo dell'informativa è troppo breve");
  const inviteDays = item?.inviteDays === undefined ? cur.inviteDays : Number(item.inviteDays);
  if (!Number.isInteger(inviteDays) || inviteDays < 7 || inviteDays > 730) bad("Inviti non attivati: indica tra 7 e 730 giorni");
  const retentionMonths = item?.retentionMonths === undefined ? cur.retentionMonths : Number(item.retentionMonths);
  if (!Number.isInteger(retentionMonths) || retentionMonths < 1 || retentionMonths > 240) bad("Conservazione: indica tra 1 e 240 mesi");
  await getPool().query("insert into settings (key, value) values ('privacy', $1) on conflict (key) do update set value = excluded.value", [JSON.stringify({ notice, inviteDays, retentionMonths })]);
}

/** Tutti i dati di un fornitore in un unico file (diritto di accesso / portabilità). */
export async function exportSupplier(db: Queryable, id: number): Promise<Row> {
  const s = (await db.query("select * from suppliers where id = $1", [id])).rows[0];
  if (!s) throw new HttpError(404, "Fornitore non trovato");
  const docs = (await db.query("select type, file_name, size, valid_until, uploaded_at, uploaded_by from supplier_documents where supplier_id = $1 order by id", [id])).rows;
  const events = (await db.query("select at, actor, action, detail from supplier_events where supplier_id = $1 order by id", [id])).rows;
  return {
    exportedAt: new Date().toISOString(),
    supplier: { name: s.name, email: s.email, status: s.status, lifecycle: s.lifecycle, sapCode: s.sap_code, companyCodes: s.company_codes, industryCode: s.industry_code, paymentTerms: s.payment_terms, createdAt: s.created_at, submittedAt: s.submitted_at },
    data: s.data, documents: docs, history: events,
  };
}

/** Rimuove i dati personali di un fornitore: contatti, indirizzo, documenti e account. Restano ragione sociale, P.IVA e IBAN per il controllo dei doppioni. */
async function anonymize(db: Queryable, id: number, actor: string, reason: string): Promise<string[]> {
  const s = (await db.query("select * from suppliers where id = $1 for update", [id])).rows[0];
  if (!s) throw new HttpError(404, "Fornitore non trovato");
  const d = s.data ?? {};
  const keep = { company: d.company ?? {}, payment: d.payment?.iban ? { iban: d.payment.iban } : {} };
  const files = (await db.query("delete from supplier_documents where supplier_id = $1 returning file_path", [id])).rows.map(r => r.file_path as string);
  await db.query(`update suppliers set email = $2, data = $3, approved_data = null, token_hash = null, token_expires = null, user_id = null, anonymized_at = now(), updated_at = now() where id = $1`,
    [id, `anonimizzato-${id}@invalid`, JSON.stringify(keep)]);
  if (s.user_id) await db.query("delete from users where id = $1 and role = 'supplier'", [s.user_id]);
  await db.query("update supplier_events set detail = '' where supplier_id = $1", [id]);
  await db.query("insert into supplier_events (supplier_id, actor, action, detail) values ($1,$2,'Dati personali anonimizzati',$3)", [id, actor, reason]);
  return files;
}

export async function anonymizeSupplier(user: User, id: number, reason: string): Promise<string[]> {
  if (user.role !== "manager") throw new HttpError(403, "Solo il Manager può anonimizzare un fornitore");
  if (reason.trim().length < 5) bad("Indica il motivo (es. richiesta di cancellazione del fornitore)");
  return inTransaction(async db => {
    const s = (await db.query("select status, lifecycle, anonymized_at from suppliers where id = $1", [id])).rows[0];
    if (!s) throw new HttpError(404, "Fornitore non trovato");
    if (s.anonymized_at) bad("Fornitore già anonimizzato");
    if (s.status === "registered" && s.lifecycle === "active") throw new HttpError(409, "Il fornitore è attivo: prima disattivalo o escludilo");
    return anonymize(db, id, user.name, reason.trim().slice(0, 500));
  });
}

/** Pulizia periodica: inviti mai attivati e fornitori non più attivi oltre il periodo di conservazione. */
export async function runRetention(): Promise<{ invitesDeleted: number; anonymized: number; staleFiles: string[] }> {
  const db = getPool();
  const p = await loadPrivacy(db);
  const inv = await db.query("delete from suppliers where status = 'invited' and created_at < now() - make_interval(days => $1)", [p.inviteDays]);
  const old = (await db.query(`select id from suppliers where anonymized_at is null and updated_at < now() - make_interval(months => $1)
    and (lifecycle in ('inactive','excluded') or status in ('rejected','draft'))`, [p.retentionMonths])).rows;
  const staleFiles: string[] = [];
  for (const r of old) staleFiles.push(...await inTransaction(tx => anonymize(tx, r.id, "Sistema", `Conservazione scaduta (${p.retentionMonths} mesi senza attività)`)));
  return { invitesDeleted: inv.rowCount ?? 0, anonymized: old.length, staleFiles };
}
