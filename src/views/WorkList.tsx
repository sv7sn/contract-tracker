import { useEffect, useState } from "react";
import type { View, WorkItem, WorkKind } from "../types.ts";
import { portalApi } from "../api.ts";
import { btnGhost, C, font, radius, sans } from "../theme.ts";
import { Card } from "../components/ui.tsx";
import { AlertTriangle, Building2, CheckCircle2, Clock, Inbox, Loader2, Scale, Send, ShieldCheck } from "../components/icons.tsx";

const ICON: Record<WorkKind, React.ReactNode> = {
  bo_message: <Send size={17} />, bo_to_send: <Send size={17} />, bo_waiting: <Clock size={17} />, task_late: <Clock size={17} />, task_soon: <Clock size={17} />, sourcing_missing: <Scale size={17} />, exception: <ShieldCheck size={17} />, unassigned: <Inbox size={17} />,
  rfq_answers: <Send size={17} />, rfq_compare: <Send size={17} />, vendor_review: <Building2 size={17} />, vendor_lapsed: <AlertTriangle size={17} />, vendor_unresponsive: <AlertTriangle size={17} />, splits: <Scale size={17} />,
};
const URGENCY = { 3: { label: "Urgente", fg: C.red, bg: C.redBg }, 2: { label: "Da fare", fg: C.yellow, bg: C.yellowBg }, 1: { label: "Da seguire", fg: C.blue, bg: C.blueBg } } as const;

/** "Da fare adesso": tutto ciò che richiede un'azione, in ordine di urgenza, con un clic per arrivare alla pratica giusta. */
export function WorkList({ onOpen }: { onOpen: (view: View, focus?: { taskId?: number; vendorId?: number; contractId?: number }) => void }) {
  const [items, setItems] = useState<WorkItem[] | null>(null);
  const [all, setAll] = useState(false);
  const [sending, setSending] = useState<number | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  useEffect(() => { let off = false; portalApi.myWork().then(x => { if (!off) setItems(x); }).catch(() => { if (!off) setItems([]); }); return () => { off = true; }; }, []);
  const quick = async (i: WorkItem) => {
    if (!i.quick) return;
    setSending(i.quick.contractId); setFlash(null);
    try { await portalApi.sendBoNotice(i.quick.contractId); setItems(await portalApi.myWork()); setFlash("Avviso inviato al Business Owner"); } catch (e) { setFlash(e instanceof Error ? e.message : "Invio non riuscito"); }
    setSending(null);
  };
  const shown = (items ?? []).slice(0, all ? 100 : 10);

  return (
    <Card style={{ marginBottom: 18, padding: 0, overflow: "hidden", borderRadius: radius.lg }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, padding: "16px 20px 10px", flexWrap: "wrap" }}>
        <div style={{ ...font, fontSize: 17, fontWeight: 700, color: C.text }}>Da fare adesso</div>
        {items && items.length > 0 && <div style={{ ...sans, fontSize: 12.5, color: C.muted }}>{items.length} {items.length === 1 ? "voce" : "voci"} · {items.filter(i => i.urgency === 3).length} urgenti</div>}
      </div>
      {flash && <div role="status" style={{ ...sans, fontSize: 12.5, color: C.muted, padding: "0 20px 8px" }}>{flash}</div>}
      {!items && <div style={{ display: "flex", justifyContent: "center", padding: 24 }}><Loader2 className="spin" size={20} color={C.subtle} /></div>}
      {items && items.length === 0 && <div style={{ ...sans, display: "flex", alignItems: "center", gap: 10, padding: "6px 20px 18px", fontSize: 13.5, color: C.muted }}><CheckCircle2 size={18} color={C.green} />Niente di urgente: nessun ritardo, nessuna offerta da confrontare, nessun fornitore da verificare.</div>}
      {shown.map((i, k) => {
        const u = URGENCY[i.urgency];
        return (
          <div key={k} style={{ display: "flex", alignItems: "center", borderTop: `1px solid ${C.borderLight}` }}>
            <button onClick={() => onOpen(i.target.view, { taskId: i.target.taskId, vendorId: i.target.vendorId, contractId: i.target.contractId })} style={{ ...sans, display: "flex", alignItems: "center", gap: 12, flex: 1, minWidth: 0, textAlign: "left", background: "none", border: "none", padding: "11px 12px 11px 20px", cursor: "pointer", color: C.text }}>
              <span style={{ width: 32, height: 32, borderRadius: 10, background: u.bg, color: u.fg, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{ICON[i.kind]}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 13.5, fontWeight: 650, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{i.title}</span>
                <span style={{ display: "block", fontSize: 12.5, color: C.muted }}>{i.detail}</span>
              </span>
              <span style={{ fontSize: 11.5, fontWeight: 650, color: u.fg, background: u.bg, borderRadius: 999, padding: "3px 9px", flexShrink: 0 }}>{u.label}</span>
            </button>
            {i.quick ? <button onClick={() => quick(i)} disabled={sending === i.quick.contractId} style={{ ...btnGhost, padding: "6px 12px", fontSize: 12.5, marginRight: 16, flexShrink: 0 }}>{sending === i.quick.contractId ? "Invio…" : i.quick.label}</button> : <span style={{ width: 16 }} />}
          </div>
        );
      })}
      {items && items.length > 10 && <div style={{ padding: "10px 20px", borderTop: `1px solid ${C.borderLight}` }}><button onClick={() => setAll(v => !v)} style={{ ...btnGhost, padding: "6px 12px", fontSize: 12.5 }}>{all ? "Mostra le prime 10" : `Mostra tutte (${items.length})`}</button></div>}
    </Card>
  );
}
