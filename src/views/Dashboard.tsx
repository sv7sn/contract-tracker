import { useState } from "react";
import type { Contract, Plans, User } from "../types.ts";
import { C, font, radius, sans, shadow } from "../theme.ts";
import { fmt, fmtCompact, urgency } from "../lib/format.ts";
import { getSuggestions } from "../lib/plan.ts";
import { Grid, StatCard } from "../components/ui.tsx";
import { AlertTriangle, BarChart3, CalendarClock, ChevronDown, Hourglass, Lightbulb, Wallet } from "../components/icons.tsx";
import { ExpiryColumns, RenewalStack, ValueBars } from "../components/charts.tsx";
import { t } from "../i18n/index.ts";

export type ContractFilter = "Tutti" | "Urgenti" | "In scadenza" | "Regolari" | "In attesa del BO";
const CHARTS_KEY = "pl-contracts-charts";

/** Numeri in cima alla pagina Contratti: riquadri su PC, una riga di "chip" sul telefono. Quelli con un filtro filtrano l'elenco. */
export function ContractSummary({ contracts, plans, filter, onFilter }: { contracts: Contract[]; plans: Plans; filter: ContractFilter; onFilter: (f: ContractFilter) => void }) {
  const mine = contracts.filter(c => !c.ceased);
  if (!mine.length) return null;
  const totalEUR = mine.filter(c => c.currency === "EUR").reduce((a, c) => a + c.value, 0);
  const pendingBO = mine.filter(c => (plans[c.id] || []).some(s => s.status === "pending_bo")).length;
  const red = mine.filter(c => urgency(c) === "red").length, yellow = mine.filter(c => urgency(c) === "yellow").length;
  const items: { f: ContractFilter | null; label: string; short: string; value: string | number; sub: string; color: string; icon: React.ReactNode; title?: string }[] = [
    { f: "Urgenti", label: t("Da gestire subito"), short: t("Da gestire"), value: red, sub: t("scaduti o entro 30 giorni"), color: C.red, icon: <AlertTriangle size={18} /> },
    { f: "In scadenza", label: t("In scadenza"), short: t("In scadenza"), value: yellow, sub: t("tra 31 e 90 giorni"), color: C.yellow, icon: <CalendarClock size={18} /> },
    { f: "In attesa del BO", label: t("In attesa del BO"), short: t("Attesa BO"), value: pendingBO, sub: t("decisioni da ricevere"), color: C.purple, icon: <Hourglass size={18} /> },
    { f: null, label: t("Valore in euro"), short: t("Valore"), value: fmtCompact(totalEUR), title: fmt(totalEUR), sub: t("{n} contratti attivi", { n: mine.length }), color: C.accent, icon: <Wallet size={18} /> },
  ];
  const toggle = (f: ContractFilter | null) => f && onFilter(filter === f ? "Tutti" : f);
  return (<>
    <div className="desktop-only">
      <Grid min={200} gap={12} fill>
        {items.map(x => x.f
          ? <button key={x.label} onClick={() => toggle(x.f)} aria-pressed={filter === x.f} style={{ all: "unset", cursor: "pointer", display: "block", borderRadius: radius.lg, outline: filter === x.f ? `2px solid ${C.accent}` : undefined, outlineOffset: 1 }}><StatCard label={x.label} value={x.value} color={x.color} icon={x.icon} sub={x.sub} /></button>
          : <div key={x.label}><StatCard label={x.label} value={x.value} title={x.title} color={x.color} icon={x.icon} sub={x.sub} /></div>)}
      </Grid>
    </div>
    <div className="mobile-only chip-row" style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 2 }}>
      {items.map(x => { const on = !!x.f && filter === x.f; return (
        <button key={x.label} onClick={() => toggle(x.f)} disabled={!x.f} aria-pressed={on} title={x.title} className="count-pill"
          style={{ ...sans, display: "inline-flex", alignItems: "center", gap: 8, flexShrink: 0, padding: "7px 14px", borderRadius: 12, border: `1px solid ${on ? x.color : C.border}`, background: on ? `${x.color}14` : "#fff", cursor: x.f ? "pointer" : "default", color: C.text, fontSize: 13, fontWeight: 600 }}>
          <b className="tabular" style={{ ...font, fontSize: 17, color: x.value ? x.color : C.subtle }}>{x.value}</b>{x.short}
        </button>); })}
    </div>
  </>);
}

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
