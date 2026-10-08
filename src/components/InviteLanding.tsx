import { useEffect, useState } from "react";
import type { User } from "../types.ts";
import { ApiError, portalApi } from "../api.ts";
import { C, font, iStyle, radius, sans } from "../theme.ts";
import { validatePassword } from "../supplierRules.ts";
import { BrandMark, Field } from "./ui.tsx";
import { AlertTriangle, Building2, Check, Eye, EyeOff, FileCheck2, Loader2, Lock, ShieldCheck } from "./icons.tsx";

const STEPS = [
  { icon: <Lock size={20} />, title: "Crea la tua password", text: "Sarà il tuo accesso personale all'area fornitori." },
  { icon: <Building2 size={20} />, title: "Inserisci i dati dell'azienda", text: "Anagrafica, sede, coordinate bancarie e contatti." },
  { icon: <FileCheck2 size={20} />, title: "Carica i documenti di qualifica", text: "Li potrai aggiornare in autonomia quando scadono." },
];
const RULES: [string, (p: string) => boolean][] = [["Almeno 10 caratteri", p => p.length >= 10], ["Una maiuscola e una minuscola", p => /[a-z]/.test(p) && /[A-Z]/.test(p)], ["Un numero", p => /\d/.test(p)], ["Un simbolo (es. ! ? #)", p => /[^A-Za-z0-9]/.test(p)]];

/** Pagina di benvenuto aperta dal link d'invito ricevuto via email. */
export function InviteLanding({ token, onActivated, onCancel }: { token: string; onActivated: (user: User) => void; onCancel: () => void }) {
  const [info, setInfo] = useState<{ name: string; email: string; companies: string[] } | null>(null);
  const [invalid, setInvalid] = useState<string | null>(null);
  const [pw, setPw] = useState(""); const [pw2, setPw2] = useState(""); const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);

  useEffect(() => {
    let off = false;
    portalApi.inviteInfo(token).then(i => { if (!off) setInfo(i); }).catch(err => { if (!off) setInvalid(err instanceof ApiError ? err.message : "Impossibile verificare l'invito"); });
    return () => { off = true; };
  }, [token]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); if (busy) return;
    const bad = validatePassword(pw); if (bad) { setError(bad); return; }
    if (pw !== pw2) { setError("Le due password non coincidono"); return; }
    setBusy(true); setError(null);
    try { onActivated((await portalApi.activate(token, pw)).user); }
    catch (err) { setError(err instanceof ApiError ? err.message : "Impossibile contattare il server"); setBusy(false); }
  };
  const field = { ...iStyle, height: 44, fontSize: 14.5 } as const;

  return (
    <div className="login-shell">
      <div className="login-brand">
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 44 }}><BrandMark size={46} /><div style={{ ...font, fontSize: 22, fontWeight: 700 }}>Contract Tracker</div></div>
        <h1 style={{ ...font, fontSize: 40, lineHeight: 1.12, fontWeight: 750, margin: 0, maxWidth: 520, letterSpacing: "-0.03em" }}>Benvenuto nel portale <span style={{ color: "#f0997a" }}>fornitori</span>.</h1>
        <p style={{ ...sans, fontSize: 17, color: "rgba(255,255,255,.72)", marginTop: 18, maxWidth: 480, lineHeight: 1.6 }}>Registrarti richiede pochi minuti. Tieni a portata di mano visura camerale, DURC e coordinate bancarie.</p>
        <div style={{ display: "grid", gap: 20, marginTop: 40, maxWidth: 480 }}>
          {STEPS.map(f => (
            <div key={f.title} style={{ display: "flex", gap: 14 }}>
              <div aria-hidden style={{ width: 42, height: 42, borderRadius: 12, background: "rgba(255,255,255,.1)", border: "1px solid rgba(255,255,255,.12)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{f.icon}</div>
              <div><div style={{ ...sans, fontSize: 15, fontWeight: 650 }}>{f.title}</div><div style={{ ...sans, fontSize: 13.5, color: "rgba(255,255,255,.62)", marginTop: 2, lineHeight: 1.5 }}>{f.text}</div></div>
            </div>
          ))}
        </div>
      </div>
      <div className="login-panel">
        <form onSubmit={submit} style={{ width: "100%", maxWidth: 430, background: "#fff", borderRadius: radius.lg + 4, padding: 32, boxShadow: "0 24px 60px rgba(16,24,43,.18)", border: `1px solid ${C.border}` }}>
          <div className="mobile-only" style={{ textAlign: "center", marginBottom: 18 }}><BrandMark size={52} /></div>
          {invalid ? (
            <>
              <div style={{ color: C.red, marginBottom: 10 }}><AlertTriangle size={30} /></div>
              <h1 style={{ ...font, fontSize: 22, margin: "0 0 8px", color: C.text }}>Invito non valido</h1>
              <p style={{ ...sans, fontSize: 14, color: C.muted, lineHeight: 1.55 }}>{invalid}</p>
              <button type="button" onClick={onCancel} style={{ ...sans, marginTop: 14, padding: "10px 16px", borderRadius: 10, border: `1px solid ${C.border}`, background: "#fff", cursor: "pointer", fontWeight: 600 }}>Vai all'accesso</button>
            </>
          ) : !info ? (
            <div style={{ display: "flex", justifyContent: "center", padding: 30 }}><Loader2 className="spin" size={24} color={C.subtle} /></div>
          ) : (
            <>
              <h1 style={{ ...font, fontSize: 24, margin: "0 0 6px", color: C.text, fontWeight: 700 }}>Ciao {info.name}</h1>
              <p style={{ ...sans, fontSize: 14, color: C.muted, margin: "0 0 20px", lineHeight: 1.55 }}>{info.companies.length ? <>{info.companies.join(", ")} ti ha invitato a registrarti come fornitore.</> : "Sei stato invitato a registrarti come fornitore."} Crea una password per accedere alla tua area personale.</p>
              <Field label="Email di accesso"><div style={{ ...field, display: "flex", alignItems: "center", background: C.bg, color: C.muted }}>{info.email}</div></Field>
              <Field label="Password" htmlFor="inv-pw">
                <div style={{ position: "relative" }}>
                  <input id="inv-pw" type={show ? "text" : "password"} autoComplete="new-password" required autoFocus value={pw} onChange={e => setPw(e.target.value)} style={{ ...field, paddingRight: 46 }} />
                  <button type="button" onClick={() => setShow(v => !v)} aria-label={show ? "Nascondi password" : "Mostra password"} style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", padding: 8, color: C.subtle, display: "flex" }}>{show ? <EyeOff size={18} /> : <Eye size={18} />}</button>
                </div>
              </Field>
              <ul style={{ listStyle: "none", margin: "-4px 0 14px", padding: 0, display: "grid", gap: 4 }}>
                {RULES.map(([t, f]) => <li key={t} style={{ ...sans, display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, color: f(pw) ? C.green : C.subtle }}><Check size={14} style={{ opacity: f(pw) ? 1 : 0.3 }} />{t}</li>)}
              </ul>
              <Field label="Ripeti la password" htmlFor="inv-pw2"><input id="inv-pw2" type={show ? "text" : "password"} autoComplete="new-password" required value={pw2} onChange={e => setPw2(e.target.value)} style={field} /></Field>
              {error && <div role="alert" style={{ ...sans, display: "flex", gap: 8, alignItems: "center", background: C.redBg, color: C.red, borderRadius: 10, padding: "10px 12px", fontSize: 13, marginBottom: 14 }}><AlertTriangle size={16} />{error}</div>}
              <button type="submit" disabled={busy} style={{ ...sans, width: "100%", height: 46, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, background: C.accent, border: "none", borderRadius: 11, color: "#fff", fontWeight: 650, fontSize: 15, cursor: busy ? "default" : "pointer", opacity: busy ? 0.8 : 1, boxShadow: "0 2px 6px rgba(200,82,42,.4)" }}>
                {busy ? <><Loader2 className="spin" size={18} />Creazione account…</> : <><ShieldCheck size={18} />Crea il mio account</>}
              </button>
              <p style={{ ...sans, fontSize: 12, color: C.subtle, margin: "14px 0 0", textAlign: "center" }}>Hai già un account? <button type="button" onClick={onCancel} style={{ background: "none", border: "none", padding: 0, color: C.blue, cursor: "pointer", font: "inherit", textDecoration: "underline" }}>Accedi</button></p>
            </>
          )}
        </form>
      </div>
    </div>
  );
}
