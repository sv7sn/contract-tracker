import { useSyncExternalStore } from "react";
import type { Lang } from "../types.ts";
import { EN } from "./en/index.ts";

// Traduzione dell'interfaccia. Il testo italiano scritto nel codice è anche la chiave: t("Contratti") restituisce
// "Contracts" in inglese e "Contratti" in italiano. Se manca la traduzione resta l'italiano (il test delle chiavi lo segnala).
// Valori variabili tra graffe: t("{n} in ritardo", { n: 3 }). Non chiamare t() fuori dai componenti (al caricamento del modulo).
const KEY = "pl-lang";
const read = (): Lang => { try { return localStorage.getItem(KEY) === "en" ? "en" : "it"; } catch { return "it"; } };
let lang: Lang = typeof window === "undefined" ? "it" : read();
const listeners = new Set<() => void>();

export const getLang = () => lang;
export function setLang(next: Lang) {
  if (next === lang) return;
  lang = next;
  try { localStorage.setItem(KEY, next); } catch { /* preferenza solo locale */ }
  if (typeof document !== "undefined") document.documentElement.lang = next;
  listeners.forEach(f => f());
}
export function useLang(): Lang { return useSyncExternalStore(f => { listeners.add(f); return () => listeners.delete(f); }, getLang, () => "it"); }

export function fill(s: string, vars?: Record<string, string | number>) {
  return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s;
}
export function t(it: string, vars?: Record<string, string | number>): string {
  return fill(lang === "en" ? EN[it] ?? it : it, vars);
}
/** Come t(), per parole che in inglese cambiano secondo il contesto ("Valuta" moneta / "Valuta" verbo). Chiave nel dizionario: "testo#contesto". */
export function tc(context: string, it: string, vars?: Record<string, string | number>): string {
  return fill(lang === "en" ? EN[`${it}#${context}`] ?? EN[it] ?? it : it, vars);
}
/** Formato di date e numeri della lingua corrente. */
export const locale = () => (lang === "en" ? "en-GB" : "it-IT");
