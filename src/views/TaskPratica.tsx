import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Contract, ContractOutcome, PlanStep, SupplierSummary, TaskDetail, TaskDocKind } from "../types.ts";
import { checkDocument, portalApi, taskDocUrl, uploadDocument } from "../api.ts";
import { btnGhost, btnPrimary, C, iStyle, sans } from "../theme.ts";
import { fmt, fmtDate } from "../lib/format.ts";
import { stepLabel, stepTemplate } from "../lib/plan.ts";
import { Card, CardTitle, Field } from "../components/ui.tsx";
import { Check, CheckCircle2, Clock, FileText, Loader2, Paperclip, Send, Trash2, Upload } from "../components/icons.tsx";
import { KV, Notice, SupplierPicker } from "../components/vendorUi.tsx";

// Una pratica d'acquisto (RDA o rinnovo di contratto) mette insieme: RDA, confronto tra fornitori, offerta/contratto, fornitore e PO.

type Saved = (t: TaskDetail, msg: string) => void;
const DOC_LABEL: Record<TaskDocKind, string> = { offer: "Offerta", contract: "Contratto", addendum: "Addendum / proroga", termination: "Disdetta", other: "Altro" };
const OUTCOMES: { key: ContractOutcome; label: string; text: string }[] = [
  { key: "renewed", label: "Rinnovo", text: "Stesso fornitore, nuovo contratto (anche rinegoziato)" },
  { key: "replaced", label: "Nuovo contratto", text: "Gara o altro fornitore" },
  { key: "extended", label: "Proroga", text: "Stesso contratto, nuova scadenza con addendum" },
  { key: "ceased", label: "Cessazione", text: "Disdetta inviata, il contratto termina" },
];
const OUTCOME_DONE: Record<ContractOutcome, string> = { renewed: "Rinnovato", replaced: "Sostituito da un nuovo contratto", extended: "Prorogato", ceased: "Cessato" };

/** Sceglie e carica un documento (PDF, DOC, DOCX) nell'archivio privato. */
function FilePick({ label, file, onFile }: { label: string; file: File | null; onFile: (f: File | null) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState<string | null>(null);
  return (
    <Field label={label} req error={err ?? undefined}>
      <input ref={ref} type="file" hidden accept=".pdf,.doc,.docx" onChange={e => { const f = e.target.files?.[0] ?? null; const bad = f ? checkDocument(f) : null; setErr(bad); onFile(bad ? null : f); }} />
      <button type="button" onClick={() => ref.current?.click()} style={{ ...btnGhost, padding: "9px 14px", fontSize: 13, display: "inline-flex", alignItems: "center", gap: 7, maxWidth: "100%" }}><Upload size={15} /><span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file ? file.name : "Scegli il file (PDF, DOC, DOCX)"}</span></button>
    </Field>
  );
}
const upload = async (f: File) => ({ fileName: f.name, filePath: await uploadDocument(f), size: f.size });

/** Contratto in scadenza e fasi del suo piano di rinnovo. */
export function RenewalCard({ t, contracts, plan, onCompleteStep, onSendBO, onOpenContract }: { t: TaskDetail; contracts: Contract[]; plan: PlanStep[]; onCompleteStep: (c: number, s: string) => void; onSendBO: (c: number) => void; onOpenContract: (c: Contract) => void }) {
  const c = contracts.find(x => x.id === t.contractId);
  const small = { ...btnGhost, padding: "5px 10px", fontSize: 12, display: "inline-flex", alignItems: "center", gap: 5 } as const;
  return (
    <Card>
      <CardTitle icon={<FileText size={16} />} action={c && <button onClick={() => onOpenContract(c)} style={small}>Apri contratto</button>}>Contratto in scadenza</CardTitle>
      <KV rows={[["Fornitore", t.meta.supplier ?? c?.supplier ?? ""], ["Oggetto", t.meta.object ?? c?.object ?? ""], ["Valore", (t.meta.previousValue ?? t.meta.value) ? fmt((t.meta.previousValue ?? t.meta.value)!, t.meta.currency ?? "EUR") : ""], ...(t.meta.previousValue !== undefined ? [["Nuovo valore", fmt(t.meta.value ?? 0, t.meta.currency ?? "EUR")] as [string, string]] : []), ["Scadenza", t.meta.end ? fmtDate(t.meta.end) : ""], ["Disdetta entro", t.meta.noticeDate ? fmtDate(t.meta.noticeDate) : "Nessun preavviso"], ["Business Owner", c?.boEmail || "—"]]} />
      {plan.length > 0 && !t.outcome && (
        <div style={{ marginTop: 14, display: "grid", gap: 2 }}>
          <div style={{ ...sans, fontSize: 12, fontWeight: 650, color: C.muted, marginBottom: 4 }}>Fasi</div>
          {plan.map(s => {
            const done = s.status === "done", tmpl = stepTemplate(s.stepId);
            return (
              <div key={s.stepId} style={{ ...sans, display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderTop: `1px solid ${C.borderLight}`, fontSize: 13, flexWrap: "wrap" }}>
                {done ? <CheckCircle2 size={16} color={C.green} /> : <Clock size={16} color={s.status === "pending_bo" ? C.yellow : C.subtle} />}
                <span style={{ flex: "1 1 160px", color: done ? C.muted : C.text, fontWeight: done ? 400 : 550 }}>{stepLabel(s.stepId, c)}{s.boDecision ? ` — ${s.boDecision}` : ""}</span>
                <span className="tabular" style={{ color: C.subtle, fontSize: 12 }}>{fmtDate(s.scheduledDate)}</span>
                {!done && t.status === "open" && c && (s.stepId === "bo_notify" ? <button onClick={() => onSendBO(c.id)} style={small}><Send size={13} />Invia al BO</button>
                  : tmpl.actor === "buyer" ? <button onClick={() => onCompleteStep(c.id, s.stepId)} style={small}><Check size={13} />Fatto</button>
                  : s.status === "pending_bo" ? <span style={{ fontSize: 12, color: C.yellow }}>in attesa del BO</span> : null)}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

/** Esito del rinnovo: nuovo contratto, proroga o cessazione. Aggiorna il contratto e lo storico. */
export function OutcomeCard({ t, contracts, fail, onSaved, onOpenContract }: { t: TaskDetail; contracts: Contract[]; fail: (e: unknown) => string; onSaved: Saved; onOpenContract: (c: Contract) => void }) {
  const [mode, setMode] = useState<ContractOutcome | null>(null);
  const [f, setF] = useState({ supplier: t.meta.supplier ?? "", object: t.meta.object ?? "", value: t.meta.value ? String(t.meta.value) : "", start: t.meta.end ? new Date(new Date(`${t.meta.end}T00:00:00Z`).getTime() + 864e5).toISOString().slice(0, 10) : "", end: "", noticeDays: "", sentDate: "", note: "" });
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [supplierId, setSupplierId] = useState<number | null>(contracts.find(c => c.id === t.contractId)?.supplierId ?? null);
  const [vendors, setVendors] = useState<SupplierSummary[] | null>(null);
  useEffect(() => { let off = false; portalApi.vendors().then(v => { if (!off) setVendors(v); }).catch(() => undefined); return () => { off = true; }; }, []);
  const up = (k: keyof typeof f) => (e: { target: { value: string } }) => setF(x => ({ ...x, [k]: e.target.value }));

  if (t.outcome) {
    const nc = t.newContractId ? contracts.find(c => c.id === t.newContractId) : undefined;
    return (
      <Card>
        <CardTitle icon={<CheckCircle2 size={16} />}>Esito del rinnovo</CardTitle>
        <div style={{ ...sans, fontSize: 13.5, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <b>{OUTCOME_DONE[t.outcome]}</b>
          {nc && <button onClick={() => onOpenContract(nc)} style={{ ...btnGhost, padding: "5px 10px", fontSize: 12 }}>Apri il nuovo contratto ({nc.supplier}, scad. {fmtDate(nc.end)})</button>}
        </div>
      </Card>
    );
  }
  if (t.status !== "open") return null;

  const save = async () => {
    if (!mode) return;
    setBusy(true); setErr(null);
    try {
      const doc = file ? await upload(file) : undefined;
      const body: Record<string, unknown> = { outcome: mode, note: f.note };
      if (mode === "renewed" || mode === "replaced") body.contract = { supplier: f.supplier, object: f.object, value: Number(f.value.replace(",", ".")), supplierId, start: f.start, end: f.end, noticeDays: f.noticeDays || null, currency: t.meta.currency ?? "EUR", ...(doc ?? {}) };
      if (mode === "extended") { body.end = f.end; body.document = doc; }
      if (mode === "ceased") { body.sentDate = f.sentDate; body.document = doc; }
      const x = await portalApi.setOutcome(t.id, body);
      onSaved(x, x.status === "done" ? "Esito registrato: pratica chiusa" : "Esito registrato: completa confronto e PO per chiudere");
    } catch (e) { setErr(fail(e)); }
    setBusy(false);
  };
  const two = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 180px), 1fr))", columnGap: 12 } as const;
  return (
    <Card>
      <CardTitle icon={<CheckCircle2 size={16} />}>Esito del rinnovo</CardTitle>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 160px), 1fr))", gap: 8, marginBottom: mode ? 14 : 0 }} role="radiogroup" aria-label="Esito">
        {OUTCOMES.map(o => (
          <button key={o.key} type="button" role="radio" aria-checked={mode === o.key} onClick={() => { setMode(o.key); setErr(null); }} style={{ ...sans, textAlign: "left", padding: "10px 12px", borderRadius: 10, border: `2px solid ${mode === o.key ? C.accent : C.border}`, background: mode === o.key ? C.accentLight : "#fff", cursor: "pointer" }}>
            <div style={{ fontWeight: 650, fontSize: 13, color: mode === o.key ? C.accent : C.text }}>{o.label}</div>
            <div style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.4, marginTop: 2 }}>{o.text}</div>
          </button>
        ))}
      </div>
      {(mode === "renewed" || mode === "replaced") && (<>
        <div style={two}>
          <Field label="Fornitore" req htmlFor="o-sup"><SupplierPicker id="o-sup" value={f.supplier} supplierId={supplierId} vendors={vendors} onChange={(name, sid) => { setF(x => ({ ...x, supplier: name })); setSupplierId(sid); }} /></Field>
          <Field label="Oggetto" req htmlFor="o-obj"><input id="o-obj" value={f.object} onChange={up("object")} style={iStyle} /></Field>
          <Field label={`Valore (${t.meta.currency ?? "EUR"})`} req htmlFor="o-val"><input id="o-val" value={f.value} onChange={up("value")} inputMode="decimal" style={iStyle} /></Field>
          <Field label="Inizio" htmlFor="o-start"><input id="o-start" type="date" value={f.start} onChange={up("start")} style={iStyle} /></Field>
          <Field label="Scadenza" req htmlFor="o-end"><input id="o-end" type="date" value={f.end} onChange={up("end")} style={iStyle} /></Field>
          <Field label="Preavviso di disdetta (giorni)" htmlFor="o-nd"><input id="o-nd" type="number" min={1} value={f.noticeDays} onChange={up("noticeDays")} placeholder="Nessuno" style={iStyle} /></Field>
        </div>
        <FilePick label="Nuovo contratto firmato" file={file} onFile={setFile} />
      </>)}
      {mode === "extended" && (<div style={two}>
        <Field label="Nuova scadenza" req htmlFor="o-ext"><input id="o-ext" type="date" value={f.end} onChange={up("end")} style={iStyle} /></Field>
        <FilePick label="Addendum o lettera di proroga" file={file} onFile={setFile} />
      </div>)}
      {mode === "ceased" && (<div style={two}>
        <Field label="Disdetta inviata il" req htmlFor="o-sent"><input id="o-sent" type="date" value={f.sentDate} onChange={up("sentDate")} style={iStyle} /></Field>
        <FilePick label="Disdetta (PEC, raccomandata o lettera)" file={file} onFile={setFile} />
      </div>)}
      {mode && (<>
        <Field label="Note" htmlFor="o-note"><input id="o-note" value={f.note} onChange={up("note")} placeholder="Es. rinegoziato -8%, gara con 3 offerte…" style={iStyle} /></Field>
        {err && <Notice kind="error">{err}</Notice>}
        <button onClick={save} disabled={busy} style={{ ...btnPrimary, padding: "10px 18px", display: "inline-flex", alignItems: "center", gap: 8 }}>{busy && <Loader2 className="spin" size={15} />}Registra l'esito</button>
      </>)}
    </Card>
  );
}

const Row = ({ ok, title, children }: { ok: boolean | null; title: string; children: ReactNode }) => (
  <div style={{ ...sans, display: "grid", gridTemplateColumns: "22px minmax(110px, 150px) minmax(0,1fr)", gap: 10, alignItems: "start", padding: "10px 0", borderTop: `1px solid ${C.borderLight}`, fontSize: 13 }}>
    <span aria-hidden style={{ marginTop: 1 }}>{ok === null ? <span style={{ display: "inline-block", width: 14, height: 14, borderRadius: 7, border: `2px solid ${C.border}` }} /> : ok ? <CheckCircle2 size={17} color={C.green} /> : <Clock size={17} color={C.yellow} />}</span>
    <b style={{ fontWeight: 650 }}>{title}<span style={{ position: "absolute", left: -9999 }}>{ok === null ? " (non necessario)" : ok ? " (completo)" : " (da completare)"}</span></b>
    <div style={{ minWidth: 0, color: C.muted, overflowWrap: "anywhere" }}>{children}</div>
  </div>
);
const splitList = (s: string) => s.split(/[\s,;]+/).map(x => x.trim()).filter(Boolean);

/** La pratica in un colpo d'occhio: RDA, confronto, offerta/contratto, fornitore e PO, con i campi per completarla. */
export function PraticaCard({ t, fail, onSaved }: { t: TaskDetail; fail: (e: unknown) => string; onSaved: Saved }) {
  const [rda, setRda] = useState(t.source === "rda" ? t.rdaNumbers.slice(1).join(", ") : t.rdaNumbers.join(", "));
  const [po, setPo] = useState(t.poNumbers.join(", "));
  const [noPo, setNoPo] = useState(t.noPoReason);
  const [noPoOn, setNoPoOn] = useState(!!t.noPoReason);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const renewal = t.source === "contract";
  const sapPos = t.pos.map(p => p.po);
  const allPos = [...new Set([...sapPos, ...t.poNumbers])];
  const supplier = t.pos[0]?.supplierName || t.sourcing?.quotes.find(q => q.chosen)?.supplier || (renewal ? t.meta.supplier : "") || "";
  const docs = t.documents;
  const needPo = !renewal || t.outcome === "renewed" || t.outcome === "replaced";

  const saveLinks = async () => {
    setBusy("links"); setErr(null);
    try {
      const x = await portalApi.setTaskLinks(t.id, { rdaNumbers: t.source === "rda" ? splitList(rda) : splitList(rda), poNumbers: splitList(po), noPoReason: noPoOn ? noPo : "" });
      onSaved(x, x.status === "done" && t.status !== "done" ? "Pratica completa e chiusa" : "Pratica aggiornata");
    } catch (e) { setErr(fail(e)); }
    setBusy(null);
  };
  const addOffer = async (f: File | undefined) => {
    if (!f) return;
    const bad = checkDocument(f); if (bad) { setErr(bad); return; }
    setBusy("doc"); setErr(null);
    try { onSaved(await portalApi.addTaskDoc(t.id, { kind: "offer", ...(await upload(f)) }), "Offerta allegata"); } catch (e) { setErr(fail(e)); }
    setBusy(null); if (fileRef.current) fileRef.current.value = "";
  };
  const removeDoc = async (id: number) => {
    if (!window.confirm("Rimuovere il documento?")) return;
    try { onSaved(await portalApi.removeTaskDoc(t.id, id), "Documento rimosso"); } catch (e) { setErr(fail(e)); }
  };
  const sourcingOk = !t.sourcingRequired ? (t.sourcing ? true : null) : t.sourcingStatus === "ok";

  return (
    <Card>
      <CardTitle icon={<Paperclip size={16} />}>Pratica</CardTitle>
      <Row ok={(t.source === "rda" || t.rdaNumbers.length > 0) ? true : null} title="RDA">
        {t.source === "rda" && <div style={{ color: C.text }}>{t.sourceKey}</div>}
        <input value={rda} onChange={e => setRda(e.target.value)} placeholder={t.source === "rda" ? "Altre RDA collegate (opzionale)" : "Numero RDA, se c'è"} aria-label="Numeri RDA" style={{ ...iStyle, padding: "7px 10px", fontSize: 13, marginTop: t.source === "rda" ? 6 : 0 }} />
      </Row>
      <Row ok={sourcingOk} title="Confronto">
        {t.sourcing ? <>{t.sourcing.mode === "comparison" ? `${t.sourcing.quotes.length} offerte` : t.sourcing.mode === "strategic" ? "Fornitura strategica" : t.sourcing.mode === "single_source" ? "Single source" : "Eccezione"}{t.saving ? <> · saving <b style={{ color: t.saving.amount >= 0 ? C.green : C.red }}>{fmt(t.saving.amount, t.meta.currency ?? "EUR")} ({t.saving.pct}%)</b></> : null}</>
          : t.sourcingRequired ? "Da registrare qui sotto (importo sopra soglia)" : "Non necessario sotto soglia"}
      </Row>
      <Row ok={docs.some(d => d.kind === "offer" || d.kind === "contract" || d.kind === "addendum") ? true : renewal && t.outcome === "ceased" ? null : false} title={renewal ? "Contratto" : "Offerta"}>
        {docs.length > 0 && <div style={{ display: "grid", gap: 4, marginBottom: 6 }}>{docs.map(d => (
          <div key={d.id} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 11.5, color: C.subtle }}>{DOC_LABEL[d.kind]}</span>
            <a href={taskDocUrl(d.id)} target="_blank" rel="noopener noreferrer" style={{ color: C.blue, fontWeight: 600, textDecoration: "none" }}>{d.fileName}</a>
            {(d.kind === "offer" || d.kind === "other") && t.status === "open" && <button onClick={() => removeDoc(d.id)} aria-label={`Rimuovi ${d.fileName}`} style={{ background: "none", border: "none", cursor: "pointer", color: C.subtle, padding: 2 }}><Trash2 size={14} /></button>}
          </div>))}</div>}
        <input ref={fileRef} type="file" hidden accept=".pdf,.doc,.docx" onChange={e => addOffer(e.target.files?.[0])} />
        <button onClick={() => fileRef.current?.click()} disabled={busy === "doc"} style={{ ...btnGhost, padding: "6px 12px", fontSize: 12.5, display: "inline-flex", alignItems: "center", gap: 6 }}>{busy === "doc" ? <Loader2 className="spin" size={14} /> : <Upload size={14} />}Allega offerta</button>
      </Row>
      <Row ok={supplier ? true : false} title="Fornitore">{supplier || "Si ricava dal PO, dal confronto o dal contratto"}</Row>
      <Row ok={!needPo ? null : allPos.length > 0 || !!t.noPoReason} title="PO">
        {sapPos.length > 0 && <div style={{ color: C.text, marginBottom: 6 }}>Da SAP: {t.pos.map(p => `${p.po}${p.supplierName ? ` (${p.supplierName})` : ""}`).join(", ")}</div>}
        {needPo && (<>
          <input value={po} onChange={e => setPo(e.target.value)} disabled={noPoOn} placeholder="Numero di PO (più numeri separati da virgola)" aria-label="Numeri PO" style={{ ...iStyle, padding: "7px 10px", fontSize: 13 }} />
          <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, cursor: "pointer", color: C.text }}>
            <input type="checkbox" checked={noPoOn} onChange={e => setNoPoOn(e.target.checked)} style={{ width: 16, height: 16, accentColor: C.accent }} />Non serve un PO
          </label>
          {noPoOn && <input value={noPo} onChange={e => setNoPo(e.target.value)} placeholder="Perché (es. contratto quadro con ordini a chiamata)" aria-label="Motivo" style={{ ...iStyle, padding: "7px 10px", fontSize: 13, marginTop: 6 }} />}
        </>)}
        {!needPo && "Non serve per proroghe e cessazioni"}
      </Row>
      {err && <div style={{ marginTop: 8 }}><Notice kind="error">{err}</Notice></div>}
      <button onClick={saveLinks} disabled={busy === "links"} style={{ ...btnGhost, marginTop: 8, padding: "8px 14px", fontSize: 13, display: "inline-flex", alignItems: "center", gap: 7 }}>{busy === "links" && <Loader2 className="spin" size={14} />}Salva RDA e PO</button>
    </Card>
  );
}
