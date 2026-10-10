// Registro delle modifiche a regole e configurazione: chi ha cambiato cosa, quando, e i valori prima e dopo.
import type { ConfigAuditEntry, PortalConfig, User } from "../src/types.ts";
import { getPool, type Queryable } from "./_db.js";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export const AREA_LABEL: Record<string, string> = {
  company: "Società", industry: "Codici merceologici", payment_term: "Condizioni di pagamento", sap: "Parametri SAP",
  doc_type: "Documenti di qualifica", reminders: "Reminder documenti", rda: "Regole RDA", pgr: "Gruppi di acquisto",
  privacy: "Privacy", user: "Utenti", category: "Categorie",
};
const FIELD_LABEL: Record<string, string> = {
  name: "Nome", label: "Descrizione", sapCompanyCode: "Società SAP", purchOrg: "Org. acquisti", buyerIds: "Buyer", help: "Istruzioni",
  expires: "Ha scadenza", multiple: "Più file", rules: "Regole", enabled: "Attivo", days: "Giorni prima della scadenza", repeatDays: "Ripeti ogni (giorni)",
  escalateAfter: "Escalation dopo", slaDays: "Giorni di lavorazione", sourcingThreshold: "Soglia confronto fornitori", renewalLeadDays: "Anticipo task di rinnovo (giorni)", userId: "Buyer", note: "Nota",
  tradingPartner: "Trading partner", sortKey: "Chiave di ordinamento", cashManagementGroup: "Gruppo cash management", releaseGroup: "Gruppo di rilascio",
  reconciliationAccounts: "Conti di riconciliazione", role: "Ruolo", title: "Titolo", active: "Attivo", email: "Email",
  notice: "Testo informativa", inviteDays: "Inviti non attivati (giorni)", retentionMonths: "Conservazione fornitori non attivi (mesi)",
};

const show = (v: unknown): string => {
  if (v === undefined || v === null || v === "") return "—";
  if (typeof v === "boolean") return v ? "sì" : "no";
  if (typeof v === "string") return v.length > 80 ? `${v.slice(0, 77)}…` : v;
  return JSON.stringify(v).slice(0, 120);
};

/** Elenco leggibile dei campi cambiati tra due versioni di un elemento. */
export function describeDiff(before: Row | null, after: Row | null): string {
  if (!before && after) return "Creato";
  if (before && !after) return "Eliminato";
  if (!before || !after) return "";
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(k => k !== "id" && k !== "openTasks");
  return keys.filter(k => JSON.stringify(before[k]) !== JSON.stringify(after[k]))
    .map(k => `${FIELD_LABEL[k] ?? k}: ${show(before[k])} → ${show(after[k])}`).join("; ");
}

/** Estrae dalla configurazione l'elemento toccato da una modifica (per confrontare prima e dopo). */
function pick(cfg: PortalConfig & { privacy?: unknown }, entity: string, item: Row): { subject: string; value: Row | null } {
  const key = String(item?.code ?? item?.key ?? item?.pgr ?? "");
  switch (entity) {
    case "company": return { subject: key, value: cfg.companies.find(c => c.code === key) ?? null };
    case "industry": return { subject: key, value: cfg.industryCodes.find(c => c.code === key) ?? null };
    case "payment_term": return { subject: key, value: cfg.paymentTerms.find(c => c.code === key) ?? null };
    case "doc_type": {
      const t = cfg.docTypes.find(d => d.key === key);
      return { subject: key, value: t ? { ...t, rules: cfg.docRules.filter(r => r.docType === key).map(r => `${r.scope}${r.value ? `=${r.value}` : ""}:${r.level}`) } : null };
    }
    case "pgr": { const g = cfg.rda.groups.find(x => x.pgr === key); return { subject: key, value: g ? { userId: g.userId, note: g.note } : null }; }
    case "rda": return { subject: "", value: { slaDays: cfg.rda.slaDays, sourcingThreshold: cfg.rda.sourcingThreshold, renewalLeadDays: cfg.rda.renewalLeadDays } };
    case "sap": return { subject: "", value: cfg.sap as unknown as Row };
    case "reminders": return { subject: "", value: cfg.reminders as unknown as Row };
    case "privacy": return { subject: "", value: (cfg.privacy ?? null) as Row | null };
    default: return { subject: key, value: null };
  }
}

export async function logChange(db: Queryable, actor: User, area: string, action: string, subject: string, before: Row | null, after: Row | null): Promise<void> {
  const detail = describeDiff(before, after);
  if (!detail) return; // nessuna modifica effettiva
  await db.query("insert into config_audit (actor, area, action, subject, detail, before, after) values ($1,$2,$3,$4,$5,$6,$7)",
    [actor.name, area, action, subject.slice(0, 120), detail.slice(0, 4000), before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null]);
}

/** Registra una modifica di configurazione confrontando la configurazione prima e dopo il salvataggio. */
export async function logConfigChange(actor: User, entity: string, action: string, item: Row, before: PortalConfig, after: PortalConfig): Promise<void> {
  const b = pick(before, entity, item), a = pick(after, entity, item);
  await logChange(getPool(), actor, entity, action === "delete" ? "delete" : b.value ? "update" : "create", a.subject || b.subject, b.value, a.value);
}

export async function listConfigAudit(limit = 200): Promise<ConfigAuditEntry[]> {
  const rows = (await getPool().query("select * from config_audit order by id desc limit $1", [limit])).rows;
  return rows.map(r => ({ id: r.id, at: new Date(r.at).toISOString(), actor: r.actor, area: r.area, areaLabel: AREA_LABEL[r.area] ?? r.area, action: r.action, subject: r.subject, detail: r.detail }));
}
