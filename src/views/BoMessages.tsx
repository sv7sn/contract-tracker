import { useCallback, useEffect, useState } from "react";
import type { BoMessage } from "../types.ts";
import { portalApi } from "../api.ts";
import { btnPrimary, C, iStyle, sans } from "../theme.ts";
import { Card } from "../components/ui.tsx";
import { Loader2, MessageSquare } from "../components/icons.tsx";
import { Notice } from "../components/vendorUi.tsx";

/** Messaggi tra Business Owner e buyer sul contratto: chiarimenti prima di decidere, risposte del buyer. */
export function BoMessages({ contractId, isBo }: { contractId: number; isBo: boolean }) {
  const [msgs, setMsgs] = useState<BoMessage[] | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { let off = false; portalApi.boMessages(contractId).then(x => { if (!off) setMsgs(x); }).catch(() => { if (!off) setMsgs([]); }); return () => { off = true; }; }, [contractId]);
  const send = useCallback(async () => {
    setBusy(true); setErr(null);
    try { setMsgs(await portalApi.sendBoMessage(contractId, text)); setText(""); } catch (e) { setErr(e instanceof Error ? e.message : "Invio non riuscito"); }
    setBusy(false);
  }, [contractId, text]);
  if (!msgs) return null;
  return (
    <Card>
      <div style={{ ...sans, display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 650, marginBottom: 10 }}><MessageSquare size={16} />{isBo ? "Scrivi al buyer" : "Messaggi con il Business Owner"}</div>
      {err && <Notice kind="error">{err}</Notice>}
      {msgs.length === 0 && <div style={{ ...sans, fontSize: 13, color: C.subtle, marginBottom: 8 }}>{isBo ? "Hai dubbi prima di decidere? Scrivi qui: il buyer riceve un'email." : "Nessun messaggio. Il Business Owner può scriverti da qui; puoi scrivergli anche tu."}</div>}
      <div style={{ display: "grid", gap: 8, marginBottom: 10 }}>
        {msgs.map(m => (
          <div key={m.id} style={{ ...sans, background: m.fromMe ? C.accentLight : C.bg, borderRadius: 12, padding: "9px 12px", fontSize: 13, marginLeft: m.fromMe ? 28 : 0, marginRight: m.fromMe ? 0 : 28 }}>
            <div style={{ fontSize: 11.5, color: C.muted, marginBottom: 2 }}><b>{m.fromMe ? "Tu" : m.authorName}</b> · {new Date(m.createdAt).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" })}</div>
            <div style={{ whiteSpace: "pre-wrap" }}>{m.body}</div>
          </div>
        ))}
      </div>
      <textarea value={text} onChange={e => setText(e.target.value)} rows={2} placeholder={isBo ? "Il tuo messaggio per il buyer" : "Il tuo messaggio per il Business Owner"} aria-label="Messaggio" style={{ ...iStyle, resize: "vertical", marginBottom: 8 }} />
      <button onClick={send} disabled={busy || text.trim().length < 2} style={{ ...btnPrimary, padding: "8px 16px", display: "inline-flex", alignItems: "center", gap: 6 }}>{busy && <Loader2 className="spin" size={14} />}Invia</button>
    </Card>
  );
}
