import type { CSSProperties, ReactNode } from "react";
import type { Role, Urgency } from "../types.ts";
import { C, colorFor, font, initials, ROLE_COLORS, ROLE_LABELS, sans, URGENCY_COLORS } from "../theme.ts";

export function UrgencyDot({ level, size = 8 }: { level: Urgency; size?: number }) {
  return <span style={{ display: "inline-block", width: size, height: size, borderRadius: "50%", background: URGENCY_COLORS[level], flexShrink: 0 }} />;
}

const RENEWAL_COLORS: Record<string, { bg: string; color: string }> = {
  "In negoziazione": { bg: C.blueBg, color: C.blue }, "Rinnovo automatico": { bg: C.greenBg, color: C.green },
  "Da rescindere": { bg: C.redBg, color: C.red }, "Da rilanciare a gara": { bg: C.yellowBg, color: C.yellow }, "Non definito": { bg: "#f0ece4", color: C.muted },
};
export function RenewalBadge({ status }: { status: string }) {
  const s = RENEWAL_COLORS[status] || RENEWAL_COLORS["Non definito"];
  return <span style={{ ...sans, background: s.bg, color: s.color, borderRadius: 4, padding: "2px 8px", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap" }}>{status || "Non definito"}</span>;
}

export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  return <div aria-hidden style={{ width: size, height: size, borderRadius: "50%", background: colorFor(name), color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.35, fontWeight: 700, flexShrink: 0, ...sans }}>{initials(name)}</div>;
}

export function RoleBadge({ role }: { role: Role }) {
  return <span style={{ ...sans, background: `${ROLE_COLORS[role]}20`, color: ROLE_COLORS[role], borderRadius: 4, padding: "2px 8px", fontSize: 11, fontWeight: 700 }}>{ROLE_LABELS[role]}</span>;
}

export function StatCard({ label, value, sub, color = C.accent }: { label: string; value: ReactNode; sub?: string; color?: string }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "16px 18px" }}>
      <div style={{ ...sans, fontSize: 10, color: C.subtle, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>{label}</div>
      <div style={{ ...font, fontSize: 22, fontWeight: 700, color, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ ...sans, fontSize: 11, color: C.muted, marginTop: 5 }}>{sub}</div>}
    </div>
  );
}

/** Griglia che passa da 1 colonna (telefono) a più colonne (desktop) senza media query. */
export function Grid({ min = 320, gap = 12, children, style }: { min?: number; gap?: number; children: ReactNode; style?: CSSProperties }) {
  return <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${min}px), 1fr))`, gap, alignItems: "start", ...style }}>{children}</div>;
}

export function Card({ children, style, onClick, ...rest }: { children: ReactNode; style?: CSSProperties; onClick?: () => void } & Omit<React.HTMLAttributes<HTMLDivElement>, "style" | "onClick">) {
  return <div onClick={onClick} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, ...style }} {...rest}>{children}</div>;
}

export function Field({ label, children, req, error, htmlFor }: { label: string; children: ReactNode; req?: boolean; error?: string; htmlFor?: string }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label htmlFor={htmlFor} style={{ ...sans, display: "block", fontSize: 11, color: C.subtle, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 5 }}>{label}{req && <span style={{ color: C.red }}> *</span>}</label>
      {children}
      {error && <div role="alert" style={{ ...sans, fontSize: 11, color: C.red, marginTop: 4 }}>{error}</div>}
    </div>
  );
}

export function AuditTrail({ entries }: { entries: { ts: string; user: string; action: string; detail: string }[] }) {
  if (!entries.length) return null;
  return (
    <Card>
      <h4 style={{ ...font, margin: "0 0 10px", fontSize: 14, color: C.navy }}>📋 Audit Trail</h4>
      {[...entries].reverse().map((log, i) => (
        <div key={i} style={{ display: "flex", gap: 8, padding: "6px 0", borderBottom: i < entries.length - 1 ? `1px solid ${C.borderLight}` : "none" }}>
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: C.accent, marginTop: 5, flexShrink: 0 }} />
          <div><div style={{ ...sans, fontSize: 12, fontWeight: 600 }}>{log.action}</div>{log.detail && <div style={{ ...sans, fontSize: 11, color: C.muted }}>{log.detail}</div>}<div style={{ ...sans, fontSize: 11, color: C.subtle }}>{log.user} · {log.ts}</div></div>
        </div>
      ))}
    </Card>
  );
}
