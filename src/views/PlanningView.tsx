import { useState } from "react";
import type { AuditLogs, Contract, PlanStep, Plans, StepTemplate, User } from "../types.ts";
import { C, font, radius, sans, URGENCY_COLORS } from "../theme.ts";
import { daysToDeadline, fmtDate, urgency } from "../lib/format.ts";
import { BO_COLORS, planProgress, stepLabel, stepTemplate } from "../lib/plan.ts";
import { canEditContract, canRespondBO } from "../permissions.ts";
import { AuditTrail, Avatar, Card, CardTitle, DaysChip, EmptyState, Grid, StepIcon } from "../components/ui.tsx";
import { StepDateEditor } from "../components/Modals.tsx";
import { ArrowLeft, CalendarRange, Check, ClipboardCheck, Pencil, Send } from "../components/icons.tsx";

interface Props {
  contracts: Contract[]; plans: Plans; auditLogs: AuditLogs; currentUser: User;
  onSendBO: (id: number) => void; onCompleteStep: (id: number, stepId: string) => void;
  onOpenBOForm: (c: Contract) => void; onUpdateStepDate: (id: number, stepId: string, date: string, reason: string) => void;
}

const btn = (bg: string, color = "#fff", border = "none"): React.CSSProperties => ({ ...sans, display: "inline-flex", alignItems: "center", gap: 7, marginTop: 10, padding: "7px 13px", background: bg, border, borderRadius: 9, color, cursor: "pointer", fontSize: 12.5, fontWeight: 650 });

export function PlanningView({ contracts, plans, auditLogs, currentUser, onSendBO, onCompleteStep, onOpenBOForm, onUpdateStepDate }: Props) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [editingStep, setEditingStep] = useState<{ step: PlanStep; tmpl: StepTemplate } | null>(null);

  // I contratti arrivano già filtrati dal server in base al ruolo: qui si tengono solo quelli in scadenza entro 120 giorni.
  const sorted = contracts.filter(c => !c.ceased && daysToDeadline(c) <= 120).sort((a, b) => daysToDeadline(a) - daysToDeadline(b));
  const contract = selectedId !== null ? contracts.find(c => c.id === selectedId) : undefined;

  if (contract) {
    const plan = plans[contract.id] || [];
    const canEdit = canEditContract(currentUser, contract);
    const canProxyBO = canRespondBO(currentUser, contract) && currentUser.role === "manager";
    const prog = planProgress(plan);
    return (
      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "minmax(0,1fr)" }}>
        <button onClick={() => setSelectedId(null)} style={{ ...sans, justifySelf: "start", display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: C.accent, cursor: "pointer", fontSize: 13, fontWeight: 650, padding: 0 }}><ArrowLeft size={16} />Tutti i piani</button>
        <div style={{ background: `linear-gradient(135deg, ${C.navy}, ${C.navySoft})`, borderRadius: radius.lg, padding: 22, color: "#fff", display: "flex", gap: 24, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ ...font, fontSize: 19, fontWeight: 700 }}>{contract.supplier}</div>
            <div style={{ ...sans, fontSize: 13, color: "rgba(255,255,255,.65)", marginTop: 2 }}>{contract.object}</div>
          </div>
          <div style={{ display: "flex", gap: 28, flexWrap: "wrap" }}>
            {[["Scadenza", fmtDate(contract.end)], ...(contract.noticeDate ? [["Disdetta entro", fmtDate(contract.noticeDate)]] : []), ["Buyer", contract.owner || "—"], ["Avanzamento", `${prog}%`]].map(([k, v]) => <div key={k}><div style={{ ...sans, fontSize: 11, color: "rgba(255,255,255,.5)", fontWeight: 600 }}>{k}</div><div className="tabular" style={{ ...sans, fontSize: 15, fontWeight: 650, marginTop: 2 }}>{v}</div></div>)}
          </div>
        </div>

        <Grid min={400}>
          <Card style={{ padding: 20 }}>
            <CardTitle icon={<CalendarRange size={16} />}>Piano di rinnovo</CardTitle>
            {plan.map((step, i) => {
              const tmpl = stepTemplate(step.stepId);
              const isLast = i === plan.length - 1;
              const done = step.status === "done", pending = step.status === "pending_bo";
              const color = done ? C.green : pending ? C.yellow : C.subtle;
              const isEditable = canEdit && step.status === "upcoming" && step.stepId !== "expiry";
              return (
                <div key={step.stepId} style={{ display: "flex", gap: 14, marginBottom: isLast ? 0 : 6 }}>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 36, flexShrink: 0 }}>
                    <div style={{ width: 36, height: 36, borderRadius: 12, background: done ? C.green : pending ? C.yellowBg : "#fff", border: `1.5px solid ${done ? C.green : pending ? "#e8c76b" : C.border}`, display: "flex", alignItems: "center", justifyContent: "center", color: done ? "#fff" : color }}>{done ? <Check size={18} strokeWidth={2.5} /> : <StepIcon id={step.stepId} size={17} />}</div>
                    {!isLast && <div style={{ width: 2, flex: 1, background: done ? "#bfe3cf" : C.borderLight, marginTop: 4, marginBottom: 0, minHeight: 18 }} />}
                  </div>
                  <div style={{ flex: 1, paddingBottom: isLast ? 0 : 16, minWidth: 0 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                      <div style={{ ...sans, fontSize: 14, fontWeight: 650, color: done ? C.green : pending ? C.yellow : C.text }}>{stepLabel(step.stepId, contract)}</div>
                      <button onClick={() => isEditable && setEditingStep({ step, tmpl })} title={isEditable ? "Cambia la data" : undefined} style={{ ...sans, display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: isEditable ? C.accent : C.subtle, background: "none", border: "none", cursor: isEditable ? "pointer" : "default", padding: 0, fontWeight: step.modified ? 700 : 500 }}>
                        {isEditable && <Pencil size={12} />}<span className="tabular">{fmtDate(step.scheduledDate)}</span>
                      </button>
                    </div>
                    {step.modified && <div style={{ ...sans, fontSize: 12, color: C.blue, marginTop: 2 }}>Data spostata: {step.modifiedReason}</div>}
                    {step.stepId === "bo_response" && step.boDecision && (
                      <div style={{ marginTop: 10, padding: "10px 14px", borderRadius: 12, background: BO_COLORS[step.boDecision]?.bg }}>
                        <div style={{ ...sans, fontSize: 11, color: C.muted, marginBottom: 2 }}>Decisione del Business Owner · {step.boRespondedAt}</div>
                        <div style={{ ...sans, fontSize: 13.5, fontWeight: 650, color: BO_COLORS[step.boDecision]?.color }}>{step.boDecision}</div>
                        {step.boNotes && <div style={{ ...sans, fontSize: 12.5, color: C.text, marginTop: 4, fontStyle: "italic" }}>"{step.boNotes}"</div>}
                      </div>
                    )}
                    {step.stepId === "bo_notify" && step.status !== "done" && canEdit && <button onClick={() => onSendBO(contract.id)} style={btn(C.navy)}><Send size={14} />Invia notifica al BO</button>}
                    {step.stepId === "bo_notify" && step.status === "done" && canProxyBO && !plan.find(s => s.stepId === "bo_response")?.boDecision && <button onClick={() => onOpenBOForm(contract)} style={btn(C.blue)}><ClipboardCheck size={14} />Registra risposta del BO (per conto)</button>}
                    {isEditable && step.stepId !== "bo_notify" && step.stepId !== "bo_response" && <button onClick={() => onCompleteStep(contract.id, step.stepId)} style={btn("#fff", C.muted, `1px solid ${C.border}`)}><Check size={14} />Segna come completato</button>}
                    {step.completedBy && <div style={{ ...sans, fontSize: 11.5, color: C.subtle, marginTop: 5 }}>Da {step.completedBy} · {step.completedAt}</div>}
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
    <div style={{ display: "grid", gap: 14, gridTemplateColumns: "minmax(0,1fr)" }}>
      <div>
        <h2 style={{ ...font, margin: 0, fontSize: 18, fontWeight: 700, color: C.text }}>{currentUser.role === "manager" ? "Piano acquisti di tutto il team" : "Il mio piano acquisti"}</h2>
        <div style={{ ...sans, fontSize: 13, color: C.muted, marginTop: 2 }}>{sorted.length} contratti con scadenza entro 120 giorni</div>
      </div>
      {sorted.length === 0 && <EmptyState icon={<CalendarRange size={26} />} title="Niente da pianificare" text="Nessun contratto scade nei prossimi 120 giorni. Quando ce ne saranno, qui vedrai il piano di rinnovo di ognuno." />}
      <Grid min={340} gap={12}>
        {sorted.map(c => {
          const plan = plans[c.id] || [];
          const prog = planProgress(plan);
          const next = plan.find(s => s.status !== "done" && s.stepId !== "expiry");
          const nextTmpl = next ? stepTemplate(next.stepId) : null;
          const days = daysToDeadline(c);
          const u = urgency(c);
          const boStep = plan.find(s => s.stepId === "bo_response");
          return (
            <Card key={c.id} className="lift" onClick={() => setSelectedId(c.id)} role="button" tabIndex={0} onKeyDown={e => { if (e.key === "Enter") setSelectedId(c.id); }} style={{ padding: 16, cursor: "pointer", borderLeft: `4px solid ${URGENCY_COLORS[u]}`, borderRadius: radius.md }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ ...sans, fontSize: 14, fontWeight: 650, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.supplier}</div>
                  <div style={{ ...sans, fontSize: 12.5, color: C.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.object}</div>
                </div>
                <DaysChip days={days} level={u} />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "14px 0 6px" }}>
                <div style={{ flex: 1, height: 6, background: C.borderLight, borderRadius: 3 }}><div style={{ height: "100%", width: `${prog}%`, background: URGENCY_COLORS[u], borderRadius: 3, transition: "width .3s ease" }} /></div>
                <span className="tabular" style={{ ...sans, fontSize: 12, fontWeight: 650, color: C.text }}>{prog}%</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7, ...sans, fontSize: 12, color: C.muted }}><Avatar name={c.owner || "?"} size={22} />{c.owner}{plan.some(s => s.modified) && <Pencil size={12} color={C.blue} aria-label="Date modificate" />}</div>
                {boStep?.boDecision ? <span style={{ ...sans, fontSize: 11.5, fontWeight: 650, color: BO_COLORS[boStep.boDecision]?.color, background: BO_COLORS[boStep.boDecision]?.bg, borderRadius: 999, padding: "3px 10px" }}>BO: {boStep.boDecision}</span>
                  : nextTmpl && <span style={{ ...sans, display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: C.subtle }}><StepIcon id={nextTmpl.id} size={14} />Prossimo: {nextTmpl.label}</span>}
              </div>
            </Card>
          );
        })}
      </Grid>
    </div>
  );
}
