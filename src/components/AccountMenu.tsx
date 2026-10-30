import { useEffect, useState } from "react";
import type { User } from "../types.ts";
import { btnPrimary, C, font, iStyle, sans } from "../theme.ts";
import { Avatar, Field, RoleBadge } from "./ui.tsx";
import {
  BarChart3,
  CalendarClock,
  Check,
  ChevronLeft,
  ChevronRight,
  Globe,
  KeyRound,
  LogOut,
  MonitorSmartphone,
  SlidersHorizontal,
  X,
} from "./icons.tsx";
import { CoverEditor } from "../views/CoverCard.tsx";
import { api, ApiError } from "../api.ts";
import { getLang, setLang, t } from "../i18n/index.ts";

type Panel = "menu" | "password" | "language" | "profile" | "cover";
interface Props {
  user: User;
  /** Da dove si apre: dalla barra laterale (in basso a sinistra) o dall'intestazione (in alto a destra). Sul telefono è sempre un pannello dal basso. */
  anchor: "sidebar" | "top";
  canChangePassword: boolean;
  onAdmin?: () => void;
  /** Solo Manager: apre gli Indicatori. */
  onKpi?: () => void;
  /** Dopo il salvataggio di "I miei dati": aggiorna l'utente nell'app. */
  onProfileSaved?: (patch: Pick<User, "title" | "phone">) => void;
  onLogout: () => void;
  onClose: () => void;
}

// Menu del profilo: impostazioni personali di ogni utente. L'amministrazione dell'azienda resta un modulo a parte (solo Manager).
export function AccountMenu({ user, anchor, canChangePassword, onAdmin, onKpi, onProfileSaved, onLogout, onClose }: Props) {
  const [panel, setPanel] = useState<Panel>("menu");
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (panel === "menu") onClose();
        else setPanel("menu");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panel, onClose]);
  const go = (p: Panel) => {
    setNote(null);
    setPanel(p);
  };

  const row = (
    icon: React.ReactNode,
    label: string,
    click: () => void,
    opts: { value?: string; danger?: boolean; chevron?: boolean } = {},
  ) => (
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
      <button
        type="button"
        onClick={() => go("menu")}
        aria-label={t("Indietro")}
        style={{ background: "none", border: "none", cursor: "pointer", padding: 4, display: "flex", color: C.muted }}
      >
        <ChevronLeft size={20} />
      </button>
      <div style={{ ...font, fontSize: 15.5, fontWeight: 700, color: C.navy }}>{title}</div>
    </div>
  );

  return (
    <div
      className="account-overlay"
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={`account-menu account-menu-${anchor}`} role="dialog" aria-modal="true" aria-label={t("Il tuo profilo")}>
        {panel === "menu" && (
          <>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 6, padding: "0 0 8px" }}>
              <button
                type="button"
                onClick={() => canChangePassword && go("profile")}
                disabled={!canChangePassword}
                aria-label={t("I miei dati")}
                className="account-row"
                style={{ ...sans, flex: 1, minWidth: 0, gap: 12, padding: "6px 6px", cursor: canChangePassword ? "pointer" : "default" }}
              >
                <Avatar name={user.name} size={44} />
                <span style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
                  <span
                    style={{
                      ...font,
                      display: "block",
                      fontSize: 15.5,
                      fontWeight: 700,
                      color: C.navy,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {user.name}
                  </span>
                  <span
                    style={{
                      ...sans,
                      display: "block",
                      fontSize: 12,
                      fontWeight: 400,
                      color: C.muted,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {user.email}
                  </span>
                  <span style={{ display: "block", marginTop: 4 }}>
                    <RoleBadge role={user.role} />
                  </span>
                </span>
                {canChangePassword && <ChevronRight size={16} color={C.subtle} />}
              </button>
              <button
                type="button"
                onClick={onClose}
                aria-label={t("Chiudi")}
                style={{ background: "none", border: "none", cursor: "pointer", color: C.subtle, padding: 6, display: "flex" }}
              >
                <X size={18} />
              </button>
            </div>
            {sep}
            <div role="menu">
              {row(<Globe size={18} />, t("Lingua"), () => go("language"), {
                value: getLang() === "en" ? "English" : "Italiano",
                chevron: true,
              })}
              {canChangePassword &&
                (user.role === "manager" || user.role === "buyer") &&
                row(<CalendarClock size={18} />, t("Le mie assenze"), () => go("cover"), { chevron: true })}
              {canChangePassword && row(<KeyRound size={18} />, t("Cambia password"), () => go("password"), { chevron: true })}
              {canChangePassword &&
                row(<MonitorSmartphone size={18} />, t("Esci dagli altri dispositivi"), async () => {
                  try {
                    await api.revokeSessions();
                    setNote({ ok: true, text: t("Le sessioni sugli altri dispositivi sono state chiuse") });
                  } catch {
                    setNote({ ok: false, text: t("Operazione non riuscita") });
                  }
                })}
              {(onKpi || onAdmin) && sep}
              {onKpi &&
                row(
                  <BarChart3 size={18} />,
                  t("Indicatori"),
                  () => {
                    onKpi();
                    onClose();
                  },
                  { chevron: true },
                )}
              {onAdmin &&
                row(
                  <SlidersHorizontal size={18} />,
                  t("Amministrazione"),
                  () => {
                    onAdmin();
                    onClose();
                  },
                  { chevron: true },
                )}
              {sep}
              {row(<LogOut size={18} />, t("Esci"), onLogout, { danger: true })}
            </div>
            {note && (
              <div role="status" style={{ ...sans, fontSize: 12.5, margin: "8px 4px 2px", color: note.ok ? C.green : C.red }}>
                {note.text}
              </div>
            )}
          </>
        )}
        {panel === "password" && <PasswordPanel user={user} header={back(t("Cambia password"))} />}
        {panel === "profile" && <ProfilePanel user={user} header={back(t("I miei dati"))} onSaved={onProfileSaved} />}
        {panel === "cover" && (
          <>
            {back(t("Le mie assenze"))}
            <CoverEditor user={user} />
          </>
        )}
        {panel === "language" && (
          <>
            {back(t("Lingua"))}
            <div role="radiogroup" aria-label={t("Lingua")}>
              {(
                [
                  ["it", "Italiano"],
                  ["en", "English"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={key === getLang()}
                  className="account-row"
                  style={{ ...sans, color: C.text }}
                  onClick={async () => {
                    if (key === getLang()) return;
                    if (canChangePassword) await api.setLang(key).catch(() => undefined);
                    setLang(key);
                  }}
                >
                  <span style={{ flex: 1, textAlign: "left" }}>{label}</span>
                  {key === getLang() && <Check size={17} color={C.accent} />}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ProfilePanel({
  user,
  header,
  onSaved,
}: {
  user: User;
  header: React.ReactNode;
  onSaved?: (patch: Pick<User, "title" | "phone">) => void;
}) {
  const [title, setTitle] = useState(user.title ?? "");
  const [phone, setPhone] = useState(user.phone ?? "");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const x = await api.saveProfile({ title, phone });
      onSaved?.(x);
      setMsg({ ok: true, text: t("Dati salvati") });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof ApiError ? err.message : t("Operazione non riuscita") });
    }
    setBusy(false);
  };
  const ro = (label: string, value: React.ReactNode) => (
    <div style={{ ...sans, display: "flex", gap: 10, padding: "7px 0", borderTop: `1px solid ${C.borderLight}`, fontSize: 13 }}>
      <span style={{ flex: "0 0 92px", color: C.muted }}>{label}</span>
      <span style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere", fontWeight: 550 }}>{value}</span>
    </div>
  );
  return (
    <form onSubmit={submit}>
      {header}
      <div style={{ marginBottom: 12 }}>
        {ro(t("Nome"), user.name)}
        {ro(t("Email"), user.email)}
        {ro(t("Ruolo"), <RoleBadge role={user.role} />)}
        <div style={{ ...sans, fontSize: 11.5, color: C.subtle, marginTop: 6, lineHeight: 1.5 }}>
          {t("Nome, email e ruolo li modifica il Manager (Amministrazione → Utenti).")}
        </div>
      </div>
      <Field label={t("Funzione")} htmlFor="pf-title">
        <input
          id="pf-title"
          value={title}
          maxLength={80}
          onChange={e => setTitle(e.target.value)}
          placeholder={t("Es. Buyer ICT")}
          style={iStyle}
        />
      </Field>
      <Field label={t("Telefono")} htmlFor="pf-phone">
        <input
          id="pf-phone"
          type="tel"
          value={phone}
          maxLength={30}
          onChange={e => setPhone(e.target.value)}
          placeholder="+39 02 1234567"
          style={iStyle}
        />
      </Field>
      {msg && (
        <div role="alert" style={{ ...sans, fontSize: 12.5, marginBottom: 10, color: msg.ok ? C.green : C.red }}>
          {msg.text}
        </div>
      )}
      <button type="submit" disabled={busy} style={{ ...btnPrimary, width: "100%", background: C.navy, opacity: busy ? 0.7 : 1 }}>
        {t("Salva")}
      </button>
    </form>
  );
}

function PasswordPanel({ user, header }: { user: User; header: React.ReactNode }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next !== again) return setMsg({ ok: false, text: t("Le due password nuove non coincidono") });
    if (next.length < 12) return setMsg({ ok: false, text: t("La nuova password deve avere almeno 12 caratteri") });
    setBusy(true);
    setMsg(null);
    try {
      await api.changePassword(current, next);
      setMsg({ ok: true, text: t("Password aggiornata") });
      setCurrent("");
      setNext("");
      setAgain("");
    } catch (err) {
      setMsg({ ok: false, text: err instanceof ApiError ? err.message : t("Operazione non riuscita") });
    }
    setBusy(false);
  };
  return (
    <form onSubmit={submit}>
      {header}
      <input type="text" autoComplete="username" value={user.email} readOnly hidden />
      <Field label={t("Password attuale")} htmlFor="pw-cur">
        <input
          id="pw-cur"
          type="password"
          autoComplete="current-password"
          required
          autoFocus
          value={current}
          onChange={e => setCurrent(e.target.value)}
          style={iStyle}
        />
      </Field>
      <Field label={t("Nuova password (min. 12 caratteri)")} htmlFor="pw-new">
        <input
          id="pw-new"
          type="password"
          autoComplete="new-password"
          required
          value={next}
          onChange={e => setNext(e.target.value)}
          style={iStyle}
        />
      </Field>
      <Field label={t("Ripeti nuova password")} htmlFor="pw-again">
        <input
          id="pw-again"
          type="password"
          autoComplete="new-password"
          required
          value={again}
          onChange={e => setAgain(e.target.value)}
          style={iStyle}
        />
      </Field>
      {msg && (
        <div role="alert" style={{ ...sans, fontSize: 12.5, marginBottom: 10, color: msg.ok ? C.green : C.red }}>
          {msg.text}
        </div>
      )}
      <button type="submit" disabled={busy} style={{ ...btnPrimary, width: "100%", background: C.navy, opacity: busy ? 0.7 : 1 }}>
        {t("Aggiorna password")}
      </button>
    </form>
  );
}
