import { useState } from "react";
import type { Contract, Plans, User } from "../types.ts";
import { C, radius, sans, shadow } from "../theme.ts";
import { fmt, fmtCompact, urgency } from "../lib/format.ts";
import { getSuggestions } from "../lib/plan.ts";
import { Grid, StatCard } from "../components/ui.tsx";
import { AlertTriangle, CalendarClock, ChevronDown, FileText, Hourglass, Lightbulb, Wallet } from "../components/icons.tsx";
import { ExpiryColumns, RenewalStack, ValueBars } from "../components/charts.tsx";
import { t } from "../i18n/index.ts";

export type ContractFilter = "Tutti" | "Urgenti" | "In scadenza" | "Regolari" | "In attesa del BO";
const CHARTS_KEY = "pl-contracts-charts";

/** Riepilogo in cima alla pagina Contratti: riquadri che filtrano l'elenco e, a richiesta, i grafici di scadenze, rinnovi e valore. */
export function ContractSummary({ contracts, plans, currentUser, filter, onFilter, onOpenKpi }: {
  contracts: Contract[]; plans: Plans; currentUser: User; filter: ContractFilter; onFilter: (f: ContractFilter) => void; onOpenKpi?: () => void;
}) {
  const [charts, setCharts] = useState(() => { try { return localStorage.getItem(CHARTS_KEY) === "1"; } catch { return false; } });
  const toggleCharts = () => setCharts(o => { try { localStorage.setItem(CHARTS_KEY, o ? "0" : "1"); } catch { /* preferenza solo locale */ } return !o; });
  const mine = contracts.filter(c => !c.ceased);
  const totalEUR = mine.filter(c => c.currency === "EUR").reduce((a, c) => a + c.value, 0);
  const isManager = currentUser.role === "manager";
  const pendingBO = mine.filter(c => (plans[c.id] || []).some(s => s.status === "pending_bo")).length;
  const suggestions = isManager ? getSuggestions(contracts, plans) : [];
  const red = mine.filter(c => urgency(c) === "red").length, yellow = mine.filter(c => urgency(c) === "yellow").length;
  if (!mine.length) return null;
  const tile = (f: ContractFilter | null, card: React.ReactNode) => f
    ? <button onClick={() => onFilter(filter === f ? "Tutti" : f)} aria-pressed={filter === f} style={{ all: "unset", cursor: "pointer", display: "block", borderRadius: radius.lg, outline: filter === f ? `2px solid ${C.accent}` : undefined, outlineOffset: 1 }}>{card}</button>
    : <div>{card}</div>;

  return (
    <div style={{ display: "grid", gap: 12, gridTemplateColumns: "minmax(0,1fr)" }}>
      <Grid min={200} gap={12} fill>
        {tile("Urgenti", <StatCard label={t("Da gestire subito")} value={red} color={C.red} icon={<AlertTriangle size={18} />} sub={t("scaduti o entro 30 giorni")} />)}
        {tile("In scadenza", <StatCard label={t("In scadenza")} value={yellow} color={C.yellow} icon={<CalendarClock size={18} />} sub={t("tra 31 e 90 giorni")} />)}
        {tile("In attesa del BO", <StatCard label={t("In attesa del BO")} value={pendingBO} color={C.purple} icon={<Hourglass size={18} />} sub={t("decisioni da ricevere")} />)}
        {tile(null, <StatCard label={t("Valore in euro")} value={fmtCompact(totalEUR)} title={fmt(totalEUR)} color={C.accent} icon={<Wallet size={18} />} sub={t("{n} contratti attivi", { n: mine.length })} />)}
      </Grid>
      {suggestions.length > 0 && onOpenKpi && (
        <div style={{ display: "flex", alignItems: "center", gap: 14, background: C.yellowBg, border: "1px solid #f3dca0", borderRadius: radius.lg, padding: "12px 16px", boxShadow: shadow.sm, flexWrap: "wrap" }}>
          <span aria-hidden style={{ color: C.yellow, display: "flex" }}><Lightbulb size={20} /></span>
          <div style={{ flex: 1, minWidth: 220, ...sans, fontSize: 13 }}><b>{suggestions.length === 1 ? t("1 suggerimento per bilanciare il carico") : t("{n} suggerimenti per bilanciare il carico", { n: suggestions.length })}</b> · {t("Alcuni buyer hanno troppe attività nello stesso mese.")}</div>
          <button onClick={onOpenKpi} style={{ ...sans, padding: "7px 13px", background: C.navy, border: "none", borderRadius: 9, color: "#fff", fontWeight: 650, fontSize: 12.5, cursor: "pointer" }}>{t("Vedi il carico del team")}</button>
        </div>
      )}
      <button onClick={toggleCharts} aria-expanded={charts} style={{ ...sans, alignSelf: "start", justifySelf: "start", display: "inline-flex", alignItems: "center", gap: 6, background: "none", border: "none", color: C.muted, fontSize: 12.5, fontWeight: 600, cursor: "pointer", padding: "2px 0" }}>
        <FileText size={14} />{charts ? t("Nascondi i grafici") : t("Mostra i grafici: scadenze, rinnovi, valore")}<ChevronDown size={14} style={{ transform: charts ? "rotate(180deg)" : undefined }} />
      </button>
      {charts && (<>
        <Grid min={420} gap={14} style={{ alignItems: "stretch" }}><ExpiryColumns contracts={contracts} /><RenewalStack contracts={contracts} /></Grid>
        <ValueBars contracts={contracts} />
      </>)}
    </div>
  );
}
