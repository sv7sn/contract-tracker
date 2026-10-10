import { useCallback, useEffect, useState } from "react";
import type { BoInfo, BoNotice, Contract } from "../types.ts";
import { portalApi } from "../api.ts";
import { btnGhost, btnPrimary, C, iStyle, sans } from "../theme.ts";
import { fmtDate } from "../lib/format.ts";
import { Card } from "../components/ui.tsx";
import { CheckCircle2, Clock, Loader2, Send } from "../components/icons.tsx";
import { Notice } from "../components/vendorUi.tsx";

const KIND: Record<BoNotice["kind"], string> = { notice: "Avviso", reminder: "Sollecito", auto: "Avviso automatico", auto_reminder: "Sollecito automatico" };

/** Avvisi al Business Owner del contratto: invio, reinvio, riapertura e tempi di partenza. */
export function BoNoticeCard({ contract, onChanged }: { contract: Contract; onChanged: () => void }) {
  const [info, setInfo] = useState<BoInfo | null>(null);
  const [message, setMessage] = useState("");
  const [lead, setLead] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  useEffect(() => { let off = false; portalApi.boInfo(contract.id).then(x => { if (!off) { setInfo(x); setLead(String(x.leadDays)); } }).catch(e => { if (!off) setMsg({ kind: "error", text: e instanceof Error ? e.message : "Caricamento non riuscito" }); }); return () => { off = true; }; }, [contract.id]);

  const run = useCallback(async (f: () => Promise<BoInfo>, ok: string) => {
    setBusy(true); setMsg(null);
    try { const x = await f(); setInfo(x); setLead(String(x.leadDays)); setMessage(""); setMsg({ kind: "ok", text: ok }); onChanged(); } catch (e) { setMsg({ kind: "error", text: e instanceof Error ? e.message : "Operazione non riuscita" }); }
    setBusy(false);
  }, [onChanged]);

  if (contract.ceased || contract.status === "closed") return null;
  if (!info) return <Card><div style={{ display: "flex", justifyContent: "center", padding: 14 }}>{msg ? <Notice kind="error">{msg.text}</Notice> : <Loader2 className="spin" size={20} color={C.subtle} />}</div></Card>;
  const answered = info.state === "answered", waiting = info.state === "waiting";
  const label = answered ? "Riapri la richiesta" : waiting ? "Reinvia l'avviso" : "Invia l'avviso";

  return (
    <Card>
      <div style={{ ...sans, display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 650, marginBottom: 10 }}><Send size={16} />Avvisi al Business Owner</div>
      {!info.boEmail && <Notice kind="warn">Manca l'email del Business Owner: aggiungila con Modifica per poter inviare gli avvisi.</Notice>}
      {info.boEmail && !info.hasBoAccount && <Notice kind="warn">{info.boEmail} non ha ancora un accesso al sistema: l'email parte, ma per rispondere dovrà avere un utente con ruolo Business Owner.</Notice>}
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      <div style={{ ...sans, display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginBottom: 12, color: answered ? C.green : waiting ? C.yellow : C.muted }}>
        {answered ? <><CheckCircle2 size={16} />Ha risposto: <b>{info.decision || "decisione registrata"}</b></> : waiting ? <><Clock size={16} />In attesa della risposta da {info.waitingDays} {info.waitingDays === 1 ? "giorno" : "giorni"}</> : <><Clock size={16} />Avviso non ancora inviato{info.noticeDate ? ` · previsto il ${fmtDate(info.noticeDate)}` : ""}</>}
      </div>
      {info.boEmail && <>
        <textarea value={message} onChange={e => setMessage(e.target.value)} rows={2} placeholder="Messaggio per il Business Owner (facoltativo): cosa ti serve e entro quando" aria-label="Messaggio" style={{ ...iStyle, resize: "vertical", marginBottom: 8 }} />
        <button onClick={() => run(() => portalApi.sendBoNotice(contract.id, { message, restart: answered }), answered ? "Richiesta riaperta e avviso inviato" : "Avviso inviato a " + info.boEmail)} disabled={busy} style={{ ...btnPrimary, padding: "9px 16px", display: "inline-flex", alignItems: "center", gap: 6 }}>{busy && <Loader2 className="spin" size={14} />}{label}</button>
      </>}
      <div style={{ ...sans, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 13, marginTop: 14, paddingTop: 12, borderTop: `1px solid ${C.borderLight}` }}>
        <span>Gli avvisi partono</span>
        <input value={lead} onChange={e => setLead(e.target.value.replace(/[^0-9]/g, ""))} inputMode="numeric" aria-label="Giorni prima della scadenza" style={{ ...iStyle, width: 70, padding: "6px 10px" }} />
        <span>giorni prima della scadenza (predefinito {info.defaultLeadDays}).</span>
        <button onClick={() => run(() => portalApi.setBoLead(contract.id, Number(lead)), "Tempi aggiornati: il piano è stato ricalcolato")} disabled={busy || !lead || Number(lead) === info.leadDays} style={{ ...btnGhost, padding: "6px 12px", fontSize: 12.5 }}>Applica</button>
      </div>
      {info.settings.auto && <div style={{ ...sans, fontSize: 12, color: C.muted, marginTop: 8 }}>Invio automatico attivo: l'avviso parte alla data prevista e, senza risposta, un sollecito ogni {info.settings.reminderDays} giorni (massimo 3).</div>}
      {info.notices.length > 0 && <div style={{ marginTop: 12 }}>
        {info.notices.map(n => <div key={n.id} style={{ ...sans, display: "flex", gap: 10, padding: "6px 0", borderTop: `1px solid ${C.borderLight}`, fontSize: 12.5, flexWrap: "wrap" }}>
          <span style={{ width: 130, color: C.subtle }}>{new Date(n.sentAt).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" })}</span>
          <span style={{ flex: 1, minWidth: 0 }}><b>{KIND[n.kind]}</b> · {n.sentBy}{n.status !== "sent" && <span style={{ color: n.status === "failed" ? C.red : C.yellow }}> · {n.status === "failed" ? "invio non riuscito" : "email non configurata, solo registrato"}</span>}{n.message && <div style={{ color: C.muted }}>{n.message}</div>}</span>
        </div>)}
      </div>}
    </Card>
  );
}
