import { useEffect, useState } from "react";
import type { ReadinessCheck, SecurityEvent } from "../types.ts";
import { portalApi } from "../api.ts";
import { C, sans } from "../theme.ts";
import { Card, CardTitle } from "../components/ui.tsx";
import { AlertTriangle, CheckCircle2, Download, Info, ShieldCheck } from "../components/icons.tsx";
import { locale, t } from "../i18n/index.ts";

const EVENT: Record<string, string> = { login_ok: "Accesso", login_failed: "Accesso rifiutato", login_blocked: "Accesso bloccato (troppi tentativi)", password_changed: "Password cambiata", password_reset_by_admin: "Password reimpostata dal Manager", sessions_revoked: "Sessioni chiuse" };

/** Per il Manager: cosa manca nella configurazione dell'ambiente e gli ultimi eventi di sicurezza (accessi, password, sessioni). */
export function SecurityCard({ fail }: { fail: (e: unknown) => string }) {
  const [checks, setChecks] = useState<ReadinessCheck[] | null>(null);
  const [events, setEvents] = useState<SecurityEvent[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { portalApi.security.readiness().then(setChecks).catch(e => setErr(fail(e))); portalApi.security.events().then(setEvents).catch(() => setEvents([])); }, [fail]);
  const icon = (s: ReadinessCheck["status"]) => s === "ok" ? <CheckCircle2 size={15} color={C.green} /> : s === "info" ? <Info size={15} color={C.blue} /> : <AlertTriangle size={15} color={s === "error" ? C.red : C.yellow} />;
  const open = checks?.filter(c => c.status === "warn" || c.status === "error").length ?? 0;
  return (
    <Card>
      <CardTitle icon={<ShieldCheck size={16} />}>{t("Sicurezza e configurazione")}</CardTitle>
      {err && <div role="alert" style={{ ...sans, color: C.red, fontSize: 13 }}>{err}</div>}
      {checks && <div style={{ ...sans, fontSize: 13, color: open ? C.yellow : C.green, marginBottom: 8, fontWeight: 650 }}>{open ? t("{n} punti da sistemare nell'ambiente", { n: open }) : t("Configurazione dell'ambiente in ordine")}</div>}
      <div style={{ display: "grid", gap: 5, marginBottom: 16 }}>
        {(checks ?? []).map(c => <div key={c.key} style={{ ...sans, display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, color: C.text }}><span style={{ marginTop: 2 }}>{icon(c.status)}</span><span><b>{c.label}</b> <span style={{ color: C.muted }}>— {c.detail}</span></span></div>)}
      </div>
      <div style={{ ...sans, display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: C.subtle, textTransform: "uppercase", letterSpacing: ".04em" }}>{t("Ultimi eventi")}</span>
        <a href="/api/portal?op=security-events-export" style={{ fontSize: 12.5, color: C.blue, display: "inline-flex", gap: 5, alignItems: "center", textDecoration: "none" }}><Download size={14} />{t("Esporta (CSV)")}</a>
      </div>
      <div style={{ display: "grid", gap: 3, maxHeight: 260, overflowY: "auto" }}>
        {(events ?? []).slice(0, 60).map(e => (
          <div key={e.id} style={{ ...sans, fontSize: 12.5, color: e.event === "login_failed" || e.event === "login_blocked" ? C.red : C.text, borderBottom: `1px solid ${C.borderLight}`, paddingBottom: 3 }}>
            <span style={{ color: C.subtle }}>{new Date(e.at).toLocaleString(locale())}</span> · {EVENT[e.event] ? t(EVENT[e.event]) : e.event} · {e.email || e.user}{e.ip ? ` · ${e.ip}` : ""}{e.detail ? ` · ${e.detail}` : ""}
          </div>))}
        {events && !events.length && <div style={{ ...sans, fontSize: 13, color: C.muted }}>{t("Nessun evento registrato.")}</div>}
      </div>
    </Card>
  );
}
