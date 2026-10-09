import type { Contract, Urgency } from "../types.ts";

export const NOW = new Date();

export function daysToExpiry(end: string) { return Math.ceil((new Date(end).getTime() - NOW.getTime()) / 864e5); }
/** Data che conta per agire: la data limite di disdetta se c'è preavviso, altrimenti la scadenza. */
export function keyDate(c: Pick<Contract, "end" | "noticeDate">) { return c.noticeDate || c.end; }
export function daysToDeadline(c: Pick<Contract, "end" | "noticeDate">) { return daysToExpiry(keyDate(c)); }
export function deadlineLabel(c: Pick<Contract, "noticeDate">) { return c.noticeDate ? "Disdetta entro" : "Scadenza"; }
export function urgency(c: Contract): Urgency { if (c.ceased) return "gray"; const d = daysToDeadline(c); return d <= 30 ? "red" : d <= 90 ? "yellow" : "green"; }
export function fmt(n: number, cur = "EUR") { try { return new Intl.NumberFormat("it-IT", { style: "currency", currency: cur, maximumFractionDigits: 0 }).format(n); } catch { return `${n} ${cur}`; } }
/** Importi grandi in forma breve (8,23 Mio €), sotto il milione per esteso. */
export function fmtCompact(n: number, cur = "EUR") {
  if (Math.abs(n) < 1e6) return fmt(n, cur);
  try { return new Intl.NumberFormat("it-IT", { style: "currency", currency: cur, notation: "compact", maximumFractionDigits: 2 }).format(n); } catch { return `${n} ${cur}`; }
}
export function fmtDate(d: string | Date) { return new Date(d).toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" }); }
export function fmtMonth(d: string | Date) { return new Date(d).toLocaleDateString("it-IT", { month: "short", year: "2-digit" }); }
export function addDays(date: string | Date, days: number) { const d = new Date(date); d.setDate(d.getDate() + days); return d; }
export function isoDate(d: Date) { return d.toISOString().slice(0, 10); }
export function tsNow() { return new Date().toLocaleString("it-IT"); }
export function monthKey(d: Date) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; }
