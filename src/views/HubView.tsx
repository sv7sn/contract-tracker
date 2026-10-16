import { useEffect, useState } from "react";
import type { Contract, PlanStep, TaskSummary, User, View } from "../types.ts";
import { portalApi } from "../api.ts";
import { C, font, radius, sans } from "../theme.ts";
import { daysToDeadline } from "../lib/format.ts";
import type { ModuleDef } from "../lib/modules.tsx";
import { Card } from "../components/ui.tsx";
import { locale, t } from "../i18n/index.ts";

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
    const vendorStaff = staff || user.role === "finance";
    Promise.allSettled([
      staff ? portalApi.taskSummary() : Promise.reject(),
      vendorStaff ? portalApi.vendors() : Promise.reject(),
      vendorStaff ? portalApi.monitor() : Promise.reject(),
    ]).then(([tk, v, m]) => {
      if (off) return;
      const mine = user.role === "finance" ? "approved" : "pending";
      setLive({
        tasks: tk.status === "fulfilled" ? tk.value : null,
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
      { label: t("In scadenza entro 30 giorni"), value: active.filter(c => daysToDeadline(c) >= 0 && daysToDeadline(c) <= 30).length, tone: "bad" },
      { label: t("In scadenza tra 31 e 90 giorni"), value: active.filter(c => daysToDeadline(c) > 30 && daysToDeadline(c) <= 90).length, tone: "warn" },
      { label: t("Contratti attivi"), value: active.length },
    ],
    vendors: [
      ...(live.vendorsToReview !== null ? [{ label: user.role === "finance" ? t("Da registrare in SAP") : t("Da verificare"), value: live.vendorsToReview, tone: live.vendorsToReview ? "warn" as const : undefined }] : []),
      ...(live.lapsed !== null ? [{ label: t("Con qualifica scaduta"), value: live.lapsed, tone: live.lapsed ? "bad" as const : "good" as const }] : []),
      ...(live.unresponsive !== null ? [{ label: t("Fornitori che non rispondono ai reminder"), value: live.unresponsive, tone: live.unresponsive ? "bad" as const : "good" as const }] : []),
    ],
    tasks: live.tasks ? [
      { label: t("Task aperti"), value: live.tasks.open }, { label: t("In ritardo"), value: live.tasks.overdue, tone: live.tasks.overdue ? "bad" : "good" },
      ...(user.role === "manager" ? [{ label: t("Da assegnare"), value: live.tasks.unassigned, tone: live.tasks.unassigned ? "warn" as const : undefined }] : []),
      { label: t("Pratiche senza confronto fornitori"), value: live.tasks.sourcingMissing, tone: live.tasks.sourcingMissing ? "warn" as const : "good" as const },
      ...(user.role === "manager" && live.tasks.exceptionsPending ? [{ label: t("Eccezioni da approvare"), value: live.tasks.exceptionsPending, tone: "warn" as const }] : []),
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
        <div style={{ ...font, fontSize: 24, fontWeight: 700, color: C.text }}>{hour < 13 ? t("Buongiorno, {name}", { name: first }) : hour < 18 ? t("Buon pomeriggio, {name}", { name: first }) : t("Buonasera, {name}", { name: first })}</div>
        <div style={{ ...sans, fontSize: 13.5, color: C.muted, marginTop: 2 }}>{t("Scegli un modulo per iniziare.")}</div>
      </div>
      {user.acting && user.acting.covering.length > 0 && <Card style={{ marginBottom: 14, background: C.blueBg, borderColor: "#c9dcf5", ...sans, fontSize: 13.5, color: C.blue }}>{t("Stai sostituendo {names}: vedi e gestisci anche le sue pratiche.", { names: user.acting.covering.map(c => t("{name} (fino al {date})", { name: c.name, date: new Date(c.until).toLocaleDateString(locale()) })).join(", ") })}</Card>}
      <div className="hub-tiles" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(168px, 1fr))", gap: 10, marginBottom: 18 }}>
        {modules.map(m => {
          const ms = metrics[m.key] ?? [];
          const alert = ms.find(x => x.tone === "bad" || x.tone === "warn" ) ?? ms[0];
          return (
            <button key={m.key} onClick={() => onOpen(m.pages[0].key)} title={m.description} className="lift"
              style={{ ...sans, display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", background: "#fff", border: `1px solid ${C.border}`, borderRadius: radius.lg, cursor: "pointer", textAlign: "left", minHeight: 58, minWidth: 0 }}>
              <span style={{ width: 36, height: 36, borderRadius: 11, background: C.accentLight, color: C.accent, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{m.icon(19)}</span>
              <span style={{ minWidth: 0, flex: 1 }}>
                <span style={{ ...font, display: "block", fontSize: 15, fontWeight: 700, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.label}</span>
                {alert && <span style={{ display: "block", fontSize: 12, color: alert.tone ? TONE[alert.tone] : C.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}><b className="tabular">{alert.value}</b> {alert.label.toLowerCase()}</span>}
              </span>
            </button>);
        })}
      </div>
    </div>
  );
}
