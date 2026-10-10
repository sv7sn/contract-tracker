import { useCallback, useEffect, useRef, useState } from "react";
import type { Rfq, SupplierSummary, TaskDetail } from "../types.ts";
import { portalApi, rfqFileUrl, uploadDocument } from "../api.ts";
import { btnGhost, btnPrimary, C, iStyle, sans } from "../theme.ts";
import { fmt, fmtDate } from "../lib/format.ts";
import { Card, CardTitle, Field } from "../components/ui.tsx";
import { CheckCircle2, Clock, Loader2, Paperclip, Send, Upload } from "../components/icons.tsx";
import { Notice } from "../components/vendorUi.tsx";
import { ScoreBadge } from "./RatingCard.tsx";

const plus = (days: number) => new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);

/** Richiesta di offerta ai fornitori registrati: le risposte arrivano dall'area fornitore e diventano il confronto della pratica. */
export function RfqCard({ t, fail, notify, onSaved }: { t: TaskDetail; fail: (e: unknown) => string; notify: (m: string) => void; onSaved: (t: TaskDetail, msg: string) => void }) {
  const [rfqs, setRfqs] = useState<Rfq[] | null>(null);
  const [vendors, setVendors] = useState<SupplierSummary[]>([]);
  const [ratings, setRatings] = useState<Record<number, { overall: number; count: number }>>({});
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState(t.title.replace(/^RDA \S+ · /, ""));
  const [description, setDescription] = useState("");
  const [deadline, setDeadline] = useState(plus(7));
  const [picked, setPicked] = useState<number[]>([]);
  const [q, setQ] = useState("");
  const [winner, setWinner] = useState<Record<number, number>>({});
  const [just, setJust] = useState("");
  const [spec, setSpec] = useState<File | null>(null);
  const specRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { let off = false; portalApi.rfqs(t.id).then(x => { if (!off) setRfqs(x); }).catch(() => { if (!off) setRfqs([]); }); return () => { off = true; }; }, [t.id]);
  useEffect(() => { if (!creating || vendors.length) return; let off = false; portalApi.vendors().then(v => { if (!off) setVendors(v.filter(x => x.status === "registered" && x.lifecycle === "active")); }).catch(() => undefined); portalApi.ratings().then(r => { if (!off) setRatings(r); }).catch(() => undefined); return () => { off = true; }; }, [creating, vendors.length]);

  const run = useCallback(async (f: () => Promise<void>) => { setBusy(true); setErr(null); try { await f(); } catch (e) { setErr(fail(e)); } setBusy(false); }, [fail]);
  const create = () => run(async () => { const specPath = spec ? await uploadDocument(spec) : undefined; setRfqs(await portalApi.createRfq({ taskId: t.id, title, description, deadline, supplierIds: picked, ...(spec && specPath ? { specPath, specName: spec.name } : {}) })); setCreating(false); setPicked([]); setSpec(null); notify("Richiesta inviata ai fornitori"); });
  const close = (id: number) => run(async () => { setRfqs(await portalApi.closeRfq(id)); });
  const use = (r: Rfq) => run(async () => { const x = await portalApi.useRfq(r.id, { supplierId: winner[r.id], justification: just }); setRfqs(await portalApi.rfqs(t.id)); onSaved(x, "Confronto registrato dalle offerte ricevute"); });
  const shown = vendors.filter(v => !q.trim() || `${v.legalName || v.name} ${v.sapCode}`.toLowerCase().includes(q.trim().toLowerCase()));
  const hasOpen = (rfqs ?? []).some(r => r.status === "open");

  return (
    <Card>
      <CardTitle icon={<Send size={16} />} action={!creating && !hasOpen ? <button onClick={() => setCreating(true)} style={{ ...btnGhost, padding: "6px 12px", fontSize: 12.5 }}>Richiedi offerte</button> : undefined}>Richiesta di offerta</CardTitle>
      {err && <Notice kind="error">{err}</Notice>}
      {rfqs && rfqs.length === 0 && !creating && <div style={{ ...sans, fontSize: 13, color: C.subtle }}>Invita due o più fornitori registrati a presentare un'offerta dalla loro area personale: le risposte diventano il confronto della pratica.</div>}
      {creating && (
        <div style={{ display: "grid", gap: 12 }}>
          <Field label="Oggetto" htmlFor="rfq-title"><input id="rfq-title" value={title} onChange={e => setTitle(e.target.value)} style={iStyle} /></Field>
          <Field label="Cosa serve (visibile ai fornitori)" htmlFor="rfq-desc"><textarea id="rfq-desc" value={description} onChange={e => setDescription(e.target.value)} rows={3} style={{ ...iStyle, resize: "vertical" }} /></Field>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <input ref={specRef} type="file" hidden accept=".pdf,.doc,.docx" onChange={e => setSpec(e.target.files?.[0] ?? null)} />
            <button type="button" onClick={() => specRef.current?.click()} style={{ ...btnGhost, padding: "7px 12px", fontSize: 12.5, display: "inline-flex", alignItems: "center", gap: 6 }}><Upload size={14} />Allega capitolato o specifiche</button>
            {spec && <span style={{ ...sans, fontSize: 13, color: C.muted }}>{spec.name}</span>}
          </div>
          <Field label="Risposta entro" htmlFor="rfq-deadline"><input id="rfq-deadline" type="date" min={plus(0)} value={deadline} onChange={e => setDeadline(e.target.value)} style={{ ...iStyle, width: 190 }} /></Field>
          <div>
            <div style={{ ...sans, fontSize: 12.5, fontWeight: 650, marginBottom: 6 }}>Fornitori da invitare ({picked.length}, da 2 a 10)</div>
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Cerca fornitore…" aria-label="Cerca fornitore" style={{ ...iStyle, maxWidth: 320, marginBottom: 8 }} />
            <div style={{ maxHeight: 200, overflowY: "auto", border: `1px solid ${C.border}`, borderRadius: 10 }}>
              {shown.length === 0 && <div style={{ ...sans, padding: 12, fontSize: 13, color: C.subtle }}>Nessun fornitore registrato.</div>}
              {shown.map(v => <label key={v.id} style={{ ...sans, display: "flex", gap: 10, alignItems: "center", padding: "7px 12px", fontSize: 13, cursor: "pointer", borderBottom: `1px solid ${C.borderLight}` }}>
                <input type="checkbox" checked={picked.includes(v.id)} onChange={e => setPicked(p => e.target.checked ? [...p, v.id] : p.filter(x => x !== v.id))} style={{ width: 16, height: 16, accentColor: C.accent }} />{v.legalName || v.name}{ratings[v.id] && <ScoreBadge value={ratings[v.id].overall} count={ratings[v.id].count} />}<span style={{ color: C.subtle, marginLeft: "auto" }}>{v.sapCode && `SAP ${v.sapCode}`}</span></label>)}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={create} disabled={busy || picked.length < 2 || title.trim().length < 3} style={{ ...btnPrimary, padding: "9px 16px", display: "inline-flex", alignItems: "center", gap: 6 }}>{busy && <Loader2 className="spin" size={14} />}Invia richiesta</button>
            <button onClick={() => setCreating(false)} style={{ ...btnGhost, padding: "9px 16px" }}>Annulla</button>
          </div>
        </div>
      )}
      {(rfqs ?? []).map(r => {
        const quoted = r.invites.filter(i => i.amount !== null && !i.declined);
        const low = quoted.length ? Math.min(...quoted.map(i => i.amount ?? 0)) : null;
        return (
          <div key={r.id} style={{ borderTop: `1px solid ${C.borderLight}`, marginTop: 12, paddingTop: 12 }}>
            <div style={{ ...sans, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", fontSize: 13 }}>
              <b>{r.title}</b>
              {r.specFile && <a href={rfqFileUrl(r.id, "spec")} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12.5, color: C.blue }}><Paperclip size={13} />{r.specFile}</a>}
              <span style={{ color: r.status === "open" ? C.blue : C.muted, display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12.5 }}><Clock size={13} />{r.status === "open" ? `Aperta fino al ${fmtDate(r.deadline)}` : `Chiusa (scadenza ${fmtDate(r.deadline)})`}</span>
              {r.status === "open" && <button onClick={() => close(r.id)} disabled={busy} style={{ ...btnGhost, padding: "4px 10px", fontSize: 12, marginLeft: "auto" }}>Chiudi ora</button>}
            </div>
            <div style={{ display: "grid", gap: 4, marginTop: 8 }}>
              {r.invites.map(i => (
                <label key={i.supplierId} style={{ ...sans, display: "flex", gap: 10, alignItems: "center", fontSize: 13 }}>
                  {r.status === "closed" && i.amount !== null && !i.declined ? <input type="radio" name={`w-${r.id}`} checked={winner[r.id] === i.supplierId} onChange={() => setWinner(w => ({ ...w, [r.id]: i.supplierId }))} /> : <span style={{ width: 13 }} />}
                  <span style={{ fontWeight: 550 }}>{i.supplierName}</span>
                  {i.fileName && <a href={rfqFileUrl(r.id, "quote", i.supplierId)} target="_blank" rel="noreferrer" title={i.fileName} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: C.blue }}><Paperclip size={13} />Offerta</a>}
                  <span style={{ marginLeft: "auto", color: i.declined ? C.subtle : i.amount === null ? C.yellow : C.text }} className="tabular">
                    {i.declined ? "Ha rinunciato" : i.amount === null ? "In attesa" : <>{fmt(i.amount)}{i.amount === low && quoted.length > 1 && <CheckCircle2 size={13} color={C.green} style={{ marginLeft: 6, verticalAlign: "-2px" }} />}</>}
                  </span>
                </label>
              ))}
              {r.invites.filter(i => i.notes).map(i => <div key={`n${i.supplierId}`} style={{ ...sans, fontSize: 12, color: C.muted, paddingLeft: 23 }}>{i.supplierName}: {i.notes}</div>)}
            </div>
            {r.status === "closed" && quoted.length >= 2 && !t.sourcing && (
              <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                <input value={just} onChange={e => setJust(e.target.value)} placeholder="Motivo della scelta (obbligatorio se non è l'offerta più bassa)" aria-label="Motivo" style={iStyle} />
                <button onClick={() => use(r)} disabled={busy || !winner[r.id]} style={{ ...btnPrimary, padding: "9px 16px", justifySelf: "start" }}>Usa le offerte come confronto</button>
              </div>
            )}
          </div>
        );
      })}
    </Card>
  );
}
