import { useEffect, useState } from "react";
import type { RatingCriterion, Scorecard } from "../types.ts";
import { portalApi } from "../api.ts";
import { btnGhost, btnPrimary, C, iStyle, sans } from "../theme.ts";
import { fmt, fmtDate } from "../lib/format.ts";
import { Card, CardTitle } from "../components/ui.tsx";
import { Loader2, Star, Trash2 } from "../components/icons.tsx";
import { Notice } from "../components/vendorUi.tsx";

const CRITERIA: [RatingCriterion, string][] = [["quality", "Qualità"], ["delivery", "Puntualità"], ["service", "Servizio"], ["price", "Prezzo"]];
const tone = (n: number | null) => (n === null ? C.subtle : n >= 4 ? C.green : n >= 3 ? C.yellow : C.red);

/** Voto con la stella: numero e colore insieme (il colore non è l'unico segnale). */
export function ScoreBadge({ value, count }: { value: number; count?: number }) {
  return <span title={count ? `${count} valutazioni` : undefined} style={{ ...sans, display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12.5, fontWeight: 650, color: tone(value) }}><Star size={13} fill="currentColor" />{value.toLocaleString("it-IT", { minimumFractionDigits: 1 })}{count ? <span style={{ color: C.subtle, fontWeight: 500 }}>({count})</span> : null}</span>;
}

function Stars({ value, onChange, label }: { value: number; onChange: (n: number) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} style={{ display: "inline-flex", gap: 2 }}>
      {[1, 2, 3, 4, 5].map(n => <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} su 5`} onClick={() => onChange(n)} style={{ background: "none", border: "none", padding: 2, cursor: "pointer", color: n <= value ? C.yellow : C.border, display: "flex" }}><Star size={20} fill={n <= value ? "currentColor" : "none"} /></button>)}
    </div>
  );
}

/** Valutazione del fornitore: voti dei buyer e dati già noti (offerte, ordini). */
export function RatingCard({ supplierId, fail, notify }: { supplierId: number; fail: (e: unknown) => string; notify: (m: string) => void }) {
  const [sc, setSc] = useState<Scorecard | null>(null);
  const [adding, setAdding] = useState(false);
  const [v, setV] = useState<Record<RatingCriterion, number>>({ quality: 0, delivery: 0, service: 0, price: 0 });
  const [comment, setComment] = useState("");
  const [po, setPo] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { let off = false; portalApi.scorecard(supplierId).then(x => { if (!off) setSc(x); }).catch(e => { if (!off) setErr(fail(e)); }); return () => { off = true; }; }, [supplierId, fail]);

  const save = async () => {
    setBusy(true); setErr(null);
    try { setSc(await portalApi.addRating(supplierId, { ...v, comment, po })); setAdding(false); setV({ quality: 0, delivery: 0, service: 0, price: 0 }); setComment(""); setPo(""); notify("Valutazione salvata"); } catch (e) { setErr(fail(e)); }
    setBusy(false);
  };
  const remove = async (id: number) => { if (!confirm("Eliminare questa valutazione?")) return; try { setSc(await portalApi.deleteRating(id)); } catch (e) { setErr(fail(e)); } };
  if (!sc && !err) return <Card><div style={{ display: "flex", justifyContent: "center", padding: 14 }}><Loader2 className="spin" size={20} color={C.subtle} /></div></Card>;

  return (
    <Card>
      <CardTitle icon={<Star size={16} />} action={!adding && sc ? <button onClick={() => setAdding(true)} style={{ ...btnGhost, padding: "6px 12px", fontSize: 12.5 }}>Valuta</button> : undefined}>Valutazione</CardTitle>
      {err && <Notice kind="error">{err}</Notice>}
      {sc && <>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 10, marginBottom: 12 }}>
          <div style={{ background: C.bg, borderRadius: 12, padding: "10px 12px" }}><div style={{ ...sans, fontSize: 11.5, color: C.muted }}>Voto complessivo</div><div style={{ marginTop: 2 }}>{sc.overall !== null ? <ScoreBadge value={sc.overall} count={sc.count} /> : <span style={{ ...sans, fontSize: 13, color: C.subtle }}>Nessun voto</span>}</div></div>
          {CRITERIA.map(([k, l]) => <div key={k} style={{ background: C.bg, borderRadius: 12, padding: "10px 12px" }}><div style={{ ...sans, fontSize: 11.5, color: C.muted }}>{l}</div><div style={{ marginTop: 2 }}>{sc.criteria[k] !== null ? <ScoreBadge value={sc.criteria[k]!} /> : <span style={{ ...sans, fontSize: 13, color: C.subtle }}>—</span>}</div></div>)}
        </div>
        <div style={{ ...sans, fontSize: 12.5, color: C.muted, display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 8 }}>
          <span>Ordini 12 mesi: <b style={{ color: C.text }}>{sc.pos12m ? `${sc.pos12m} PO · ${fmt(sc.spend12m)}` : "nessuno"}</b></span>
          <span>Richieste di offerta: <b style={{ color: C.text }}>{sc.rfq.invited ? `${sc.rfq.answered} risposte su ${sc.rfq.invited} inviti${sc.rfq.declined ? ` (${sc.rfq.declined} rinunce)` : ""}` : "nessuna"}</b></span>
        </div>
      </>}
      {adding && (
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 12, padding: 14, display: "grid", gap: 10, marginBottom: 12 }}>
          {CRITERIA.map(([k, l]) => <div key={k} style={{ display: "flex", alignItems: "center", gap: 12 }}><span style={{ ...sans, fontSize: 13, width: 90 }}>{l}</span><Stars value={v[k]} onChange={n => setV(x => ({ ...x, [k]: n }))} label={l} /></div>)}
          <input value={comment} onChange={e => setComment(e.target.value)} placeholder="Commento (obbligatorio con un voto di 1 o 2)" aria-label="Commento" style={iStyle} />
          <input value={po} onChange={e => setPo(e.target.value)} placeholder="PO di riferimento (facoltativo)" aria-label="PO di riferimento" style={{ ...iStyle, maxWidth: 260 }} />
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={save} disabled={busy || Object.values(v).some(x => !x)} style={{ ...btnPrimary, padding: "8px 16px" }}>{busy ? "Salvo…" : "Salva valutazione"}</button>
            <button onClick={() => setAdding(false)} style={{ ...btnGhost, padding: "8px 16px" }}>Annulla</button>
          </div>
        </div>
      )}
      {sc?.ratings.map(r => (
        <div key={r.id} style={{ ...sans, display: "flex", gap: 10, padding: "8px 0", borderTop: `1px solid ${C.borderLight}`, fontSize: 13, flexWrap: "wrap", alignItems: "baseline" }}>
          <span style={{ width: 96, color: C.subtle, fontSize: 12 }}>{fmtDate(r.createdAt)}</span>
          <span style={{ flex: "1 1 220px", minWidth: 0 }}><b>{r.raterName}</b>{r.po && <span style={{ color: C.subtle }}> · PO {r.po}</span>}{r.comment && <div style={{ color: C.muted, fontSize: 12.5 }}>{r.comment}</div>}</span>
          <span className="tabular" style={{ color: C.muted, fontSize: 12.5 }}>{r.quality}·{r.delivery}·{r.service}·{r.price}</span>
          <button onClick={() => remove(r.id)} aria-label="Elimina valutazione" style={{ background: "none", border: "none", cursor: "pointer", color: C.subtle, display: "flex" }}><Trash2 size={14} /></button>
        </div>
      ))}
      {sc && sc.ratings.length > 0 && <div style={{ ...sans, fontSize: 11.5, color: C.subtle, marginTop: 6 }}>Voti: qualità · puntualità · servizio · prezzo. Il voto complessivo considera gli ultimi 24 mesi.</div>}
    </Card>
  );
}
