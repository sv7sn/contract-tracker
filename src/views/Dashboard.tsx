import { useState } from "react";
import type { Contract, Plans, User } from "../types.ts";
import { C, radius, sans, shadow } from "../theme.ts";
import { getSuggestions } from "../lib/plan.ts";
import { Grid } from "../components/ui.tsx";
import { BarChart3, ChevronDown, Lightbulb } from "../components/icons.tsx";
import { ExpiryColumns, RenewalStack, ValueBars } from "../components/charts.tsx";
import { t } from "../i18n/index.ts";

const CHARTS_KEY = "pl-contracts-charts";

/** In fondo alla pagina Contratti: suggerimenti sul carico (Manager) e grafici di scadenze, rinnovi e valore, aperti a richiesta. */
export function ContractCharts({ contracts, plans, currentUser, onOpenKpi }: { contracts: Contract[]; plans: Plans; currentUser: User; onOpenKpi?: () => void }) {
  const [open, setOpen] = useState(() => { try { return localStorage.getItem(CHARTS_KEY) === "1"; } catch { return false; } });
  const toggle = () => setOpen(o => { try { localStorage.setItem(CHARTS_KEY, o ? "0" : "1"); } catch { /* preferenza solo locale */ } return !o; });
  if (!contracts.some(c => !c.ceased)) return null;
  const suggestions = currentUser.role === "manager" ? getSuggestions(contracts, plans) : [];
  return (
    <div style={{ display: "grid", gap: 12, gridTemplateColumns: "minmax(0,1fr)", marginTop: 8 }}>
      {suggestions.length > 0 && onOpenKpi && (
        <div style={{ display: "flex", alignItems: "center", gap: 14, background: C.yellowBg, border: "1px solid #f3dca0", borderRadius: radius.lg, padding: "12px 16px", boxShadow: shadow.sm, flexWrap: "wrap" }}>
          <span aria-hidden style={{ color: C.yellow, display: "flex" }}><Lightbulb size={20} /></span>
          <div style={{ flex: 1, minWidth: 220, ...sans, fontSize: 13 }}><b>{suggestions.length === 1 ? t("1 suggerimento per bilanciare il carico") : t("{n} suggerimenti per bilanciare il carico", { n: suggestions.length })}</b> · {t("Alcuni buyer hanno troppe attività nello stesso mese.")}</div>
          <button onClick={onOpenKpi} style={{ ...sans, padding: "7px 13px", background: C.navy, border: "none", borderRadius: 9, color: "#fff", fontWeight: 650, fontSize: 12.5, cursor: "pointer" }}>{t("Vedi il carico del team")}</button>
        </div>
      )}
      <button onClick={toggle} aria-expanded={open} style={{ ...sans, justifySelf: "start", display: "inline-flex", alignItems: "center", gap: 6, background: "none", border: "none", color: C.muted, fontSize: 12.5, fontWeight: 600, cursor: "pointer", padding: "2px 0" }}>
        <BarChart3 size={14} />{open ? t("Nascondi i grafici") : t("Mostra i grafici: scadenze, rinnovi, valore")}<ChevronDown size={14} style={{ transform: open ? "rotate(180deg)" : undefined }} />
      </button>
      {open && (<>
        <Grid min={420} gap={14} style={{ alignItems: "stretch" }}><ExpiryColumns contracts={contracts} /><RenewalStack contracts={contracts} /></Grid>
        <ValueBars contracts={contracts} />
      </>)}
    </div>
  );
}
