import type { ReactNode } from "react";
import type { User, View } from "../types.ts";
import { Inbox, PiggyBank, Wallet, Building2, ClipboardCheck, FileText, Scale, BookOpen, ListChecks } from "../components/icons.tsx";
import { t } from "../i18n/index.ts";

/** Una voce della navigazione: una pagina sola, uguale nella barra laterale (PC) e nella barra in basso (telefono). */
export interface NavTab {
  key: View;
  label: string;
  icon: (size: number) => ReactNode;
}

/**
 * Voci per ruolo. Al massimo cinque, così sul telefono stanno tutte nella barra fissa in basso.
 * Indicatori e Amministrazione (solo Manager) si aprono dal menu del profilo. In modalità demo (senza server) c'è solo Contratti.
 */
export function navTabsFor(user: User, apiMode: boolean): NavTab[] {
  const tab = (key: View, label: string, icon: NavTab["icon"]): NavTab => ({ key, label, icon });
  const contracts = tab("list", t("Contratti"), s => <FileText size={s} />);
  if (!apiMode) return [contracts];
  const tasks = tab("tasks", t("Task"), s => <ListChecks size={s} />);
  const vendors = tab("vendors", t("Fornitori"), s => <Building2 size={s} />);
  const budget = tab("budget", t("Budget"), s => <PiggyBank size={s} />);
  const spend = tab("spend", t("Spesa"), s => <Wallet size={s} />);
  switch (user.role) {
    case "manager":
    case "buyer":
      return [tasks, contracts, vendors, budget, spend];
    case "finance":
      return [vendors, budget, spend];
    case "viewer":
      return [contracts, budget, spend];
    case "bo":
      return [
        tab("bo", t("Richieste"), s => <ClipboardCheck size={s} />),
        tab("requests", t("Le mie RDA"), s => <Inbox size={s} />),
        contracts,
        tab("reviews", t("Revisioni"), s => <Scale size={s} />),
      ];
    case "legal":
    case "compliance":
    case "itsec":
      return [tab("reviews", t("Revisioni"), s => <Scale size={s} />), tab("clauses", t("Clausole"), s => <BookOpen size={s} />)];
    default:
      return [];
  }
}

/** Voce della navigazione da evidenziare per una pagina (le pagine "interne" ricadono sulla voce da cui si aprono). */
export function tabOfView(v: View, role: string): View | null {
  switch (v) {
    case "detail":
      return "list";
    case "clauses":
      return role === "legal" || role === "compliance" || role === "itsec" ? "clauses" : "list";
    case "expiries":
      return "vendors";
    case "kpi":
    case "config":
    case "users":
      return null;
    default:
      return v;
  }
}
