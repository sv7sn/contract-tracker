import type { Contract, Plans, User } from "../types.ts";
import { C, font, sans, URGENCY_COLORS } from "../theme.ts";
import { daysToExpiry, fmtDate, urgency } from "../lib/format.ts";
import { BO_COLORS } from "../lib/plan.ts";
import { Avatar, Grid } from "../components/ui.tsx";

export function BOView({ contracts, plans, currentUser, onOpenBOForm }: { contracts: Contract[]; plans: Plans; currentUser: User; onOpenBOForm: (c: Contract) => void }) {
  const myContracts = contracts.filter(c => !c.ceased);
  const pending = myContracts.filter(c => (plans[c.id] || []).some(s => s.stepId === "bo_response" && s.status === "pending_bo"));
  const others = myContracts.filter(c => !pending.find(p => p.id === c.id));

  return (
    <div>
      <div style={{ background: C.navy, borderRadius: 12, padding: 18, marginBottom: 20, color: "#fff" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
          <Avatar name={currentUser.name} size={44} />
          <div>
            <div style={{ ...font, fontSize: 16, fontWeight: 700 }}>{currentUser.name}</div>
            <div style={{ ...sans, fontSize: 12, color: "rgba(255,255,255,0.5)" }}>{currentUser.title}</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 28 }}>
          <div><div style={{ ...sans, fontSize: 10, color: "rgba(255,255,255,0.4)" }}>CONTRATTI</div><div style={{ ...font, fontSize: 20, fontWeight: 700 }}>{myContracts.length}</div></div>
          <div><div style={{ ...sans, fontSize: 10, color: "rgba(255,255,255,0.4)" }}>IN ATTESA RISPOSTA</div><div style={{ ...font, fontSize: 20, fontWeight: 700, color: "#f5c55a" }}>{pending.length}</div></div>
        </div>
      </div>

      {pending.length > 0 && (
        <div style={{ marginBottom: 22 }}>
          <div style={{ ...sans, fontSize: 12, fontWeight: 700, color: C.yellow, marginBottom: 10 }}>⏳ Richieste in attesa di risposta ({pending.length})</div>
          <Grid min={340}>
            {pending.map(c => (
              <div key={c.id} style={{ background: C.yellowBg, border: `1px solid #f0d080`, borderRadius: 10, padding: 16 }}>
                <div style={{ ...sans, fontSize: 13, fontWeight: 700, color: C.navy, marginBottom: 4 }}>{c.supplier}</div>
                <div style={{ ...sans, fontSize: 12, color: C.muted, marginBottom: 10 }}>{c.object} · Scadenza: {fmtDate(c.end)}</div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ ...sans, fontSize: 12, color: C.muted }}>Buyer: {c.owner}</div>
                  <button onClick={() => onOpenBOForm(c)} style={{ ...sans, padding: "8px 16px", background: C.accent, border: "none", borderRadius: 8, color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: 13 }}>📋 Rispondi</button>
                </div>
              </div>
            ))}
          </Grid>
        </div>
      )}

      {others.length > 0 && (
        <div>
          <div style={{ ...sans, fontSize: 12, fontWeight: 700, color: C.muted, marginBottom: 10 }}>I tuoi contratti ({others.length})</div>
          <Grid min={340} gap={8}>
            {others.map(c => {
              const days = daysToExpiry(c.end); const lc = URGENCY_COLORS[urgency(c)];
              const boStep = (plans[c.id] || []).find(s => s.stepId === "bo_response");
              return (
                <div key={c.id} style={{ background: C.card, border: `1px solid ${C.border}`, borderLeft: `3px solid ${lc}`, borderRadius: 10, padding: 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <div style={{ ...sans, fontSize: 13, fontWeight: 700, color: C.navy }}>{c.supplier}</div>
                    <div style={{ ...sans, fontSize: 12, fontWeight: 700, color: lc }}>{days < 0 ? "Scaduto" : `${days}gg`}</div>
                  </div>
                  <div style={{ ...sans, fontSize: 12, color: C.muted, marginTop: 2 }}>{c.object}</div>
                  {boStep?.boDecision && (
                    <div style={{ marginTop: 8 }}>
                      <span style={{ ...sans, fontSize: 11, fontWeight: 600, color: BO_COLORS[boStep.boDecision]?.color, background: BO_COLORS[boStep.boDecision]?.bg, borderRadius: 4, padding: "2px 8px" }}>✓ {boStep.boDecision}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </Grid>
        </div>
      )}

      {myContracts.length === 0 && (
        <div style={{ textAlign: "center", padding: 40 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
          <div style={{ ...sans, color: C.muted, fontSize: 14 }}>Nessun contratto assegnato al momento.</div>
        </div>
      )}
    </div>
  );
}
