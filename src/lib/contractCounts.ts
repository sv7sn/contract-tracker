import type { Contract, Plans } from "../types.ts";
import { C } from "../theme.ts";
import { fmt, fmtCompact, urgency } from "./format.ts";
import { t } from "../i18n/index.ts";

export type ContractFilter = "Tutti" | "Urgenti" | "In scadenza" | "Regolari" | "In attesa del BO";

/** Numeri in cima alla pagina Contratti. Quelli con un filtro filtrano l'elenco. */
export function contractCounts(contracts: Contract[], plans: Plans): { key: string; filter?: ContractFilter; label: string; value: number | string; color: string; title?: string }[] {
  const mine = contracts.filter(c => !c.ceased);
  if (!mine.length) return [];
  const totalEUR = mine.filter(c => c.currency === "EUR").reduce((a, c) => a + c.value, 0);
  return [
    { key: "red", filter: "Urgenti", label: t("Da gestire"), value: mine.filter(c => urgency(c) === "red").length, color: C.red, title: t("scaduti o entro 30 giorni") },
    { key: "yellow", filter: "In scadenza", label: t("In scadenza"), value: mine.filter(c => urgency(c) === "yellow").length, color: C.yellow, title: t("tra 31 e 90 giorni") },
    { key: "bo", filter: "In attesa del BO", label: t("Attesa BO"), value: mine.filter(c => (plans[c.id] || []).some(s => s.status === "pending_bo")).length, color: C.purple, title: t("decisioni da ricevere") },
    { key: "value", label: t("Valore"), value: fmtCompact(totalEUR), color: C.text, title: `${fmt(totalEUR)} · ${t("{n} contratti attivi", { n: mine.length })}` },
  ];
}
