import type { CSSProperties } from "react";
import type { Role, Urgency } from "./types.ts";

export const C = {
  bg: "#f8f7f4", surface: "#ffffff", card: "#ffffff",
  border: "#e8e4dc", borderLight: "#f0ece4",
  accent: "#c8522a", accentLight: "#f5e8e3",
  navy: "#1a2640", text: "#1a1a1a", muted: "#6b6560", subtle: "#9e9890",
  green: "#2d7d4f", greenBg: "#e8f5ee",
  yellow: "#b07d10", yellowBg: "#fef8e7",
  red: "#c8522a", redBg: "#fdf0ec",
  blue: "#1a5c9e", blueBg: "#e8f0fa",
  gray: "#4b5563", grayBg: "#f0ece4",
  purple: "#6d28d9", purpleBg: "#ede9fe",
};
export const URGENCY_COLORS: Record<Urgency, string> = { green: C.green, yellow: C.yellow, red: C.red, gray: "#9ca3af" };
export const font: CSSProperties = { fontFamily: "'Georgia','Times New Roman',serif" };
export const sans: CSSProperties = { fontFamily: "'Helvetica Neue','Arial',sans-serif" };
export const iStyle: CSSProperties = { fontFamily: "'Helvetica Neue','Arial',sans-serif", width: "100%", boxSizing: "border-box", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: "9px 12px", fontSize: 14, color: C.text, outline: "none" };

export const ROLE_LABELS: Record<Role, string> = { manager: "Manager", buyer: "Buyer", bo: "Business Owner" };
export const ROLE_COLORS: Record<Role, string> = { manager: C.accent, buyer: C.blue, bo: C.green };

const AVATAR_COLORS = ["#c8522a", "#1a5c9e", "#2d7d4f", "#6d28d9", "#b07d10", "#0f766e", "#9d174d", "#4b5563"];
/** Colore stabile derivato dal nome (gli utenti non hanno un colore salvato). */
export function colorFor(name: string) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

export const btnPrimary: CSSProperties = { ...sans, padding: 11, background: C.accent, border: "none", borderRadius: 8, color: "#fff", fontWeight: 700, cursor: "pointer" };
export const btnGhost: CSSProperties = { ...sans, padding: 11, background: "transparent", border: `1px solid ${C.border}`, borderRadius: 8, color: C.muted, cursor: "pointer" };
