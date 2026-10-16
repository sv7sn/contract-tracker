import type { ReactNode } from "react";
import type { User, View } from "../types.ts";
import { BarChart3, Bell, Inbox, PiggyBank, Wallet, Building2, CalendarClock, CalendarRange, ClipboardCheck, FileText, Scale, BookOpen, LayoutDashboard, ListChecks, ShieldCheck, SlidersHorizontal, Users } from "../components/icons.tsx";
import { t } from "../i18n/index.ts";

export type ModuleKey = "reviews" | "contracts" | "vendors" | "tasks" | "budget" | "spend" | "kpi" | "admin";
export interface NavPage { key: View; label: string; icon: ReactNode }
export interface ModuleDef { key: ModuleKey; label: string; description: string; icon: (size: number) => ReactNode; pages: NavPage[] }

const page = (key: View, label: string, icon: ReactNode): NavPage => ({ key, label, icon });

/** Moduli e pagine visibili a un utente. In modalità demo (senza server) esiste solo il modulo Contratti. */
export function modulesFor(user: User, apiMode: boolean): ModuleDef[] {
  const staff = user.role === "manager" || user.role === "buyer";
  /** Controlling / CFO: consultano contratti, Master Plan, spesa e indicatori. */
  const viewer = user.role === "viewer";
  const mods: ModuleDef[] = [];
  if (staff || viewer) {
    mods.push({ key: "contracts", label: t("Contratti"), description: t("Scadenze, piani di rinnovo e decisioni dei Business Owner"), icon: s => <FileText size={s} />, pages: [
      page("dashboard", t("Panoramica"), <LayoutDashboard size={19} />), page("list", t("Contratti"), <FileText size={19} />), page("planning", t("Piano"), <CalendarRange size={19} />),
      ...(user.role === "manager" ? [page("team", t("Team"), <Users size={19} />)] : []), ...(viewer ? [] : [page("notifiche", t("Avvisi"), <Bell size={19} />)]), ...(apiMode && !viewer ? [page("clauses", t("Clausole"), <BookOpen size={19} />)] : []),
    ] });
  } else if (user.role === "bo") {
    mods.push({ key: "contracts", label: t("Contratti"), description: t("Le tue richieste e i contratti di cui sei responsabile"), icon: s => <FileText size={s} />, pages: [page("bo", t("Richieste"), <ClipboardCheck size={19} />), page("requests", t("Le mie RDA"), <Inbox size={19} />), page("list", t("Contratti"), <FileText size={19} />)] });
  }
  if (apiMode && (user.role === "legal" || user.role === "compliance" || user.role === "itsec" || user.role === "bo")) {
    mods.push({ key: "reviews", label: t("Revisioni"), description: t("Bozze di contratto da rivedere: commenta il testo e dai il tuo parere"), icon: s => <Scale size={s} />, pages: [page("reviews", t("Revisioni"), <Scale size={19} />), ...(user.role !== "bo" ? [page("clauses", t("Clausole"), <BookOpen size={19} />)] : [])] });
  }
  if (apiMode && (staff || user.role === "finance")) {
    mods.push({ key: "vendors", label: t("Fornitori"), description: t("Registrazione, qualifica e scadenze dei documenti dei fornitori"), icon: s => <Building2 size={s} />, pages: [page("vendors", t("Fornitori"), <Building2 size={19} />), page("expiries", t("Scadenze"), <CalendarClock size={19} />)] });
  }
  if (apiMode && staff) {
    mods.push({ key: "tasks", label: t("Task"), description: t("RDA da SAP, attività dei contratti e task manuali del team"), icon: s => <ListChecks size={s} />, pages: [page("tasks", t("Task"), <ListChecks size={19} />)] });
  }
  if (apiMode && (staff || viewer || user.role === "finance")) {
    mods.push({ key: "budget", label: t("Budget"), description: t("Master Plan per internal order: budget, impegnato, in previsione e impegni futuri dei contratti"), icon: s => <PiggyBank size={s} />, pages: [page("budget", t("Master Plan"), <PiggyBank size={19} />)] });
  }
  if (apiMode && (staff || viewer || user.role === "finance")) {
    mods.push({ key: "spend", label: t("Spesa"), description: t("Spesa reale dai file ordini SAP: fornitori, categorie, funzioni, copertura contrattuale e ordini senza RDA"), icon: s => <Wallet size={s} />, pages: [page("spend", t("Spesa"), <Wallet size={19} />)] });
  }
  if (apiMode && (user.role === "manager" || viewer)) {
    mods.push({ key: "kpi", label: t("Indicatori"), description: t("Tempi e rispetto delle regole: RDA, scelta del fornitore, onboarding, qualifica e contratti"), icon: s => <BarChart3 size={s} />, pages: [page("kpi", t("Indicatori"), <BarChart3 size={19} />)] });
  }
  if (apiMode && user.role === "manager") {
    mods.push({ key: "admin", label: t("Amministrazione"), description: t("Utenti, documenti richiesti, reminder e parametri SAP"), icon: s => <ShieldCheck size={s} />, pages: [page("config", t("Configurazione"), <SlidersHorizontal size={19} />), page("users", t("Utenti"), <ShieldCheck size={19} />)] });
  }
  // Ordine nel menu e nella Home: Task, Contratti, Fornitori, Indicatori. Amministrazione si apre dal menu del profilo.
  const order: ModuleKey[] = ["reviews", "tasks", "contracts", "vendors", "budget", "spend", "kpi", "admin"];
  return mods.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
}

export function moduleOfView(v: View, role?: string): ModuleKey | "hub" | null {
  switch (v) {
    case "dashboard": case "list": case "planning": case "team": case "notifiche": case "bo": case "requests": case "detail": return "contracts";
    case "vendors": case "expiries": return "vendors";
    case "tasks": return "tasks";
    case "reviews": return "reviews";
    case "clauses": return role === "legal" || role === "compliance" || role === "itsec" ? "reviews" : "contracts";
    case "kpi": return "kpi";
    case "budget": return "budget";
    case "spend": return "spend";
    case "config": case "users": return "admin";
    case "hub": return "hub";
    default: return null;
  }
}
