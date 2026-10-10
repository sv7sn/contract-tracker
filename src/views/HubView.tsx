import { useEffect, useState } from "react";
import type { Contract, PlanStep, TaskSummary, User, View } from "../types.ts";
import { portalApi } from "../api.ts";
import { C, font, radius, sans } from "../theme.ts";
import { daysToDeadline } from "../lib/format.ts";
import type { ModuleDef } from "../lib/modules.tsx";
import { Card, Grid } from "../components/ui.tsx";
import { ArrowRight } from "../components/icons.tsx";
import { WorkList } from "./WorkList.tsx";

interface Props { user: User; modules: ModuleDef[]; contracts: Contract[]; plans: Record<number, PlanStep[]>; onOpen: (view: View, focus?: { taskId?: number; vendorId?: number; contractId?: number }) => void }
interface Metric { label: string; value: number | string; tone?: "bad" | "warn" | "good" }
interface Live { tasks: TaskSummary | null; vendorsToReview: number | null; lapsed: number | null; unresponsive: number | null }

const TONE = { bad: C.red, warn: C.yellow, good: C.green } as const;

/** Pagina iniziale: un riquadro per ogni modulo con i numeri che richiedono attenzione. */
export function HubView({ user, modules, contracts, onOpen }: Props) {
  const [live, setLive] = useState<Live>({ tasks: null, vendorsToReview: null, lapsed: null, unresponsive: null });
  useEffect(() => {
    let off = false;
    const staff = user.role === "manager" || user.role === "buyer";
    Promise.allSettled([
      staff ? portalApi.taskSummary() : Promise.reject(),
      portalApi.vendors(),
      portalApi.monitor(),
    ]).then(([t, v, m]) => {
      if (off) return;
      const mine = user.role === "finance" ? "approved" : "pending";
      setLive({
        tasks: t.status === "fulfilled" ? t.value : null,
        vendorsToReview: v.status === "fulfilled" ? v.value.filter(x => x.status === mine).length : null,
        lapsed: v.status === "fulfilled" ? v.value.filter(x => x.qualification === "lapsed").length : null,
        unresponsive: m.status === "fulfilled" ? new Set(m.value.items.filter(i => i.unresponsive).map(i => i.supplierId)).size : null,
      });
    });
    return () => { off = true; };
  }, [user]);

  const active = contracts.filter(c => !c.ceased);
  const metrics: Record<string, Metric[]> = {
    contracts: user.role === "bo" ? [] : [
      { label: "In scadenza entro 30 giorni", value: active.filter(c => daysToDeadline(c) >= 0 && daysToDeadline(c) <= 30).length, tone: "bad" },
      { label: "In scadenza entro 90 giorni", value: active.filter(c => daysToDeadline(c) > 30 && daysToDeadline(c) <= 90).length, tone: "warn" },
      { label: "Contratti attivi", value: active.length },
    ],
    vendors: [
      ...(live.vendorsToReview !== null ? [{ label: user.role === "finance" ? "Da registrare in SAP" : "Da verificare", value: live.vendorsToReview, tone: live.vendorsToReview ? "warn" as const : undefined }] : []),
      ...(live.lapsed !== null ? [{ label: "Con qualifica scaduta", value: live.lapsed, tone: live.lapsed ? "bad" as const : "good" as const }] : []),
      ...(live.unresponsive !== null ? [{ label: "Fornitori che non rispondono ai reminder", value: live.unresponsive, tone: live.unresponsive ? "bad" as const : "good" as const }] : []),
    ],
    tasks: live.tasks ? [
      { label: "Task aperti", value: live.tasks.open }, { label: "In ritardo", value: live.tasks.overdue, tone: live.tasks.overdue ? "bad" : "good" },
      ...(user.role === "manager" ? [{ label: "Da assegnare", value: live.tasks.unassigned, tone: live.tasks.unassigned ? "warn" as const : undefined }] : []),
      { label: "RDA senza confronto fornitori", value: live.tasks.sourcingMissing, tone: live.tasks.sourcingMissing ? "warn" as const : "good" as const },
      ...(user.role === "manager" && live.tasks.exceptionsPending ? [{ label: "Eccezioni da approvare", value: live.tasks.exceptionsPending, tone: "warn" as const }] : []),
    ] : [],
    kpi: [],
    budget: [],
    admin: [],
  };
  const hour = new Date().getHours();
  const first = user.name.split(" ")[0];

  return (
    <div>
      <div style={{ marginBottom: 18 }}>
        <div style={{ ...font, fontSize: 24, fontWeight: 700, color: C.text }}>{hour < 13 ? "Buongiorno" : hour < 18 ? "Buon pomeriggio" : "Buonasera"}, {first}</div>
        <div style={{ ...sans, fontSize: 13.5, color: C.muted, marginTop: 2 }}>{user.role === "manager" || user.role === "buyer" ? "Ecco cosa richiede la tua attenzione. Sotto trovi i moduli." : "Scegli un modulo per iniziare."}</div>
      </div>
      {(user.role === "manager" || user.role === "buyer") && <WorkList onOpen={onOpen} />}
      <Grid min={300} gap={14} fill>
        {modules.map(m => (
          <Card key={m.key} className="lift" onClick={() => onOpen(m.pages[0].key)} role="button" tabIndex={0} onKeyDown={e => { if (e.key === "Enter") onOpen(m.pages[0].key); }} style={{ cursor: "pointer", padding: 20, borderRadius: radius.lg, display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ width: 44, height: 44, borderRadius: 13, background: C.accentLight, color: C.accent, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{m.icon(22)}</span>
              <div style={{ minWidth: 0 }}><div style={{ ...font, fontSize: 17, fontWeight: 700, color: C.text }}>{m.label}</div><div style={{ ...sans, fontSize: 12.5, color: C.muted, lineHeight: 1.45 }}>{m.description}</div></div>
            </div>
            <div style={{ display: "grid", gap: 6, flex: 1 }}>
              {(metrics[m.key] ?? []).map(x => (
                <div key={x.label} style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                  <span className="tabular" style={{ ...font, fontSize: 22, fontWeight: 700, minWidth: 34, color: x.tone ? TONE[x.tone] : C.text }}>{x.value}</span>
                  <span style={{ ...sans, fontSize: 13, color: C.muted }}>{x.label}</span>
                </div>
              ))}
            </div>
            <div style={{ ...sans, display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 650, color: C.accent }}>Apri<ArrowRight size={15} /></div>
          </Card>
        ))}
      </Grid>
    </div>
  );
}
