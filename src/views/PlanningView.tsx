import { useState } from "react";
import type { AuditLogs, Contract, PlanStep, Plans, StepTemplate, User } from "../types.ts";
import { C, colorFor, font, sans, URGENCY_COLORS } from "../theme.ts";
import { daysToExpiry, fmtDate, urgency } from "../lib/format.ts";
import { BO_COLORS, planProgress, stepTemplate } from "../lib/plan.ts";
import { canEditContract, canRespondBO } from "../permissions.ts";
import { AuditTrail, Card, Grid } from "../components/ui.tsx";
import { StepDateEditor } from "../components/Modals.tsx";

interface Props {
  contracts: Contract[]; plans: Plans; auditLogs: AuditLogs; currentUser: User;
  onSendBO: (id: number) => void; onCompleteStep: (id: number, stepId: string) => void;
  onOpenBOForm: (c: Contract) => void; onUpdateStepDate: (id: number, stepId: string, date: string, reason: string) => void;
}

export function PlanningView({ contracts, plans, auditLogs, currentUser, onSendBO, onCompleteStep, onOpenBOForm, onUpdateStepDate }: Props) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [editingStep, setEditingStep] = useState<{ step: PlanStep; tmpl: StepTemplate } | null>(null);

  // I contratti arrivano già filtrati dal server in base al ruolo: qui si tengono solo quelli in scadenza entro 120 giorni.
  const sorted = contracts.filter(c => !c.ceased && daysToExpiry(c.end) <= 120).sort((a, b) => daysToExpiry(a.end) - daysToExpiry(b.end));
  const contract = selectedId !== null ? contracts.find(c => c.id === selectedId) : undefined;

  if (contract) {
    const plan = plans[contract.id] || [];
    const canEdit = canEditContract(currentUser, contract);
    const canProxyBO = canRespondBO(currentUser, contract) && currentUser.role === "manager";
    return (
      <div>
        <button onClick={() => setSelectedId(null)} style={{ ...sans, background: "none", border: "none", color: C.accent, cursor: "pointer", marginBottom: 14, fontSize: 13, fontWeight: 600, padding: 0 }}>← Piano</button>
        <div style={{ background: C.navy, borderRadius: 12, padding: 18, marginBottom: 14, color: "#fff" }}>
          <div style={{ ...font, fontSize: 15, fontWeight: 700, marginBottom: 4 }}>{contract.supplier}</div>
          <div style={{ ...sans, fontSize: 12, color: "rgba(255,255,255,0.6)", marginBottom: 10 }}>{contract.object}</div>
          <div style={{ display: "flex", gap: 24 }}>
            <div><div style={{ ...sans, fontSize: 9, color: "rgba(255,255,255,0.4)" }}>SCADENZA</div><div style={{ ...sans, fontSize: 13, fontWeight: 600 }}>{fmtDate(contract.end)}</div></div>
            <div><div style={{ ...sans, fontSize: 9, color: "rgba(255,255,255,0.4)" }}>BUYER</div><div style={{ ...sans, fontSize: 13, fontWeight: 600 }}>{contract.owner}</div></div>
          </div>
        </div>

        <Grid min={380}>
          <Card style={{ padding: 18 }}>
            <h4 style={{ ...font, margin: "0 0 16px", fontSize: 15, color: C.navy }}>Piano attività</h4>
            {plan.map((step, i) => {
              const tmpl = stepTemplate(step.stepId);
              const isLast = i === plan.length - 1;
              const sc = step.status === "done" ? C.green : step.status === "pending_bo" ? C.yellow : C.subtle;
              const isEditable = canEdit && step.status === "upcoming" && step.stepId !== "expiry";
              return (
                <div key={step.stepId} style={{ display: "flex", gap: 12, marginBottom: isLast ? 0 : 16 }}>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 32, flexShrink: 0 }}>
                    <div style={{ width: 32, height: 32, borderRadius: "50%", background: step.status === "done" ? C.green : C.bg, border: `2px solid ${sc}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, color: step.status === "done" ? "#fff" : undefined }}>{step.status === "done" ? "✓" : tmpl.icon}</div>
                    {!isLast && <div style={{ width: 2, flex: 1, background: step.status === "done" ? C.green : C.borderLight, marginTop: 4, marginBottom: -8 }} />}
                  </div>
                  <div style={{ flex: 1, paddingBottom: isLast ? 0 : 6 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <div style={{ ...sans, fontSize: 13, fontWeight: 700, color: step.status === "done" ? C.green : step.status === "pending_bo" ? C.yellow : C.navy }}>{tmpl.label}</div>
                      <button onClick={() => isEditable && setEditingStep({ step, tmpl })} style={{ ...sans, fontSize: 11, color: isEditable ? C.accent : C.subtle, background: "none", border: "none", cursor: isEditable ? "pointer" : "default", padding: 0, fontWeight: step.modified ? 700 : 400 }}>
                        {step.modified ? "✏️ " : ""}{fmtDate(step.scheduledDate)}
                      </button>
                    </div>
                    {step.modified && <div style={{ ...sans, fontSize: 11, color: C.blue, marginTop: 2 }}>⏩ {step.modifiedReason}</div>}
                    {step.stepId === "bo_response" && step.boDecision && (
                      <div style={{ marginTop: 8, padding: "8px 12px", borderRadius: 8, background: BO_COLORS[step.boDecision]?.bg, border: `1px solid ${BO_COLORS[step.boDecision]?.color}` }}>
                        <div style={{ ...sans, fontSize: 11, color: C.subtle, marginBottom: 2 }}>Decisione BO · {step.boRespondedAt}</div>
                        <div style={{ ...sans, fontSize: 13, fontWeight: 700, color: BO_COLORS[step.boDecision]?.color }}>{step.boDecision}</div>
                        {step.boNotes && <div style={{ ...sans, fontSize: 12, color: C.text, marginTop: 4, fontStyle: "italic" }}>"{step.boNotes}"</div>}
                      </div>
                    )}
                    {step.stepId === "bo_notify" && step.status !== "done" && canEdit && <button onClick={() => onSendBO(contract.id)} style={{ ...sans, marginTop: 8, padding: "6px 12px", background: C.navy, border: "none", borderRadius: 6, color: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>✉️ Invia notifica BO</button>}
                    {step.stepId === "bo_notify" && step.status === "done" && canProxyBO && !plan.find(s => s.stepId === "bo_response")?.boDecision && <button onClick={() => onOpenBOForm(contract)} style={{ ...sans, marginTop: 8, padding: "6px 12px", background: C.blue, border: "none", borderRadius: 6, color: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>📋 Registra risposta BO (per conto)</button>}
                    {isEditable && step.stepId !== "bo_notify" && step.stepId !== "bo_response" && <button onClick={() => onCompleteStep(contract.id, step.stepId)} style={{ ...sans, marginTop: 8, padding: "5px 10px", background: "transparent", border: `1px solid ${C.border}`, borderRadius: 6, color: C.muted, cursor: "pointer", fontSize: 11 }}>✓ Completato</button>}
                    {step.completedBy && <div style={{ ...sans, fontSize: 11, color: C.subtle, marginTop: 4 }}>Da {step.completedBy} · {step.completedAt}</div>}
                  </div>
                </div>
              );
            })}
          </Card>
          <AuditTrail entries={auditLogs[contract.id] || []} />
        </Grid>

        {editingStep && <StepDateEditor step={editingStep.step} tmpl={editingStep.tmpl} onSave={(d, r) => { onUpdateStepDate(contract.id, editingStep.step.stepId, d, r); setEditingStep(null); }} onClose={() => setEditingStep(null)} />}
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <div style={{ ...font, fontSize: 15, fontWeight: 700, color: C.navy }}>{currentUser.role === "manager" ? "Piano acquisti — tutto il team" : "Il mio piano acquisti"}</div>
        <div style={{ ...sans, fontSize: 12, color: C.muted }}>{sorted.length} contratti con scadenza entro 120 giorni</div>
      </div>
      {sorted.length === 0 && <p style={{ ...sans, color: C.muted, fontSize: 13 }}>Nessun contratto da pianificare nei prossimi 120 giorni.</p>}
      <Grid min={340} gap={10}>
        {sorted.map(c => {
          const plan = plans[c.id] || [];
          const prog = planProgress(plan);
          const next = plan.find(s => s.status !== "done" && s.stepId !== "expiry");
          const nextTmpl = next ? stepTemplate(next.stepId) : null;
          const days = daysToExpiry(c.end);
          const uColor = URGENCY_COLORS[urgency(c)];
          const boStep = plan.find(s => s.stepId === "bo_response");
          return (
            <div key={c.id} onClick={() => setSelectedId(c.id)} role="button" tabIndex={0} onKeyDown={e => { if (e.key === "Enter") setSelectedId(c.id); }} style={{ background: C.card, border: `1px solid ${C.border}`, borderLeft: `3px solid ${uColor}`, borderRadius: 10, padding: 14, cursor: "pointer" }}
              onMouseEnter={e => e.currentTarget.style.boxShadow = "0 4px 16px rgba(0,0,0,0.07)"}
              onMouseLeave={e => e.currentTarget.style.boxShadow = "none"}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 4 }}>
                <div style={{ ...sans, fontSize: 13, fontWeight: 700, color: C.navy, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.supplier}</div>
                <div style={{ ...sans, fontSize: 12, fontWeight: 700, color: uColor, flexShrink: 0 }}>{days < 0 ? "Scaduto" : `${days}gg`}</div>
              </div>
              <div style={{ ...sans, fontSize: 12, color: C.muted, marginBottom: 8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.object}</div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: colorFor(c.owner) }} />
                  <span style={{ ...sans, fontSize: 11, color: C.muted }}>{c.owner}</span>
                  {plan.some(s => s.modified) && <span style={{ ...sans, fontSize: 10, color: C.blue, background: C.blueBg, borderRadius: 3, padding: "1px 5px" }}>✏️</span>}
                </div>
                <span style={{ ...sans, fontSize: 11, fontWeight: 600, color: C.navy }}>{prog}%</span>
              </div>
              <div style={{ height: 5, background: C.borderLight, borderRadius: 3, marginBottom: 8 }}><div style={{ height: "100%", width: `${prog}%`, background: uColor, borderRadius: 3 }} /></div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                {nextTmpl && <span style={{ ...sans, fontSize: 11, color: C.subtle }}>{nextTmpl.icon} {nextTmpl.label}</span>}
                {boStep?.boDecision && <span style={{ ...sans, fontSize: 11, fontWeight: 600, color: BO_COLORS[boStep.boDecision]?.color, background: BO_COLORS[boStep.boDecision]?.bg, borderRadius: 4, padding: "2px 6px" }}>BO: {boStep.boDecision}</span>}
              </div>
            </div>
          );
        })}
      </Grid>
    </div>
  );
}
