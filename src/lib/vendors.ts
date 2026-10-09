import type { Supplier, SupplierStatus } from "../types.ts";
import { C } from "../theme.ts";

export const STATUS_STYLE: Record<SupplierStatus, { label: string; color: string; bg: string }> = {
  invited: { label: "Invitato", color: C.gray, bg: C.grayBg },
  draft: { label: "In compilazione", color: C.blue, bg: C.blueBg },
  pending: { label: "Da verificare (Buyer)", color: C.yellow, bg: C.yellowBg },
  pending_revision: { label: "Modifiche richieste", color: C.red, bg: C.redBg },
  approved: { label: "In attesa del Finance", color: C.purple, bg: C.purpleBg },
  rejected: { label: "Rifiutato", color: C.red, bg: C.redBg },
  registered: { label: "Registrato in SAP", color: C.green, bg: C.greenBg },
};

export const fmtSize = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export const supplierTimeline = (s: Supplier) => s.events.map(e => ({ ts: new Date(e.at).toLocaleString("it-IT", { dateStyle: "medium", timeStyle: "short" }), user: e.actor, action: e.action, detail: e.detail }));


export const LIFECYCLE_STYLE = {
  blocked: { label: "Bloccato", color: C.red, bg: C.redBg },
  inactive: { label: "Disattivato", color: C.gray, bg: C.grayBg },
  excluded: { label: "Escluso", color: "#fff", bg: C.red },
} as const;
export const CHECK_STYLE = {
  ok: { label: "Superato", color: C.green, bg: C.greenBg },
  warn: { label: "Da valutare", color: C.yellow, bg: C.yellowBg },
  fail: { label: "Non superato", color: C.red, bg: C.redBg },
  todo: { label: "Da eseguire", color: C.blue, bg: C.blueBg },
  na: { label: "Non applicabile", color: C.gray, bg: C.grayBg },
} as const;
