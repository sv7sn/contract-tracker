import { useEffect, useState } from "react";
import type { User } from "../types.ts";
import { btnPrimary, C, font, iStyle, sans } from "../theme.ts";
import { Avatar, Field, RoleBadge } from "./ui.tsx";
import { Check, ChevronLeft, ChevronRight, Globe, KeyRound, LogOut, MonitorSmartphone, SlidersHorizontal, X } from "./icons.tsx";
import { api, ApiError } from "../api.ts";

type Panel = "menu" | "password" | "language";
interface Props {
  user: User;
  /** Da dove si apre: dalla barra laterale (in basso a sinistra) o dall'intestazione (in alto a destra). Sul telefono è sempre un pannello dal basso. */
  anchor: "sidebar" | "top";
  canChangePassword: boolean;
  onAdmin?: () => void;
  onLogout: () => void;
  onClose: () => void;
}

// Menu del profilo: impostazioni personali di ogni utente. L'amministrazione dell'azienda resta un modulo a parte (solo Manager).
export function AccountMenu({ user, anchor, canChangePassword, onAdmin, onLogout, onClose }: Props) {
  const [panel, setPanel] = useState<Panel>("menu");
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { if (panel === "menu") onClose(); else setPanel("menu"); } };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [panel, onClose]);
  const go = (p: Panel) => { setNote(null); setPanel(p); };

  const row = (icon: React.ReactNode, label: string, click: () => void, opts: { value?: string; danger?: boolean; chevron?: boolean } = {}) => (
    <button type="button" role="menuitem" onClick={click} className="account-row" style={{ ...sans, color: opts.danger ? C.red : C.text }}>
      <span style={{ display: "flex", color: opts.danger ? C.red : C.muted }}>{icon}</span>
      <span style={{ flex: 1, textAlign: "left" }}>{label}</span>
      {opts.value && <span style={{ fontSize: 12.5, color: C.muted }}>{opts.value}</span>}
      {opts.chevron && <ChevronRight size={16} color={C.subtle} />}
    </button>
  );
  const sep = <div style={{ height: 1, background: C.borderLight, margin: "6px 0" }} />;
  const back = (title: string) => (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 12 }}>
      <button type="button" onClick={() => go("menu")} aria-label="Indietro" style={{ background: "none", border: "none", cursor: "pointer", padding: 4, display: "flex", color: C.muted }}><ChevronLeft size={20} /></button>
      <div style={{ ...font, fontSize: 15.5, fontWeight: 700, color: C.navy }}>{title}</div>
    </div>
  );

  return (
    <div className="account-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`account-menu account-menu-${anchor}`} role="dialog" aria-modal="true" aria-label="Il tuo profilo">
        {panel === "menu" && (<>
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "4px 4px 12px" }}>
            <Avatar name={user.name} size={44} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ ...font, fontSize: 15.5, fontWeight: 700, color: C.navy, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user.name}</div>
              <div style={{ ...sans, fontSize: 12, color: C.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user.email}</div>
              <div style={{ marginTop: 4 }}><RoleBadge role={user.role} /></div>
            </div>
            <button type="button" onClick={onClose} aria-label="Chiudi" style={{ background: "none", border: "none", cursor: "pointer", color: C.subtle, alignSelf: "flex-start", padding: 2, display: "flex" }}><X size={18} /></button>
          </div>
          {sep}
          <div role="menu">
            {row(<Globe size={18} />, "Lingua", () => go("language"), { value: "Italiano", chevron: true })}
            {canChangePassword && row(<KeyRound size={18} />, "Cambia password", () => go("password"), { chevron: true })}
            {canChangePassword && row(<MonitorSmartphone size={18} />, "Esci dagli altri dispositivi", async () => {
              try { await api.revokeSessions(); setNote({ ok: true, text: "Le sessioni sugli altri dispositivi sono state chiuse" }); }
              catch { setNote({ ok: false, text: "Operazione non riuscita" }); }
            })}
            {onAdmin && <>{sep}{row(<SlidersHorizontal size={18} />, "Amministrazione", () => { onAdmin(); onClose(); }, { chevron: true })}</>}
            {sep}
            {row(<LogOut size={18} />, "Esci", onLogout, { danger: true })}
          </div>
          {note && <div role="status" style={{ ...sans, fontSize: 12.5, margin: "8px 4px 2px", color: note.ok ? C.green : C.red }}>{note.text}</div>}
        </>)}
        {panel === "password" && <PasswordPanel user={user} header={back("Cambia password")} />}
        {panel === "language" && (<>
          {back("Lingua")}
          <div role="radiogroup" aria-label="Lingua">
            {[{ key: "it", label: "Italiano", ready: true }, { key: "en", label: "English", ready: false }].map(l => (
              <button key={l.key} type="button" role="radio" aria-checked={l.key === "it"} disabled={!l.ready} className="account-row" style={{ ...sans, color: l.ready ? C.text : C.subtle, cursor: l.ready ? "pointer" : "default" }}>
                <span style={{ flex: 1, textAlign: "left" }}>{l.label}</span>
                {l.key === "it" ? <Check size={17} color={C.accent} /> : <span style={{ fontSize: 12, color: C.subtle }}>in arrivo</span>}
              </button>
            ))}
          </div>
        </>)}
      </div>
    </div>
  );
}

function PasswordPanel({ user, header }: { user: User; header: React.ReactNode }) {
  const [current, setCurrent] = useState(""); const [next, setNext] = useState(""); const [again, setAgain] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null); const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next !== again) return setMsg({ ok: false, text: "Le due password nuove non coincidono" });
    if (next.length < 12) return setMsg({ ok: false, text: "La nuova password deve avere almeno 12 caratteri" });
    setBusy(true); setMsg(null);
    try { await api.changePassword(current, next); setMsg({ ok: true, text: "Password aggiornata" }); setCurrent(""); setNext(""); setAgain(""); }
    catch (err) { setMsg({ ok: false, text: err instanceof ApiError ? err.message : "Operazione non riuscita" }); }
    setBusy(false);
  };
  return (
    <form onSubmit={submit}>
      {header}
      <input type="text" autoComplete="username" value={user.email} readOnly hidden />
      <Field label="Password attuale" htmlFor="pw-cur"><input id="pw-cur" type="password" autoComplete="current-password" required autoFocus value={current} onChange={e => setCurrent(e.target.value)} style={iStyle} /></Field>
      <Field label="Nuova password (min. 12 caratteri)" htmlFor="pw-new"><input id="pw-new" type="password" autoComplete="new-password" required value={next} onChange={e => setNext(e.target.value)} style={iStyle} /></Field>
      <Field label="Ripeti nuova password" htmlFor="pw-again"><input id="pw-again" type="password" autoComplete="new-password" required value={again} onChange={e => setAgain(e.target.value)} style={iStyle} /></Field>
      {msg && <div role="alert" style={{ ...sans, fontSize: 12.5, marginBottom: 10, color: msg.ok ? C.green : C.red }}>{msg.text}</div>}
      <button type="submit" disabled={busy} style={{ ...btnPrimary, width: "100%", background: C.navy, opacity: busy ? 0.7 : 1 }}>Aggiorna password</button>
    </form>
  );
}
