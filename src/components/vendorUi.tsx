import { useState, type ReactNode } from "react";
import type { SupplierStatus } from "../types.ts";
import { btnGhost, btnPrimary, C, font, iStyle, sans } from "../theme.ts";
import { docValidity } from "../supplierRules.ts";
import { fmtDate } from "../lib/format.ts";
import { AlertCircle, AlertTriangle, CheckCircle2, Clock, Download, ExternalLink, Hourglass, Loader2, Mail, X } from "./icons.tsx";
import { supplierDocUrl } from "../api.ts";
import { STATUS_STYLE } from "../lib/vendors.ts";

export function StatusBadge({ status, update }: { status: SupplierStatus; update?: boolean }) {
  const s = STATUS_STYLE[status];
  return <span style={{ ...sans, display: "inline-flex", alignItems: "center", gap: 6, background: s.bg, color: s.color, borderRadius: 999, padding: "3px 10px", fontSize: 11.5, fontWeight: 650, whiteSpace: "nowrap" }}><span style={{ width: 6, height: 6, borderRadius: "50%", background: s.color }} />{s.label}{update && status === "pending" ? " · aggiornamento" : ""}</span>;
}

export function ValidityChip({ validUntil }: { validUntil: string | null }) {
  const v = docValidity(validUntil);
  if (v === "none") return null;
  const map = { valid: { c: C.green, bg: C.greenBg, t: `Valido fino al ${fmtDate(validUntil!)}` }, expiring: { c: C.yellow, bg: C.yellowBg, t: `In scadenza il ${fmtDate(validUntil!)}` }, expired: { c: C.red, bg: C.redBg, t: `Scaduto il ${fmtDate(validUntil!)}` } }[v];
  return <span style={{ ...sans, background: map.bg, color: map.c, borderRadius: 999, padding: "2px 9px", fontSize: 11, fontWeight: 650, whiteSpace: "nowrap" }}>{map.t}</span>;
}

export function Notice({ kind = "info", children }: { kind?: "info" | "warn" | "error" | "ok"; children: ReactNode }) {
  const m = { info: [C.blueBg, C.blue, <Mail size={17} key="i" />], warn: [C.yellowBg, C.yellow, <AlertTriangle size={17} key="w" />], error: [C.redBg, C.red, <AlertCircle size={17} key="e" />], ok: [C.greenBg, C.green, <CheckCircle2 size={17} key="o" />] }[kind];
  return <div role={kind === "error" ? "alert" : undefined} style={{ ...sans, display: "flex", gap: 10, background: m[0] as string, color: m[1] as string, borderRadius: 12, padding: "12px 14px", fontSize: 13, lineHeight: 1.55, marginBottom: 14 }}><span style={{ flexShrink: 0, marginTop: 1 }}>{m[2]}</span><div style={{ minWidth: 0, overflowWrap: "anywhere" }}>{children}</div></div>;
}

export function DocLink({ id, name }: { id: number; name: string }) {
  const style = { ...sans, display: "inline-flex", alignItems: "center", gap: 5, color: C.blue, fontSize: 12.5, fontWeight: 600, textDecoration: "none" } as const;
  return (
    <span style={{ display: "inline-flex", gap: 12, flexWrap: "wrap" }}>
      <a href={supplierDocUrl(id)} target="_blank" rel="noopener noreferrer" style={style} aria-label={`Apri ${name}`}><ExternalLink size={14} />Apri</a>
      <a href={supplierDocUrl(id, true)} style={style} aria-label={`Scarica ${name}`}><Download size={14} />Scarica</a>
    </span>
  );
}

/** Mostra i dati dell'anagrafica a coppie etichetta/valore. */
export function KV({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 210px), 1fr))", gap: "12px 18px" }}>
      {rows.map(([k, v]) => (
        <div key={k} style={{ minWidth: 0 }}>
          <dt style={{ ...sans, fontSize: 11.5, color: C.subtle, fontWeight: 600 }}>{k}</dt>
          <dd style={{ ...sans, margin: "2px 0 0", fontSize: 13.5, color: C.text, overflowWrap: "anywhere" }}>{v || "—"}</dd>
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
        <textarea autoFocus required value={reason} onChange={e => setReason(e.target.value)} aria-label="Motivo" placeholder="Scrivi il motivo…" style={{ ...iStyle, height: 96, resize: "vertical", marginBottom: 12 }} />
        {error && <Notice kind="error">{error}</Notice>}
        <div style={{ display: "flex", gap: 10 }}>
          <button type="button" onClick={onClose} style={{ ...btnGhost, flex: 1 }}>Annulla</button>
          <button type="submit" disabled={busy || reason.trim().length < 3} style={{ ...btnPrimary, flex: 2, background: danger ? C.red : C.accent, opacity: busy || reason.trim().length < 3 ? 0.6 : 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>{busy && <Loader2 className="spin" size={16} />}{confirmLabel}</button>
        </div>
      </form>
    </div>
  );
}

export function CloseButton({ onClick }: { onClick: () => void }) {
  return <button onClick={onClick} aria-label="Chiudi" style={{ background: "none", border: "none", cursor: "pointer", padding: 6, color: C.subtle, display: "flex" }}><X size={20} /></button>;
}

export { Hourglass, Clock };
