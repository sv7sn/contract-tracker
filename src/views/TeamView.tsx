import { useMemo, useState } from "react";
import type { Contract, Plans } from "../types.ts";
import { C, CHART, colorFor, font, radius, sans, shadow, URGENCY_COLORS } from "../theme.ts";
import { daysToExpiry, urgency } from "../lib/format.ts";
import { BO_COLORS, calcWorkload, getSuggestions, planProgress, WORKLOAD_THRESHOLD } from "../lib/plan.ts";
import { Avatar, Card, DaysChip, Grid } from "../components/ui.tsx";
import { ChartCard } from "../components/charts.tsx";
import { Lightbulb } from "../components/icons.tsx";

const OVERLOAD = "#d03b3b";

export function TeamView({ contracts, plans, onApplySuggestion }: { contracts: Contract[]; plans: Plans; onApplySuggestion: (id: number, offset: number) => void }) {
  const [selectedBuyer, setSelectedBuyer] = useState("Tutti");
  const [hover, setHover] = useState<number | null>(null);
  const workload = useMemo(() => calcWorkload(contracts, plans), [contracts, plans]);
  const suggestions = useMemo(() => getSuggestions(contracts, plans), [contracts, plans]);
  const buyers = ["Tutti", ...new Set(contracts.filter(c => !c.ceased).map(c => c.owner).filter(Boolean))];
  const months = Object.entries(workload).slice(0, 12);
  const maxVal = Math.max(4, ...months.map(([, m]) => m.total));
  const max = Math.ceil(maxVal / 4) * 4;
  const filtered = useMemo(() => {
    const active = contracts.filter(c => !c.ceased);
    return selectedBuyer === "Tutti" ? active : active.filter(c => c.owner === selectedBuyer);
  }, [contracts, selectedBuyer]);
  const H = 150;
  const overloaded = (m: typeof months[number][1]) => Math.max(0, ...Object.values(m.byBuyer)) >= WORKLOAD_THRESHOLD;

  return (
    <div style={{ display: "grid", gap: 18, gridTemplateColumns: "minmax(0,1fr)" }}>
      <ChartCard
        title="Carico di lavoro del team" subtitle={`Attività di rinnovo ancora da fare, mese per mese. In rosso i mesi in cui almeno un buyer ha ${WORKLOAD_THRESHOLD} o più attività.`}
        table={{ head: ["Mese", "Attività", "Buyer più carico"], rows: months.map(([, m]) => { const top = Object.entries(m.byBuyer).sort((a, b) => b[1] - a[1])[0]; return [m.label, m.total, top ? `${top[0]} (${top[1]})` : "—"]; }) }}
        legend={
          <div style={{ display: "flex", gap: 18, marginTop: 14, ...sans, fontSize: 12.5, color: C.muted }}>
            <span style={{ display: "flex", alignItems: "center", gap: 7 }}><span aria-hidden style={{ width: 10, height: 10, borderRadius: 3, background: CHART.blue }} />Carico regolare</span>
            <span style={{ display: "flex", alignItems: "center", gap: 7 }}><span aria-hidden style={{ width: 10, height: 10, borderRadius: 3, background: OVERLOAD }} />Almeno un buyer sovraccarico</span>
          </div>
        }
      >
        <div style={{ display: "flex", gap: 8 }}>
          <div aria-hidden style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", height: H, ...sans, fontSize: 11, color: CHART.label, textAlign: "right", width: 18 }}><span>{max}</span><span>{max / 2}</span><span>0</span></div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ position: "relative", height: H }}>
              {[0, 0.5, 1].map(f => <div key={f} aria-hidden style={{ position: "absolute", left: 0, right: 0, top: `${f * 100}%`, height: 1, background: f === 1 ? CHART.axis : CHART.grid }} />)}
              <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "flex-end" }}>
                {months.map(([key, m], i) => {
                  const h = m.total ? Math.max(6, (m.total / max) * H) : 0;
                  const over = overloaded(m);
                  const people = Object.entries(m.byBuyer).sort((a, b) => b[1] - a[1]);
                  return (
                    <div key={key} tabIndex={0} role="img" aria-label={`${m.label}: ${m.total} attività${over ? ", un buyer è sovraccarico" : ""}`}
                      onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}
                      style={{ flex: 1, height: "100%", display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center", position: "relative", outline: "none" }}>
                      {hover === i && (
                        <div role="tooltip" style={{ position: "absolute", bottom: "calc(100% + 8px)", ...(i < 2 ? { left: 0 } : i > 9 ? { right: 0 } : { left: "50%", transform: "translateX(-50%)" }), zIndex: 5, background: C.navy, color: "#fff", borderRadius: 10, padding: "8px 11px", fontSize: 12, lineHeight: 1.45, minWidth: 140, boxShadow: shadow.md, pointerEvents: "none", ...sans }}>
                          <div style={{ fontWeight: 650, textTransform: "capitalize" }}>{m.label}</div>
                          <div style={{ opacity: .8 }}>{m.total} attività</div>
                          {people.slice(0, 5).map(([n, c]) => <div key={n} style={{ opacity: .9 }}>• {n}: {c}</div>)}
                        </div>
                      )}
                      {m.total > 0 && <div className="tabular" style={{ ...sans, fontSize: 11, fontWeight: 650, color: over ? OVERLOAD : C.muted, marginBottom: 3 }}>{m.total}</div>}
                      {m.total > 0 && <div style={{ width: "min(100%, 24px)", height: h, background: over ? OVERLOAD : CHART.blue, borderRadius: "4px 4px 0 0", opacity: hover !== null && hover !== i ? 0.45 : 1, transition: "opacity .12s ease" }} />}
                    </div>
                  );
                })}
              </div>
            </div>
            <div style={{ display: "flex", marginTop: 6 }}>{months.map(([k, m]) => <div key={k} style={{ flex: 1, textAlign: "center", ...sans, fontSize: 11, color: CHART.label, textTransform: "capitalize" }}>{m.label.split(" ")[0]}</div>)}</div>
          </div>
        </div>
      </ChartCard>

      {suggestions.length > 0 && (
        <div style={{ background: C.yellowBg, border: "1px solid #f3dca0", borderRadius: radius.lg, padding: 16 }}>
          <div style={{ ...font, fontSize: 15, fontWeight: 650, color: C.text, marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}><Lightbulb size={18} color={C.yellow} />{suggestions.length} {suggestions.length === 1 ? "suggerimento" : "suggerimenti"} per bilanciare il carico</div>
          <Grid min={290} gap={10}>
            {suggestions.map(s => (
              <div key={s.contractId} style={{ background: "#fff", borderRadius: 12, padding: 14, border: `1px solid ${C.border}` }}>
                <div style={{ ...sans, fontSize: 13.5, fontWeight: 650, marginBottom: 3 }}>{s.supplier}</div>
                <div style={{ ...sans, fontSize: 12.5, color: C.muted, marginBottom: 12 }}>{s.reason}</div>
                <button onClick={() => onApplySuggestion(s.contractId, s.recommendedOffset)} style={{ ...sans, padding: "7px 14px", background: C.navy, border: "none", borderRadius: 9, color: "#fff", cursor: "pointer", fontSize: 12.5, fontWeight: 650 }}>Anticipa di {s.recommendedOffset} giorni</button>
              </div>
            ))}
          </Grid>
        </div>
      )}

      <div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
          {buyers.map(b => { const sel = selectedBuyer === b; return (
            <button key={b} onClick={() => setSelectedBuyer(b)} aria-pressed={sel} style={{ ...sans, display: "flex", alignItems: "center", gap: 8, padding: b === "Tutti" ? "6px 14px" : "4px 12px 4px 5px", borderRadius: 999, border: `1px solid ${sel ? C.navy : C.border}`, background: sel ? C.navy : "#fff", color: sel ? "#fff" : C.muted, cursor: "pointer", fontSize: 12.5, fontWeight: 600 }}>{b !== "Tutti" && <Avatar name={b} size={22} />}{b}</button>
          ); })}
        </div>
        <div style={{ ...font, fontSize: 15, fontWeight: 650, color: C.text, marginBottom: 12 }}>{selectedBuyer === "Tutti" ? "Tutti i contratti" : selectedBuyer} <span style={{ color: C.subtle, fontWeight: 500 }}>({filtered.length})</span></div>
        <Grid min={340} gap={12}>
          {filtered.map(c => {
            const plan = plans[c.id] || [];
            const prog = planProgress(plan);
            const u = urgency(c);
            const bColor = colorFor(c.owner);
            const boStep = plan.find(s => s.stepId === "bo_response");
            return (
              <Card key={c.id} style={{ borderLeft: `4px solid ${URGENCY_COLORS[u]}`, borderRadius: radius.md, padding: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
                  <div style={{ minWidth: 0 }}><div style={{ ...sans, fontSize: 14, fontWeight: 650, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.supplier}</div><div style={{ ...sans, fontSize: 12.5, color: C.muted }}>{c.object}</div></div>
                  <DaysChip days={daysToExpiry(c.end)} level={u} />
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "14px 0 6px" }}>
                  <div style={{ flex: 1, height: 6, background: C.borderLight, borderRadius: 3 }}><div style={{ height: "100%", width: `${prog}%`, background: bColor, borderRadius: 3 }} /></div>
                  <span className="tabular" style={{ ...sans, fontSize: 12, fontWeight: 650 }}>{prog}%</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7, ...sans, fontSize: 12, color: C.muted }}><Avatar name={c.owner || "?"} size={22} />{c.owner}</div>
                  {boStep?.boDecision && <span style={{ ...sans, fontSize: 11.5, fontWeight: 650, color: BO_COLORS[boStep.boDecision]?.color, background: BO_COLORS[boStep.boDecision]?.bg, borderRadius: 999, padding: "3px 10px" }}>BO: {boStep.boDecision}</span>}
                </div>
              </Card>
            );
          })}
        </Grid>
      </div>
    </div>
  );
}
