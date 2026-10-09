import type { ReactNode } from "react";
import type { User, View } from "../types.ts";
import { Bell, Building2, CalendarClock, CalendarRange, ClipboardCheck, FileText, LayoutDashboard, ListChecks, ShieldCheck, SlidersHorizontal, Users } from "../components/icons.tsx";

export type ModuleKey = "contracts" | "vendors" | "tasks" | "admin";
export interface NavPage { key: View; label: string; icon: ReactNode }
export interface ModuleDef { key: ModuleKey; label: string; description: string; icon: (size: number) => ReactNode; pages: NavPage[] }

const page = (key: View, label: string, icon: ReactNode): NavPage => ({ key, label, icon });

/** Moduli e pagine visibili a un utente. In modalità demo (senza server) esiste solo il modulo Contratti. */
export function modulesFor(user: User, apiMode: boolean): ModuleDef[] {
  const staff = user.role === "manager" || user.role === "buyer";
  const mods: ModuleDef[] = [];
  if (staff) {
    mods.push({ key: "contracts", label: "Contratti", description: "Scadenze, piani di rinnovo e decisioni dei Business Owner", icon: s => <FileText size={s} />, pages: [
      page("dashboard", "Panoramica", <LayoutDashboard size={19} />), page("list", "Contratti", <FileText size={19} />), page("planning", "Piano", <CalendarRange size={19} />),
      ...(user.role === "manager" ? [page("team", "Team", <Users size={19} />)] : []), page("notifiche", "Avvisi", <Bell size={19} />),
    ] });
  } else if (user.role === "bo") {
    mods.push({ key: "contracts", label: "Contratti", description: "Le tue richieste e i contratti di cui sei responsabile", icon: s => <FileText size={s} />, pages: [page("bo", "Richieste", <ClipboardCheck size={19} />), page("list", "Contratti", <FileText size={19} />)] });
  }
  if (apiMode && (staff || user.role === "finance")) {
    mods.push({ key: "vendors", label: "Fornitori", description: "Registrazione, qualifica e scadenze dei documenti dei fornitori", icon: s => <Building2 size={s} />, pages: [page("vendors", "Fornitori", <Building2 size={19} />), page("expiries", "Scadenze", <CalendarClock size={19} />)] });
  }
  if (apiMode && staff) {
    mods.push({ key: "tasks", label: "Task", description: "RDA da SAP, attività dei contratti e task manuali del team", icon: s => <ListChecks size={s} />, pages: [page("tasks", "Task", <ListChecks size={19} />)] });
  }
  if (apiMode && user.role === "manager") {
    mods.push({ key: "admin", label: "Amministrazione", description: "Utenti, documenti richiesti, reminder e parametri SAP", icon: s => <ShieldCheck size={s} />, pages: [page("config", "Configurazione", <SlidersHorizontal size={19} />), page("users", "Utenti", <ShieldCheck size={19} />)] });
  }
  return mods;
}

export function moduleOfView(v: View): ModuleKey | "hub" | null {
  switch (v) {
    case "dashboard": case "list": case "planning": case "team": case "notifiche": case "bo": case "detail": return "contracts";
    case "vendors": case "expiries": return "vendors";
    case "tasks": return "tasks";
    case "config": case "users": return "admin";
    case "hub": return "hub";
    default: return null;
  }
}
