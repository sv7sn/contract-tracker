import { useRef, useState } from "react";
import type { Contract, ContractData, NewUserInput, PlanStep, Role, StepTemplate, User } from "../types.ts";
import { btnGhost, btnPrimary, C, font, iStyle, ROLE_LABELS, sans } from "../theme.ts";
import { fmt, fmtDate } from "../lib/format.ts";
import { BO_COLORS, BO_DECISIONS } from "../lib/plan.ts";
import { Avatar, Field, RoleBadge } from "./ui.tsx";
import { api, ApiError, checkDocument, uploadDocument } from "../api.ts";

// ─── Risposta del Business Owner ─────────────────────────────
export function BOFormModal({ contract, currentUser, onSubmit, onClose }: { contract: Contract; currentUser: User; onSubmit: (id: number, r: { decision: string; notes: string }) => void; onClose: () => void }) {
  const [decision, setDecision] = useState(""); const [notes, setNotes] = useState(""); const [submitted, setSubmitted] = useState(false);
  const handleSubmit = () => { if (!decision) return; setSubmitted(true); setTimeout(() => { onSubmit(contract.id, { decision, notes }); onClose(); }, 1200); };
  return (
    <div className="dialog-overlay" role="dialog" aria-modal="true">
      <div className="dialog">
        {submitted ? (
          <div style={{ textAlign: "center", padding: "32px 0" }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
            <h3 style={{ ...font, color: C.green, margin: "0 0 8px" }}>Risposta registrata</h3>
            <p style={{ ...sans, color: C.muted, fontSize: 14 }}>Il piano verrà aggiornato automaticamente.</p>
          </div>
        ) : (
          <>
            <div style={{ background: C.navy, borderRadius: 10, padding: 14, marginBottom: 18 }}>
              <div style={{ ...sans, fontSize: 10, color: "rgba(255,255,255,0.4)", marginBottom: 4 }}>Richiesta da: {contract.owner} · Sistema automatico</div>
              <div style={{ ...sans, fontSize: 10, color: "rgba(255,255,255,0.4)", marginBottom: 8 }}>A: {contract.boEmail || currentUser.email}</div>
              <div style={{ ...font, fontSize: 14, color: "#fff", fontWeight: 700 }}>Decisione richiesta: {contract.supplier}</div>
            </div>
            <p style={{ ...sans, fontSize: 13, color: C.text, lineHeight: 1.6, marginBottom: 16 }}>
              Il contratto con <b>{contract.supplier}</b> scade il <b>{fmtDate(contract.end)}</b>.<br />
              Valore: <b>{fmt(contract.value, contract.currency)}</b>
            </p>
            <div style={{ marginBottom: 14 }}>
              {BO_DECISIONS.map(d => { const s = BO_COLORS[d]; const sel = decision === d; return (
                <button key={d} onClick={() => setDecision(d)} aria-pressed={sel} style={{ ...sans, width: "100%", marginBottom: 8, padding: "10px 14px", borderRadius: 8, border: `2px solid ${sel ? s.color : C.border}`, background: sel ? s.bg : "transparent", color: sel ? s.color : C.text, cursor: "pointer", fontSize: 13, fontWeight: sel ? 700 : 400, textAlign: "left" }}>{sel ? "✓ " : ""}{d}</button>
              ); })}
            </div>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Note / motivazioni..." aria-label="Note" style={{ ...iStyle, height: 72, resize: "none", marginBottom: 14 }} />
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={onClose} style={{ ...btnGhost, flex: 1 }}>Annulla</button>
              <button onClick={handleSubmit} disabled={!decision} style={{ ...btnPrimary, flex: 2, background: decision ? C.accent : C.border, cursor: decision ? "pointer" : "default" }}>✓ Invia risposta</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Cambio data di un'attività ──────────────────────────────
export function StepDateEditor({ step, tmpl, onSave, onClose }: { step: PlanStep; tmpl: StepTemplate; onSave: (date: string, reason: string) => void; onClose: () => void }) {
  const [newDate, setNewDate] = useState(step.scheduledDate); const [reason, setReason] = useState("");
  const diff = newDate ? Math.round((new Date(newDate).getTime() - new Date(step.originalDate).getTime()) / 864e5) : 0;
  const ok = !!newDate && !!reason.trim();
  return (
    <div className="dialog-overlay" role="dialog" aria-modal="true" style={{ zIndex: 300 }}>
      <div className="dialog" style={{ maxWidth: 380 }}>
        <h4 style={{ ...font, margin: "0 0 16px", fontSize: 16, color: C.navy }}>{tmpl.icon} {tmpl.label}</h4>
        <Field label="Data originale"><div style={{ ...sans, fontSize: 13, color: C.muted, padding: "8px 12px", background: C.bg, borderRadius: 6 }}>{fmtDate(step.originalDate)}</div></Field>
        <Field label="Nuova data" req htmlFor="step-date"><input id="step-date" type="date" value={newDate} onChange={e => setNewDate(e.target.value)} style={iStyle} /></Field>
        {newDate !== step.originalDate && diff !== 0 && (
          <div style={{ background: C.blueBg, borderRadius: 6, padding: 10, marginBottom: 14 }}>
            <div style={{ ...sans, fontSize: 12, color: C.blue }}>{diff < 0 ? `⏩ Anticipo di ${Math.abs(diff)} giorni` : `⏪ Posticipo di ${diff} giorni`}</div>
          </div>
        )}
        <Field label="Motivazione" req htmlFor="step-reason"><textarea id="step-reason" value={reason} onChange={e => setReason(e.target.value)} placeholder="Es. Distribuzione carico, periodo festivo..." style={{ ...iStyle, height: 64, resize: "none" }} /></Field>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onClose} style={{ ...btnGhost, flex: 1 }}>Annulla</button>
          <button onClick={() => ok && onSave(newDate, reason)} disabled={!ok} style={{ ...btnPrimary, flex: 2, background: ok ? C.accent : C.border, cursor: ok ? "pointer" : "default" }}>💾 Salva</button>
        </div>
      </div>
    </div>
  );
}

// ─── Form contratto ──────────────────────────────────────────
const CATEGORIES = ["Capex / Machinery","Professional Services IT","Logistica","ICT / Software","Materie Prime","Facility Services","HR Services","AMS","Utilities","Marketing","Legal","Finance","Altro"];
const TYPES = ["Fornitura","Servizi","AMS","SaaS","Licenza","Framework","NDA","Altro"];
const CURRENCIES = ["EUR","USD","GBP","CNY","CHF"];
const RENEWAL_OPTIONS = ["In negoziazione","Rinnovo automatico","Da rescindere","Da rilanciare a gara","Non definito"];

type FormState = Omit<ContractData, "value"> & { value: string | number };
type FormErrors = Partial<Record<"supplier" | "object" | "end" | "boEmail" | "file", string>>;
type TextField = "supplier" | "object" | "country" | "boEmail" | "category" | "type" | "currency" | "renewal";

export function ContractForm({ initial, currentUser, users, canUpload, onSave, onClose }: { initial: Contract | null; currentUser: User; users: User[]; canUpload: boolean; onSave: (data: ContractData) => void; onClose: () => void }) {
  const isBuyer = currentUser.role === "buyer";
  const owners = users.filter(u => u.active && (u.role === "buyer" || u.role === "manager")).map(u => u.name);
  if (!owners.includes(currentUser.name) && !isBuyer) owners.unshift(currentUser.name);
  const [form, setForm] = useState<FormState>(initial || { supplier: "", object: "", category: "", country: "Italia", value: "", currency: "EUR", start: "", end: "", owner: isBuyer ? currentUser.name : "", boEmail: "", renewal: "Non definito", type: "Servizi", notes: "", ceased: false, fileName: null, filePath: null });
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});
  // `file` è presente solo per un documento scelto ora (da caricare); `path` per uno già salvato.
  const [attachedFile, setAttachedFile] = useState<{ name: string; file?: File; path?: string | null } | null>(initial?.fileName ? { name: initial.fileName, path: initial.filePath } : null);
  const fileRef = useRef<HTMLInputElement>(null);
  const up = <K extends keyof FormState>(k: K) => (v: FormState[K]) => setForm(f => ({ ...f, [k]: v }));
  const isNew = !initial;
  const validate = () => {
    const e: FormErrors = {};
    if (!form.supplier.trim()) e.supplier = "Obbligatorio";
    if (!form.object.trim()) e.object = "Obbligatorio";
    if (!form.end) e.end = "Obbligatorio";
    else if (form.start && form.end < form.start) e.end = "La scadenza deve essere successiva alla data di inizio";
    if (form.boEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.boEmail)) e.boEmail = "Email non valida";
    if (isNew && !attachedFile) e.file = "Documento obbligatorio";
    setErrors(e);
    return !Object.keys(e).length;
  };
  const handleSave = async () => {
    if (busy || !validate()) return;
    let filePath = attachedFile?.path ?? null;
    if (attachedFile?.file) {
      filePath = null;
      if (canUpload) {
        setBusy(true);
        try { filePath = await uploadDocument(attachedFile.file); }
        catch (err) { setErrors(e => ({ ...e, file: err instanceof Error ? err.message : "Caricamento non riuscito" })); setBusy(false); return; }
        setBusy(false);
      }
    }
    onSave({ ...form, owner: form.owner || currentUser.name, value: parseFloat(String(form.value).replace(",", ".")) || 0, fileName: attachedFile?.name ?? null, filePath });
  };
  const fi = (key: TextField, ph: string, type = "text") => <input id={`f-${key}`} value={form[key]} onChange={e => up(key)(e.target.value)} placeholder={ph} type={type} style={{ ...iStyle, borderColor: (errors as Record<string, string | undefined>)[key] ? C.red : C.border }} />;
  const sel = (key: TextField, opts: string[]) => <select id={`f-${key}`} value={form[key]} onChange={e => up(key)(e.target.value)} style={iStyle}><option value="">— Seleziona —</option>{opts.map(o => <option key={o}>{o}</option>)}</select>;
  const two = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 } as const;
  return (
    <div className="sheet-overlay" role="dialog" aria-modal="true">
      <div className="sheet">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <h3 style={{ ...font, margin: 0, fontSize: 17, color: C.navy }}>{isNew ? "➕ Nuovo contratto" : "✏️ Modifica contratto"}</h3>
          <button onClick={onClose} aria-label="Chiudi" style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: C.muted }}>×</button>
        </div>
        <div style={two}>
          <Field label="Fornitore" req error={errors.supplier} htmlFor="f-supplier">{fi("supplier", "Es. Acme Srl")}</Field>
          <Field label="Oggetto" req error={errors.object} htmlFor="f-object">{fi("object", "Es. Fornitura logistica")}</Field>
        </div>
        <div style={two}><Field label="Categoria" htmlFor="f-category">{sel("category", CATEGORIES)}</Field><Field label="Tipo" htmlFor="f-type">{sel("type", TYPES)}</Field></div>
        <div style={{ ...two, gridTemplateColumns: "2fr 1fr" }}><Field label="Valore" htmlFor="f-value"><input id="f-value" value={form.value} onChange={e => up("value")(e.target.value)} type="number" min="0" style={iStyle} /></Field><Field label="Valuta" htmlFor="f-currency">{sel("currency", CURRENCIES)}</Field></div>
        <div style={two}>
          <Field label="Inizio" htmlFor="f-start"><input id="f-start" value={form.start} onChange={e => up("start")(e.target.value)} type="date" style={iStyle} /></Field>
          <Field label="Scadenza" req error={errors.end} htmlFor="f-end"><input id="f-end" value={form.end} onChange={e => up("end")(e.target.value)} type="date" style={{ ...iStyle, borderColor: errors.end ? C.red : C.border }} /></Field>
        </div>
        <div style={two}>
          <Field label="Paese" htmlFor="f-country">{fi("country", "Es. Italia")}</Field>
          <Field label="Contract Owner" htmlFor="f-owner">
            {isBuyer
              ? <div style={{ ...iStyle, background: "#f0ece4", color: C.muted }}>{currentUser.name} (tu)</div>
              : <select id="f-owner" value={form.owner} onChange={e => up("owner")(e.target.value)} style={iStyle}><option value="">— Seleziona —</option>{owners.map(o => <option key={o}>{o}</option>)}</select>}
          </Field>
        </div>
        <div style={two}>
          <Field label="Email Business Owner" error={errors.boEmail} htmlFor="f-boEmail">{fi("boEmail", "bo@azienda.it", "email")}</Field>
          <Field label="Stato rinnovo" htmlFor="f-renewal">{sel("renewal", RENEWAL_OPTIONS)}</Field>
        </div>
        <Field label="Note" htmlFor="f-notes"><textarea id="f-notes" value={form.notes} onChange={e => up("notes")(e.target.value)} style={{ ...iStyle, height: 60, resize: "vertical" }} /></Field>
        <Field label="Documento" req={isNew}>
          <input ref={fileRef} type="file" accept=".pdf,.doc,.docx" onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; if (!f) return; const err = checkDocument(f); if (err) { setErrors(x => ({ ...x, file: err })); return; } setErrors(x => ({ ...x, file: undefined })); setAttachedFile({ name: f.name, file: f }); }} style={{ display: "none" }} />
          {!attachedFile
            ? <button type="button" onClick={() => fileRef.current?.click()} style={{ ...sans, width: "100%", padding: "12px", background: errors.file ? C.redBg : C.bg, border: `2px dashed ${errors.file ? C.red : C.border}`, borderRadius: 8, color: errors.file ? C.red : C.muted, cursor: "pointer", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>📎 Allega PDF o Word{isNew && <span style={{ color: C.red }}>*</span>}</button>
            : <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: C.greenBg, border: `1px solid ${C.green}`, borderRadius: 8 }}>📄<div style={{ flex: 1, minWidth: 0, ...sans, fontSize: 13, fontWeight: 600, color: C.green, overflow: "hidden", textOverflow: "ellipsis" }}>{attachedFile.name}{attachedFile.file && canUpload && <span style={{ fontWeight: 400, color: C.muted }}> · verrà caricato al salvataggio</span>}{!attachedFile.file && !attachedFile.path && canUpload && <span style={{ fontWeight: 400, color: C.yellow }}> · non salvato: ricarica il file</span>}</div><button type="button" onClick={() => fileRef.current?.click()} style={{ ...sans, background: "none", border: "none", color: C.accent, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>Sostituisci</button><button type="button" onClick={() => setAttachedFile(null)} aria-label="Rimuovi documento" style={{ background: "none", border: "none", color: C.muted, cursor: "pointer" }}>×</button></div>}
          {errors.file && <div role="alert" style={{ ...sans, fontSize: 11, color: C.red, marginTop: 6 }}>⚠️ {errors.file}</div>}
        </Field>
        {initial && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, padding: 12, background: form.ceased ? C.grayBg : C.greenBg, borderRadius: 8 }}>
            <input type="checkbox" checked={form.ceased} onChange={e => up("ceased")(e.target.checked)} id="ceased" style={{ width: 18, height: 18 }} />
            <label htmlFor="ceased" style={{ ...sans, fontSize: 13, color: form.ceased ? C.gray : C.green, fontWeight: 600, cursor: "pointer" }}>{form.ceased ? "⚫ Cessato" : "🟢 Attivo"}</label>
          </div>
        )}
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onClose} style={{ ...btnGhost, flex: 1, padding: 12 }}>Annulla</button>
          <button onClick={handleSave} disabled={busy} style={{ ...btnPrimary, flex: 2, padding: 12, opacity: busy ? 0.7 : 1 }}>{busy ? "Caricamento documento…" : isNew ? "➕ Aggiungi" : "💾 Salva"}</button>
        </div>
      </div>
    </div>
  );
}

// ─── Account: info, cambio password, uscita ──────────────────
export function AccountModal({ user, canChangePassword, onLogout, onClose }: { user: User; canChangePassword: boolean; onLogout: () => void; onClose: () => void }) {
  const [current, setCurrent] = useState(""); const [next, setNext] = useState(""); const [again, setAgain] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null); const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next !== again) return setMsg({ ok: false, text: "Le due password nuove non coincidono" });
    if (next.length < 8) return setMsg({ ok: false, text: "La nuova password deve avere almeno 8 caratteri" });
    setBusy(true); setMsg(null);
    try { await api.changePassword(current, next); setMsg({ ok: true, text: "Password aggiornata" }); setCurrent(""); setNext(""); setAgain(""); }
    catch (err) { setMsg({ ok: false, text: err instanceof ApiError ? err.message : "Operazione non riuscita" }); }
    setBusy(false);
  };
  return (
    <div className="dialog-overlay" role="dialog" aria-modal="true" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog">
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 18 }}>
          <Avatar name={user.name} size={52} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ ...font, fontSize: 17, fontWeight: 700, color: C.navy }}>{user.name}</div>
            <div style={{ ...sans, fontSize: 12, color: C.muted, overflow: "hidden", textOverflow: "ellipsis" }}>{user.email}</div>
            <div style={{ marginTop: 4 }}><RoleBadge role={user.role} /></div>
          </div>
          <button onClick={onClose} aria-label="Chiudi" style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: C.muted, alignSelf: "flex-start" }}>×</button>
        </div>
        {canChangePassword && (
          <form onSubmit={submit} style={{ borderTop: `1px solid ${C.borderLight}`, paddingTop: 16, marginBottom: 12 }}>
            <div style={{ ...sans, fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Cambia password</div>
            <input type="text" autoComplete="username" value={user.email} readOnly hidden />
            <Field label="Password attuale" htmlFor="pw-cur"><input id="pw-cur" type="password" autoComplete="current-password" required value={current} onChange={e => setCurrent(e.target.value)} style={iStyle} /></Field>
            <Field label="Nuova password (min. 8 caratteri)" htmlFor="pw-new"><input id="pw-new" type="password" autoComplete="new-password" required value={next} onChange={e => setNext(e.target.value)} style={iStyle} /></Field>
            <Field label="Ripeti nuova password" htmlFor="pw-again"><input id="pw-again" type="password" autoComplete="new-password" required value={again} onChange={e => setAgain(e.target.value)} style={iStyle} /></Field>
            {msg && <div role="alert" style={{ ...sans, fontSize: 12, marginBottom: 10, color: msg.ok ? C.green : C.red }}>{msg.text}</div>}
            <button type="submit" disabled={busy} style={{ ...btnPrimary, width: "100%", background: C.navy, opacity: busy ? 0.7 : 1 }}>Aggiorna password</button>
          </form>
        )}
        <button onClick={onLogout} style={{ ...btnGhost, width: "100%", color: C.red, borderColor: C.red }}>Esci</button>
      </div>
    </div>
  );
}

// ─── Nuovo utente / reimposta password (solo manager) ────────
export function NewUserModal({ onSave, onClose }: { onSave: (input: NewUserInput) => Promise<string | null>; onClose: () => void }) {
  const [f, setF] = useState<NewUserInput>({ email: "", name: "", role: "buyer", title: "", password: "" });
  const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    const err = await onSave(f);
    if (err) { setError(err); setBusy(false); }
  };
  return (
    <div className="dialog-overlay" role="dialog" aria-modal="true">
      <form className="dialog" onSubmit={submit}>
        <h3 style={{ ...font, margin: "0 0 16px", fontSize: 17, color: C.navy }}>➕ Nuovo utente</h3>
        <Field label="Nome e cognome" req htmlFor="u-name"><input id="u-name" required value={f.name} onChange={e => setF({ ...f, name: e.target.value })} style={iStyle} /></Field>
        <Field label="Email" req htmlFor="u-email"><input id="u-email" type="email" required value={f.email} onChange={e => setF({ ...f, email: e.target.value })} style={iStyle} /></Field>
        <Field label="Ruolo" req htmlFor="u-role">
          <select id="u-role" value={f.role} onChange={e => setF({ ...f, role: e.target.value as Role })} style={iStyle}>{(Object.keys(ROLE_LABELS) as Role[]).map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</select>
        </Field>
        <Field label="Funzione" htmlFor="u-title"><input id="u-title" value={f.title} onChange={e => setF({ ...f, title: e.target.value })} placeholder="Es. Buyer ICT" style={iStyle} /></Field>
        <Field label="Password iniziale (min. 8 caratteri)" req htmlFor="u-pw"><input id="u-pw" type="text" autoComplete="off" required minLength={8} value={f.password} onChange={e => setF({ ...f, password: e.target.value })} style={iStyle} /></Field>
        <p style={{ ...sans, fontSize: 11, color: C.muted, margin: "-6px 0 14px" }}>Comunicala all'utente in modo sicuro: potrà cambiarla dal suo account.</p>
        {error && <div role="alert" style={{ ...sans, background: C.redBg, color: C.red, borderRadius: 8, padding: "10px 12px", fontSize: 13, marginBottom: 14 }}>{error}</div>}
        <div style={{ display: "flex", gap: 10 }}>
          <button type="button" onClick={onClose} style={{ ...btnGhost, flex: 1 }}>Annulla</button>
          <button type="submit" disabled={busy} style={{ ...btnPrimary, flex: 2, opacity: busy ? 0.7 : 1 }}>Crea utente</button>
        </div>
      </form>
    </div>
  );
}

export function ResetPasswordModal({ user, onSave, onClose }: { user: User; onSave: (password: string) => Promise<string | null>; onClose: () => void }) {
  const [pw, setPw] = useState(""); const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => { e.preventDefault(); setBusy(true); setError(null); const err = await onSave(pw); if (err) { setError(err); setBusy(false); } };
  return (
    <div className="dialog-overlay" role="dialog" aria-modal="true">
      <form className="dialog" onSubmit={submit}>
        <h3 style={{ ...font, margin: "0 0 6px", fontSize: 17, color: C.navy }}>🔑 Reimposta password</h3>
        <p style={{ ...sans, fontSize: 13, color: C.muted, margin: "0 0 16px" }}>{user.name} · {user.email}</p>
        <Field label="Nuova password (min. 8 caratteri)" req htmlFor="r-pw"><input id="r-pw" type="text" autoComplete="off" required minLength={8} value={pw} onChange={e => setPw(e.target.value)} style={iStyle} /></Field>
        {error && <div role="alert" style={{ ...sans, background: C.redBg, color: C.red, borderRadius: 8, padding: "10px 12px", fontSize: 13, marginBottom: 14 }}>{error}</div>}
        <div style={{ display: "flex", gap: 10 }}>
          <button type="button" onClick={onClose} style={{ ...btnGhost, flex: 1 }}>Annulla</button>
          <button type="submit" disabled={busy} style={{ ...btnPrimary, flex: 2, opacity: busy ? 0.7 : 1 }}>Salva</button>
        </div>
      </form>
    </div>
  );
}
