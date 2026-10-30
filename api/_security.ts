// Eventi di sicurezza e controlli di configurazione, per il Manager.
import type { ReadinessCheck, SecurityEvent, User } from "../src/types.ts";
import { getPool } from "./_db.js";
import { HttpError } from "./_http.js";
import { aiConfigured, aiProvider } from "./_docai.js";

const must = (u: User) => {
  if (u.role !== "manager") throw new HttpError(403, "Solo il Manager vede il registro di sicurezza");
};

export async function listSecurityEvents(user: User, limit = 200): Promise<SecurityEvent[]> {
  must(user);
  const rows = (
    await getPool().query("select e.*, u.name from security_events e left join users u on u.id = e.user_id order by e.id desc limit $1", [
      Math.min(Math.max(limit, 1), 1000),
    ])
  ).rows;
  return rows.map(r => ({
    id: r.id,
    at: new Date(r.at).toISOString(),
    event: r.event,
    user: r.name ?? "",
    email: r.email,
    ip: r.ip ?? "",
    detail: r.detail,
  }));
}
export async function securityCsv(user: User): Promise<string> {
  const list = (await listSecurityEvents(user, 1000)).reverse();
  const q = (v: string) => `"${v.replace(/"/g, '""')}"`;
  return [
    "Data;Evento;Utente;Email;Indirizzo;Dettaglio",
    ...list.map(e => [e.at, e.event, e.user, e.email, e.ip, e.detail].map(q).join(";")),
  ].join("\r\n");
}

/** Cosa manca o è debole nella configurazione dell'ambiente: i valori non si leggono mai, si segnala solo se ci sono. */
export async function readiness(user: User): Promise<ReadinessCheck[]> {
  must(user);
  const env = (k: string) => !!process.env[k]?.trim();
  const out: ReadinessCheck[] = [];
  const add = (key: string, label: string, status: ReadinessCheck["status"], detail: string) => out.push({ key, label, status, detail });
  let managers = 0;
  try {
    managers = (await getPool().query("select count(*)::int as n from users where role = 'manager' and active")).rows[0].n;
    add("db", "Database", "ok", "Raggiungibile");
  } catch {
    add("db", "Database", "error", "Non raggiungibile");
  }
  add(
    "session",
    "Chiave delle sessioni (SESSION_SECRET)",
    env("SESSION_SECRET") ? "ok" : "warn",
    env("SESSION_SECRET") ? "Impostata" : "Non impostata: la chiave deriva dalla stringa del database. Impostane una dedicata e lunga",
  );
  add(
    "cron",
    "Controlli giornalieri (CRON_SECRET)",
    env("CRON_SECRET") ? "ok" : "warn",
    env("CRON_SECRET") ? "Impostata" : "Non impostata: promemoria, conservazione dati e solleciti non partono",
  );
  add(
    "blob",
    "Archivio documenti (Blob privato)",
    env("BLOB_STORE_ID") || env("BLOB_READ_WRITE_TOKEN") ? "ok" : "error",
    env("BLOB_STORE_ID") || env("BLOB_READ_WRITE_TOKEN") ? "Collegato" : "Non collegato: i file non si possono caricare",
  );
  add(
    "mail",
    "Email (Resend)",
    env("RESEND_API_KEY") && env("MAIL_FROM") ? "ok" : "warn",
    env("RESEND_API_KEY") && env("MAIL_FROM") ? "Configurata" : "Non configurata: le email vengono solo registrate, non inviate",
  );
  add(
    "app_url",
    "Indirizzo pubblico (APP_URL)",
    env("APP_URL") ? "ok" : "info",
    env("APP_URL") ? "Impostato" : "Non impostato: i link nelle email usano l'indirizzo della richiesta",
  );
  add(
    "sap",
    "Codici fornitore SAP",
    (process.env.SAP_MODE ?? "simulated") === "http" && env("SAP_ENDPOINT") ? "ok" : "warn",
    (process.env.SAP_MODE ?? "simulated") === "http" ? "Invio a SAP attivo" : "Modalità simulata: i codici fornitore sono fittizi",
  );
  add(
    "ingest",
    "Ricezione automatica file SAP",
    env("RDA_INGEST_SECRET") ? "ok" : "info",
    env("RDA_INGEST_SECRET") ? "Attiva" : "Non attiva: i file si caricano a mano",
  );
  add(
    "admin_env",
    "Credenziali iniziali (ADMIN_PASSWORD)",
    env("ADMIN_PASSWORD") ? "warn" : "ok",
    env("ADMIN_PASSWORD") ? "Ancora presente nell'ambiente: dopo il primo avvio va tolta" : "Rimossa",
  );
  add(
    "managers",
    "Manager attivi",
    managers >= 2 ? "ok" : "warn",
    managers >= 2 ? `${managers} Manager attivi` : "Un solo Manager: se perde l'accesso nessuno può amministrare",
  );
  add(
    "demo",
    "Strumenti di prova",
    process.env.DISABLE_DEMO_TOOLS === "1" ? "ok" : "warn",
    process.env.DISABLE_DEMO_TOOLS === "1"
      ? "Disattivati"
      : "Attivi (accessi di prova, simulazione, fornitori di prova): prima dell'uso reale impostare DISABLE_DEMO_TOOLS=1",
  );
  const ssoOn = env("OIDC_ISSUER") && env("OIDC_CLIENT_ID") && env("OIDC_CLIENT_SECRET"),
    ssoForced = process.env.SSO_ENFORCE === "1";
  add(
    "sso",
    "Accesso con account aziendale (SSO)",
    ssoOn && ssoForced ? "ok" : "info",
    !ssoOn
      ? "Non configurato: il personale interno entra con email e password"
      : ssoForced
        ? "Attivo e obbligatorio per il personale interno"
        : "Attivo ma facoltativo: la password interna resta valida (SSO_ENFORCE=1 per renderlo obbligatorio)",
  );
  add(
    "ai",
    "Controllo AI dei documenti fornitore",
    "info",
    aiConfigured() ? `Attivo (${aiProvider()}): i documenti dei fornitori vengono inviati al servizio esterno` : "Disattivato",
  );
  add(
    "vies",
    "Controllo partite IVA (VIES)",
    (process.env.VIES_MODE ?? "live") === "off" ? "warn" : "ok",
    (process.env.VIES_MODE ?? "live") === "off" ? "Disattivato" : "Attivo",
  );
  return out;
}
