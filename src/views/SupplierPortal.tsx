import { useEffect, useRef, useState } from "react";
import type { ResolvedDocType, Supplier, SupplierData, SupplierDocument } from "../types.ts";
import { ApiError, myDataExportUrl, portalApi, uploadSupplierDocument } from "../api.ts";
import { btnGhost, btnPrimary, C, font, iStyle, radius, sans } from "../theme.ts";
import { fmtDate } from "../lib/format.ts";
import { COUNTRIES, countryName, CURRENCIES, DOC_EXTENSIONS, MAX_DOC_BYTES, missingRequired, REGION_REQUIRED, validateDeclarations, validateSupplierData, WITHHOLDING_TYPES } from "../supplierRules.ts";
import { Card, CardTitle, EmptyState, Field } from "../components/ui.tsx";
import { ArrowLeft, ArrowRight, CheckCircle2, Clock, FileCheck2, Loader2, Paperclip, Pencil, Save, Send, Trash2, Building2, Wallet, History } from "../components/icons.tsx";
import { AiResult, DocLink, KV, Notice, StatusBadge, ValidityChip } from "../components/vendorUi.tsx";
import { SupplierRfqs } from "../components/SupplierRfqs.tsx";
import { fmtSize, supplierTimeline } from "../lib/vendors.ts";
import { docValidity } from "../supplierRules.ts";

const STEPS = ["Società e indirizzo", "Pagamenti e contatti", "Documenti", "Riepilogo e invio"];
const TRACK = ["Compilazione", "Verifica Buyer", "Verifica Finance", "Registrato"];
const trackIndex = (s: Supplier) => ({ invited: 0, draft: 0, pending_revision: 0, rejected: 0, pending: 1, approved: 2, registered: 3 })[s.status];
const stepOf = (key: string) => (key.startsWith("company.") || key.startsWith("address.") ? 0 : key.startsWith("payment.") || key.startsWith("contacts.") ? 1 : key === "acceptedTerms" || key.startsWith("declarations.") ? 3 : 0);

const checkFile = (f: File): string | null => {
  const ext = f.name.toLowerCase().split(".").pop() ?? "";
  if (!DOC_EXTENSIONS.includes(ext)) return "Formato non supportato: usa PDF, Word, PowerPoint o immagini (JPG, PNG)";
  if (f.size === 0) return "Il file è vuoto";
  if (f.size > MAX_DOC_BYTES) return `Il file supera il limite di ${MAX_DOC_BYTES / 1024 / 1024} MB`;
  return null;
};

// Campi definiti fuori dal componente principale: così non perdono il focus a ogni tasto premuto.
function TextField({ id, label, value, onChange, error, req, type = "text", hint, disabled, placeholder, inputMode, autoComplete }: { id: string; label: string; value?: string; onChange: (v: string) => void; error?: string; req?: boolean; type?: string; hint?: string; disabled?: boolean; placeholder?: string; inputMode?: "text" | "numeric" | "email" | "tel"; autoComplete?: string }) {
  return (
    <Field label={label} req={req} error={error} htmlFor={id}>
      <input id={id} type={type} value={value ?? ""} onChange={e => onChange(e.target.value)} disabled={disabled} placeholder={placeholder} inputMode={inputMode} autoComplete={autoComplete ?? "off"} aria-invalid={!!error} style={{ ...iStyle, ...(error ? { borderColor: C.red } : {}), ...(disabled ? { background: C.bg } : {}) }} />
      {hint && !error && <div style={{ ...sans, fontSize: 11.5, color: C.subtle, marginTop: 4 }}>{hint}</div>}
    </Field>
  );
}
function SelectField({ id, label, value, onChange, options, error, req, disabled }: { id: string; label: string; value?: string; onChange: (v: string) => void; options: { value: string; label: string }[]; error?: string; req?: boolean; disabled?: boolean }) {
  return (
    <Field label={label} req={req} error={error} htmlFor={id}>
      <select id={id} value={value ?? ""} onChange={e => onChange(e.target.value)} disabled={disabled} aria-invalid={!!error} style={{ ...iStyle, ...(error ? { borderColor: C.red } : {}) }}>
        <option value="">Seleziona…</option>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </Field>
  );
}
const Cols = ({ children }: { children: React.ReactNode }) => <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 230px), 1fr))", columnGap: 14 }}>{children}</div>;

// ─── Slot di un tipo di documento ────────────────────────────
function DocSlot({ type, docs, editable, checking, onUpload, onRemove }: { type: ResolvedDocType; docs: SupplierDocument[]; editable: boolean; checking: number[]; onUpload: (t: ResolvedDocType, f: File, validUntil: string | null) => Promise<string | null>; onRemove: (d: SupplierDocument) => Promise<void> }) {
  const [date, setDate] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const pick = () => { setError(null); if (type.expires && !date) { setError("Indica prima la data di scadenza del documento"); return; } input.current?.click(); };
  const chosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; e.target.value = ""; if (!f) return;
    setBusy(true); const err = await onUpload(type, f, type.expires ? date : null); setBusy(false);
    if (err) setError(err); else setDate("");
  };
  const missing = type.required && !docs.some(d => docValidity(d.validUntil) !== "expired");
  return (
    <div style={{ border: `1px solid ${missing ? "#f0c9c9" : C.border}`, borderRadius: radius.md, padding: 14, background: "#fff" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
        <div style={{ ...sans, fontSize: 14, fontWeight: 650, color: C.text }}>{type.label}</div>
        <span style={{ ...sans, fontSize: 11, fontWeight: 650, color: type.required ? C.red : C.subtle }}>{type.required ? "Obbligatorio" : "Facoltativo"}</span>
      </div>
      <div style={{ ...sans, fontSize: 12.5, color: C.muted, margin: "3px 0 10px", lineHeight: 1.5 }}>{type.help}</div>
      {docs.map(d => (
        <div key={d.id} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "8px 10px", background: C.bg, borderRadius: 10, marginBottom: 6 }}>
          <Paperclip size={15} color={C.subtle} />
          <div style={{ minWidth: 0, flex: "1 1 180px" }}>
            <div style={{ ...sans, fontSize: 13, fontWeight: 600, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.fileName}</div>
            <div style={{ ...sans, fontSize: 11.5, color: C.subtle }}>{fmtSize(d.size)} · caricato il {fmtDate(d.uploadedAt)}</div>
          </div>
          <ValidityChip validUntil={d.validUntil} />
          <DocLink id={d.id} name={d.fileName} />
          {editable && <button onClick={() => onRemove(d)} aria-label={`Rimuovi ${d.fileName}`} style={{ background: "none", border: "none", cursor: "pointer", color: C.subtle, padding: 4, display: "flex" }}><Trash2 size={16} /></button>}
          {checking.includes(d.id) ? <div style={{ ...sans, flexBasis: "100%", display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: C.muted }}><Loader2 className="spin" size={14} />Controllo del documento in corso…</div> : <AiResult check={d.ai} audience="supplier" />}
        </div>
      ))}
      {editable && (
        <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap", marginTop: 6 }}>
          {type.expires && (
            <div>
              <label htmlFor={`d-${type.key}`} style={{ ...sans, display: "block", fontSize: 11.5, color: C.muted, fontWeight: 600, marginBottom: 4 }}>Data di scadenza del documento</label>
              <input id={`d-${type.key}`} type="date" value={date} onChange={e => setDate(e.target.value)} style={{ ...iStyle, width: 170, padding: "8px 10px" }} />
            </div>
          )}
          <button type="button" onClick={pick} disabled={busy} style={{ ...btnGhost, padding: "9px 14px", display: "inline-flex", alignItems: "center", gap: 7, color: C.text, fontSize: 13 }}>
            {busy ? <Loader2 className="spin" size={15} /> : <Paperclip size={15} />}{docs.length && !type.multiple ? "Sostituisci file" : "Carica file"}
          </button>
          <input ref={input} type="file" hidden accept={DOC_EXTENSIONS.map(e => `.${e}`).join(",")} onChange={chosen} />
        </div>
      )}
      {error && <div role="alert" style={{ ...sans, fontSize: 12, color: C.red, marginTop: 8 }}>{error}</div>}
    </div>
  );
}

// ─── Area del fornitore ──────────────────────────────────────
interface Props { onSessionExpired: () => void; notify: (m: string) => void }

export function SupplierPortal({ onSessionExpired, notify }: Props) {
  const [s, setS] = useState<Supplier | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [data, setData] = useState<SupplierData>({});
  const [step, setStep] = useState(0);
  const [editing, setEditing] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState<number[]>([]);
  const [formError, setFormError] = useState<string | null>(null);

  const fail = (err: unknown): string => {
    if (err instanceof ApiError && err.status === 401) { onSessionExpired(); return "Sessione scaduta"; }
    return err instanceof Error ? err.message : "Operazione non riuscita";
  };
  const adopt = (sup: Supplier) => { setS(sup); setData(sup.data); };

  useEffect(() => {
    let off = false;
    portalApi.myself().then(sup => {
      if (off) return;
      setS(sup);
      // Prima compilazione: precompila ragione sociale ed email con quelle dell'invito.
      setData(sup.data.company?.legalName ? sup.data : { ...sup.data, company: { ...sup.data.company, legalName: sup.name }, contacts: { language: "IT", ordersEmail: sup.email, adminEmail: sup.email, ...sup.data.contacts } });
    })
      .catch(err => { if (!off) setLoadError(fail(err)); });
    return () => { off = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loadError) return <EmptyState title="Impossibile caricare la tua scheda" text={loadError} />;
  if (!s) return <div style={{ display: "flex", justifyContent: "center", padding: 60 }}><Loader2 className="spin" size={26} color={C.subtle} /></div>;

  // Un fornitore registrato (anche con un aggiornamento già in verifica) può modificare dati e documenti in autonomia.
  const amending = s.status === "registered" || (s.status === "pending" && s.isUpdate);
  const wizard = s.status === "draft" || s.status === "pending_revision" || s.status === "rejected" || (amending && editing);
  const country = data.address?.country;
  const dirty = JSON.stringify(data) !== JSON.stringify(s.data);
  const localErrors = validateSupplierData(data);
  // Le dichiarazioni (conflitto d'interessi, sanzioni, privacy) si rendono al primo invio della registrazione.
  const declErrors = amending ? {} : validateDeclarations(data);
  const errors = { ...serverErrors, ...(showErrors ? { ...localErrors, ...declErrors } : {}) };
  const decl = data.declarations ?? {};
  const setDecl = (patch: NonNullable<SupplierData["declarations"]>) => { setData(d => ({ ...d, declarations: { ...d.declarations, ...patch } })); setServerErrors({}); };
  const bankKeyOf = (d: SupplierData) => [d.payment?.iban, d.payment?.accountNumber, d.payment?.swift].map(x => (x ?? "").replace(/\s+/g, "").toUpperCase()).join("|");
  const bankEdited = amending && bankKeyOf(data) !== bankKeyOf(s.data);
  const docs = s.documents.map(d => ({ type: d.type, validUntil: d.validUntil }));
  const missing = missingRequired(s.docTypes, docs);
  const labelOf = (k: string) => s.docTypes.find(t => t.key === k)?.label ?? k;
  const cantSubmit = !(Object.keys(localErrors).length === 0 && Object.keys(declErrors).length === 0 && missing.length === 0 && (amending || data.acceptedTerms));
  const set = <K extends keyof SupplierData>(group: K, patch: Partial<NonNullable<SupplierData[K]>>) => { setData(d => ({ ...d, [group]: { ...(d[group] as object | undefined), ...patch } })); setServerErrors({}); };

  const saveNow = async (): Promise<boolean> => {
    if (!dirty) return true;
    try { adopt(await portalApi.save(data)); return true; } catch (err) { setFormError(fail(err)); return false; }
  };

  const goTo = async (n: number) => {
    setFormError(null);
    if (!amending && !(await saveNow())) return;
    setStep(n); window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const next = async () => {
    if (step === 0 || step === 1) {
      const keys = Object.keys(localErrors).filter(k => stepOf(k) === step);
      if (keys.length) { setShowErrors(true); setFormError("Controlla i campi evidenziati prima di proseguire."); return; }
    }
    await goTo(step + 1);
  };
  const saveDraft = async () => { setBusy(true); setFormError(null); if (await saveNow()) notify("Bozza salvata"); setBusy(false); };

  const submit = async () => {
    setBusy(true); setFormError(null);
    try {
      if (amending) {
        if (!dirty) { setFormError("Non hai modificato nessun dato."); setBusy(false); return; }
        adopt(await portalApi.save(data)); setEditing(false); notify("Modifiche inviate: ora sono in verifica");
      } else {
        const saved = await portalApi.save({ ...data, acceptedTerms: !!data.acceptedTerms });
        adopt(saved);
        adopt(await portalApi.submit()); notify("Registrazione inviata: ti avviseremo via email");
      }
      setShowErrors(false); setServerErrors({});
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) {
        const fe = (err.data.fieldErrors ?? {}) as Record<string, string>; setServerErrors(fe); setShowErrors(true);
        setFormError("Mancano alcune informazioni: trovi i dettagli qui sotto.");
      } else setFormError(fail(err));
    }
    setBusy(false);
  };

  const uploadDoc = async (t: ResolvedDocType, f: File, validUntil: string | null): Promise<string | null> => {
    const bad = checkFile(f); if (bad) return bad;
    try {
      if (!(await saveNow())) return "Salva prima i dati: correggi gli errori indicati";
      const path = await uploadSupplierDocument(f);
      const added = await portalApi.addDocument({ type: t.key, fileName: f.name, filePath: path, size: f.size, validUntil });
      adopt(added.supplier); notify(`${t.label} caricato`);
      // Primo controllo automatico del documento, in una richiesta a parte: il caricamento è già completato.
      setChecking(c => [...c, added.docId]);
      portalApi.checkDocument(added.docId).then(adopt).catch(() => undefined).finally(() => setChecking(c => c.filter(x => x !== added.docId)));
      return null;
    } catch (err) { return fail(err); }
  };
  const removeDoc = async (d: SupplierDocument) => {
    if (!window.confirm(`Rimuovere "${d.fileName}"?`)) return;
    try { if (await saveNow()) adopt(await portalApi.removeDocument(d.id)); } catch (err) { notify(`⚠️ ${fail(err)}`); }
  };

  // ─── Parti della pagina ────────────────────────────────────
  const idx = trackIndex(s);
  const tracker = (
    <Card style={{ padding: "18px 20px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ ...font, fontSize: 20, fontWeight: 700, color: C.text }}>{s.name}</div>
          <div style={{ ...sans, fontSize: 12.5, color: C.muted, marginTop: 2 }}>{s.companyCodes.length ? `Registrazione richiesta da: ${s.companyCodes.join(", ")}` : ""}</div>
        </div>
        <StatusBadge status={s.status} update={s.isUpdate} />
      </div>
      <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 6 }}>
        {TRACK.map((t, i) => {
          const done = i < idx || (i === idx && s.status === "registered"); const cur = i === idx && !done;
          return (
            <li key={t} aria-current={cur ? "step" : undefined} style={{ textAlign: "center", minWidth: 0 }}>
              <div style={{ height: 4, borderRadius: 4, background: done || cur ? (done ? C.green : C.accent) : C.borderLight, marginBottom: 8 }} />
              <div style={{ ...sans, fontSize: 11.5, fontWeight: cur || done ? 650 : 500, color: done ? C.green : cur ? C.text : C.subtle, overflow: "hidden", textOverflow: "ellipsis" }}>{t}</div>
            </li>
          );
        })}
      </ol>
    </Card>
  );

  const banner = (() => {
    if (s.lifecycle === "blocked") return <Notice kind="error"><b>La tua anagrafica è temporaneamente bloccata.</b>{s.lifecycleReason ? <><br />{s.lifecycleReason}</> : null}<br />Puoi aggiornare dati e documenti; per chiarimenti contatta il Buyer di riferimento.</Notice>;
    if (s.status === "pending_revision") return <Notice kind="warn"><b>Il Buyer ha chiesto delle modifiche.</b><br />{s.rejectionReason}<br />Correggi i dati o i documenti indicati e invia di nuovo la registrazione.</Notice>;
    if (s.status === "rejected") return <Notice kind="error"><b>La registrazione non è stata approvata.</b><br />{s.rejectionReason}<br />Se pensi sia un errore o vuoi correggere le informazioni, puoi modificarle e inviare di nuovo.</Notice>;
    if (s.status === "pending") return <Notice kind="info"><b>{s.isUpdate ? "Le tue modifiche sono in verifica." : "Registrazione inviata."}</b> Il Buyer sta controllando i dati e i documenti. Fino alla decisione non puoi modificarli; riceverai un'email a ogni passaggio.</Notice>;
    if (s.status === "approved") return <Notice kind="info"><b>Approvata dal Buyer.</b> Ora il team Finance completa la tua registrazione nei sistemi aziendali. Riceverai il codice fornitore via email.</Notice>;
    if (s.status === "registered") return <Notice kind="ok"><b>Sei registrato come fornitore{s.sapCode ? ` (codice ${s.sapCode})` : ""}.</b> Puoi tenere aggiornati dati e documenti da qui: ogni modifica viene ricontrollata prima di essere applicata.</Notice>;
    if (s.status === "draft") return <Notice kind="info"><b>Benvenuto!</b> Compila i dati della tua azienda e carica i documenti di qualifica. Puoi salvare una bozza e riprendere quando vuoi con la stessa email e password.</Notice>;
    return null;
  })();

  const expiring = s.documents.filter(d => ["expired", "expiring"].includes(docValidity(d.validUntil)));
  const missingNow = missing.filter(k => !expiring.some(d => d.type === k));
  const expiryNotice = amending && (expiring.length > 0 || missingNow.length > 0) && (
    <Notice kind="warn"><b>Documenti da caricare o rinnovare:</b> {[...missingNow.map(k => `${labelOf(k)} (mancante)`), ...expiring.map(d => `${d.typeLabel} (${docValidity(d.validUntil) === "expired" ? "scaduto" : "in scadenza"} il ${fmtDate(d.validUntil!)})`)].join("; ")}. Carica la versione aggiornata nella sezione Documenti qui sotto.</Notice>
  );

  const err = (k: string) => errors[k];
  const wizardBody = (
    <Card style={{ padding: 0, overflow: "hidden" }}>
      <div style={{ display: "flex", overflowX: "auto", borderBottom: `1px solid ${C.border}`, background: C.bg }} role="tablist" aria-label="Passaggi">
        {STEPS.map((t, i) => {
          const on = i === step;
          const hasErr = showErrors && ((i < 2 && Object.keys(errors).some(k => stepOf(k) === i)) || (i === 2 && missing.length > 0));
          return (
            <button key={t} role="tab" aria-selected={on} onClick={() => goTo(i)} style={{ ...sans, flex: "1 0 auto", display: "flex", alignItems: "center", gap: 8, padding: "13px 16px", border: "none", borderBottom: `3px solid ${on ? C.accent : "transparent"}`, background: on ? "#fff" : "transparent", cursor: "pointer", fontSize: 13, fontWeight: on ? 700 : 550, color: on ? C.text : C.muted, whiteSpace: "nowrap" }}>
              <span style={{ width: 22, height: 22, borderRadius: "50%", background: hasErr ? C.red : on ? C.accent : "#cfd4e0", color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 11.5, fontWeight: 700 }}>{hasErr ? "!" : i + 1}</span>{t}
            </button>
          );
        })}
      </div>
      <div style={{ padding: 20 }}>
        {step === 0 && (<>
          <CardTitle icon={<Building2 size={16} />}>Dati della società</CardTitle>
          <TextField id="legal" label="Ragione sociale" req value={data.company?.legalName} onChange={v => set("company", { legalName: v })} error={err("company.legalName")} autoComplete="organization" />
          <Cols>
            <TextField id="vat" label="Partita IVA / VAT" req value={data.company?.vatCode} onChange={v => set("company", { vatCode: v })} error={err("company.vatCode")} hint={country === "IT" ? "11 cifre, es. 12345678901" : country === "BR" ? "CNPJ, 14 cifre" : undefined} />
            <TextField id="fiscal" label="Codice fiscale" req value={data.company?.fiscalCode} onChange={v => set("company", { fiscalCode: v })} error={err("company.fiscalCode")} hint="Se non lo hai, ripeti la partita IVA" />
          </Cols>
          <div style={{ height: 6 }} />
          <CardTitle>Sede legale</CardTitle>
          <SelectField id="country" label="Paese" req value={country} onChange={v => set("address", { country: v })} error={err("address.country")} options={COUNTRIES.map(c => ({ value: c.code, label: c.name }))} />
          {country === "BR" && <Notice kind="warn">Per i fornitori brasiliani servono dati fiscali aggiuntivi che il portale non raccoglie ancora: puoi compilare e inviare la scheda, ma la registrazione definitiva sarà completata dal tuo referente.</Notice>}
          <Cols>
            <TextField id="street" label="Via / indirizzo" req value={data.address?.street} onChange={v => set("address", { street: v })} error={err("address.street")} autoComplete="address-line1" />
            <TextField id="house" label="Numero civico" value={data.address?.houseNumber} onChange={v => set("address", { houseNumber: v })} />
            <TextField id="zip" label="CAP / codice postale" req value={data.address?.postalCode} onChange={v => set("address", { postalCode: v })} error={err("address.postalCode")} autoComplete="postal-code" />
            <TextField id="city" label="Città" req value={data.address?.city} onChange={v => set("address", { city: v })} error={err("address.city")} autoComplete="address-level2" />
            <TextField id="region" label={country === "IT" ? "Provincia (sigla)" : "Regione / stato"} req={!!country && REGION_REQUIRED.includes(country)} value={data.address?.region} onChange={v => set("address", { region: v })} error={err("address.region")} />
          </Cols>
        </>)}

        {step === 1 && (<>
          <CardTitle icon={<Wallet size={16} />}>Coordinate bancarie</CardTitle>
          <Cols>
            <TextField id="iban" label="IBAN" req={country !== "BR"} value={data.payment?.iban} onChange={v => set("payment", { iban: v })} error={err("payment.iban")} placeholder="IT60 X054 2811 1010 0000 0123 456" />
            <TextField id="swift" label="SWIFT / BIC" req value={data.payment?.swift} onChange={v => set("payment", { swift: v })} error={err("payment.swift")} hint="8 o 11 caratteri" />
            <TextField id="bank" label="Nome della banca" req value={data.payment?.bankName} onChange={v => set("payment", { bankName: v })} error={err("payment.bankName")} />
            <TextField id="acc" label="Numero di conto" req value={data.payment?.accountNumber} onChange={v => set("payment", { accountNumber: v })} error={err("payment.accountNumber")} />
            <SelectField id="cur" label="Valuta del conto" req value={data.payment?.currency} onChange={v => set("payment", { currency: v })} error={err("payment.currency")} options={CURRENCIES.map(c => ({ value: c, label: c }))} />
          </Cols>
          {bankEdited && <div style={{ marginBottom: 12 }}><Notice kind="warn"><b>Stai cambiando le coordinate bancarie.</b> Per sicurezza carica anche una nuova lettera della banca (su carta intestata) nella sezione Documenti: senza, la modifica non può essere approvata. Riceverai un'email di conferma del cambio.</Notice></div>}
          {country === "IT" && (<>
            <Field label="Applichi la ritenuta d'acconto?" req error={err("payment.withholdingTax")}>
              <div style={{ display: "flex", gap: 10 }}>
                {[[true, "Sì"], [false, "No"]].map(([v, l]) => { const on = data.payment?.withholdingTax === v; return (
                  <button key={String(v)} type="button" aria-pressed={on} onClick={() => set("payment", { withholdingTax: v as boolean })} style={{ ...sans, minWidth: 80, padding: "9px 18px", borderRadius: 10, border: `2px solid ${on ? C.accent : C.border}`, background: on ? C.accentLight : "#fff", color: on ? C.accent : C.text, fontWeight: 650, cursor: "pointer" }}>{l as string}</button>
                ); })}
              </div>
            </Field>
            {data.payment?.withholdingTax && (
              <Cols>
                <SelectField id="wt" label="Tipo di ritenuta" req value={data.payment?.withholdingType} onChange={v => set("payment", { withholdingType: v })} error={err("payment.withholdingType")} options={WITHHOLDING_TYPES.map(w => ({ value: w.code, label: w.label }))} />
                {data.payment?.withholdingType === "other" && <TextField id="ws" label="Specifica" req value={data.payment?.withholdingSpec} onChange={v => set("payment", { withholdingSpec: v })} error={err("payment.withholdingSpec")} />}
              </Cols>
            )}
          </>)}
          <div style={{ height: 6 }} />
          <CardTitle>Contatti</CardTitle>
          <Cols>
            <SelectField id="lang" label="Lingua delle comunicazioni" req value={data.contacts?.language} onChange={v => set("contacts", { language: v as "IT" | "EN" })} error={err("contacts.language")} options={[{ value: "IT", label: "Italiano" }, { value: "EN", label: "English" }]} />
            <TextField id="oe" label="Email per gli ordini" req type="email" inputMode="email" value={data.contacts?.ordersEmail} onChange={v => set("contacts", { ordersEmail: v })} error={err("contacts.ordersEmail")} />
            <TextField id="ae" label="Email amministrativa" req type="email" inputMode="email" value={data.contacts?.adminEmail} onChange={v => set("contacts", { adminEmail: v })} error={err("contacts.adminEmail")} />
            <TextField id="ph" label="Telefono" req type="tel" inputMode="tel" value={data.contacts?.phone} onChange={v => set("contacts", { phone: v })} error={err("contacts.phone")} placeholder="+39 02 1234567" />
          </Cols>
        </>)}

        {step === 2 && (<>
          <CardTitle icon={<FileCheck2 size={16} />}>Documentazione di qualifica</CardTitle>
          <p style={{ ...sans, fontSize: 13, color: C.muted, margin: "0 0 14px", lineHeight: 1.55 }}>Carica un file per ogni documento richiesto (PDF, Word, PowerPoint o immagine, massimo {MAX_DOC_BYTES / 1024 / 1024} MB). Per i documenti con scadenza indica la data: ti ricorderemo di rinnovarli.</p>
          {!country && <Notice kind="warn">Seleziona prima il paese nel passaggio “Società e indirizzo”: i documenti richiesti dipendono dal paese.</Notice>}
          {showErrors && missing.length > 0 && <Notice kind="error">Documenti obbligatori mancanti o scaduti: {missing.map(labelOf).join(", ")}.</Notice>}
          <div style={{ display: "grid", gap: 12 }}>
            {s.docTypes.map(t => <DocSlot key={t.key} type={t} docs={s.documents.filter(d => d.type === t.key)} editable checking={checking} onUpload={uploadDoc} onRemove={removeDoc} />)}
          </div>
        </>)}

        {step === 3 && (<>
          <CardTitle icon={<CheckCircle2 size={16} />}>Controlla e invia</CardTitle>
          <Summary s={s} data={data} />
          {(Object.keys(localErrors).length > 0 || Object.keys(declErrors).length > 0 || missing.length > 0) ? (
            <div style={{ marginTop: 16 }}>
              <Notice kind="warn">Prima di inviare completa ancora:
                <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                  {[...new Set(Object.keys(localErrors).map(k => stepOf(k)).filter(n => n < 3))].map(n => <li key={n}>{STEPS[n]} — <button onClick={() => goTo(n)} style={{ background: "none", border: "none", padding: 0, color: "inherit", textDecoration: "underline", cursor: "pointer", font: "inherit" }}>vai al passaggio</button></li>)}
                  {Object.keys(declErrors).length > 0 && <li>Dichiarazioni qui sotto: rispondi a tutte</li>}
                  {missing.length > 0 && <li>Documenti: {missing.map(labelOf).join(", ")} — <button onClick={() => goTo(2)} style={{ background: "none", border: "none", padding: 0, color: "inherit", textDecoration: "underline", cursor: "pointer", font: "inherit" }}>carica</button></li>}
                </ul>
              </Notice>
            </div>
          ) : null}
          {!amending && (
            <div style={{ marginTop: 18, display: "grid", gap: 14 }}>
              <CardTitle>Dichiarazioni</CardTitle>
              <Field label="Esistono rapporti di parentela, partecipazione o interesse tra la tua azienda (titolari, soci, amministratori) e dipendenti o amministratori della nostra società?" req error={err("declarations.conflictOfInterest")}>
                <div style={{ display: "flex", gap: 10 }}>
                  {[[false, "No"], [true, "Sì"]].map(([v, l]) => { const on = decl.conflictOfInterest === v; return (
                    <button key={String(v)} type="button" aria-pressed={on} onClick={() => setDecl({ conflictOfInterest: v as boolean })} style={{ ...sans, minWidth: 80, padding: "9px 18px", borderRadius: 10, border: `2px solid ${on ? C.accent : C.border}`, background: on ? C.accentLight : "#fff", color: on ? C.accent : C.text, fontWeight: 650, cursor: "pointer" }}>{l as string}</button>
                  ); })}
                </div>
              </Field>
              {decl.conflictOfInterest && <TextField id="coi" label="Descrivi il rapporto (persone coinvolte e ruolo)" req value={decl.conflictDetails} onChange={v => setDecl({ conflictDetails: v })} error={err("declarations.conflictDetails")} />}
              <DeclCheck checked={!!decl.noSanctions} onChange={v => setDecl({ noSanctions: v })} error={err("declarations.noSanctions")}>
                Dichiaro che l'azienda, i suoi titolari e amministratori non sono soggetti a sanzioni internazionali (UE, ONU, USA, UK) né a provvedimenti interdittivi o di esclusione dai contratti pubblici.
              </DeclCheck>
              <DeclCheck checked={!!decl.privacyAccepted} onChange={v => setDecl({ privacyAccepted: v })} error={err("declarations.privacyAccepted")}>
                Ho preso visione dell'informativa privacy: {s.privacyNotice}
              </DeclCheck>
            </div>
          )}
          {!amending && (
            <label style={{ ...sans, display: "flex", gap: 10, alignItems: "flex-start", margin: "18px 0 4px", fontSize: 13, color: C.text, lineHeight: 1.5, cursor: "pointer" }}>
              <input type="checkbox" checked={!!data.acceptedTerms} onChange={e => setData(d => ({ ...d, acceptedTerms: e.target.checked }))} style={{ marginTop: 3, width: 17, height: 17, accentColor: C.accent }} />
              <span>Dichiaro che i dati e i documenti forniti sono veritieri e completi e accetto i termini e le condizioni del portale fornitori.</span>
            </label>
          )}
          {errors.acceptedTerms && <div role="alert" style={{ ...sans, fontSize: 12, color: C.red, marginBottom: 6 }}>{errors.acceptedTerms}</div>}
        </>)}

        {formError && <div style={{ marginTop: 14 }}><Notice kind="error">{formError}</Notice></div>}
      </div>
      <div style={{ display: "flex", gap: 10, padding: "14px 20px", borderTop: `1px solid ${C.border}`, background: C.bg, flexWrap: "wrap", alignItems: "center" }}>
        {step > 0 && <button onClick={() => goTo(step - 1)} disabled={busy} style={{ ...btnGhost, display: "inline-flex", alignItems: "center", gap: 7, padding: "10px 16px" }}><ArrowLeft size={16} />Indietro</button>}
        {amending && <button onClick={() => { setEditing(false); setData(s.data); setShowErrors(false); setFormError(null); }} style={{ ...btnGhost, padding: "10px 16px" }}>Annulla modifiche</button>}
        <div style={{ flex: 1 }} />
        {!amending && step < 3 && <button onClick={saveDraft} disabled={busy || !dirty} style={{ ...btnGhost, display: "inline-flex", alignItems: "center", gap: 7, padding: "10px 16px", opacity: dirty ? 1 : 0.55 }}><Save size={16} />Salva bozza</button>}
        {step < 3 ? (
          <button onClick={next} disabled={busy} style={{ ...btnPrimary, display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 20px" }}>Avanti<ArrowRight size={16} /></button>
        ) : (
          <button onClick={submit} disabled={busy || cantSubmit} style={{ ...btnPrimary, display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 20px", opacity: busy || cantSubmit ? 0.55 : 1 }}>
            {busy ? <Loader2 className="spin" size={16} /> : <Send size={16} />}{amending ? "Invia le modifiche per verifica" : "Invia la registrazione"}
          </button>
        )}
      </div>
    </Card>
  );

  const overview = (
    <>
      <Card>
        <CardTitle icon={<Building2 size={16} />} action={amending && <button onClick={() => { setEditing(true); setStep(0); }} style={{ ...btnGhost, display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px", fontSize: 12.5 }}><Pencil size={14} />Modifica i dati</button>}>I tuoi dati</CardTitle>
        <Summary s={s} data={s.data} />
        <div style={{ ...sans, fontSize: 12, color: C.subtle, marginTop: 14 }}><a href={myDataExportUrl} style={{ color: C.muted }}>Scarica una copia dei tuoi dati</a> (privacy: diritto di accesso)</div>
      </Card>
      <Card style={{ marginTop: 14 }}>
        <CardTitle icon={<FileCheck2 size={16} />}>Documenti di qualifica</CardTitle>
        {amending && <p style={{ ...sans, fontSize: 12.5, color: C.muted, margin: "0 0 12px", lineHeight: 1.5 }}>Quando un documento sta per scadere caricane uno nuovo qui: la tua scheda tornerà in verifica fino all'approvazione.</p>}
        <div style={{ display: "grid", gap: 12 }}>
          {s.docTypes.map(t => <DocSlot key={t.key} type={t} docs={s.documents.filter(d => d.type === t.key)} editable={amending} checking={checking} onUpload={uploadDoc} onRemove={removeDoc} />)}
        </div>
      </Card>
    </>
  );

  const events = supplierTimeline(s);
  return (
    <div style={{ maxWidth: 920, margin: "0 auto", display: "grid", gap: 14 }}>
      {tracker}
      {s.status === "registered" && <SupplierRfqs fail={fail} notify={notify} />}
      {banner}
      {expiryNotice}
      {amending && s.bankChanged && !s.bankLetterAfterChange && !wizard && <Notice kind="warn"><b>Hai cambiato le coordinate bancarie:</b> carica una nuova lettera della banca nei documenti di qualifica, altrimenti la modifica non può essere approvata.</Notice>}
      {formError && !wizard && <Notice kind="error">{formError}</Notice>}
      {wizard ? wizardBody : overview}
      {events.length > 0 && (
        <Card>
          <CardTitle icon={<History size={16} />}>Cronologia</CardTitle>
          {[...events].reverse().slice(0, 12).map((e, i) => (
            <div key={i} style={{ display: "flex", gap: 10, padding: "7px 0", borderTop: i ? `1px solid ${C.borderLight}` : "none" }}>
              <Clock size={15} color={C.subtle} style={{ marginTop: 2, flexShrink: 0 }} />
              <div style={{ minWidth: 0 }}><div style={{ ...sans, fontSize: 13, fontWeight: 600 }}>{e.action}</div>{e.detail && <div style={{ ...sans, fontSize: 12.5, color: C.muted, overflowWrap: "anywhere" }}>{e.detail}</div>}<div style={{ ...sans, fontSize: 11.5, color: C.subtle }}>{e.ts}</div></div>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

export function Summary({ s, data }: { s: Supplier; data: SupplierData }) {
  const c = data.company ?? {}, a = data.address ?? {}, p = data.payment ?? {}, k = data.contacts ?? {};
  const wh = p.withholdingTax === undefined || p.withholdingTax === null ? "" : p.withholdingTax ? `Sì${p.withholdingType ? ` · ${WITHHOLDING_TYPES.find(w => w.code === p.withholdingType)?.label ?? p.withholdingType}` : ""}` : "No";
  return (
    <div style={{ display: "grid", gap: 18 }}>
      <KV rows={[["Ragione sociale", c.legalName], ["Partita IVA", c.vatCode], ["Codice fiscale", c.fiscalCode], ["Indirizzo", [a.street, a.houseNumber].filter(Boolean).join(" ")], ["CAP e città", [a.postalCode, a.city].filter(Boolean).join(" ")], ["Regione / provincia", a.region], ["Paese", countryName(a.country)]]} />
      <KV rows={[["IBAN", p.iban], ["SWIFT / BIC", p.swift], ["Banca", p.bankName], ["Numero di conto", p.accountNumber], ["Valuta", p.currency], ...(a.country === "IT" ? [["Ritenuta d'acconto", wh] as [string, string]] : [])]} />
      <KV rows={[["Lingua", k.language === "EN" ? "English" : k.language === "IT" ? "Italiano" : ""], ["Email ordini", k.ordersEmail], ["Email amministrativa", k.adminEmail], ["Telefono", k.phone], ["Documenti caricati", String(s.documents.length)]]} />
      {data.declarations && (data.declarations.conflictOfInterest !== undefined || data.declarations.noSanctions) && <KV rows={[["Conflitto d'interessi", data.declarations.conflictOfInterest ? `Sì — ${data.declarations.conflictDetails ?? ""}` : data.declarations.conflictOfInterest === false ? "No" : ""], ["Assenza di sanzioni", data.declarations.noSanctions ? "Dichiarata" : ""], ["Informativa privacy", data.declarations.privacyAccepted ? `Accettata${data.declarations.privacyAcceptedAt ? ` il ${fmtDate(data.declarations.privacyAcceptedAt.slice(0, 10))}` : ""}` : ""]]} />}
    </div>
  );
}

function DeclCheck({ checked, onChange, error, children }: { checked: boolean; onChange: (v: boolean) => void; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ ...sans, display: "flex", gap: 10, alignItems: "flex-start", fontSize: 13, color: C.text, lineHeight: 1.5, cursor: "pointer" }}>
        <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} style={{ marginTop: 3, width: 17, height: 17, accentColor: C.accent, flexShrink: 0 }} />
        <span>{children}</span>
      </label>
      {error && <div role="alert" style={{ ...sans, fontSize: 12, color: C.red, marginTop: 4, marginLeft: 27 }}>{error}</div>}
    </div>
  );
}
