import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { AiCheck, CheckStatus, Lifecycle, Qualification, RiskAssessment, RiskCheckEntry, RiskLevel, SupplierStatus, SupplierSummary } from "../types.ts";
import { btnGhost, btnPrimary, C, font, iStyle, sans } from "../theme.ts";
import { docValidity } from "../supplierRules.ts";
import { fmtDate } from "../lib/format.ts";
import { AlertCircle, AlertTriangle, CheckCircle2, Clock, Download, ExternalLink, Hourglass, Loader2, Mail, X } from "./icons.tsx";
import { supplierDocUrl } from "../api.ts";
import { LIFECYCLE_STYLE, STATUS_STYLE } from "../lib/vendors.ts";
import { locale, t } from "../i18n/index.ts";

export function StatusBadge({ status, update }: { status: SupplierStatus; update?: boolean }) {
  const s = STATUS_STYLE[status];
  return <span style={{ ...sans, display: "inline-flex", alignItems: "center", gap: 6, background: s.bg, color: s.color, borderRadius: 999, padding: "3px 10px", fontSize: 11.5, fontWeight: 650, whiteSpace: "nowrap" }}><span style={{ width: 6, height: 6, borderRadius: "50%", background: s.color }} />{t(s.label)}{update && status === "pending" ? " · " + t("aggiornamento") : ""}</span>;
}

export function ValidityChip({ validUntil }: { validUntil: string | null }) {
  const v = docValidity(validUntil);
  if (v === "none") return null;
  const map = { valid: { c: C.green, bg: C.greenBg, t: t("Valido fino al {date}", { date: fmtDate(validUntil!) }) }, expiring: { c: C.yellow, bg: C.yellowBg, t: t("In scadenza il {date}", { date: fmtDate(validUntil!) }) }, expired: { c: C.red, bg: C.redBg, t: t("Scaduto il {date}", { date: fmtDate(validUntil!) }) } }[v];
  return <span style={{ ...sans, background: map.bg, color: map.c, borderRadius: 999, padding: "2px 9px", fontSize: 11, fontWeight: 650, whiteSpace: "nowrap" }}>{map.t}</span>;
}

export function Notice({ kind = "info", children }: { kind?: "info" | "warn" | "error" | "ok"; children: ReactNode }) {
  const m = { info: [C.blueBg, C.blue, <Mail size={17} key="i" />], warn: [C.yellowBg, C.yellow, <AlertTriangle size={17} key="w" />], error: [C.redBg, C.red, <AlertCircle size={17} key="e" />], ok: [C.greenBg, C.green, <CheckCircle2 size={17} key="o" />] }[kind];
  return <div role={kind === "error" ? "alert" : undefined} style={{ ...sans, display: "flex", gap: 10, background: m[0] as string, color: m[1] as string, borderRadius: 12, padding: "12px 14px", fontSize: 13, lineHeight: 1.55, marginBottom: 14 }}><span style={{ flexShrink: 0, marginTop: 1 }}>{m[2]}</span><div style={{ minWidth: 0, overflowWrap: "anywhere" }}>{children}</div></div>;
}

/** Esito del controllo automatico di un documento. Per il fornitore il tono è di aiuto, per il Buyer è informativo: è solo un primo filtro. */
export function AiResult({ check, audience }: { check: AiCheck | null; audience: "supplier" | "staff" }) {
  if (!check || check.status === "skipped") return null;
  const m = { ok: { c: C.green, bg: C.greenBg, t: t("Controllo automatico: nessun problema") }, warning: { c: C.yellow, bg: C.yellowBg, t: audience === "supplier" ? t("Da controllare") : t("Controllo automatico: da verificare") }, problem: { c: C.red, bg: C.redBg, t: audience === "supplier" ? t("Il documento potrebbe non essere corretto") : t("Controllo automatico: documento sospetto") } }[check.status];
  return (
    <div style={{ ...sans, flexBasis: "100%", background: m.bg, color: m.c, borderRadius: 10, padding: "8px 11px", fontSize: 12.5, lineHeight: 1.5 }}>
      <b>{m.t}.</b> {check.summary}
      {check.issues.length > 0 && <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>{check.issues.map((i, k) => <li key={k}>{i}</li>)}</ul>}
      {check.status !== "ok" && <div style={{ marginTop: 4, opacity: 0.85 }}>{audience === "supplier" ? t("Se il documento è corretto puoi lasciarlo così: sarà comunque controllato dal Buyer. Altrimenti sostituiscilo.") : t("È un primo filtro automatico: la decisione resta tua.")}</div>}
    </div>
  );
}

export function DocLink({ id, name }: { id: number; name: string }) {
  const style = { ...sans, display: "inline-flex", alignItems: "center", gap: 5, color: C.blue, fontSize: 12.5, fontWeight: 600, textDecoration: "none" } as const;
  return (
    <span style={{ display: "inline-flex", gap: 12, flexWrap: "wrap" }}>
      <a href={supplierDocUrl(id)} target="_blank" rel="noopener noreferrer" style={style} aria-label={t("Apri {name}", { name })}><ExternalLink size={14} />{t("Apri")}</a>
      <a href={supplierDocUrl(id, true)} style={style} aria-label={t("Scarica {name}", { name })}><Download size={14} />{t("Scarica")}</a>
    </span>
  );
}

/** Mostra i dati dell'anagrafica a coppie etichetta/valore. */
export function KV({ rows, dense }: { rows: [string, ReactNode][]; dense?: boolean }) {
  return (
    <dl style={{ margin: 0, display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${dense ? 118 : 210}px), 1fr))`, gap: dense ? "6px 12px" : "12px 18px" }}>
      {rows.map(([k, v]) => (
        <div key={k} style={{ minWidth: 0 }}>
          <dt style={{ ...sans, fontSize: dense ? 11 : 11.5, color: C.subtle, fontWeight: 600 }}>{k}</dt>
          <dd style={{ ...sans, margin: dense ? "1px 0 0" : "2px 0 0", fontSize: dense ? 13 : 13.5, color: C.text, overflowWrap: "anywhere" }}>{v || "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Finestra di conferma con un motivo obbligatorio (rifiuto, richiesta di modifiche). */
export function ReasonDialog({ title, text, confirmLabel, danger, onConfirm, onClose }: { title: string; text: string; confirmLabel: string; danger?: boolean; onConfirm: (reason: string) => Promise<string | null>; onClose: () => void }) {
  const [reason, setReason] = useState(""); const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => { e.preventDefault(); setBusy(true); setError(null); const err = await onConfirm(reason.trim()); if (err) { setError(err); setBusy(false); } };
  return (
    <div className="dialog-overlay" role="dialog" aria-modal="true" style={{ zIndex: 320 }}>
      <form className="dialog" onSubmit={submit}>
        <h3 style={{ ...font, margin: "0 0 6px", fontSize: 17, color: C.text }}>{title}</h3>
        <p style={{ ...sans, fontSize: 13, color: C.muted, margin: "0 0 14px", lineHeight: 1.5 }}>{text}</p>
        <textarea autoFocus required value={reason} onChange={e => setReason(e.target.value)} aria-label={t("Motivo")} placeholder={t("Scrivi il motivo…")} style={{ ...iStyle, height: 96, resize: "vertical", marginBottom: 12 }} />
        {error && <Notice kind="error">{error}</Notice>}
        <div style={{ display: "flex", gap: 10 }}>
          <button type="button" onClick={onClose} style={{ ...btnGhost, flex: 1 }}>{t("Annulla")}</button>
          <button type="submit" disabled={busy || reason.trim().length < 3} style={{ ...btnPrimary, flex: 2, background: danger ? C.red : C.accent, opacity: busy || reason.trim().length < 3 ? 0.6 : 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>{busy && <Loader2 className="spin" size={16} />}{confirmLabel}</button>
        </div>
      </form>
    </div>
  );
}

export function CloseButton({ onClick }: { onClick: () => void }) {
  return <button onClick={onClick} aria-label={t("Chiudi")} style={{ background: "none", border: "none", cursor: "pointer", padding: 6, color: C.subtle, display: "flex" }}><X size={20} /></button>;
}

export { Hourglass, Clock };

/** Le finestre vanno montate su <body>: dentro la pagina (che ha le animazioni) la barra in alto finirebbe sopra e ne coprirebbe la parte superiore. */
export function Portal({ children }: { children: ReactNode }) {
  return createPortal(children, document.body);
}

const pill = (label: string, color: string, bg: string) => <span style={{ ...sans, display: "inline-flex", alignItems: "center", background: bg, color, borderRadius: 999, padding: "3px 10px", fontSize: 11.5, fontWeight: 650, whiteSpace: "nowrap" }}>{label}</span>;
/** Segnalazioni sintetiche sul fornitore: stato operativo, qualifica scaduta, possibile doppione. */
export function VendorFlags({ lifecycle, qualification, duplicate }: { lifecycle: Lifecycle; qualification: Qualification; duplicate?: boolean }) {
  return (
    <>
      {lifecycle !== "active" && pill(t(LIFECYCLE_STYLE[lifecycle].label), LIFECYCLE_STYLE[lifecycle].color, LIFECYCLE_STYLE[lifecycle].bg)}
      {qualification === "lapsed" && pill(t("Qualifica scaduta"), C.red, C.redBg)}
      {qualification === "expiring" && pill(t("Qualifica in scadenza"), C.yellow, C.yellowBg)}
      {duplicate && pill(t("Possibile doppione"), C.purple, C.purpleBg)}
    </>
  );
}

/** Etichetta del livello di rischio (nulla se il fornitore non ha ancora un livello). */
const RISK_STYLE: Record<Exclude<RiskLevel, "na">, { label: string; color: string; bg: string }> = {
  high: { label: "Rischio alto", color: C.red, bg: C.redBg }, medium: { label: "Rischio medio", color: C.yellow, bg: C.yellowBg }, low: { label: "Rischio basso", color: C.green, bg: C.greenBg },
};
export function RiskBadge({ risk }: { risk?: RiskAssessment }) {
  if (!risk || risk.level === "na") return <span style={{ color: C.subtle }}>—</span>;
  const s = RISK_STYLE[risk.level];
  return <span title={risk.factors.map(f => t(f.text, f.vars)).join(" · ")}>{pill(t(s.label), s.color, s.bg)}</span>;
}
const TRIGGER: Record<RiskCheckEntry["trigger"], string> = { periodic: "Verifica periodica", manual: "Ricontrollo manuale", onboarding: "Registrazione" };
const DOT: Record<CheckStatus, string> = { ok: C.green, warn: C.yellow, fail: C.red, todo: C.subtle, na: C.subtle };

/** Livello di rischio con i motivi, le date delle verifiche e lo storico dei ricontrolli. */
export function RiskPanel({ risk, history }: { risk: RiskAssessment; history: RiskCheckEntry[] }) {
  const [all, setAll] = useState(false);
  if (risk.level === "na") return null;
  const s = RISK_STYLE[risk.level];
  const when = (d: string | null) => (d ? new Date(d).toLocaleDateString(locale(), { day: "2-digit", month: "short", year: "numeric" }) : "—");
  const shown = all ? history : history.slice(0, 4);
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
        {pill(t(s.label), s.color, s.bg)}
        {risk.worsenedAt && pill(t("Peggiorato il {date}", { date: when(risk.worsenedAt) }), C.red, C.redBg)}
      </div>
      {risk.factors.length === 0
        ? <div style={{ ...sans, fontSize: 13, color: C.muted, marginBottom: 10 }}>{t("Nessuna criticità rilevata nei controlli.")}</div>
        : <ul style={{ ...sans, margin: "0 0 10px", paddingLeft: 18, fontSize: 13, lineHeight: 1.6 }}>{risk.factors.map((f, i) => <li key={i} style={{ color: f.level === "high" ? C.red : C.text }}>{t(f.text, f.vars)}</li>)}</ul>}
      <div style={{ ...sans, fontSize: 12, color: C.muted, display: "flex", gap: 16, flexWrap: "wrap" }}>
        <span>{t("Ultima verifica esterna")}: <b style={{ color: C.text }}>{when(risk.checkedAt)}</b></span>
        <span>{t("Prossima verifica automatica")}: <b style={{ color: C.text }}>{when(risk.nextCheckAt)}</b></span>
      </div>
      {history.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ ...sans, fontSize: 11.5, fontWeight: 700, color: C.subtle, textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 4 }}>{t("Storico delle verifiche")}</div>
          {shown.map((h, i) => (
            <div key={i} style={{ ...sans, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", padding: "6px 0", borderTop: `1px solid ${C.borderLight}`, fontSize: 12.5 }}>
              <span className="tabular" style={{ minWidth: 92, color: C.muted }}>{when(h.at)}</span>
              <span style={{ minWidth: 130 }}>{t(TRIGGER[h.trigger])}</span>
              <span style={{ display: "inline-flex", gap: 10, color: C.muted }}>
                {([["vies", "IVA"], ["company", "Azienda"], ["sanctions", "Sanzioni"]] as const).map(([k, l]) => <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><span aria-hidden style={{ width: 8, height: 8, borderRadius: 4, background: DOT[h[k]] }} />{t(l)}</span>)}
              </span>
              {h.worsened.length > 0 && <span style={{ color: C.red, fontWeight: 650 }}>{t("Peggiorato")}: {h.worsened.map(w => t(w)).join(", ")}</span>}
            </div>
          ))}
          {history.length > 4 && <button onClick={() => setAll(a => !a)} style={{ ...btnGhost, padding: "4px 10px", fontSize: 12, marginTop: 6 }}>{all ? t("Mostra meno") : t("Mostra tutte ({n})", { n: history.length })}</button>}
        </div>
      )}
    </div>
  );
}

/** Campo fornitore collegato all'anagrafica: suggerisce i fornitori registrati e mostra qualifica e stato di quello scelto. */
export function SupplierPicker({ id, value, supplierId, vendors, onChange, error }: { id: string; value: string; supplierId: number | null | undefined; vendors: SupplierSummary[] | null; onChange: (name: string, supplierId: number | null) => void; error?: boolean }) {
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  const pick = (name: string) => { const v = vendors?.find(x => norm(x.legalName || x.name) === norm(name)); onChange(name, v ? v.id : null); };
  const v = supplierId ? vendors?.find(x => x.id === supplierId) : undefined;
  const reg = v?.sapCode ? t("Registrato (SAP {code})", { code: v.sapCode }) : t("Registrato");
  const hint = !vendors ? null : !value.trim() ? null : !v
    ? { c: C.yellow, t: t("Non presente in anagrafica fornitori: invitalo dal modulo Fornitori per la qualifica") }
    : v.lifecycle !== "active" ? { c: C.red, t: t("Fornitore {state} in anagrafica", { state: t(LIFECYCLE_STYLE[v.lifecycle].label).toLowerCase() }) }
    : v.status !== "registered" ? { c: C.yellow, t: t("In anagrafica, registrazione non completata ({state})", { state: t(STATUS_STYLE[v.status].label).toLowerCase() }) }
    : v.qualification === "lapsed" ? { c: C.red, t: t("{reg}, ma con qualifica scaduta", { reg }) }
    : { c: C.green, t: (v.qualification === "expiring" ? t("{reg}, documenti in scadenza", { reg }) : t("{reg}, qualifica valida", { reg })) };
  return (
    <>
      <input id={id} list={`${id}-list`} value={value} onChange={e => pick(e.target.value)} placeholder={t("Es. Acme Srl")} autoComplete="off" style={{ ...iStyle, borderColor: error ? C.red : C.border }} />
      <datalist id={`${id}-list`}>{(vendors ?? []).filter(x => x.status !== "invited").map(x => <option key={x.id} value={x.legalName || x.name}>{x.sapCode ? `SAP ${x.sapCode}` : t(STATUS_STYLE[x.status].label)}</option>)}</datalist>
      {hint && <div style={{ ...sans, fontSize: 11.5, color: hint.c, marginTop: 4, lineHeight: 1.4 }}>{hint.t}</div>}
    </>
  );
}
