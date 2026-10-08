import type { CSSProperties, ReactNode } from "react";
import type { Role, Urgency } from "../types.ts";
import { C, colorFor, font, initials, radius, ROLE_COLORS, ROLE_LABELS, sans, shadow, URGENCY_COLORS } from "../theme.ts";
import { BarChart3, ClipboardCheck, Flag, Handshake, History, Inbox, Mail, PenLine, Target } from "./icons.tsx";

export function UrgencyDot({ level, size = 8 }: { level: Urgency; size?: number }) {
  return <span style={{ display: "inline-block", width: size, height: size, borderRadius: "50%", background: URGENCY_COLORS[level], flexShrink: 0 }} />;
}

const RENEWAL_COLORS: Record<string, { bg: string; color: string }> = {
  "In negoziazione": { bg: C.blueBg, color: C.blue }, "Rinnovo automatico": { bg: C.greenBg, color: C.green },
  "Da rescindere": { bg: C.redBg, color: C.red }, "Da rilanciare a gara": { bg: C.yellowBg, color: C.yellow }, "Non definito": { bg: C.grayBg, color: C.muted },
};
/** Etichetta a pillola con un puntino: il significato non dipende dal solo colore perché il testo è sempre presente. */
export function RenewalBadge({ status }: { status: string }) {
  const s = RENEWAL_COLORS[status] || RENEWAL_COLORS["Non definito"];
  return <span style={{ ...sans, display: "inline-flex", alignItems: "center", gap: 6, background: s.bg, color: s.color, borderRadius: 999, padding: "3px 10px", fontSize: 11.5, fontWeight: 600, whiteSpace: "nowrap" }}><span style={{ width: 6, height: 6, borderRadius: "50%", background: s.color }} />{status || "Non definito"}</span>;
}

/** Giorni alla scadenza in una pillola colorata. */
export function DaysChip({ days, level, ceased }: { days: number; level: Urgency; ceased?: boolean }) {
  const color = URGENCY_COLORS[level];
  const label = ceased ? "Cessato" : days < 0 ? `Scaduto da ${Math.abs(days)} gg` : days === 0 ? "Scade oggi" : `${days} gg`;
  return <span className="tabular" style={{ ...sans, background: `${color}18`, color, borderRadius: 999, padding: "3px 10px", fontSize: 11.5, fontWeight: 700, whiteSpace: "nowrap" }}>{label}</span>;
}

export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  return <div aria-hidden style={{ width: size, height: size, borderRadius: "50%", background: colorFor(name), color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.36, fontWeight: 650, flexShrink: 0, letterSpacing: 0, boxShadow: "0 0 0 2px rgba(255,255,255,.9)", ...sans }}>{initials(name)}</div>;
}

export function RoleBadge({ role }: { role: Role }) {
  return <span style={{ ...sans, background: `${ROLE_COLORS[role]}1c`, color: ROLE_COLORS[role], borderRadius: 999, padding: "3px 10px", fontSize: 11, fontWeight: 650 }}>{ROLE_LABELS[role]}</span>;
}

/** Tessera con numero in evidenza e icona: stessa altezza per tutte, il valore non esce mai dal riquadro. */
export function StatCard({ label, value, sub, color = C.accent, icon, title }: { label: string; value: ReactNode; sub?: string; color?: string; icon?: ReactNode; title?: string }) {
  return (
    <div className="lift" title={title} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: radius.lg, padding: "16px 18px 15px", boxShadow: shadow.sm, display: "flex", flexDirection: "column", gap: 10, minWidth: 0, height: "100%", boxSizing: "border-box" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div style={{ ...sans, fontSize: 12.5, color: C.muted, fontWeight: 600, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</div>
        {icon && <div aria-hidden style={{ width: 34, height: 34, borderRadius: 10, background: `${color}14`, color, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{icon}</div>}
      </div>
      <div className="tabular" style={{ ...font, fontSize: "clamp(24px, 2.2vw, 30px)", fontWeight: 700, color: C.text, lineHeight: 1.1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{value}</div>
      <div style={{ ...sans, fontSize: 12, color: C.subtle, marginTop: "auto", minHeight: 16 }}>{sub ?? "\u00a0"}</div>
    </div>
  );
}

/** Griglia che passa da 1 colonna (telefono) a più colonne (desktop) senza media query. */
export function Grid({ min = 320, gap = 14, children, style, fill = false }: { min?: number; gap?: number; children: ReactNode; style?: CSSProperties; fill?: boolean }) {
  // fill: le colonne si allargano per occupare tutta la riga (auto-fit) e le schede hanno tutte la stessa altezza.
  return <div style={{ display: "grid", gridTemplateColumns: `repeat(${fill ? "auto-fit" : "auto-fill"}, minmax(min(100%, ${min}px), 1fr))`, gap, alignItems: fill ? "stretch" : "start", ...style }}>{children}</div>;
}

export function Card({ children, style, onClick, ...rest }: { children: ReactNode; style?: CSSProperties; onClick?: () => void } & Omit<React.HTMLAttributes<HTMLDivElement>, "style" | "onClick">) {
  return <div onClick={onClick} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: radius.lg, padding: 18, boxShadow: shadow.sm, ...style }} {...rest}>{children}</div>;
}

/** Titolo di sezione dentro una scheda. */
export function CardTitle({ children, icon, action }: { children: ReactNode; icon?: ReactNode; action?: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
      {icon && <span aria-hidden style={{ color: C.subtle, display: "flex" }}>{icon}</span>}
      <h3 style={{ ...font, margin: 0, fontSize: 15, fontWeight: 650, color: C.text, flex: 1 }}>{children}</h3>
      {action}
    </div>
  );
}

export function Field({ label, children, req, error, htmlFor }: { label: string; children: ReactNode; req?: boolean; error?: string; htmlFor?: string }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label htmlFor={htmlFor} style={{ ...sans, display: "block", fontSize: 12, color: C.muted, fontWeight: 600, marginBottom: 6 }}>{label}{req && <span style={{ color: C.red }}> *</span>}</label>
      {children}
      {error && <div role="alert" style={{ ...sans, fontSize: 12, color: C.red, marginTop: 5 }}>{error}</div>}
    </div>
  );
}

/** Storico delle azioni come linea del tempo. */
export function AuditTrail({ entries }: { entries: { ts: string; user: string; action: string; detail: string }[] }) {
  if (!entries.length) return null;
  return (
    <Card>
      <CardTitle icon={<History size={16} />}>Storico delle attività</CardTitle>
      <div style={{ position: "relative", paddingLeft: 18 }}>
        <div style={{ position: "absolute", left: 4, top: 6, bottom: 6, width: 2, background: C.borderLight, borderRadius: 2 }} />
        {[...entries].reverse().map((log, i) => (
          <div key={i} style={{ position: "relative", padding: "0 0 14px" }}>
            <div style={{ position: "absolute", left: -18, top: 5, width: 10, height: 10, borderRadius: "50%", background: i === 0 ? C.accent : "#fff", border: `2px solid ${i === 0 ? C.accent : "#cfd4e0"}` }} />
            <div style={{ ...sans, fontSize: 13, fontWeight: 600, color: C.text }}>{log.action}</div>
            {log.detail && <div style={{ ...sans, fontSize: 12, color: C.muted, marginTop: 1, overflowWrap: "anywhere" }}>{log.detail}</div>}
            <div style={{ ...sans, fontSize: 11, color: C.subtle, marginTop: 2 }}>{log.user} · {log.ts}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}

/** Stato vuoto con spiegazione e, se serve, un'azione. */
export function EmptyState({ title, text, action, icon }: { title: string; text?: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div style={{ textAlign: "center", padding: "44px 20px", background: C.card, border: `1px dashed #cfd4e0`, borderRadius: radius.lg }}>
      <div aria-hidden style={{ width: 56, height: 56, borderRadius: 18, background: C.blueBg, color: C.blue, display: "inline-flex", alignItems: "center", justifyContent: "center", marginBottom: 14 }}>{icon ?? <Inbox size={26} />}</div>
      <div style={{ ...font, fontSize: 16, fontWeight: 650, color: C.text }}>{title}</div>
      {text && <div style={{ ...sans, fontSize: 13, color: C.muted, margin: "6px auto 0", maxWidth: 420, lineHeight: 1.55 }}>{text}</div>}
      {action && <div style={{ marginTop: 18 }}>{action}</div>}
    </div>
  );
}

/** Logo dell'applicazione (lo stesso della favicon). */
export function BrandMark({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden style={{ flexShrink: 0, filter: "drop-shadow(0 4px 10px rgba(200,82,42,.35))" }}>
      <rect width="64" height="64" rx="15" fill="#c8522a" />
      <path d="M20 14h17l9 9v27a3 3 0 0 1-3 3H20a3 3 0 0 1-3-3V17a3 3 0 0 1 3-3z" fill="#fff" />
      <path d="M37 14v9h9" fill="#f3c9ba" />
      <path d="M24 36l5 5 11-12" fill="none" stroke="#16213b" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const STEP_ICONS = { analysis: BarChart3, bo_notify: Mail, bo_response: ClipboardCheck, action: Target, negotiation: Handshake, signature: PenLine, expiry: Flag } as const;
/** Icona di un passaggio del piano di rinnovo. */
export function StepIcon({ id, size = 16 }: { id: string; size?: number }) {
  const I = STEP_ICONS[id as keyof typeof STEP_ICONS] ?? Flag;
  return <I size={size} />;
}
