import type { CSSProperties } from "react";
import type { Role, Urgency } from "./types.ts";

export const C = {
  bg: "#f4f5f8", surface: "#ffffff", card: "#ffffff",
  border: "#e4e7ee", borderLight: "#eef0f5",
  accent: "#c8522a", accentLight: "#fbece6",
  navy: "#16213b", navySoft: "#223056", text: "#141a2b", muted: "#5b6275", subtle: "#8b91a3",
  green: "#1f8a5b", greenBg: "#e6f5ed",
  yellow: "#a46a06", yellowBg: "#fff5dd",
  red: "#cf3b3b", redBg: "#fdebeb",
  blue: "#2467c9", blueBg: "#e8f0fc",
  gray: "#4b5563", grayBg: "#eef0f5",
  purple: "#6247d0", purpleBg: "#eeeafc",
};

// Soglie e colori dei grafici: palette categorica validata (blu, arancio, acqua, viola) + grigio neutro per "non definito".
export const CHART = { blue: "#2a78d6", orange: "#eb6834", aqua: "#1baf7a", violet: "#4a3aa7", neutral: "#c3c6d0", grid: "#e4e7ee", axis: "#c3c6d0", label: "#8b91a3" };

export const URGENCY_COLORS: Record<Urgency, string> = { green: C.green, yellow: C.yellow, red: C.red, gray: "#9ca3af" };

export const FONT_STACK = "'Inter Variable', Inter, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
// Un solo carattere in tutta l'app: i titoli si distinguono per peso e spaziatura, non per la famiglia.
export const font: CSSProperties = { fontFamily: FONT_STACK, letterSpacing: "-0.015em" };
export const sans: CSSProperties = { fontFamily: FONT_STACK };
export const iStyle: CSSProperties = { fontFamily: FONT_STACK, width: "100%", boxSizing: "border-box", background: "#fff", border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 12px", fontSize: 14, color: C.text, outline: "none" };

export const radius = { sm: 8, md: 12, lg: 16 } as const;
export const shadow = { sm: "0 1px 2px rgba(16,24,43,.05), 0 1px 1px rgba(16,24,43,.03)", md: "0 6px 20px rgba(16,24,43,.08)", lg: "0 18px 50px rgba(16,24,43,.18)" } as const;

export const ROLE_LABELS: Record<Role, string> = { manager: "Manager", buyer: "Buyer", bo: "Business Owner" };
export const ROLE_COLORS: Record<Role, string> = { manager: C.accent, buyer: C.blue, bo: C.green };

const AVATAR_COLORS = ["#c8522a", "#2467c9", "#1f8a5b", "#6247d0", "#a46a06", "#0f766e", "#b0285f", "#4b5563"];
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

export const btnPrimary: CSSProperties = { ...sans, padding: 11, background: C.accent, border: "none", borderRadius: 10, color: "#fff", fontWeight: 650, cursor: "pointer", boxShadow: "0 1px 2px rgba(200,82,42,.35)" };
export const btnGhost: CSSProperties = { ...sans, padding: 11, background: "#fff", border: `1px solid ${C.border}`, borderRadius: 10, color: C.muted, cursor: "pointer", fontWeight: 550 };
