import { useEffect, useState } from "react";
import type { Obligation } from "../types.ts";
import { portalApi } from "../api.ts";
import { btnGhost, btnPrimary, C, iStyle, sans } from "../theme.ts";
import { Card, CardTitle } from "../components/ui.tsx";
import { fmtDate } from "../lib/format.ts";
import { Check, ListChecks, Trash2 } from "../components/icons.tsx";

const KIND: Record<Obligation["kind"], string> = { deliverable: "Consegna", indexation: "Revisione prezzi", review: "Verifica", payment: "Pagamento", other: "Altro" };

/** Obblighi e scadenze del contratto (consegne, indicizzazioni, verifiche), con responsabile e data: compaiono in "Il mio lavoro". */
export function ObligationsCard({ contractId, canEdit }: { contractId: number; canEdit: boolean }) {
  const [list, setList] = useState<Obligation[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [f, setF] = useState({ title: "", kind: "deliverable" as Obligation["kind"], due: "", owner: "", repeat: "" });
  useEffect(() => { portalApi.obligations(contractId).then(setList).catch(() => setList([])); }, [contractId]);
  const run = async (p: Promise<Obligation[]>) => { try { setList(await p); setErr(null); return true; } catch (e) { setErr(e instanceof Error ? e.message : "Operazione non riuscita"); return false; } };
  const add = async () => { if (await run(portalApi.saveObligation(contractId, { title: f.title, kind: f.kind, due: f.due, owner: f.owner, repeatMonths: f.repeat === "" ? null : Number(f.repeat) }))) setF({ ...f, title: "", due: "", owner: "", repeat: "" }); };
  if (!list || (!list.length && !canEdit)) return null;
  const today = new Date().toISOString().slice(0, 10);
  return (
    <Card>
      <CardTitle icon={<ListChecks size={16} />}>Obblighi e scadenze</CardTitle>
      {err && <div role="alert" style={{ ...sans, color: C.red, fontSize: 13, marginBottom: 8 }}>{err}</div>}
      <div style={{ display: "grid", gap: 6 }}>
        {!list.length && <div style={{ ...sans, fontSize: 13, color: C.muted }}>Nessun obbligo registrato.</div>}
        {list.map(o => (
          <div key={o.id} style={{ ...sans, display: "flex", gap: 8, alignItems: "center", fontSize: 13, color: o.status === "done" ? C.subtle : C.text, flexWrap: "wrap", borderBottom: `1px solid ${C.borderLight}`, paddingBottom: 6 }}>
            <span style={{ color: C.subtle, fontSize: 11.5, minWidth: 90 }}>{KIND[o.kind]}</span>
            <span style={{ flex: 1, minWidth: 160, textDecoration: o.status === "done" ? "line-through" : "none" }}>{o.title}{o.owner ? ` · ${o.owner}` : ""}{o.repeatMonths ? ` · ogni ${o.repeatMonths} mesi` : ""}</span>
            <span style={{ color: o.status === "open" && o.due < today ? C.red : C.muted, fontSize: 12.5 }}>{o.status === "done" ? `fatto${o.doneAt ? ` il ${fmtDate(o.doneAt.slice(0, 10))}` : ""}` : fmtDate(o.due)}</span>
            {canEdit && o.status === "open" && <button onClick={() => run(portalApi.completeObligation(o.id))} aria-label={`Segna fatto: ${o.title}`} style={{ ...btnGhost, padding: "3px 8px", fontSize: 12, display: "inline-flex", gap: 4, alignItems: "center" }}><Check size={13} />Fatto</button>}
            {canEdit && <button onClick={() => run(portalApi.deleteObligation(o.id))} aria-label={`Elimina: ${o.title}`} style={{ background: "none", border: "none", cursor: "pointer", color: C.subtle }}><Trash2 size={14} /></button>}
          </div>))}
      </div>
      {canEdit && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 8, marginTop: 12, alignItems: "end" }}>
          <input placeholder="Cosa va fatto" value={f.title} onChange={e => setF({ ...f, title: e.target.value })} style={{ ...iStyle, gridColumn: "span 2" }} />
          <select value={f.kind} onChange={e => setF({ ...f, kind: e.target.value as Obligation["kind"] })} style={iStyle}>{(Object.keys(KIND) as Obligation["kind"][]).map(k => <option key={k} value={k}>{KIND[k]}</option>)}</select>
          <input type="date" value={f.due} onChange={e => setF({ ...f, due: e.target.value })} style={iStyle} aria-label="Scadenza" />
          <input placeholder="Responsabile" value={f.owner} onChange={e => setF({ ...f, owner: e.target.value })} style={iStyle} />
          <input type="number" min={1} max={60} placeholder="Ogni N mesi" value={f.repeat} onChange={e => setF({ ...f, repeat: e.target.value })} style={iStyle} />
          <button onClick={add} style={{ ...btnPrimary, padding: "10px 14px" }}>Aggiungi</button>
        </div>)}
    </Card>
  );
}
