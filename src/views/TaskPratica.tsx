import { useEffect, useRef, useState, type ReactNode } from "react";
import type { BudgetLine, Contract, ContractOutcome, PlanStep, SupplierSummary, TaskContractStatus, TaskDetail, TaskDocKind } from "../types.ts";
import { checkDocument, portalApi, taskDocUrl, uploadDocument } from "../api.ts";
import { btnGhost, btnPrimary, C, iStyle, sans } from "../theme.ts";
import { fmt, fmtDate } from "../lib/format.ts";
import { stepLabel, stepTemplate } from "../lib/plan.ts";
import { Card, CardTitle, Field } from "../components/ui.tsx";
import { Check, CheckCircle2, Clock, FileText, Loader2, Send, Trash2, Upload } from "../components/icons.tsx";
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
const OUTCOME_DONE: Record<ContractOutcome | "new_contract", string> = { renewed: "Rinnovato", replaced: "Sostituito da un nuovo contratto", extended: "Prorogato", ceased: "Cessato", new_contract: "Contratto firmato registrato" };

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
  const purchase = t.source === "manual";
  const [mode, setMode] = useState<ContractOutcome | null>(null);
  const [f, setF] = useState({ supplier: t.meta.supplier ?? "", object: t.meta.object ?? "", value: t.meta.value ? String(t.meta.value) : "", start: t.meta.end ? new Date(new Date(`${t.meta.end}T00:00:00Z`).getTime() + 864e5).toISOString().slice(0, 10) : "", end: "", noticeDays: "", sentDate: "", note: "" });
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [supplierId, setSupplierId] = useState<number | null>(contracts.find(c => c.id === t.contractId)?.supplierId ?? t.meta.supplierId ?? null);
  const [vendors, setVendors] = useState<SupplierSummary[] | null>(null);
  useEffect(() => { let off = false; portalApi.vendors().then(v => { if (!off) setVendors(v); }).catch(() => undefined); return () => { off = true; }; }, []);
  const up = (k: keyof typeof f) => (e: { target: { value: string } }) => setF(x => ({ ...x, [k]: e.target.value }));

  if (t.outcome) {
    const nc = t.newContractId ? contracts.find(c => c.id === t.newContractId) : undefined;
    return (
      <Card>
        <CardTitle icon={<CheckCircle2 size={16} />}>{purchase ? "Contratto" : "Esito del rinnovo"}</CardTitle>
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
      if (mode === "renewed" || mode === "replaced" || purchase) body.contract = { supplier: f.supplier, object: f.object, value: Number(f.value.replace(",", ".")), supplierId, start: f.start, end: f.end, noticeDays: f.noticeDays || null, currency: t.meta.currency ?? "EUR", ...(doc ?? {}) };
      if (mode === "extended") { body.end = f.end; body.document = doc; }
      if (mode === "ceased") { body.sentDate = f.sentDate; body.document = doc; }
      const x = purchase ? await portalApi.registerContract(t.id, body) : await portalApi.setOutcome(t.id, body);
      onSaved(x, x.status === "done" ? "Esito registrato: pratica chiusa" : "Esito registrato: completa confronto e PO per chiudere");
    } catch (e) { setErr(fail(e)); }
    setBusy(false);
  };
  const two = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 180px), 1fr))", columnGap: 12 } as const;
  return (
    <Card>
      <CardTitle icon={<CheckCircle2 size={16} />}>{purchase ? "Contratto" : "Esito del rinnovo"}</CardTitle>
      {purchase && !mode && (<>
        <p style={{ ...sans, fontSize: 12.5, color: C.muted, margin: "-4px 0 10px", lineHeight: 1.5 }}>Se l'acquisto prevede un contratto, registralo qui: entra nel registro contratti, collegato al fornitore, e alla scadenza partirà il task di rinnovo. Per un acquisto con sola offerta e PO non serve.</p>
        <button onClick={() => setMode("replaced")} style={{ ...btnGhost, padding: "8px 14px", fontSize: 13, display: "inline-flex", alignItems: "center", gap: 7 }}><FileText size={15} />Registra il contratto firmato</button>
      </>)}
      {!purchase && <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 160px), 1fr))", gap: 8, marginBottom: mode ? 14 : 0 }} role="radiogroup" aria-label="Esito">
        {OUTCOMES.map(o => (
          <button key={o.key} type="button" role="radio" aria-checked={mode === o.key} onClick={() => { setMode(o.key); setErr(null); }} style={{ ...sans, textAlign: "left", padding: "10px 12px", borderRadius: 10, border: `2px solid ${mode === o.key ? C.accent : C.border}`, background: mode === o.key ? C.accentLight : "#fff", cursor: "pointer" }}>
            <div style={{ fontWeight: 650, fontSize: 13, color: mode === o.key ? C.accent : C.text }}>{o.label}</div>
            <div style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.4, marginTop: 2 }}>{o.text}</div>
          </button>
        ))}
      </div>}
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
        <button onClick={save} disabled={busy} style={{ ...btnPrimary, padding: "10px 18px", display: "inline-flex", alignItems: "center", gap: 8 }}>{busy && <Loader2 className="spin" size={15} />}{purchase ? "Registra il contratto" : "Registra l'esito"}</button>
      </>)}
    </Card>
  );
}

/** Voce di un quadrante: titolo piccolo e contenuto, senza spunte (lo stato è del quadrante). */
const Block = ({ title, first, children }: { title: string; first?: boolean; children: ReactNode }) => (
  <div style={{ ...sans, padding: "10px 0", borderTop: first ? "none" : `1px solid ${C.borderLight}`, fontSize: 13 }}>
    <div style={{ fontSize: 11.5, fontWeight: 700, color: C.subtle, textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 6 }}>{title}</div>
    <div style={{ minWidth: 0, color: C.muted, overflowWrap: "anywhere" }}>{children}</div>
  </div>
);
const splitList = (s: string) => s.split(/[\s,;]+/).map(x => x.trim()).filter(Boolean);

/** La pratica in un colpo d'occhio: RDA, confronto, offerta/contratto, fornitore e PO, con i campi per completarla. */
/** Una parte della pratica per quadrante: dati di partenza (internal order), documenti e contratto, oppure PO e RDA collegate. */
export function PraticaPart({ t, part, fail, onSaved }: { t: TaskDetail; part: "contract" | "po"; fail: (e: unknown) => string; onSaved: Saved }) {
  const [rda, setRda] = useState(t.source === "rda" ? t.rdaNumbers.slice(1).join(", ") : t.rdaNumbers.join(", "));
  const [po, setPo] = useState(t.poNumbers.join(", "));
  const [noPo, setNoPo] = useState(t.noPoReason);
  const [noPoOn, setNoPoOn] = useState(!!t.noPoReason);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const renewal = t.source === "contract";
  const sapPos = t.pos.map(p => p.po);
  const docs = t.documents;
  const [cs, setCs] = useState<TaskContractStatus>(t.contractStatus);
  const [csNote, setCsNote] = useState(t.contractNote);
  const needPo = !renewal || t.outcome === "renewed" || t.outcome === "replaced";

  const saveLinks = async () => {
    setBusy("links"); setErr(null);
    try {
      const x = await portalApi.setTaskLinks(t.id, { rdaNumbers: splitList(rda), poNumbers: splitList(po), noPoReason: noPoOn ? noPo : "" });
      onSaved(x, x.status === "done" && t.status !== "done" ? "Pratica completa e chiusa" : "Dati salvati");
    } catch (e) { setErr(fail(e)); }
    setBusy(null);
  };
  const saveContract = async () => {
    setBusy("contract"); setErr(null);
    try { onSaved(await portalApi.setTaskLinks(t.id, { contractStatus: cs, contractNote: csNote }), "Stato del contratto aggiornato"); } catch (e) { setErr(fail(e)); }
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

  const saveBtn = (label: string) => <button onClick={saveLinks} disabled={busy === "links"} style={{ ...btnGhost, marginTop: 10, padding: "8px 14px", fontSize: 13, display: "inline-flex", alignItems: "center", gap: 7 }}>{busy === "links" && <Loader2 className="spin" size={14} />}{label}</button>;
  const open = t.status === "open";
  return (
    <Card>
      {part === "contract" && (<>
        <Block title="Offerta e contratto" first>
          {docs.length === 0 && <div style={{ marginBottom: 6 }}>Nessun documento allegato.</div>}
          {docs.length > 0 && <div style={{ display: "grid", gap: 4, marginBottom: 6 }}>{docs.map(d => (
            <div key={d.id} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontSize: 11.5, color: C.subtle }}>{DOC_LABEL[d.kind]}</span>
              <a href={taskDocUrl(d.id)} target="_blank" rel="noopener noreferrer" style={{ color: C.blue, fontWeight: 600, textDecoration: "none" }}>{d.fileName}</a>
              {(d.kind === "offer" || d.kind === "other") && open && <button onClick={() => removeDoc(d.id)} aria-label={`Rimuovi ${d.fileName}`} style={{ background: "none", border: "none", cursor: "pointer", color: C.subtle, padding: 2 }}><Trash2 size={14} /></button>}
            </div>))}</div>}
          {open && <><input ref={fileRef} type="file" hidden accept=".pdf,.doc,.docx" onChange={e => addOffer(e.target.files?.[0])} />
          <button onClick={() => fileRef.current?.click()} disabled={busy === "doc"} style={{ ...btnGhost, padding: "6px 12px", fontSize: 12.5, display: "inline-flex", alignItems: "center", gap: 6 }}>{busy === "doc" ? <Loader2 className="spin" size={14} /> : <Upload size={14} />}Allega offerta</button></>}
        </Block>
        {!renewal && open && (
          <Block title="Serve un contratto?">
            <div role="radiogroup" aria-label="Stato del contratto" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {([["not_needed", "Non serve"], ["negotiating", "In negoziazione"], ["signed", "Firmato"]] as [TaskContractStatus, string][]).map(([k, l]) => (
                <button key={k} role="radio" aria-checked={cs === k} onClick={() => setCs(k)} style={{ ...sans, padding: "6px 12px", borderRadius: 999, border: `1px solid ${cs === k ? C.accent : C.border}`, background: cs === k ? C.accentLight : "#fff", color: cs === k ? C.accent : C.muted, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>{l}</button>
              ))}
            </div>
            {(cs === "not_needed" || cs === "negotiating") && <input value={csNote} onChange={e => setCsNote(e.target.value)} placeholder={cs === "not_needed" ? "Perché non serve (es. ordine semplice, offerta accettata)" : "Note sulla trattativa (opzionale)"} aria-label="Note sul contratto" style={{ ...iStyle, padding: "7px 10px", fontSize: 13, marginTop: 8 }} />}
            {cs === "signed" && <div style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>Allega prima l'offerta accettata o il contratto firmato qui sopra.</div>}
            <button onClick={saveContract} disabled={busy === "contract" || cs === t.contractStatus && csNote === t.contractNote || !cs} style={{ ...btnGhost, marginTop: 8, padding: "6px 12px", fontSize: 12.5, display: "inline-flex", alignItems: "center", gap: 6 }}>{busy === "contract" && <Loader2 className="spin" size={13} />}Salva lo stato del contratto</button>
          </Block>
        )}
        {!renewal && !open && t.contractStatus && <Block title="Contratto">{t.contractStatus === "signed" ? "Firmato" : t.contractStatus === "not_needed" ? `Non serve${t.contractNote ? `: ${t.contractNote}` : ""}` : "In negoziazione"}</Block>}
      </>)}
      {part === "po" && (<>
        <Block title="Ordini in SAP" first>
          {sapPos.length > 0 ? <div style={{ color: C.text }}>{t.pos.map(p => `${p.po}${p.supplierName ? ` (${p.supplierName})` : ""}${p.docDate ? ` · ${fmtDate(p.docDate)}` : ""}`).join(" — ")}</div>
            : <div>{t.source === "rda" ? "Nessun ordine ancora. Il PO lo emette il buyer in SAP: quando arriva nell'estrazione, la RDA si chiude da sola se tutti i passaggi sono fatti." : "Nessun ordine ancora in SAP."}</div>}
        </Block>
        {needPo && (
          <Block title={t.source === "rda" ? "PO emesso (facoltativo)" : "Numero di PO"}>
            <input value={po} onChange={e => setPo(e.target.value)} disabled={noPoOn || !open} placeholder="Numero di PO (più numeri separati da virgola)" aria-label="Numeri PO" style={{ ...iStyle, padding: "7px 10px", fontSize: 13 }} />
            {t.source !== "rda" && <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, cursor: "pointer", color: C.text }}>
              <input type="checkbox" checked={noPoOn} disabled={!open} onChange={e => setNoPoOn(e.target.checked)} style={{ width: 16, height: 16, accentColor: C.accent }} />Non serve un PO
            </label>}
            {noPoOn && t.source !== "rda" && <input value={noPo} onChange={e => setNoPo(e.target.value)} disabled={!open} placeholder="Perché (es. contratto quadro con ordini a chiamata)" aria-label="Motivo" style={{ ...iStyle, padding: "7px 10px", fontSize: 13, marginTop: 6 }} />}
          </Block>
        )}
        {!needPo && <Block title="PO">Non serve per proroghe e cessazioni.</Block>}
        <Block title="RDA collegate">
          {t.source === "rda" && <div style={{ color: C.text, marginBottom: 6 }}>{t.sourceKey}</div>}
          <input value={rda} onChange={e => setRda(e.target.value)} disabled={!open} placeholder={t.source === "rda" ? "Altre RDA collegate (opzionale)" : "Numero RDA, se c'è"} aria-label="Numeri RDA" style={{ ...iStyle, padding: "7px 10px", fontSize: 13 }} />
        </Block>
        {open && saveBtn("Salva PO e RDA")}
      </>)}
      {err && <div style={{ marginTop: 8 }}><Notice kind="error">{err}</Notice></div>}
    </Card>
  );
}

/** Internal order come gli altri campi: se c'è si legge (e il budget residuo), se manca si evidenzia e si compila qui. */
export function IoField({ t, fail, onSaved }: { t: TaskDetail; fail: (e: unknown) => string; onSaved: Saved }) {
  const sapIos = Object.keys(t.meta.io ?? {});
  const [io, setIo] = useState(t.meta.internalOrder ?? "");
  const shown = sapIos[0] ?? t.meta.internalOrder ?? "";
  const [mp, setMp] = useState<BudgetLine | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let off = false;
    if (shown) portalApi.budgetIo(shown).then(x => { if (!off) setMp(x.line); }).catch(() => undefined);
    return () => { off = true; };
  }, [shown]);
  const save = async () => {
    setBusy(true); setErr(null);
    try { onSaved(await portalApi.setTaskLinks(t.id, { internalOrder: io }), "Internal order salvato"); } catch (e) { setErr(fail(e)); }
    setBusy(false);
  };
  const open = t.status === "open";
  const mpLine = mp && <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{mp.description ? `${mp.description} · ` : ""}budget {mp.current !== null ? fmt(mp.current) : "non nel Master Plan"}{mp.residual !== null && <> · residuo <b style={{ color: mp.residual < 0 ? C.red : C.green }}>{fmt(mp.residual)}</b></>}</div>;
  if (sapIos.length > 0) return <><span className="tabular">{sapIos.join(", ")}</span>{mpLine}</>;
  return (
    <div style={{ border: `1.5px solid ${shown ? C.border : C.red}`, background: shown ? "transparent" : C.redBg, borderRadius: 8, padding: "6px 8px" }}>
      {!shown && <div style={{ fontSize: 12, fontWeight: 650, color: C.red, marginBottom: 6 }}>Manca, è necessario: compilalo o aspetta SAP.</div>}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <input value={io} onChange={e => setIo(e.target.value)} disabled={!open} placeholder="Internal order" aria-label="Internal order" style={{ ...iStyle, padding: "5px 7px", fontSize: 12.5, flex: "1 1 96px", minWidth: 0 }} />
        {open && <button onClick={save} disabled={busy || io.trim() === (t.meta.internalOrder ?? "")} style={{ ...btnGhost, padding: "5px 10px", fontSize: 12 }}>{busy ? <Loader2 className="spin" size={13} /> : "Salva"}</button>}
      </div>
      {mpLine}
      {err && <div style={{ fontSize: 12, color: C.red, marginTop: 4 }}>{err}</div>}
    </div>
  );
}

/** Consegna richiesta: da SAP se c'è, altrimenti si può indicare a mano (come l'internal order). */
export function DeliveryField({ t, fail, onSaved }: { t: TaskDetail; fail: (e: unknown) => string; onSaved: Saved }) {
  const sap = t.meta.delivDate ?? "";
  const [d, setD] = useState(t.meta.delivDateManual ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (sap) return <span className="tabular">{fmtDate(sap)}</span>;
  const save = async () => {
    setBusy(true); setErr(null);
    try { onSaved(await portalApi.setTaskLinks(t.id, { delivDate: d }), "Consegna salvata"); } catch (e) { setErr(fail(e)); }
    setBusy(false);
  };
  return (
    <div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <input type="date" value={d} onChange={e => setD(e.target.value)} disabled={t.status !== "open"} aria-label="Consegna richiesta" style={{ ...iStyle, padding: "5px 7px", fontSize: 12.5, flex: "1 1 96px", minWidth: 0 }} />
        {t.status === "open" && <button onClick={save} disabled={busy || d === (t.meta.delivDateManual ?? "")} style={{ ...btnGhost, padding: "5px 10px", fontSize: 12 }}>{busy ? <Loader2 className="spin" size={13} /> : "Salva"}</button>}
      </div>
      <div style={{ fontSize: 11.5, color: C.subtle, marginTop: 3 }}>Non in SAP: inseriscila.</div>
      {err && <div style={{ fontSize: 12, color: C.red, marginTop: 4 }}>{err}</div>}
    </div>
  );
}
