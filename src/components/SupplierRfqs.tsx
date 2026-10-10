import { useCallback, useEffect, useRef, useState } from "react";
import type { SupplierRfq } from "../types.ts";
import { portalApi, supplierRfqSpecUrl, uploadSupplierDocument } from "../api.ts";
import { btnGhost, btnPrimary, C, iStyle, sans } from "../theme.ts";
import { fmt, fmtDate } from "../lib/format.ts";
import { Card, CardTitle, Field } from "./ui.tsx";
import { Loader2, Paperclip, Send, Trash2, Upload } from "./icons.tsx";
import { Notice } from "./vendorUi.tsx";

/** Richieste di offerta ricevute dal fornitore: risponde con importo e note, oppure rinuncia. */
export function SupplierRfqs({ fail, notify }: { fail: (e: unknown) => string; notify: (m: string) => void }) {
  const [rfqs, setRfqs] = useState<SupplierRfq[] | null>(null);
  useEffect(() => { let off = false; portalApi.myRfqs().then(x => { if (!off) setRfqs(x); }).catch(() => { if (!off) setRfqs([]); }); return () => { off = true; }; }, []);
  const open = (rfqs ?? []).filter(r => r.status === "open");
  const past = (rfqs ?? []).filter(r => r.status === "closed" && r.myQuote.quotedAt);
  if (!rfqs || (!open.length && !past.length)) return null;
  return (
    <Card>
      <CardTitle icon={<Send size={16} />}>Richieste di offerta</CardTitle>
      <div style={{ display: "grid", gap: 12 }}>
        {open.map(r => <RfqForm key={r.id} r={r} fail={fail} onSaved={x => { setRfqs(x); notify("Risposta inviata"); }} />)}
        {past.map(r => (
          <div key={r.id} style={{ ...sans, fontSize: 13, color: C.muted, borderTop: `1px solid ${C.borderLight}`, paddingTop: 10 }}>
            <b style={{ color: C.text }}>{r.title}</b> · chiusa il {fmtDate(r.deadline)} · {r.myQuote.declined ? "hai rinunciato" : `la tua offerta: ${fmt(r.myQuote.amount ?? 0)}`}
          </div>
        ))}
      </div>
    </Card>
  );
}

function RfqForm({ r, fail, onSaved }: { r: SupplierRfq; fail: (e: unknown) => string; onSaved: (x: SupplierRfq[]) => void }) {
  const q = r.myQuote;
  const [amount, setAmount] = useState(q.amount ? String(q.amount) : "");
  const [notes, setNotes] = useState(q.notes);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [removeFile, setRemoveFile] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const send = useCallback(async (declined: boolean) => {
    setBusy(true); setErr(null);
    try {
      if (declined) { onSaved(await portalApi.quoteRfq(r.id, { declined: true })); setBusy(false); return; }
      const filePath = file ? await uploadSupplierDocument(file) : undefined;
      onSaved(await portalApi.quoteRfq(r.id, { amount: Number(amount.replace(",", ".")), notes, ...(file && filePath ? { filePath, fileName: file.name } : {}), removeFile: removeFile && !file }));
    } catch (e) { setErr(fail(e)); }
    setBusy(false);
  }, [r.id, amount, notes, file, removeFile, fail, onSaved]);
  const attached = !removeFile && q.fileName;
  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 12, padding: "14px 16px" }}>
      <div style={{ ...sans, fontWeight: 650, fontSize: 14.5, color: C.text }}>{r.title}</div>
      <div style={{ ...sans, fontSize: 12.5, color: C.muted, margin: "2px 0 8px" }}>Rispondi entro il {fmtDate(r.deadline)}{q.quotedAt ? ` · ${q.declined ? "hai rinunciato" : `hai già risposto (${fmt(q.amount ?? 0)})`}: puoi modificare la risposta fino alla scadenza` : ""}</div>
      {r.description && <div style={{ ...sans, fontSize: 13, whiteSpace: "pre-wrap", marginBottom: 10 }}>{r.description}</div>}
      {r.specFile && <a href={supplierRfqSpecUrl(r.id)} target="_blank" rel="noreferrer" style={{ ...sans, display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: C.blue, marginBottom: 10 }}><Paperclip size={14} />{r.specFile}</a>}
      {err && <Notice kind="error">{err}</Notice>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
        <Field label="Importo offerto (EUR, IVA esclusa)" htmlFor={`rfq-a-${r.id}`}><input id={`rfq-a-${r.id}`} inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} style={iStyle} placeholder="es. 12500" /></Field>
        <Field label="Note (tempi, validità, condizioni)" htmlFor={`rfq-n-${r.id}`}><input id={`rfq-n-${r.id}`} value={notes} onChange={e => setNotes(e.target.value)} style={iStyle} /></Field>
      </div>
      <div style={{ ...sans, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: 13, marginBottom: 12 }}>
        <input ref={fileRef} type="file" hidden accept=".pdf,.doc,.docx,.ppt,.pptx,.jpg,.jpeg,.png" onChange={e => { setFile(e.target.files?.[0] ?? null); setRemoveFile(false); }} />
        <button type="button" onClick={() => fileRef.current?.click()} style={{ ...btnGhost, padding: "7px 12px", fontSize: 12.5, display: "inline-flex", alignItems: "center", gap: 6 }}><Upload size={14} />{file || attached ? "Cambia l'offerta in allegato" : "Allega l'offerta (PDF)"}</button>
        {file ? <span style={{ color: C.muted }}>{file.name}</span> : attached ? <span style={{ color: C.muted, display: "inline-flex", alignItems: "center", gap: 6 }}><Paperclip size={14} />{q.fileName}<button type="button" onClick={() => setRemoveFile(true)} aria-label="Rimuovi allegato" style={{ background: "none", border: "none", cursor: "pointer", color: C.subtle, display: "flex" }}><Trash2 size={14} /></button></span> : null}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button onClick={() => send(false)} disabled={busy || !amount.trim()} style={{ ...btnPrimary, padding: "9px 16px", display: "inline-flex", alignItems: "center", gap: 6 }}>{busy && <Loader2 className="spin" size={14} />}Invia offerta</button>
        <button onClick={() => send(true)} disabled={busy} style={{ ...btnGhost, padding: "9px 16px" }}>Non partecipo</button>
      </div>
    </div>
  );
}
