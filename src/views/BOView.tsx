import type { Contract, Plans, User } from "../types.ts";
import { C, font, radius, sans, URGENCY_COLORS } from "../theme.ts";
import { daysToDeadline, fmtDate, urgency } from "../lib/format.ts";
import { BO_COLORS } from "../lib/plan.ts";
import { Avatar, Card, DaysChip, EmptyState, Grid, StatCard } from "../components/ui.tsx";
import { CheckCircle2, ClipboardCheck, FileText, Hourglass } from "../components/icons.tsx";

export function BOView({ contracts, plans, currentUser, onOpenBOForm }: { contracts: Contract[]; plans: Plans; currentUser: User; onOpenBOForm: (c: Contract) => void }) {
  const myContracts = contracts.filter(c => !c.ceased);
  const pending = myContracts.filter(c => (plans[c.id] || []).some(s => s.stepId === "bo_response" && s.status === "pending_bo"));
  const others = myContracts.filter(c => !pending.find(p => p.id === c.id));
  const first = currentUser.name.split(" ")[0];

  return (
    <div style={{ display: "grid", gap: 20, gridTemplateColumns: "minmax(0,1fr)" }}>
      <div>
        <h2 style={{ ...font, margin: 0, fontSize: 24, fontWeight: 700, color: C.text }}>Ciao, {first}</h2>
        <p style={{ ...sans, margin: "4px 0 0", fontSize: 14, color: C.muted }}>{pending.length > 0 ? <>Ci sono <b style={{ color: C.yellow }}>{pending.length} {pending.length === 1 ? "richiesta" : "richieste"}</b> in attesa della tua decisione.</> : "Non ci sono richieste in attesa: grazie!"}</p>
      </div>
      <Grid min={220} fill>
        <StatCard label="I tuoi contratti" value={myContracts.length} color={C.blue} icon={<FileText size={18} />} sub="a te assegnati" />
        <StatCard label="In attesa di risposta" value={pending.length} color={C.yellow} icon={<Hourglass size={18} />} sub={pending.length ? "serve la tua decisione" : "nessuna richiesta"} />
      </Grid>

      {pending.length > 0 && (
        <section>
          <h3 style={{ ...font, fontSize: 15, margin: "0 0 12px", color: C.text, display: "flex", alignItems: "center", gap: 8 }}><ClipboardCheck size={17} color={C.yellow} />Richieste in attesa di risposta</h3>
          <Grid min={340}>
            {pending.map(c => (
              <Card key={c.id} style={{ borderLeft: `4px solid ${C.yellow}`, borderRadius: radius.md }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
                  <div style={{ minWidth: 0 }}><div style={{ ...sans, fontSize: 14.5, fontWeight: 650, color: C.text }}>{c.supplier}</div><div style={{ ...sans, fontSize: 12.5, color: C.muted, marginTop: 1 }}>{c.object}</div></div>
                  <DaysChip days={daysToDeadline(c)} level={urgency(c)} />
                </div>
                <div style={{ ...sans, fontSize: 12.5, color: C.muted, margin: "12px 0" }}>Scade il <b style={{ color: C.text }}>{fmtDate(c.end)}</b>{c.noticeDate && <> · disdetta entro <b style={{ color: C.text }}>{fmtDate(c.noticeDate)}</b></>}</div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, ...sans, fontSize: 12.5, color: C.muted }}><Avatar name={c.owner || "?"} size={24} />Buyer: {c.owner}</div>
                  <button onClick={() => onOpenBOForm(c)} style={{ ...sans, display: "flex", alignItems: "center", gap: 7, padding: "9px 16px", background: C.accent, border: "none", borderRadius: 10, color: "#fff", fontWeight: 650, cursor: "pointer", fontSize: 13, boxShadow: "0 1px 2px rgba(200,82,42,.35)" }}><ClipboardCheck size={16} />Rispondi</button>
                </div>
              </Card>
            ))}
          </Grid>
        </section>
      )}

      {others.length > 0 && (
        <section>
          <h3 style={{ ...font, fontSize: 15, margin: "0 0 12px", color: C.text }}>I tuoi contratti</h3>
          <Grid min={340} gap={12}>
            {others.map(c => {
              const days = daysToDeadline(c); const u = urgency(c);
              const boStep = (plans[c.id] || []).find(s => s.stepId === "bo_response");
              return (
                <Card key={c.id} style={{ borderLeft: `4px solid ${URGENCY_COLORS[u]}`, borderRadius: radius.md, padding: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
                    <div style={{ minWidth: 0 }}><div style={{ ...sans, fontSize: 14, fontWeight: 650, color: C.text }}>{c.supplier}</div><div style={{ ...sans, fontSize: 12.5, color: C.muted, marginTop: 1 }}>{c.object}</div></div>
                    <DaysChip days={days} level={u} />
                  </div>
                  {boStep?.boDecision && <div style={{ marginTop: 12 }}><span style={{ ...sans, display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 650, color: BO_COLORS[boStep.boDecision]?.color, background: BO_COLORS[boStep.boDecision]?.bg, borderRadius: 999, padding: "4px 11px" }}><CheckCircle2 size={14} />{boStep.boDecision}</span></div>}
                </Card>
              );
            })}
          </Grid>
        </section>
      )}

      {myContracts.length === 0 && <EmptyState icon={<CheckCircle2 size={28} />} title="Nessun contratto assegnato" text="Quando un buyer ti indicherà come Business Owner di un contratto lo troverai qui." />}
    </div>
  );
}
