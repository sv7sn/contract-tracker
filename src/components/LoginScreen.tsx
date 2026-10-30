import { useEffect, useState } from "react";
import { C, font, iStyle, radius, sans } from "../theme.ts";
import { DEMO_PASSWORD, DEMO_USERS } from "../lib/demo.ts";
import { BrandMark, Field } from "./ui.tsx";
import { t } from "../i18n/index.ts";
import { AlertTriangle, CalendarClock, ClipboardCheck, Eye, EyeOff, FileCheck2, Loader2, Lock, Mail, ShieldCheck } from "./icons.tsx";

interface Props {
  mode: "api" | "local";
  setupRequired: boolean;
  /** Restituisce un messaggio di errore, oppure null se l'accesso è riuscito. */
  onLogin: (email: string, password: string) => Promise<string | null>;
  onResetDemo?: () => void;
}

const FEATURES = [
  {
    icon: <CalendarClock size={20} />,
    title: "Nessuna scadenza dimenticata",
    text: "Un piano di rinnovo per ogni contratto, con le date a ritroso dalla scadenza.",
  },
  {
    icon: <ClipboardCheck size={20} />,
    title: "Decisioni dei Business Owner",
    text: "Ogni responsabile risponde dal suo spazio e lo stato del contratto si aggiorna.",
  },
  {
    icon: <ShieldCheck size={20} />,
    title: "Accesso per ruolo, storico completo",
    text: "Ognuno vede solo ciò che gli compete e ogni azione resta tracciata.",
  },
];

export function LoginScreen({ mode, setupRequired, onLogin, onResetDemo }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(() =>
    new URLSearchParams(window.location.search).get("sso") === "denied"
      ? t(
          "Accesso aziendale non riuscito: l'account non è abilitato in Procurement Lab o la sessione è scaduta. Riprova o contatta l'amministratore.",
        )
      : null,
  );
  const [busy, setBusy] = useState(false);
  const [sso, setSso] = useState<{ enabled: boolean; enforce: boolean } | null>(null);
  useEffect(() => {
    if (mode === "local") return;
    fetch("/api/portal?op=sso-config")
      .then(r => (r.ok ? r.json() : null))
      .then(c => c && setSso(c))
      .catch(() => {});
  }, [mode]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const err = await onLogin(email, password);
    if (err) {
      setError(err);
      setBusy(false);
    }
  };
  const withIcon = { ...iStyle, paddingLeft: 40, height: 44, fontSize: 14.5 } as const;
  const iconStyle = {
    position: "absolute",
    left: 13,
    top: "50%",
    transform: "translateY(-50%)",
    color: C.subtle,
    pointerEvents: "none",
  } as const;

  return (
    <div className="login-shell">
      <div className="login-brand">
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 44 }}>
          <BrandMark size={46} />
          <div style={{ ...font, fontSize: 22, fontWeight: 700 }}>Procurement Lab</div>
        </div>
        <h1 style={{ ...font, fontSize: 44, lineHeight: 1.1, fontWeight: 750, margin: 0, maxWidth: 540, letterSpacing: "-0.03em" }}>
          {t("I contratti sotto controllo,")} <span style={{ color: "#f0997a" }}>{t("prima")}</span> {t("che scadano.")}
        </h1>
        <p style={{ ...sans, fontSize: 17, color: "rgba(255,255,255,.72)", marginTop: 18, maxWidth: 500, lineHeight: 1.6 }}>
          {t("Scadenze, piani di rinnovo e decisioni dei Business Owner in un unico posto, per tutto il team acquisti.")}
        </p>
        <div style={{ display: "grid", gap: 20, marginTop: 44, maxWidth: 500 }}>
          {FEATURES.map(f => (
            <div key={f.title} style={{ display: "flex", gap: 14 }}>
              <div
                aria-hidden
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: 12,
                  background: "rgba(255,255,255,.1)",
                  border: "1px solid rgba(255,255,255,.12)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                {f.icon}
              </div>
              <div>
                <div style={{ ...sans, fontSize: 15, fontWeight: 650 }}>{t(f.title)}</div>
                <div style={{ ...sans, fontSize: 13.5, color: "rgba(255,255,255,.62)", marginTop: 2, lineHeight: 1.5 }}>{t(f.text)}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="login-panel">
        <form
          onSubmit={submit}
          style={{
            width: "100%",
            maxWidth: 410,
            background: "#fff",
            borderRadius: radius.lg + 4,
            padding: 32,
            boxShadow: "0 24px 60px rgba(16,24,43,.18)",
            border: `1px solid ${C.border}`,
          }}
        >
          <div className="mobile-only" style={{ textAlign: "center", marginBottom: 18 }}>
            <BrandMark size={52} />
          </div>
          <h1 style={{ ...font, fontSize: 24, margin: "0 0 6px", color: C.text, fontWeight: 700 }}>{t("Bentornato")}</h1>
          <p style={{ ...sans, fontSize: 14, color: C.muted, margin: "0 0 24px" }}>
            {t("Accedi con le credenziali che ti ha dato l'amministratore.")}
          </p>

          {setupRequired && (
            <div
              style={{
                ...sans,
                display: "flex",
                gap: 10,
                background: C.yellowBg,
                border: "1px solid #f3dca0",
                color: C.yellow,
                borderRadius: 12,
                padding: 13,
                fontSize: 12.5,
                lineHeight: 1.55,
                marginBottom: 18,
              }}
            >
              <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: 1 }} />
              <div>
                <b>{t("Nessun utente configurato.")}</b> {t("Imposta su Vercel le variabili")} <code>ADMIN_EMAIL</code> {t("e")}{" "}
                <code>ADMIN_PASSWORD</code> {t("(minimo 12 caratteri) e rifai il deploy: al primo avvio verrà creato l'amministratore.")}
              </div>
            </div>
          )}

          {sso?.enabled && (
            <>
              <a
                href="/api/portal?op=sso-start"
                style={{
                  ...sans,
                  width: "100%",
                  height: 46,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  background: C.text,
                  borderRadius: 11,
                  color: "#fff",
                  fontWeight: 650,
                  fontSize: 15,
                  textDecoration: "none",
                  marginBottom: 16,
                }}
              >
                <ShieldCheck size={18} />
                {t("Accedi con l'account aziendale")}
              </a>
              <div style={{ ...sans, fontSize: 12, color: C.subtle, textAlign: "center", marginBottom: 14 }}>
                {sso.enforce ? t("Fornitori e accessi di emergenza:") : t("oppure con email e password:")}
              </div>
            </>
          )}

          <Field label="Email" htmlFor="login-email">
            <div style={{ position: "relative" }}>
              <Mail size={17} style={iconStyle} />
              <input
                id="login-email"
                type="email"
                autoComplete="username"
                required
                autoFocus
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder={t("nome@azienda.it")}
                style={withIcon}
              />
            </div>
          </Field>
          <Field label="Password" htmlFor="login-password">
            <div style={{ position: "relative" }}>
              <Lock size={17} style={iconStyle} />
              <input
                id="login-password"
                type={show ? "text" : "password"}
                autoComplete="current-password"
                required
                value={password}
                onChange={e => setPassword(e.target.value)}
                style={{ ...withIcon, paddingRight: 46 }}
              />
              <button
                type="button"
                onClick={() => setShow(s => !s)}
                aria-label={show ? t("Nascondi password") : t("Mostra password")}
                style={{
                  position: "absolute",
                  right: 6,
                  top: "50%",
                  transform: "translateY(-50%)",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: 8,
                  color: C.subtle,
                  display: "flex",
                }}
              >
                {show ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </Field>

          {error && (
            <div
              role="alert"
              style={{
                ...sans,
                display: "flex",
                gap: 8,
                alignItems: "center",
                background: C.redBg,
                color: C.red,
                borderRadius: 10,
                padding: "10px 12px",
                fontSize: 13,
                marginBottom: 16,
              }}
            >
              <AlertTriangle size={16} />
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            style={{
              ...sans,
              width: "100%",
              height: 46,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              background: C.accent,
              border: "none",
              borderRadius: 11,
              color: "#fff",
              fontWeight: 650,
              fontSize: 15,
              cursor: busy ? "default" : "pointer",
              opacity: busy ? 0.8 : 1,
              boxShadow: "0 2px 6px rgba(200,82,42,.4)",
            }}
          >
            {busy ? (
              <>
                <Loader2 className="spin" size={18} />
                {t("Accesso in corso…")}
              </>
            ) : (
              t("Accedi")
            )}
          </button>

          {mode === "local" && (
            <div
              style={{
                ...sans,
                marginTop: 22,
                padding: 14,
                background: C.bg,
                borderRadius: 12,
                fontSize: 12.5,
                color: C.muted,
                lineHeight: 1.6,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 7, color: C.yellow, fontWeight: 650, marginBottom: 4 }}>
                <FileCheck2 size={15} />
                {t("Modalità demo")}
              </div>
              {t("Database non raggiungibile: puoi provare l'app con dati di esempio. Password per tutti gli account:")}{" "}
              <code>{DEMO_PASSWORD}</code>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
                {[
                  [DEMO_USERS[0], "Manager"],
                  [DEMO_USERS[1], "Buyer"],
                  [DEMO_USERS[6], "Business Owner"],
                ].map(([u, label]) => (
                  <button
                    key={(u as (typeof DEMO_USERS)[0]).id}
                    type="button"
                    onClick={() => {
                      setEmail((u as (typeof DEMO_USERS)[0]).email);
                      setPassword(DEMO_PASSWORD);
                    }}
                    style={{
                      ...sans,
                      padding: "5px 12px",
                      borderRadius: 999,
                      border: `1px solid ${C.border}`,
                      background: "#fff",
                      color: C.text,
                      cursor: "pointer",
                      fontSize: 12,
                      fontWeight: 600,
                    }}
                  >
                    {t(label as string)}
                  </button>
                ))}
              </div>
              {onResetDemo && (
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm(t("Ripristinare i dati demo? Le modifiche salvate in questo browser andranno perse.")))
                      onResetDemo();
                  }}
                  style={{
                    ...sans,
                    display: "block",
                    marginTop: 12,
                    padding: 0,
                    background: "none",
                    border: "none",
                    color: C.subtle,
                    cursor: "pointer",
                    fontSize: 12,
                    textDecoration: "underline",
                  }}
                >
                  {t("Ripristina i dati demo")}
                </button>
              )}
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
