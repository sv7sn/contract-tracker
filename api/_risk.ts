// Rischio fornitori: livello alto/medio/basso con i motivi, e verifica periodica automatica dei fornitori registrati.
// Il livello è il peggiore tra le aree controllate (stato, situazione dell'azienda, partita IVA, sanzioni, documenti,
// valutazione dei buyer); una forte concentrazione della spesa porta un rischio medio ad alto.
// La verifica periodica ripete i controlli esterni con una frequenza che dipende dal livello e avvisa i buyer se qualcosa peggiora.
import type { Lifecycle, Qualification, RiskAssessment, RiskFactor, RiskLevel, RiskPolicy, SupplierStatus } from "../src/types.ts";
import { getPool, type Queryable } from "./_db.js";
import { HttpError } from "./_http.js";
import { sendMail } from "./_notify.js";
import { loadCatalog } from "./_docs.js";
import { resolveDocTypes } from "./_supplier-rules.js";
import { qualificationOf, runExternalChecks, type StoredCompliance } from "./_governance.js";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export const DEFAULT_RISK_POLICY: RiskPolicy = { enabled: true, days: { high: 30, medium: 90, low: 180 }, batch: 20 };
/** Quota della spesa degli ultimi 12 mesi oltre la quale la dipendenza dal fornitore è un fattore di rischio. */
export const CONCENTRATION_SHARE = 0.2;

export async function loadRiskPolicy(db: Queryable): Promise<RiskPolicy> {
  const v = (await db.query("select value from settings where key = 'risk_checks'")).rows[0]?.value as Partial<RiskPolicy> | undefined;
  return { ...DEFAULT_RISK_POLICY, ...(v ?? {}), days: { ...DEFAULT_RISK_POLICY.days, ...(v?.days ?? {}) } };
}
export async function saveRiskPolicy(item: Row): Promise<void> {
  const day = (v: unknown, def: number) => { const n = Number(v ?? def); if (!Number.isInteger(n) || n < 7 || n > 730) throw new HttpError(400, "La frequenza deve essere tra 7 e 730 giorni"); return n; };
  const batch = Number(item?.batch ?? DEFAULT_RISK_POLICY.batch);
  if (!Number.isInteger(batch) || batch < 1 || batch > 200) throw new HttpError(400, "Il numero di verifiche al giorno deve essere tra 1 e 200");
  const days = { high: day(item?.days?.high, 30), medium: day(item?.days?.medium, 90), low: day(item?.days?.low, 180) };
  if (!(days.high <= days.medium && days.medium <= days.low)) throw new HttpError(400, "I fornitori più a rischio vanno controllati più spesso: giorni alto ≤ medio ≤ basso");
  const next: RiskPolicy = { enabled: item?.enabled !== false, days, batch };
  await getPool().query("insert into settings (key, value) values ('risk_checks', $1) on conflict (key) do update set value = excluded.value", [JSON.stringify(next)]);
}

export interface RiskInput {
  status: SupplierStatus; lifecycle: Lifecycle; qualification: Qualification; compliance: StoredCompliance | null;
  rating: { overall: number; count: number } | null;
  /** Quota della spesa EUR degli ultimi 12 mesi (0–1), null se il fornitore non ha ordini o non ha codice SAP. */
  spendShare: number | null;
}

const ORDER: Record<RiskLevel, number> = { na: 0, low: 1, medium: 2, high: 3 };
const addDays = (iso: string, d: number) => new Date(new Date(iso).getTime() + d * 864e5).toISOString();

/** Valuta il rischio di un fornitore. Funzione pura: stessi dati, stesso risultato. */
export function assessRisk(x: RiskInput, policy: RiskPolicy = DEFAULT_RISK_POLICY): RiskAssessment {
  const c = x.compliance ?? {};
  const base = { checkedAt: c.checkedAt ?? null, worsenedAt: c.worsenedAt ?? null };
  if (x.status !== "registered" || x.lifecycle === "inactive") return { level: "na", factors: [], nextCheckAt: null, ...base };
  const f: RiskFactor[] = [];
  if (x.lifecycle === "blocked") f.push({ area: "lifecycle", level: "high", text: "Fornitore bloccato" });
  if (x.lifecycle === "excluded") f.push({ area: "lifecycle", level: "high", text: "Fornitore escluso" });
  if (c.company?.status === "fail") f.push({ area: "company", level: "high", text: "Situazione dell'azienda con criticità" });
  else if (c.company?.status === "warn") f.push({ area: "company", level: "medium", text: "Situazione dell'azienda da verificare" });
  if (c.vies?.status === "fail") f.push({ area: "vies", level: "high", text: "Partita IVA non valida (VIES)" });
  else if (c.vies?.status === "warn") f.push({ area: "vies", level: "medium", text: "Partita IVA da verificare (VIES)" });
  if (c.sanctions?.status === "fail") f.push({ area: "sanctions", level: "high", text: "Possibile corrispondenza nelle liste sanzioni" });
  else if (c.sanctions?.status === "warn") f.push({ area: "sanctions", level: "medium", text: "Liste sanzioni: corrispondenza da verificare" });
  if (x.qualification === "lapsed") f.push({ area: "documents", level: "high", text: "Documenti obbligatori scaduti o mancanti" });
  else if (x.qualification === "expiring") f.push({ area: "documents", level: "medium", text: "Documenti obbligatori in scadenza entro 30 giorni" });
  if (x.rating?.count) {
    if (x.rating.overall < 2.5) f.push({ area: "performance", level: "high", text: "Valutazione dei buyer bassa ({score}/5)", vars: { score: x.rating.overall } });
    else if (x.rating.overall < 3.5) f.push({ area: "performance", level: "medium", text: "Valutazione dei buyer sotto la sufficienza ({score}/5)", vars: { score: x.rating.overall } });
  }
  if (!c.checkedAt) f.push({ area: "unverified", level: "medium", text: "Controlli esterni mai eseguiti" });
  const concentrated = x.spendShare !== null && x.spendShare >= CONCENTRATION_SHARE;
  if (concentrated) f.push({ area: "dependency", level: "medium", text: "Concentrazione della spesa: {pct}% degli ordini degli ultimi 12 mesi", vars: { pct: Math.round((x.spendShare ?? 0) * 100) } });
  let level: RiskLevel = f.reduce<RiskLevel>((a, b) => (ORDER[b.level] > ORDER[a] ? b.level : a), "low");
  // Un fornitore da cui dipende molta spesa e con un'altra criticità media va trattato come rischio alto.
  if (level === "medium" && concentrated && f.some(x => x.area !== "dependency" && x.level === "medium")) level = "high";
  f.sort((a, b) => ORDER[b.level] - ORDER[a.level]);
  const nextCheckAt = c.checkedAt ? addDays(c.checkedAt, policy.days[level as "high" | "medium" | "low"]) : new Date().toISOString();
  return { level, factors: f, nextCheckAt, ...base };
}

/** Dati per la valutazione di più fornitori in una sola passata: valutazioni dei buyer e quota di spesa. */
async function context(db: Queryable): Promise<{ ratings: Map<number, { overall: number; count: number }>; share: Map<string, number> }> {
  const [r, s] = await Promise.all([
    db.query("select supplier_id, round(avg((quality + delivery + service + price) / 4.0)::numeric, 1)::float a, count(*)::int n from supplier_ratings where created_at > now() - interval '24 months' group by supplier_id"),
    db.query("select supplier_code, sum(value)::float v from po_lines where currency = 'EUR' and supplier_code <> '' and doc_date > current_date - interval '12 months' group by supplier_code"),
  ]);
  const total = s.rows.reduce((a, x) => a + (x.v > 0 ? x.v : 0), 0);
  return {
    ratings: new Map(r.rows.map(x => [x.supplier_id as number, { overall: x.a as number, count: x.n as number }])),
    share: new Map(total > 0 ? s.rows.map(x => [x.supplier_code as string, Math.max(0, x.v) / total]) : []),
  };
}

/** Livello di rischio per un elenco di fornitori già letti (righe della tabella suppliers, con la qualifica calcolata). */
export async function assessRows(db: Queryable, rows: (Row & { qualification: Qualification })[], policy?: RiskPolicy): Promise<Map<number, RiskAssessment>> {
  const ctx = await context(db), p = policy ?? await loadRiskPolicy(db);
  return new Map(rows.map(r => [r.id as number, assessRisk({
    status: r.status, lifecycle: r.lifecycle ?? "active", qualification: r.qualification, compliance: r.compliance ?? null,
    rating: ctx.ratings.get(r.id) ?? null, spendShare: r.sap_code ? ctx.share.get(r.sap_code) ?? null : null,
  }, p)]));
}

/** Fornitori registrati con la qualifica documentale calcolata: base della verifica periodica. */
async function registeredWithQualification(db: Queryable): Promise<(Row & { qualification: Qualification })[]> {
  const rows = (await db.query("select * from suppliers where status = 'registered' and anonymized_at is null and coalesce(lifecycle, 'active') <> 'inactive'")).rows;
  if (!rows.length) return [];
  const cat = await loadCatalog(db);
  const docs = (await db.query("select supplier_id, type, valid_until from supplier_documents where supplier_id = any($1)", [rows.map(r => r.id)])).rows;
  return rows.map(r => ({ ...r, qualification: qualificationOf(r.status, resolveDocTypes(cat.types, cat.rules, r.data?.address?.country, r.industry_code),
    docs.filter(d => d.supplier_id === r.id).map(d => ({ type: d.type, validUntil: d.valid_until ? new Date(d.valid_until).toISOString().slice(0, 10) : null }))) }));
}

/** Avvisa il buyer di riferimento e i buyer del codice merceologico (o i Manager) che un fornitore è peggiorato. */
export async function riskAlert(db: Queryable, supplierId: number, worsened: string[], origin: string, detail = ""): Promise<void> {
  const s = (await db.query("select id, name, reference_buyer_id, industry_code from suppliers where id = $1", [supplierId])).rows[0];
  if (!s || !worsened.length) return;
  await db.query("insert into supplier_events (supplier_id, actor, action, detail) values ($1,'Sistema','Verifica periodica: situazione peggiorata',$2)", [s.id, `${worsened.join(", ")}${detail ? ` — ${detail}` : ""}`.slice(0, 500)]);
  let to = (await db.query("select distinct u.email from users u where u.active and u.role in ('buyer','manager') and (u.id = $1 or u.id in (select user_id from industry_buyers where industry_code = $2))", [s.reference_buyer_id, s.industry_code])).rows;
  if (!to.length) to = (await db.query("select email from users where active and role = 'manager'")).rows;
  for (const u of to) await sendMail(db, { to: u.email, template: "risk_alert", supplierId: s.id, vars: { name: s.name, detail: worsened.join(", "), link: `${origin}/` } });
}

/** Verifica periodica: ricontrolla i fornitori registrati la cui verifica è scaduta, dai più a rischio. Un errore su un fornitore non ferma gli altri. */
export async function runRiskChecks(origin: string, opts: { force?: boolean } = {}): Promise<{ due: number; checked: number; worsened: number; errors: number }> {
  const db = getPool(), policy = await loadRiskPolicy(db);
  if (!policy.enabled && !opts.force) return { due: 0, checked: 0, worsened: 0, errors: 0 };
  const rows = await registeredWithQualification(db);
  const risk = await assessRows(db, rows, policy);
  const now = Date.now();
  const due = rows.filter(r => { const a = risk.get(r.id)!; return a.level !== "na" && (!a.nextCheckAt || new Date(a.nextCheckAt).getTime() <= now); })
    .sort((a, b) => ORDER[risk.get(b.id)!.level] - ORDER[risk.get(a.id)!.level] || String(risk.get(a.id)!.checkedAt ?? "").localeCompare(String(risk.get(b.id)!.checkedAt ?? "")));
  let checked = 0, worsened = 0, errors = 0;
  for (const r of due.slice(0, policy.batch)) {
    try {
      const res = await runExternalChecks(db, r.id, "periodic");
      checked++;
      if (res.worsened.length) { worsened++; await riskAlert(db, r.id, res.worsened, origin); }
    } catch (err) { errors++; console.error("Verifica periodica non riuscita", r.id, err); }
  }
  return { due: due.length, checked, worsened, errors };
}

