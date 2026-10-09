import type { AiStatus, DocRule, DocTypeDef, MonitorData, MonitorItem, MonitorState, PortalConfig, ReminderPolicy, User } from "../src/types.ts";
import { getPool, inTransaction, type Queryable } from "./_db.js";
import { HttpError } from "./_http.js";
import { sendMail, type Lang } from "./_notify.js";
import { visibleWhere } from "./_access.js";
import { COUNTRIES, docValidity, resolveDocTypes } from "./_supplier-rules.js";
import { aiConfigured, aiProvider } from "./_docai.js";

const bad = (msg: string): never => { throw new HttpError(400, msg); };
const str = (v: unknown, max = 300) => (typeof v === "string" ? v.trim().slice(0, max) : "");
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const DAY = 864e5;
const day = (d: unknown) => (d ? new Date(d as string).toISOString().slice(0, 10) : null);

// ─── Catalogo documenti e regole ─────────────────────────────
export async function loadCatalog(db: Queryable): Promise<{ types: DocTypeDef[]; rules: DocRule[] }> {
  const [t, r] = await Promise.all([db.query("select * from doc_types order by position, label"), db.query("select * from doc_rules order by id")]);
  return {
    types: t.rows.map(x => ({ key: x.key, label: x.label, help: x.help, expires: x.expires, multiple: x.multiple })),
    rules: r.rows.map(x => ({ docType: x.doc_type, scope: x.scope, value: x.value, level: x.level })),
  };
}

const KEY_RE = /^[a-z0-9_]{2,40}$/;
export async function saveDocType(action: string, item: Row): Promise<void> {
  const key = str(item?.key, 40);
  if (!KEY_RE.test(key)) bad("Codice non valido: usa lettere minuscole, numeri e _ (2-40 caratteri)");
  if (action === "delete") {
    const used = (await getPool().query("select count(*)::int as n from supplier_documents where type = $1", [key])).rows[0].n;
    if (used > 0) throw new HttpError(409, `Ci sono ${used} documenti caricati di questo tipo: per non chiederlo più togli le regole invece di eliminarlo`);
    await getPool().query("delete from doc_types where key = $1", [key]);
    return;
  }
  const label = str(item?.label, 120); if (!label) bad("Il nome del documento è obbligatorio");
  const rules: DocRule[] = [];
  for (const r of Array.isArray(item?.rules) ? item.rules : []) {
    const scope = r?.scope, level = r?.level, value = scope === "all" ? "" : str(r?.value, 20);
    if (!["all", "country", "industry"].includes(scope) || !["required", "optional"].includes(level)) bad("Regola non valida");
    if (scope === "country" && !COUNTRIES.some(c => c.code === value)) bad("Paese non valido in una regola");
    if (scope === "industry" && !(await getPool().query("select 1 from industry_codes where code = $1", [value])).rows.length) bad("Codice merceologico non valido in una regola");
    if (!rules.some(x => x.scope === scope && x.value === value)) rules.push({ docType: key, scope, value, level });
  }
  await inTransaction(async tx => {
    const pos = (await tx.query("select coalesce(max(position), -1) + 1 as p from doc_types")).rows[0].p;
    await tx.query(`insert into doc_types (key, label, help, expires, multiple, position) values ($1,$2,$3,$4,$5,$6)
      on conflict (key) do update set label = excluded.label, help = excluded.help, expires = excluded.expires, multiple = excluded.multiple`,
      [key, label, str(item?.help, 400), !!item?.expires, !!item?.multiple, pos]);
    await tx.query("delete from doc_rules where doc_type = $1", [key]);
    for (const r of rules) await tx.query("insert into doc_rules (doc_type, scope, value, level) values ($1,$2,$3,$4)", [key, r.scope, r.value, r.level]);
  });
}

// ─── Politica dei reminder ───────────────────────────────────
const DEFAULT_POLICY: ReminderPolicy = { enabled: true, days: [60, 30, 15], repeatDays: 7, escalateAfter: 2 };
export async function loadPolicy(db: Queryable): Promise<ReminderPolicy> {
  const v = (await db.query("select value from settings where key = 'reminders'")).rows[0]?.value as Partial<ReminderPolicy> | undefined;
  return { ...DEFAULT_POLICY, ...(v ?? {}) };
}
export async function savePolicy(item: Row): Promise<void> {
  const days = [...new Set((Array.isArray(item?.days) ? item.days : []).map(Number).filter((n: number) => Number.isInteger(n) && n >= 1 && n <= 365))].sort((a, b) => (b as number) - (a as number)) as number[];
  if (!days.length || days.length > 6) bad("Indica da 1 a 6 scadenze, in giorni (es. 60, 30, 15)");
  const repeatDays = Number(item?.repeatDays), escalateAfter = Number(item?.escalateAfter);
  if (!Number.isInteger(repeatDays) || repeatDays < 1 || repeatDays > 60) bad("La ripetizione deve essere tra 1 e 60 giorni");
  if (!Number.isInteger(escalateAfter) || escalateAfter < 1 || escalateAfter > 10) bad("Il numero di solleciti deve essere tra 1 e 10");
  await getPool().query("insert into settings (key, value) values ('reminders', $1) on conflict (key) do update set value = excluded.value", [JSON.stringify({ enabled: !!item?.enabled, days, repeatDays, escalateAfter })]);
}

export const emailConfigured = () => !!(process.env.RESEND_API_KEY && process.env.MAIL_FROM);
export function docConfig(c: { types: DocTypeDef[]; rules: DocRule[] }, policy: ReminderPolicy): Pick<PortalConfig, "docTypes" | "docRules" | "reminders" | "emailConfigured" | "ai"> {
  return { docTypes: c.types, docRules: c.rules, reminders: policy, emailConfigured: emailConfigured(), ai: { provider: aiProvider(), configured: aiConfigured() } };
}

// ─── Stato dei documenti di tutti i fornitori ────────────────
/** Un documento richiede un intervento se è scaduto, mancante o sta per scadere entro l'ultima soglia di reminder. */
const needsAction = (i: MonitorItem, p: ReminderPolicy) => i.state === "expired" || i.state === "missing" || (i.state === "expiring" && i.daysLeft !== null && i.daysLeft <= Math.min(...p.days));

interface Outstanding { supplier: Row; item: MonitorItem }

/** Elenco di tutti i documenti richiesti/caricati dei fornitori registrati, con stato, solleciti e segnalazione "non risponde". */
async function collect(db: Queryable, whereSql: string, policy: ReminderPolicy, now = new Date()): Promise<Outstanding[]> {
  const cat = await loadCatalog(db);
  const suppliers = (await db.query(`select s.*, rb.name as reference_buyer_name from suppliers s left join users rb on rb.id = s.reference_buyer_id where s.status = 'registered' and ${whereSql} order by s.name`)).rows;
  if (!suppliers.length) return [];
  const ids = suppliers.map(s => s.id);
  const docs = (await db.query("select * from supplier_documents where supplier_id = any($1) order by id", [ids])).rows;
  const rem = (await db.query("select * from doc_reminders where supplier_id = any($1) and channel <> 'alert' order by sent_at", [ids])).rows;
  const labels = new Map(cat.types.map(t => [t.key, t.label]));
  const out: Outstanding[] = [];
  const today = new Date(now.toISOString().slice(0, 10));
  for (const s of suppliers) {
    const resolved = resolveDocTypes(cat.types, cat.rules, s.data?.address?.country, s.industry_code);
    const sdocs = docs.filter(d => d.supplier_id === s.id);
    const push = (type: string, d: Row | null, required: boolean) => {
      const valid = d?.valid_until ? day(d.valid_until) : null;
      const left = valid ? Math.round((new Date(valid).getTime() - today.getTime()) / DAY) : null;
      const v = docValidity(valid, now);
      const state: MonitorState = !d ? "missing" : v === "expired" ? "expired" : v === "expiring" ? "expiring" : "valid";
      const rs = rem.filter(r => r.supplier_id === s.id && r.doc_type === type && (r.doc_id ?? null) === (d?.id ?? null));
      const last = rs[rs.length - 1];
      out.push({ supplier: s, item: {
        key: `${s.id}:${type}:${d?.id ?? "x"}`, supplierId: s.id, supplierName: s.data?.company?.legalName || s.name, buyerName: s.reference_buyer_name ?? "",
        docType: type, docLabel: labels.get(type) ?? type, docId: d?.id ?? null, fileName: d?.file_name ?? "", validUntil: valid, daysLeft: left, state, required,
        reminders: rs.length, lastReminderAt: last ? new Date(last.sent_at).toISOString() : null, lastChannel: last?.channel ?? null,
        unresponsive: false, ai: (d?.ai_status ?? null) as AiStatus | null,
      } });
      const it = out[out.length - 1].item; it.unresponsive = needsAction(it, policy) && it.reminders >= policy.escalateAfter;
    };
    for (const t of resolved) {
      const mine = sdocs.filter(d => d.type === t.key);
      if (!mine.length) { if (t.required) push(t.key, null, true); continue; }
      for (const d of mine) push(t.key, d, t.required);
      // Un documento obbligatorio con solo copie scadute: oltre alla riga "scaduto" non serve altro.
    }
    // Documenti caricati di tipi non più richiesti: restano visibili se hanno una scadenza.
    for (const d of sdocs.filter(x => !resolved.some(t => t.key === x.type))) push(d.type, d, false);
  }
  return out;
}

export async function monitorData(user: User): Promise<MonitorData> {
  const db = getPool();
  const policy = await loadPolicy(db);
  const items = (await collect(db, visibleWhere(user), policy)).map(o => o.item);
  const last = (await db.query("select value from settings where key = 'reminders_last_run'")).rows[0]?.value as { at?: string } | undefined;
  return { items, policy, emailConfigured: emailConfigured(), lastRunAt: last?.at ?? null };
}

// ─── Invio dei reminder ──────────────────────────────────────
const fmt = (d: string) => new Date(d).toLocaleDateString("it-IT", { day: "2-digit", month: "long", year: "numeric" });
const describe = (i: MonitorItem, lang: Lang) => {
  const en = lang === "EN";
  const what = i.state === "missing" ? (en ? "missing" : "mancante") : i.state === "expired" ? (en ? `expired on ${i.validUntil}` : `scaduto il ${fmt(i.validUntil!)}`) : (en ? `expires on ${i.validUntil}` : `scade il ${fmt(i.validUntil!)}`);
  return `- ${i.docLabel}: ${what}`;
};

/** Quale stage di reminder è dovuto per un elemento (null = nessun invio oggi). */
export function dueStage(i: MonitorItem, policy: ReminderPolicy, history: { stage: string; at: Date }[], now: Date): string | null {
  const last = history[history.length - 1];
  const repeat = () => (!last || now.getTime() - last.at.getTime() >= policy.repeatDays * DAY ? true : false);
  if (i.state === "missing") return repeat() ? "missing" : null;
  if (i.state === "expired") return repeat() ? "expired" : null;
  if (i.state === "expiring" && i.daysLeft !== null) {
    const t = [...policy.days].sort((a, b) => a - b).find(d => i.daysLeft! <= d);
    if (t === undefined) return null;
    return history.some(h => h.stage === String(t)) ? null : String(t);
  }
  return null;
}

export interface RunResult { suppliers: number; emails: number; items: number; alerts: number }

/** Passa in rassegna i fornitori registrati e invia i reminder dovuti (un'email per fornitore). Chiamato ogni giorno dal cron. */
export async function runReminders(origin: string, now = new Date()): Promise<RunResult> {
  const db = getPool();
  const policy = await loadPolicy(db);
  const res: RunResult = { suppliers: 0, emails: 0, items: 0, alerts: 0 };
  await db.query("insert into settings (key, value) values ('reminders_last_run', $1) on conflict (key) do update set value = excluded.value", [JSON.stringify({ at: now.toISOString() })]);
  if (!policy.enabled) return res;
  const all = await collect(db, "true", policy, now);
  const bySupplier = new Map<number, Outstanding[]>();
  for (const o of all) { const l = bySupplier.get(o.supplier.id) ?? []; l.push(o); bySupplier.set(o.supplier.id, l); }
  for (const [sid, list] of bySupplier) {
    const s = list[0].supplier;
    const lang: Lang = s.data?.contacts?.language === "EN" ? "EN" : "IT";
    const due: { o: Outstanding; stage: string }[] = [];
    for (const o of list) {
      if (o.item.state === "valid") continue;
      const hist = (await db.query("select stage, sent_at from doc_reminders where supplier_id = $1 and doc_type = $2 and doc_id is not distinct from $3 and channel <> 'alert' order by sent_at", [sid, o.item.docType, o.item.docId])).rows.map(r => ({ stage: r.stage as string, at: new Date(r.sent_at) }));
      const stage = dueStage(o.item, policy, hist, now);
      if (stage) due.push({ o, stage });
    }
    if (due.length) {
      const status = await sendMail(db, { to: s.email, template: "doc_reminder", lang, supplierId: sid, vars: { name: s.name, link: `${origin}/`, items: due.map(d => describe(d.o.item, lang)).join("\n") } });
      for (const d of due) await db.query("insert into doc_reminders (supplier_id, doc_type, doc_id, stage, channel, kind, status) values ($1,$2,$3,$4,'email','auto',$5)", [sid, d.o.item.docType, d.o.item.docId, d.stage, status]);
      res.suppliers++; res.emails++; res.items += due.length;
    }
    // Avviso al buyer quando il fornitore non risponde (al massimo una volta ogni `repeatDays` giorni).
    const sentNow = new Set(due.map(d => d.o));
    const stuck = list.filter(o => needsAction(o.item, policy) && o.item.reminders + (sentNow.has(o) ? 1 : 0) >= policy.escalateAfter);
    if (stuck.length) {
      const recent = (await db.query("select 1 from doc_reminders where supplier_id = $1 and channel = 'alert' and sent_at > $2", [sid, new Date(now.getTime() - policy.repeatDays * DAY)])).rows.length;
      if (!recent) {
        const buyers = (await db.query("select distinct u.email from users u where u.active and u.role in ('buyer','manager') and (u.id = $1 or u.id in (select user_id from industry_buyers where industry_code = $2))", [s.reference_buyer_id, s.industry_code])).rows;
        const to = buyers.length ? buyers : (await db.query("select email from users where active and role = 'manager'")).rows;
        for (const b of to) await sendMail(db, { to: b.email, template: "doc_unresponsive", supplierId: sid, vars: { name: s.name, link: `${origin}/`, items: stuck.map(o => describe(o.item, "IT")).join("\n") } });
        await db.query("insert into doc_reminders (supplier_id, doc_type, stage, channel, kind) values ($1,'*','unresponsive','alert','auto')", [sid]);
        res.alerts++;
      }
    }
  }
  return res;
}

/** Sollecito manuale del Buyer: email al fornitore con tutti i documenti da sistemare, oppure registrazione di un contatto telefonico. */
export async function remindSupplier(user: User, supplierId: number, channel: "email" | "phone", note: string, origin: string): Promise<{ sent: number }> {
  if (user.role !== "manager" && user.role !== "buyer") throw new HttpError(403, "Operazione non consentita");
  const db = getPool();
  const policy = await loadPolicy(db);
  const items = (await collect(db, `s.id = ${Number(supplierId)} and ${visibleWhere(user)}`, policy)).filter(o => o.item.state !== "valid" && (o.item.state !== "expiring" || (o.item.daysLeft ?? 99) <= Math.max(...policy.days)));
  if (!items.length) throw new HttpError(400, "Nessun documento da sollecitare per questo fornitore");
  const s = items[0].supplier;
  if (channel === "phone" && note.trim().length < 3) bad("Scrivi una breve nota sul contatto (con chi hai parlato, cosa è stato concordato)");
  let status = "logged";
  if (channel === "email") {
    const lang: Lang = s.data?.contacts?.language === "EN" ? "EN" : "IT";
    status = await sendMail(db, { to: s.email, template: "doc_reminder", lang, supplierId: s.id, vars: { name: s.name, link: `${origin}/`, items: items.map(o => describe(o.item, lang)).join("\n") } });
  }
  for (const o of items) await db.query("insert into doc_reminders (supplier_id, doc_type, doc_id, stage, channel, kind, sent_by, status, note) values ($1,$2,$3,$4,$5,'manual',$6,$7,$8)", [s.id, o.item.docType, o.item.docId, channel === "phone" ? "phone" : "manual", channel, user.name, status, str(note, 500)]);
  await db.query("insert into supplier_events (supplier_id, actor, action, detail, public) values ($1,$2,$3,$4,false)", [s.id, user.name, channel === "email" ? "Sollecito documenti inviato" : "Contatto telefonico registrato", channel === "phone" ? str(note, 500) : items.map(o => o.item.docLabel).join(", ")]);
  return { sent: items.length };
}
