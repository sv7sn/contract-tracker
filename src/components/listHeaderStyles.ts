import type { CSSProperties } from "react";
import { C, iStyle, sans } from "../theme.ts";

/** Stili comuni dei comandi dentro i filtri: menu a tendina e pulsanti secondari. */
export const filterSelect: CSSProperties = { ...iStyle, width: "auto", flex: "0 1 auto", minWidth: 0, maxWidth: 180 };
export const filterButton: CSSProperties = {
  ...sans,
  display: "inline-flex",
  alignItems: "center",
  gap: 7,
  padding: "9px 14px",
  background: "#fff",
  border: `1px solid ${C.border}`,
  borderRadius: 10,
  color: C.text,
  fontWeight: 600,
  fontSize: 13,
  cursor: "pointer",
  whiteSpace: "nowrap",
};
