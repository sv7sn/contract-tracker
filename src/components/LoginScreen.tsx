import { useState } from "react";
import { C, font, iStyle, sans } from "../theme.ts";
import { DEMO_PASSWORD, DEMO_USERS } from "../lib/demo.ts";
import { Field } from "./ui.tsx";

interface Props {
  mode: "api" | "local";
  setupRequired: boolean;
  /** Restituisce un messaggio di errore, oppure null se l'accesso è riuscito. */
  onLogin: (email: string, password: string) => Promise<string | null>;
  onResetDemo?: () => void;
}

export function LoginScreen({ mode, setupRequired, onLogin, onResetDemo }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setError(null);
    const err = await onLogin(email, password);
    if (err) { setError(err); setBusy(false); }
  };

  return (
    <div className="login-shell">
      <div className="login-brand">
        <div style={{ width: 60, height: 60, background: C.accent, borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 30, marginBottom: 24 }}>📋</div>
        <div style={{ ...font, fontSize: 38, fontWeight: 700, lineHeight: 1.15 }}>Contract Tracker</div>
        <div style={{ ...sans, fontSize: 17, color: "rgba(255,255,255,.7)", marginTop: 14, maxWidth: 460, lineHeight: 1.55 }}>
          Scadenze contrattuali, piani di rinnovo e decisioni dei Business Owner in un unico posto, con uno storico completo di ogni azione.
        </div>
        <div style={{ ...sans, fontSize: 13, color: "rgba(255,255,255,.45)", marginTop: 40 }}>Prometeon Tyre Group · Procurement indiretto</div>
      </div>

      <div className="login-panel">
        <form onSubmit={submit} style={{ width: "100%", maxWidth: 400, background: C.surface, borderRadius: 16, padding: 28, boxShadow: "0 8px 40px rgba(0,0,0,.15)" }}>
          <div className="mobile-only" style={{ textAlign: "center", marginBottom: 18 }}>
            <div style={{ width: 48, height: 48, background: C.accent, borderRadius: 12, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 24 }}>📋</div>
          </div>
          <h1 style={{ ...font, fontSize: 22, margin: "0 0 4px", color: C.navy }}>Accedi</h1>
          <p style={{ ...sans, fontSize: 13, color: C.muted, margin: "0 0 20px" }}>Usa le credenziali assegnate dall'amministratore.</p>

          {setupRequired && (
            <div style={{ ...sans, background: C.yellowBg, border: "1px solid #f0d080", color: C.yellow, borderRadius: 8, padding: 12, fontSize: 12, lineHeight: 1.55, marginBottom: 16 }}>
              <b>Nessun utente configurato.</b> Imposta su Vercel le variabili <code>ADMIN_EMAIL</code> e <code>ADMIN_PASSWORD</code> (minimo 8 caratteri) e rifai il deploy: al primo avvio verrà creato l'amministratore.
            </div>
          )}

          <Field label="Email" htmlFor="login-email">
            <input id="login-email" type="email" autoComplete="username" required autoFocus value={email} onChange={e => setEmail(e.target.value)} style={iStyle} />
          </Field>
          <Field label="Password" htmlFor="login-password">
            <div style={{ position: "relative" }}>
              <input id="login-password" type={show ? "text" : "password"} autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} style={{ ...iStyle, paddingRight: 44 }} />
              <button type="button" onClick={() => setShow(s => !s)} aria-label={show ? "Nascondi password" : "Mostra password"} style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", fontSize: 16, padding: 6 }}>{show ? "🙈" : "👁️"}</button>
            </div>
          </Field>

          {error && <div role="alert" style={{ ...sans, background: C.redBg, color: C.red, borderRadius: 8, padding: "10px 12px", fontSize: 13, marginBottom: 14 }}>{error}</div>}

          <button type="submit" disabled={busy} style={{ ...sans, width: "100%", padding: 14, background: C.accent, border: "none", borderRadius: 10, color: "#fff", fontWeight: 700, fontSize: 15, cursor: busy ? "default" : "pointer", opacity: busy ? 0.7 : 1 }}>
            {busy ? "Accesso in corso…" : "Accedi"}
          </button>

          {mode === "local" && (
            <div style={{ ...sans, marginTop: 20, paddingTop: 16, borderTop: `1px solid ${C.borderLight}`, fontSize: 12, color: C.muted, lineHeight: 1.6 }}>
              <b style={{ color: C.yellow }}>Modalità demo</b> (database non raggiungibile). Password per tutti gli account: <code>{DEMO_PASSWORD}</code>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
                {[DEMO_USERS[0], DEMO_USERS[1], DEMO_USERS[6]].map(u => (
                  <button key={u.id} type="button" onClick={() => { setEmail(u.email); setPassword(DEMO_PASSWORD); }} style={{ ...sans, padding: "5px 10px", borderRadius: 20, border: `1px solid ${C.border}`, background: "transparent", color: C.muted, cursor: "pointer", fontSize: 11 }}>{u.title.split(" ").slice(0, 2).join(" ")}</button>
                ))}
              </div>
              {onResetDemo && (
                <button type="button" onClick={() => { if (window.confirm("Ripristinare i dati demo? Le modifiche salvate in questo browser andranno perse.")) onResetDemo(); }} style={{ ...sans, display: "block", marginTop: 12, padding: 0, background: "none", border: "none", color: C.subtle, cursor: "pointer", fontSize: 11, textDecoration: "underline" }}>↺ Ripristina dati demo</button>
              )}
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
