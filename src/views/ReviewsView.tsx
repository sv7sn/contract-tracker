import { useCallback, useEffect, useState } from "react";
import type { MyReview, User } from "../types.ts";
import { portalApi } from "../api.ts";
import { C, font, sans } from "../theme.ts";
import { Card, EmptyState } from "../components/ui.tsx";
import { AlertTriangle, ArrowLeft, Clock, Loader2, Scale } from "../components/icons.tsx";
import { FUNC_LABEL } from "../clmRules.ts";
import { DraftPanel } from "./DraftPanel.tsx";

const STATE = { pending: "Da rivedere", approved: "Approvata", approved_comments: "Approvata con commenti", changes: "Modifiche richieste" } as const;
const PRIO: Record<string, string> = { high: "Alta", normal: "Normale", low: "Bassa" };

/** Coda delle revisioni di una funzione (Legal, Compliance, IT Security, Richiedente): stesse scadenze e priorità dei task del buyer. */
export function ReviewsView({ currentUser, onSessionExpired }: { currentUser: User; onSessionExpired: () => void }) {
  const [list, setList] = useState<MyReview[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const load = useCallback(() => { portalApi.clm.mine().then(setList).catch(e => { if (e?.status === 401) onSessionExpired(); else setError(e instanceof Error ? e.message : "Errore"); }); }, [onSessionExpired]);
  useEffect(load, [load]);
  if (error) return <EmptyState icon={<AlertTriangle size={26} />} title="Impossibile caricare le revisioni" text={error} />;
  if (!list) return <div style={{ display: "flex", justifyContent: "center", padding: 60 }}><Loader2 className="spin" size={26} color={C.subtle} /></div>;
  if (openId !== null) return (
    <div style={{ display: "grid", gap: 12 }}>
      <button onClick={() => { setOpenId(null); load(); }} style={{ all: "unset", cursor: "pointer", ...sans, fontSize: 13.5, color: C.blue, display: "inline-flex", gap: 6, alignItems: "center" }}><ArrowLeft size={16} />Tutte le revisioni</button>
      <Card><DraftPanel taskId={openId} currentUser={currentUser} /></Card>
    </div>);
  const pending = list.filter(r => r.status === "pending");
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div>
        <h2 style={{ ...font, margin: 0, fontSize: 22, fontWeight: 700, color: C.text }}>Revisioni, {currentUser.name.split(" ")[0]}</h2>
        <p style={{ ...sans, margin: "4px 0 0", fontSize: 13.5, color: C.muted }}>Bozze di contratto che aspettano il parere {list[0] ? `di ${FUNC_LABEL[list[0].func]}` : "della tua funzione"}. Il buyer non può firmare finché non approvate: rispettate le scadenze come i task.</p>
      </div>
      {!list.length && <EmptyState icon={<Scale size={26} />} title="Nessuna revisione" text="Quando un buyer ti invita a rivedere una bozza la trovi qui." />}
      {list.length > 0 && <div style={{ ...sans, fontSize: 13, color: C.muted }}>{pending.length} da rivedere · {list.length - pending.length} già con un parere</div>}
      {list.map(r => (
        <Card key={r.reviewId} onClick={() => setOpenId(r.taskId)} style={{ cursor: "pointer", padding: "12px 16px", display: "flex", gap: 12, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ ...sans, fontSize: 14.5, fontWeight: 650, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.title}</div>
            <div style={{ ...sans, fontSize: 12.5, color: C.muted }}>{[r.supplier, `versione ${r.version}`, `priorità ${PRIO[r.priority] ?? r.priority}`].filter(Boolean).join(" · ")}</div>
          </div>
          <div style={{ ...sans, fontSize: 12.5, display: "flex", gap: 10, alignItems: "center" }}>
            {r.overdueDays > 0 && <span style={{ color: C.red, fontWeight: 650, display: "inline-flex", gap: 4, alignItems: "center" }}><Clock size={13} />in ritardo di {r.overdueDays} gg</span>}
            {r.status === "pending" && r.due && r.overdueDays === 0 && <span style={{ color: C.muted }}>entro {r.due.split("-").reverse().join("/")}</span>}
            <span style={{ color: r.status === "pending" ? C.yellow : r.status === "changes" ? C.red : C.green, fontWeight: 650 }}>{STATE[r.status]}</span>
          </div>
        </Card>))}
    </div>
  );
}
