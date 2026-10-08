import { useMemo, useState } from "react";
import type { Contract, Plans } from "../types.ts";
import { C, colorFor, font, sans, URGENCY_COLORS } from "../theme.ts";
import { daysToExpiry, urgency } from "../lib/format.ts";
import { BO_COLORS, calcWorkload, getSuggestions, planProgress, WORKLOAD_THRESHOLD } from "../lib/plan.ts";
import { Card, Grid } from "../components/ui.tsx";

export function TeamView({ contracts, plans, onApplySuggestion }: { contracts: Contract[]; plans: Plans; onApplySuggestion: (id: number, offset: number) => void }) {
  const [selectedBuyer, setSelectedBuyer] = useState("Tutti");
  const workload = useMemo(() => calcWorkload(contracts, plans), [contracts, plans]);
  const suggestions = useMemo(() => getSuggestions(contracts, plans), [contracts, plans]);
  const buyers = ["Tutti", ...new Set(contracts.filter(c => !c.ceased).map(c => c.owner).filter(Boolean))];
  const months = Object.entries(workload).slice(0, 12);
  const maxVal = Math.max(...months.map(([, m]) => m.total), 1);
  const filtered = useMemo(() => {
    const active = contracts.filter(c => !c.ceased);
    return selectedBuyer === "Tutti" ? active : active.filter(c => c.owner === selectedBuyer);
  }, [contracts, selectedBuyer]);

  return (
    <div>
      <Card style={{ marginBottom: 16 }}>
        <div style={{ ...font, fontSize: 14, fontWeight: 700, color: C.navy, marginBottom: 12 }}>Carico team per mese</div>
        <div style={{ display: "flex", gap: 6, alignItems: "flex-end", height: 110 }}>
          {months.map(([key, m]) => {
            const maxB = Math.max(...Object.values(m.byBuyer), 0);
            const bc = maxB >= WORKLOAD_THRESHOLD * 2 ? C.red : maxB >= WORKLOAD_THRESHOLD ? C.yellow : C.green;
            const h = Math.max(4, (m.total / maxVal) * 80);
            return (
              <div key={key} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                {m.total > 0 && <div style={{ ...sans, fontSize: 9, color: bc === C.red ? C.red : C.muted, fontWeight: bc === C.red ? 700 : 400 }}>{m.total}</div>}
                <div style={{ width: "100%", height: `${h}px`, background: bc, borderRadius: "3px 3px 0 0", opacity: 0.85 }} />
                <div style={{ ...sans, fontSize: 8, color: C.muted, whiteSpace: "nowrap" }}>{m.label}</div>
              </div>
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
          {[["🟢", "OK"], ["🟡", "Alto"], ["🔴", "Critico"]].map(([e, l]) => <div key={l} style={{ display: "flex", alignItems: "center", gap: 3 }}><span style={{ fontSize: 10 }}>{e}</span><span style={{ ...sans, fontSize: 10, color: C.muted }}>{l}</span></div>)}
        </div>
      </Card>

      {suggestions.length > 0 && (
        <div style={{ background: C.yellowBg, border: `1px solid #f0d080`, borderRadius: 12, padding: 14, marginBottom: 16 }}>
          <div style={{ ...font, fontSize: 14, fontWeight: 700, color: C.yellow, marginBottom: 10 }}>💡 {suggestions.length} suggerimento/i di anticipo</div>
          <Grid min={280} gap={8}>
            {suggestions.map(s => (
              <div key={s.contractId} style={{ background: "#fff", borderRadius: 8, padding: 12 }}>
                <div style={{ ...sans, fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{s.supplier}</div>
                <div style={{ ...sans, fontSize: 12, color: C.muted, marginBottom: 8 }}>{s.reason}</div>
                <button onClick={() => onApplySuggestion(s.contractId, s.recommendedOffset)} style={{ ...sans, padding: "6px 14px", background: C.navy, border: "none", borderRadius: 6, color: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>⏩ Anticipa di {s.recommendedOffset}gg</button>
              </div>
            ))}
          </Grid>
        </div>
      )}

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
        {buyers.map(b => { const color = b === "Tutti" ? C.navy : colorFor(b); const sel = selectedBuyer === b; return (
          <button key={b} onClick={() => setSelectedBuyer(b)} aria-pressed={sel} style={{ ...sans, padding: "5px 12px", borderRadius: 20, border: `1px solid ${sel ? color : C.border}`, background: sel ? color : "transparent", color: sel ? "#fff" : C.muted, cursor: "pointer", fontSize: 11, fontWeight: 600 }}>{b}</button>
        ); })}
      </div>

      <div style={{ ...font, fontSize: 14, fontWeight: 700, color: C.navy, marginBottom: 10 }}>{selectedBuyer} ({filtered.length})</div>
      <Grid min={340} gap={8}>
        {filtered.map(c => {
          const plan = plans[c.id] || [];
          const prog = planProgress(plan);
          const days = daysToExpiry(c.end);
          const uColor = URGENCY_COLORS[urgency(c)];
          const bColor = colorFor(c.owner);
          const boStep = plan.find(s => s.stepId === "bo_response");
          return (
            <div key={c.id} style={{ background: C.card, border: `1px solid ${C.border}`, borderLeft: `3px solid ${uColor}`, borderRadius: 10, padding: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 4 }}>
                <div style={{ ...sans, fontSize: 13, fontWeight: 700, color: C.navy, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.supplier}</div>
                <div style={{ ...sans, fontSize: 12, fontWeight: 700, color: uColor, flexShrink: 0 }}>{days < 0 ? "Scaduto" : `${days}gg`}</div>
              </div>
              <div style={{ ...sans, fontSize: 12, color: C.muted, marginBottom: 8 }}>{c.object}</div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 5 }}><div style={{ width: 8, height: 8, borderRadius: "50%", background: bColor }} /><span style={{ ...sans, fontSize: 11, color: C.muted }}>{c.owner}</span></div>
                <span style={{ ...sans, fontSize: 11, fontWeight: 600, color: C.navy }}>{prog}%</span>
              </div>
              <div style={{ height: 5, background: C.borderLight, borderRadius: 3 }}><div style={{ height: "100%", width: `${prog}%`, background: bColor, borderRadius: 3 }} /></div>
              {boStep?.boDecision && <div style={{ marginTop: 8 }}><span style={{ ...sans, fontSize: 11, fontWeight: 600, color: BO_COLORS[boStep.boDecision]?.color, background: BO_COLORS[boStep.boDecision]?.bg, borderRadius: 4, padding: "2px 8px" }}>BO: {boStep.boDecision}</span></div>}
            </div>
          );
        })}
      </Grid>
    </div>
  );
}
