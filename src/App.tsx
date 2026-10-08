import { useState, useMemo, useRef, useEffect, type CSSProperties, type ReactNode } from "react";
import type { Role, Urgency, View, User, Contract, ContractData, PlanStep, StepTemplate, AuditEntry, Plans, AuditLogs, Suggestion, MonthLoad, AppState, CommitPayload } from "./types.ts";
import { api } from "./api.ts";

// ─── DESIGN TOKENS ────────────────────────────────────────────
const C = {
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
const URGENCY_COLORS: Record<Urgency, string> = { green: C.green, yellow: C.yellow, red: C.red, gray: "#9ca3af" };
const font: CSSProperties = { fontFamily: "'Georgia','Times New Roman',serif" };
const sans: CSSProperties = { fontFamily: "'Helvetica Neue','Arial',sans-serif" };
const iStyle: CSSProperties = { fontFamily: "'Helvetica Neue','Arial',sans-serif", width: "100%", boxSizing: "border-box", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: "9px 12px", fontSize: 14, color: C.text, outline: "none" };

// ─── USERS & ROLES ───────────────────────────────────────────
const ROLES = { MANAGER: "manager", BUYER: "buyer", BO: "bo" } as const satisfies Record<string, Role>;

const USERS: User[] = [
  { id: "salvatore",    name: "Salvatore",          email: "salvatore@prometeon.com",        role: ROLES.MANAGER, avatar: "S",  color: "#c8522a", title: "Head of Indirect Procurement" },
  { id: "andrea",       name: "Andrea Lizza",        email: "andrea.lizza@prometeon.com",     role: ROLES.BUYER,   avatar: "AL", color: "#1a5c9e", title: "Senior Buyer" },
  { id: "teresa",       name: "Teresa Mingione",     email: "teresa.mingione@prometeon.com",  role: ROLES.BUYER,   avatar: "TM", color: "#2d7d4f", title: "Buyer" },
  { id: "marzia",       name: "Marzia",              email: "marzia@prometeon.com",           role: ROLES.BUYER,   avatar: "M",  color: "#6d28d9", title: "Buyer ICT" },
  { id: "rafael",       name: "Rafael Latorre Jr.",  email: "rafael.latorre@prometeon.com",   role: ROLES.BUYER,   avatar: "RL", color: "#b07d10", title: "Buyer Facility" },
  { id: "harris",       name: "Harris Xia",          email: "harris.xia@prometeon.com",       role: ROLES.BUYER,   avatar: "HX", color: "#0f766e", title: "Buyer - China Hub" },
  { id: "bo_ops",       name: "Mario Bianchi",       email: "ops@prometeon.com",              role: ROLES.BO,      avatar: "MB", color: "#4b5563", title: "Dir. Operations" },
  { id: "bo_it",        name: "Luca Ferrari",        email: "it@prometeon.com",               role: ROLES.BO,      avatar: "LF", color: "#4b5563", title: "CTO" },
  { id: "bo_supply",    name: "Anna Russo",          email: "supply@prometeon.com",           role: ROLES.BO,      avatar: "AR", color: "#4b5563", title: "Dir. Supply Chain" },
  { id: "bo_hr",        name: "Giulia Verdi",        email: "hr@prometeon.com",               role: ROLES.BO,      avatar: "GV", color: "#4b5563", title: "HR Director" },
  { id: "bo_fac",       name: "Roberto Neri",        email: "fac@prometeon.com",              role: ROLES.BO,      avatar: "RN", color: "#4b5563", title: "Facility Manager" },
];

const ROLE_LABELS: Record<Role, string> = { manager: "Manager", buyer: "Buyer", bo: "Business Owner" };
const ROLE_COLORS: Record<Role, string> = { manager: C.accent, buyer: C.blue, bo: C.green };

// ─── PLANNING ────────────────────────────────────────────────
const PLANNING_STEPS: StepTemplate[] = [
  { id: "analysis",    daysBeforeEnd: 90, icon: "📊", label: "Analisi spend",           actor: "buyer"  },
  { id: "bo_notify",   daysBeforeEnd: 75, icon: "✉️",  label: "Notifica Business Owner", actor: "system" },
  { id: "bo_response", daysBeforeEnd: 60, icon: "📋",  label: "Risposta Business Owner", actor: "bo"     },
  { id: "action",      daysBeforeEnd: 45, icon: "🎯",  label: "Avvio azione",            actor: "buyer"  },
  { id: "negotiation", daysBeforeEnd: 30, icon: "🤝",  label: "Negoziazione",            actor: "buyer"  },
  { id: "signature",   daysBeforeEnd: 15, icon: "✍️",  label: "Firma / formalizzazione", actor: "buyer"  },
  { id: "expiry",      daysBeforeEnd: 0,  icon: "🏁",  label: "Scadenza",                actor: "system" },
];
const stepTemplate = (id: string) => PLANNING_STEPS.find(s => s.id === id)!;

const BO_DECISIONS = ["Rinnovare alle stesse condizioni", "Rinnovare con rinegoziazione", "Mettere in gara (RFQ/RFP)", "Prorogare temporaneamente", "Cessare l'attività"];
const BO_COLORS: Record<string, { bg: string; color: string }> = {
  "Rinnovare alle stesse condizioni": { bg: C.greenBg,  color: C.green  },
  "Rinnovare con rinegoziazione":     { bg: C.blueBg,   color: C.blue   },
  "Mettere in gara (RFQ/RFP)":        { bg: C.yellowBg, color: C.yellow },
  "Prorogare temporaneamente":         { bg: C.purpleBg, color: C.purple },
  "Cessare l'attività":                { bg: C.redBg,    color: C.red    },
};

const WORKLOAD_THRESHOLD = 3;
const NOW = new Date();
const STORAGE_KEY = "contract-tracker:v1";

// ─── HELPERS ─────────────────────────────────────────────────
function daysToExpiry(end: string) { return Math.ceil((new Date(end).getTime() - NOW.getTime()) / 864e5); }
function urgency(c: Contract): Urgency { if (c.ceased) return "gray"; const d = daysToExpiry(c.end); return d <= 30 ? "red" : d <= 90 ? "yellow" : "green"; }
function fmt(n: number, cur = "EUR") { try { return new Intl.NumberFormat("it-IT", { style: "currency", currency: cur, maximumFractionDigits: 0 }).format(n); } catch { return `${n} ${cur}`; } }
function fmtDate(d: string | Date) { return new Date(d).toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" }); }
function fmtMonth(d: string | Date) { return new Date(d).toLocaleDateString("it-IT", { month: "short", year: "2-digit" }); }
function addDays(date: string | Date, days: number) { const d = new Date(date); d.setDate(d.getDate() + days); return d; }
function isoDate(d: Date) { return d.toISOString().slice(0, 10); }
function tsNow() { return new Date().toLocaleString("it-IT"); }
function monthKey(d: Date) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; }
function userByEmail(email: string) { return USERS.find(u => u.email === email); }
function userByName(name: string) { return USERS.find(u => u.name === name); }
function planProgress(plan: PlanStep[]) { return plan.length ? Math.round((plan.filter(s => s.status === "done").length / plan.length) * 100) : 0; }

function makePlan(contractId: number, end: string, offsetDays = 0): PlanStep[] {
  return PLANNING_STEPS.map(s => {
    const scheduled = addDays(end, -(s.daysBeforeEnd + offsetDays));
    const isPast = scheduled < NOW;
    return { contractId, stepId: s.id, scheduledDate: isoDate(scheduled), originalDate: isoDate(scheduled), status: isPast ? (s.id === "bo_response" ? "pending_bo" : "done") : "upcoming", completedAt: isPast && s.id !== "bo_response" ? fmtDate(scheduled) : null, completedBy: isPast && s.id !== "bo_response" ? (s.actor === "system" ? "Sistema" : "Buyer") : null, boDecision: null, boNotes: "", boRespondedAt: null, modified: false, modifiedReason: "" };
  });
}

// Ricalcola le date del piano su una nuova scadenza mantenendo lo stato delle attività già avviate/completate.
function reschedulePlan(oldPlan: PlanStep[], contractId: number, end: string): PlanStep[] {
  return makePlan(contractId, end).map(ns => {
    const old = oldPlan.find(s => s.stepId === ns.stepId);
    return old && old.status !== "upcoming" ? { ...old, scheduledDate: ns.scheduledDate, originalDate: ns.originalDate, modified: false, modifiedReason: "" } : ns;
  });
}

// ─── MOCK DATA ────────────────────────────────────────────────
// Le date sono relative a oggi, così la demo mostra sempre un mix realistico di scadenze.
const rel = (days: number) => isoDate(addDays(NOW, days));
const MOCK_CONTRACTS: Contract[] = [
  { id: 1,  supplier: "Mesnac Co. Ltd",      object: "Macchinari - Linea Egitto",  category: "Capex",    country: "Cina",     value: 2400000, currency: "EUR", start: rel(-480),  end: rel(-15),  owner: "Andrea Lizza",      boEmail: "ops@prometeon.com",   renewal: "Da rilanciare a gara", type: "Fornitura", notes: "", ceased: false, fileName: "mesnac.pdf" },
  { id: 2,  supplier: "Deloitte Consulting", object: "SAP S/4HANA",               category: "IT",       country: "Italia",   value: 850000,  currency: "EUR", start: rel(-700),  end: rel(25),   owner: "Salvatore",         boEmail: "it@prometeon.com",    renewal: "In negoziazione",      type: "Servizi",  notes: "", ceased: false, fileName: null },
  { id: 3,  supplier: "DHL Supply Chain",    object: "Logistica outbound Europa", category: "Logistica",country: "Germania", value: 320000,  currency: "EUR", start: rel(-850),  end: rel(40),   owner: "Teresa Mingione",   boEmail: "supply@prometeon.com",renewal: "In negoziazione",      type: "Servizi",  notes: "", ceased: false, fileName: "dhl.pdf" },
  { id: 4,  supplier: "Oracle Italia Srl",   object: "Licenze database AMS",      category: "ICT",      country: "Italia",   value: 180000,  currency: "EUR", start: rel(-1390), end: rel(70),   owner: "Marzia",            boEmail: "it@prometeon.com",    renewal: "Da rescindere",        type: "AMS",      notes: "", ceased: false, fileName: null },
  { id: 5,  supplier: "Aeolus Tyre Co.",     object: "Raw materials supply",      category: "Mat.Prime",country: "Cina",     value: 5600000, currency: "USD", start: rel(-490),  end: rel(240),  owner: "Harris Xia",        boEmail: "ops@prometeon.com",   renewal: "Rinnovo automatico",   type: "Fornitura",notes: "", ceased: false, fileName: "aeolus.pdf" },
  { id: 6,  supplier: "Securitas Italia",    object: "Vigilanza stabilimenti",    category: "Facility", country: "Italia",   value: 95000,   currency: "EUR", start: rel(-1770), end: rel(55),   owner: "Rafael Latorre Jr.",boEmail: "fac@prometeon.com",   renewal: "Da rilanciare a gara", type: "Servizi",  notes: "", ceased: false, fileName: null },
  { id: 7,  supplier: "Microsoft Azure",     object: "Cloud & M365",              category: "ICT",      country: "USA",      value: 240000,  currency: "EUR", start: rel(-640),  end: rel(420),  owner: "Marzia",            boEmail: "it@prometeon.com",    renewal: "Rinnovo automatico",   type: "SaaS",     notes: "", ceased: false, fileName: null },
  { id: 8,  supplier: "Manpower Group",      object: "Somministrazione lavoro",   category: "HR",       country: "Italia",   value: 410000,  currency: "EUR", start: rel(-630),  end: rel(100),  owner: "Teresa Mingione",   boEmail: "hr@prometeon.com",    renewal: "In negoziazione",      type: "Servizi",  notes: "", ceased: false, fileName: null },
  { id: 9,  supplier: "Randstad Italia",     object: "Ricerca & selezione",       category: "HR",       country: "Italia",   value: 85000,   currency: "EUR", start: rel(-620),  end: rel(110),  owner: "Teresa Mingione",   boEmail: "hr@prometeon.com",    renewal: "In negoziazione",      type: "Servizi",  notes: "", ceased: false, fileName: null },
  { id: 10, supplier: "IBM Italia",          object: "Manutenzione server legacy",category: "ICT",      country: "Italia",   value: 120000,  currency: "EUR", start: rel(-1000), end: rel(85),   owner: "Marzia",            boEmail: "it@prometeon.com",    renewal: "Da rescindere",        type: "AMS",      notes: "", ceased: false, fileName: null },
];

function initialPlans(): Plans {
  return Object.fromEntries(MOCK_CONTRACTS.map(c => [c.id, makePlan(c.id, c.end)]));
}
function initialAudit(): AuditLogs {
  return Object.fromEntries(MOCK_CONTRACTS.map(c => [c.id, [{ ts: `${fmtDate(c.start)}, 09:00`, user: c.owner, action: "Contratto creato", detail: `${c.supplier} · ${c.object}` }]]));
}

// ─── PERSISTENCE (solo modalità locale, quando l'API non è raggiungibile) ───
function loadLocal(): AppState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as AppState;
    return Array.isArray(data.contracts) && data.plans && data.auditLogs ? data : null;
  } catch { return null; }
}
function saveLocal(state: AppState) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* storage pieno o non disponibile */ }
}
function clearLocal() {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}

// ─── SMALL COMPONENTS ────────────────────────────────────────
function UrgencyDot({ level, size = 8 }: { level: Urgency; size?: number }) {
  return <span style={{ display: "inline-block", width: size, height: size, borderRadius: "50%", background: URGENCY_COLORS[level], flexShrink: 0 }} />;
}
function RenewalBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string }> = { "In negoziazione": { bg: C.blueBg, color: C.blue }, "Rinnovo automatico": { bg: C.greenBg, color: C.green }, "Da rescindere": { bg: C.redBg, color: C.red }, "Da rilanciare a gara": { bg: C.yellowBg, color: C.yellow }, "Non definito": { bg: "#f0ece4", color: C.muted } };
  const s = map[status] || map["Non definito"];
  return <span style={{ ...sans, background: s.bg, color: s.color, borderRadius: 4, padding: "2px 8px", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap" }}>{status || "Non definito"}</span>;
}
function Avatar({ user, size = 36 }: { user: User; size?: number }) {
  return <div style={{ width: size, height: size, borderRadius: "50%", background: user.color, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.35, fontWeight: 700, flexShrink: 0, ...sans }}>{user.avatar}</div>;
}
function RoleBadge({ role }: { role: Role }) {
  return <span style={{ ...sans, background: `${ROLE_COLORS[role]}20`, color: ROLE_COLORS[role], borderRadius: 4, padding: "2px 8px", fontSize: 11, fontWeight: 700 }}>{ROLE_LABELS[role]}</span>;
}
function StatCard({ label, value, sub, color = C.accent }: { label: string; value: ReactNode; sub?: string; color?: string }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "16px 18px", flex: 1 }}>
      <div style={{ ...sans, fontSize: 10, color: C.subtle, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>{label}</div>
      <div style={{ ...font, fontSize: 22, fontWeight: 700, color, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ ...sans, fontSize: 11, color: C.muted, marginTop: 5 }}>{sub}</div>}
    </div>
  );
}

// ─── WORKLOAD ─────────────────────────────────────────────────
function calcWorkload(contracts: Contract[], plans: Plans) {
  const months: Record<string, MonthLoad> = {};
  for (let i = -1; i < 12; i++) {
    const d = new Date(NOW.getFullYear(), NOW.getMonth() + i, 1);
    months[monthKey(d)] = { label: fmtMonth(d), total: 0, byBuyer: {} };
  }
  contracts.filter(c => !c.ceased).forEach(c => {
    (plans[c.id] || []).filter(s => s.status !== "done" && s.stepId !== "expiry").forEach(s => {
      const key = monthKey(new Date(s.scheduledDate));
      if (months[key]) { months[key].total++; if (!months[key].byBuyer[c.owner]) months[key].byBuyer[c.owner] = 0; months[key].byBuyer[c.owner]++; }
    });
  });
  return months;
}

function getSuggestions(contracts: Contract[], plans: Plans) {
  const workload = calcWorkload(contracts, plans);
  return contracts.filter(c => !c.ceased).reduce((acc, c) => {
    const first = (plans[c.id] || []).find(s => s.stepId === "analysis");
    if (!first || first.status === "done") return acc;
    const d = new Date(first.scheduledDate);
    const load = workload[monthKey(d)]?.byBuyer[c.owner] || 0;
    if (load >= WORKLOAD_THRESHOLD) acc.push({ contractId: c.id, supplier: c.supplier, owner: c.owner, reason: `${c.owner} ha ${load} attività a ${fmtMonth(d)}`, recommendedOffset: 30 });
    return acc;
  }, [] as Suggestion[]);
}

// ─── LOGIN SCREEN ─────────────────────────────────────────────
function LoginScreen({ onLogin, onResetDemo }: { onLogin: (u: User) => void; onResetDemo?: () => void }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);

  const groups = [
    { label: "Management", users: USERS.filter(u => u.role === ROLES.MANAGER) },
    { label: "Team Procurement", users: USERS.filter(u => u.role === ROLES.BUYER) },
    { label: "Business Owner", users: USERS.filter(u => u.role === ROLES.BO) },
  ];

  return (
    <div style={{ minHeight: "100vh", background: C.navy, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24 }}>
      {/* Logo */}
      <div style={{ marginBottom: 32, textAlign: "center" }}>
        <div style={{ width: 56, height: 56, background: C.accent, borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, margin: "0 auto 16px" }}>📋</div>
        <div style={{ ...font, fontSize: 22, fontWeight: 700, color: "#fff" }}>Contract Tracker</div>
        <div style={{ ...sans, fontSize: 13, color: "rgba(255,255,255,0.5)", marginTop: 4 }}>Prometeon Tyre Group</div>
        <div style={{ ...sans, fontSize: 11, color: "rgba(255,255,255,0.3)", marginTop: 8, background: "rgba(255,255,255,0.08)", borderRadius: 6, padding: "4px 12px", display: "inline-block" }}>
          🔒 Demo — seleziona il tuo profilo
        </div>
      </div>

      {/* User selector */}
      <div style={{ width: "100%", maxWidth: 400 }}>
        {groups.map(g => (
          <div key={g.label} style={{ marginBottom: 20 }}>
            <div style={{ ...sans, fontSize: 11, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>{g.label}</div>
            {g.users.map(u => (
              <div key={u.id} onClick={() => setSelected(u.id)}
                onMouseEnter={() => setHoverId(u.id)} onMouseLeave={() => setHoverId(null)}
                style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 16px", borderRadius: 12, marginBottom: 8, cursor: "pointer", border: `2px solid ${selected === u.id ? u.color : "transparent"}`, background: selected === u.id ? "rgba(255,255,255,0.1)" : hoverId === u.id ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.03)", transition: "all 0.15s" }}>
                <Avatar user={u} size={40} />
                <div style={{ flex: 1 }}>
                  <div style={{ ...sans, fontSize: 14, fontWeight: 600, color: "#fff" }}>{u.name}</div>
                  <div style={{ ...sans, fontSize: 12, color: "rgba(255,255,255,0.4)" }}>{u.title}</div>
                </div>
                <RoleBadge role={u.role} />
                {selected === u.id && <span style={{ color: u.color, fontSize: 18 }}>✓</span>}
              </div>
            ))}
          </div>
        ))}

        <button onClick={() => { const u = USERS.find(x => x.id === selected); if (u) onLogin(u); }}
          disabled={!selected}
          style={{ ...sans, width: "100%", padding: 16, background: selected ? C.accent : "rgba(255,255,255,0.1)", border: "none", borderRadius: 12, color: selected ? "#fff" : "rgba(255,255,255,0.3)", fontWeight: 700, cursor: selected ? "pointer" : "default", fontSize: 16, marginTop: 8, transition: "all 0.2s" }}>
          {selected ? `Accedi come ${USERS.find(u => u.id === selected)?.name} →` : "Seleziona un profilo"}
        </button>
        {onResetDemo && (
          <button onClick={() => { if (window.confirm("Ripristinare i dati demo? Tutte le modifiche salvate in questo browser andranno perse.")) onResetDemo(); }}
            style={{ ...sans, width: "100%", marginTop: 12, padding: 8, background: "none", border: "none", color: "rgba(255,255,255,0.35)", cursor: "pointer", fontSize: 12, textDecoration: "underline" }}>
            ↺ Ripristina dati demo
          </button>
        )}
      </div>
    </div>
  );
}

// ─── BO FORM MODAL ────────────────────────────────────────────
function BOFormModal({ contract, currentUser, onSubmit, onClose }: { contract: Contract; currentUser: User; onSubmit: (id: number, r: { decision: string; notes: string }) => void; onClose: () => void }) {
  const [decision, setDecision] = useState(""); const [notes, setNotes] = useState(""); const [submitted, setSubmitted] = useState(false);
  const handleSubmit = () => { if (!decision) return; setSubmitted(true); setTimeout(() => { onSubmit(contract.id, { decision, notes }); onClose(); }, 1500); };
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ background: C.surface, borderRadius: 16, padding: 24, width: "100%", maxWidth: 420, maxHeight: "90vh", overflowY: "auto" }}>
        {submitted ? (
          <div style={{ textAlign: "center", padding: "32px 0" }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
            <h3 style={{ ...font, color: C.green, margin: "0 0 8px" }}>Risposta registrata</h3>
            <p style={{ ...sans, color: C.muted, fontSize: 14 }}>Il piano verrà aggiornato automaticamente.</p>
          </div>
        ) : (
          <>
            <div style={{ background: C.navy, borderRadius: 10, padding: 14, marginBottom: 18 }}>
              <div style={{ ...sans, fontSize: 10, color: "rgba(255,255,255,0.4)", marginBottom: 4 }}>Richiesta da: {contract.owner} · Sistema automatico</div>
              <div style={{ ...sans, fontSize: 10, color: "rgba(255,255,255,0.4)", marginBottom: 8 }}>A: {currentUser.email}</div>
              <div style={{ ...font, fontSize: 14, color: "#fff", fontWeight: 700 }}>Decisione richiesta: {contract.supplier}</div>
            </div>
            <p style={{ ...sans, fontSize: 13, color: C.text, lineHeight: 1.6, marginBottom: 16 }}>
              Il contratto con <b>{contract.supplier}</b> scade il <b>{fmtDate(contract.end)}</b>.<br />
              Valore: <b>{fmt(contract.value, contract.currency)}</b>
            </p>
            <div style={{ marginBottom: 14 }}>
              {BO_DECISIONS.map(d => { const s = BO_COLORS[d]; const sel = decision === d; return (
                <button key={d} onClick={() => setDecision(d)} style={{ ...sans, width: "100%", marginBottom: 8, padding: "10px 14px", borderRadius: 8, border: `2px solid ${sel ? s.color : C.border}`, background: sel ? s.bg : "transparent", color: sel ? s.color : C.text, cursor: "pointer", fontSize: 13, fontWeight: sel ? 700 : 400, textAlign: "left" }}>{sel ? "✓ " : ""}{d}</button>
              ); })}
            </div>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Note / motivazioni..." style={{ ...iStyle, height: 72, resize: "none", marginBottom: 14 }} />
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={onClose} style={{ ...sans, flex: 1, padding: 11, background: "transparent", border: `1px solid ${C.border}`, borderRadius: 8, color: C.muted, cursor: "pointer" }}>Annulla</button>
              <button onClick={handleSubmit} disabled={!decision} style={{ ...sans, flex: 2, padding: 11, background: decision ? C.accent : C.border, border: "none", borderRadius: 8, color: "#fff", fontWeight: 700, cursor: decision ? "pointer" : "default" }}>✓ Invia risposta</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── STEP DATE EDITOR ─────────────────────────────────────────
function StepDateEditor({ step, tmpl, onSave, onClose }: { step: PlanStep; tmpl: StepTemplate; onSave: (date: string, reason: string) => void; onClose: () => void }) {
  const [newDate, setNewDate] = useState(step.scheduledDate); const [reason, setReason] = useState("");
  const diff = newDate ? Math.round((new Date(newDate).getTime() - new Date(step.originalDate).getTime()) / 864e5) : 0;
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ background: C.surface, borderRadius: 14, padding: 22, width: "100%", maxWidth: 360 }}>
        <h4 style={{ ...font, margin: "0 0 16px", fontSize: 16, color: C.navy }}>{tmpl.icon} {tmpl.label}</h4>
        <div style={{ marginBottom: 14 }}>
          <label style={{ ...sans, fontSize: 11, color: C.subtle, display: "block", marginBottom: 5, textTransform: "uppercase" }}>Data originale</label>
          <div style={{ ...sans, fontSize: 13, color: C.muted, padding: "8px 12px", background: C.bg, borderRadius: 6 }}>{fmtDate(step.originalDate)}</div>
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={{ ...sans, fontSize: 11, color: C.subtle, display: "block", marginBottom: 5, textTransform: "uppercase" }}>Nuova data *</label>
          <input type="date" value={newDate} onChange={e => setNewDate(e.target.value)} style={iStyle} />
        </div>
        {newDate !== step.originalDate && diff !== 0 && (
          <div style={{ background: C.blueBg, borderRadius: 6, padding: 10, marginBottom: 14 }}>
            <div style={{ ...sans, fontSize: 12, color: C.blue }}>{diff < 0 ? `⏩ Anticipo di ${Math.abs(diff)} giorni` : `⏪ Posticipo di ${diff} giorni`}</div>
          </div>
        )}
        <div style={{ marginBottom: 16 }}>
          <label style={{ ...sans, fontSize: 11, color: C.subtle, display: "block", marginBottom: 5, textTransform: "uppercase" }}>Motivazione *</label>
          <textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="Es. Distribuzione carico, periodo festivo..." style={{ ...iStyle, height: 64, resize: "none" }} />
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onClose} style={{ ...sans, flex: 1, padding: 11, background: "transparent", border: `1px solid ${C.border}`, borderRadius: 8, color: C.muted, cursor: "pointer" }}>Annulla</button>
          <button onClick={() => newDate && reason.trim() && onSave(newDate, reason)} disabled={!newDate || !reason.trim()} style={{ ...sans, flex: 2, padding: 11, background: newDate && reason.trim() ? C.accent : C.border, border: "none", borderRadius: 8, color: "#fff", fontWeight: 700, cursor: newDate && reason.trim() ? "pointer" : "default" }}>💾 Salva</button>
        </div>
      </div>
    </div>
  );
}

// ─── CONTRACT FORM ────────────────────────────────────────────
const CATEGORIES = ["Capex / Machinery","Professional Services IT","Logistica","ICT / Software","Materie Prime","Facility Services","HR Services","AMS","Utilities","Marketing","Legal","Finance","Altro"];
const TYPES = ["Fornitura","Servizi","AMS","SaaS","Licenza","Framework","NDA","Altro"];
const CURRENCIES = ["EUR","USD","GBP","CNY","CHF"];
const BUYER_NAMES = USERS.filter(u => u.role === ROLES.BUYER || u.role === ROLES.MANAGER).map(u => u.name);
const RENEWAL_OPTIONS = ["In negoziazione","Rinnovo automatico","Da rescindere","Da rilanciare a gara","Non definito"];

type FormState = Omit<ContractData, "value"> & { value: string | number };
type FormErrors = Partial<Record<"supplier" | "object" | "end" | "file", string>>;
type TextField = "supplier" | "object" | "country" | "boEmail" | "category" | "type" | "currency" | "renewal";

function Field({ label, children, req, error }: { label: string; children: ReactNode; req?: boolean; error?: string }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ ...sans, display: "block", fontSize: 11, color: C.subtle, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 5 }}>{label}{req && <span style={{ color: C.red }}> *</span>}</label>
      {children}
      {error && <div style={{ ...sans, fontSize: 11, color: C.red, marginTop: 4 }}>{error}</div>}
    </div>
  );
}

function ContractForm({ initial, currentUser, onSave, onClose }: { initial: Contract | null; currentUser: User; onSave: (data: ContractData) => void; onClose: () => void }) {
  const defaultOwner = currentUser.role === ROLES.BUYER ? currentUser.name : "";
  const [form, setForm] = useState<FormState>(initial || { supplier: "", object: "", category: "", country: "Italia", value: "", currency: "EUR", start: "", end: "", owner: defaultOwner, boEmail: "", renewal: "Non definito", type: "Servizi", notes: "", ceased: false, fileName: null });
  const [errors, setErrors] = useState<FormErrors>({});
  const [attachedFile, setAttachedFile] = useState<{ name: string } | null>(initial?.fileName ? { name: initial.fileName } : null);
  const fileRef = useRef<HTMLInputElement>(null);
  const up = <K extends keyof FormState>(k: K) => (v: FormState[K]) => setForm(f => ({ ...f, [k]: v }));
  const isNew = !initial;
  const validate = () => {
    const e: FormErrors = {};
    if (!form.supplier.trim()) e.supplier = "Obbligatorio";
    if (!form.object.trim()) e.object = "Obbligatorio";
    if (!form.end) e.end = "Obbligatorio";
    else if (form.start && form.end < form.start) e.end = "La scadenza deve essere successiva alla data di inizio";
    if (isNew && !attachedFile) e.file = "Documento obbligatorio";
    setErrors(e);
    return !Object.keys(e).length;
  };
  const handleSave = () => { if (validate()) onSave({ ...form, owner: form.owner || currentUser.name, value: parseFloat(String(form.value).replace(",", ".")) || 0, fileName: attachedFile?.name || form.fileName || null }); };
  const fi = (key: TextField, ph: string, type = "text") => <input value={form[key]} onChange={e => up(key)(e.target.value)} placeholder={ph} type={type} style={{ ...iStyle, borderColor: (errors as Record<string, string | undefined>)[key] ? C.red : C.border }} />;
  const sel = (key: TextField, opts: string[]) => <select value={form[key]} onChange={e => up(key)(e.target.value)} style={iStyle}><option value="">— Seleziona —</option>{opts.map(o => <option key={o}>{o}</option>)}</select>;
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 100, display: "flex", alignItems: "flex-end" }}>
      <div style={{ background: C.surface, borderRadius: "16px 16px 0 0", padding: 20, width: "100%", boxSizing: "border-box", maxHeight: "90vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <h3 style={{ ...font, margin: 0, fontSize: 17, color: C.navy }}>{isNew ? "➕ Nuovo contratto" : "✏️ Modifica"}</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: C.muted }}>×</button>
        </div>
        <Field label="Fornitore" req error={errors.supplier}>{fi("supplier", "Es. Acme Srl")}</Field>
        <Field label="Oggetto" req error={errors.object}>{fi("object", "Es. Fornitura logistica")}</Field>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}><Field label="Categoria">{sel("category", CATEGORIES)}</Field><Field label="Tipo">{sel("type", TYPES)}</Field></div>
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12 }}><Field label="Valore"><input value={form.value} onChange={e => up("value")(e.target.value)} type="number" style={iStyle} /></Field><Field label="Valuta">{sel("currency", CURRENCIES)}</Field></div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}><Field label="Inizio"><input value={form.start} onChange={e => up("start")(e.target.value)} type="date" style={iStyle} /></Field><Field label="Scadenza" req error={errors.end}><input value={form.end} onChange={e => up("end")(e.target.value)} type="date" style={{ ...iStyle, borderColor: errors.end ? C.red : C.border }} /></Field></div>
        <Field label="Paese">{fi("country", "Es. Italia")}</Field>
        <Field label="Contract Owner">
          {currentUser.role === ROLES.BUYER
            ? <div style={{ ...iStyle, background: "#f0ece4", color: C.muted }}>{currentUser.name} (tu)</div>
            : <select value={form.owner} onChange={e => up("owner")(e.target.value)} style={iStyle}><option value="">— Seleziona —</option>{BUYER_NAMES.map(o => <option key={o}>{o}</option>)}</select>}
        </Field>
        <Field label="Email Business Owner">{fi("boEmail", "bo@prometeon.com", "email")}</Field>
        <Field label="Stato rinnovo">{sel("renewal", RENEWAL_OPTIONS)}</Field>
        <Field label="Note"><textarea value={form.notes} onChange={e => up("notes")(e.target.value)} style={{ ...iStyle, height: 60, resize: "none" }} /></Field>
        <Field label="Documento" req={isNew}>
          <input ref={fileRef} type="file" accept=".pdf,.doc,.docx" onChange={e => { const f = e.target.files?.[0]; if (f) setAttachedFile(f); }} style={{ display: "none" }} />
          {!attachedFile
            ? <button onClick={() => fileRef.current?.click()} style={{ ...sans, width: "100%", padding: "12px", background: errors.file ? C.redBg : C.bg, border: `2px dashed ${errors.file ? C.red : C.border}`, borderRadius: 8, color: errors.file ? C.red : C.muted, cursor: "pointer", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>📎 Allega PDF o Word{isNew && <span style={{ color: C.red }}>*</span>}</button>
            : <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: C.greenBg, border: `1px solid ${C.green}`, borderRadius: 8 }}>📄<div style={{ flex: 1, ...sans, fontSize: 13, fontWeight: 600, color: C.green, overflow: "hidden", textOverflow: "ellipsis" }}>{attachedFile.name}</div><button onClick={() => setAttachedFile(null)} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer" }}>×</button></div>}
          {errors.file && <div style={{ ...sans, fontSize: 11, color: C.red, marginTop: 6 }}>⚠️ {errors.file}</div>}
        </Field>
        {initial && currentUser.role !== ROLES.BO && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, padding: 12, background: form.ceased ? C.grayBg : C.greenBg, borderRadius: 8 }}>
            <input type="checkbox" checked={form.ceased} onChange={e => up("ceased")(e.target.checked)} id="ceased" style={{ width: 18, height: 18 }} />
            <label htmlFor="ceased" style={{ ...sans, fontSize: 13, color: form.ceased ? C.gray : C.green, fontWeight: 600, cursor: "pointer" }}>{form.ceased ? "⚫ Cessato" : "🟢 Attivo"}</label>
          </div>
        )}
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onClose} style={{ ...sans, flex: 1, padding: 12, background: "transparent", border: `1px solid ${C.border}`, borderRadius: 8, color: C.muted, cursor: "pointer" }}>Annulla</button>
          <button onClick={handleSave} style={{ ...sans, flex: 2, padding: 12, background: C.accent, border: "none", borderRadius: 8, color: "#fff", fontWeight: 700, cursor: "pointer" }}>{isNew ? "➕ Aggiungi" : "💾 Salva"}</button>
        </div>
      </div>
    </div>
  );
}

// ─── BO VIEW ─────────────────────────────────────────────────
function BOView({ contracts, plans, currentUser, onOpenBOForm }: { contracts: Contract[]; plans: Plans; currentUser: User; onOpenBOForm: (c: Contract) => void }) {
  const myContracts = contracts.filter(c => !c.ceased && c.boEmail === currentUser.email);
  const pending = myContracts.filter(c => { const plan = plans[c.id] || []; return plan.some(s => s.stepId === "bo_response" && s.status === "pending_bo"); });
  const others = myContracts.filter(c => !pending.find(p => p.id === c.id));

  return (
    <div>
      <div style={{ background: C.navy, borderRadius: 12, padding: 18, marginBottom: 20, color: "#fff" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
          <Avatar user={currentUser} size={44} />
          <div>
            <div style={{ ...font, fontSize: 16, fontWeight: 700 }}>{currentUser.name}</div>
            <div style={{ ...sans, fontSize: 12, color: "rgba(255,255,255,0.5)" }}>{currentUser.title}</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 20 }}>
          <div><div style={{ ...sans, fontSize: 10, color: "rgba(255,255,255,0.4)" }}>CONTRATTI</div><div style={{ ...font, fontSize: 20, fontWeight: 700 }}>{myContracts.length}</div></div>
          <div><div style={{ ...sans, fontSize: 10, color: "rgba(255,255,255,0.4)" }}>IN ATTESA RISPOSTA</div><div style={{ ...font, fontSize: 20, fontWeight: 700, color: "#f5c55a" }}>{pending.length}</div></div>
        </div>
      </div>

      {pending.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ ...sans, fontSize: 12, fontWeight: 700, color: C.yellow, marginBottom: 10 }}>⏳ Richieste in attesa di risposta ({pending.length})</div>
          {pending.map(c => (
            <div key={c.id} style={{ background: C.yellowBg, border: `1px solid #f0d080`, borderRadius: 10, padding: 16, marginBottom: 10 }}>
              <div style={{ ...sans, fontSize: 13, fontWeight: 700, color: C.navy, marginBottom: 4 }}>{c.supplier}</div>
              <div style={{ ...sans, fontSize: 12, color: C.muted, marginBottom: 10 }}>{c.object} · Scadenza: {fmtDate(c.end)}</div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ ...sans, fontSize: 12, color: C.muted }}>Buyer: {c.owner}</div>
                <button onClick={() => onOpenBOForm(c)} style={{ ...sans, padding: "8px 16px", background: C.accent, border: "none", borderRadius: 8, color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: 13 }}>📋 Rispondi</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {others.length > 0 && (
        <div>
          <div style={{ ...sans, fontSize: 12, fontWeight: 700, color: C.muted, marginBottom: 10 }}>I tuoi contratti ({others.length})</div>
          {others.map(c => {
            const days = daysToExpiry(c.end);
            const lc = URGENCY_COLORS[urgency(c)];
            const plan = plans[c.id] || [];
            const boStep = plan.find(s => s.stepId === "bo_response");
            return (
              <div key={c.id} style={{ background: C.card, border: `1px solid ${C.border}`, borderLeft: `3px solid ${lc}`, borderRadius: 10, padding: 14, marginBottom: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <div style={{ ...sans, fontSize: 13, fontWeight: 700, color: C.navy }}>{c.supplier}</div>
                  <div style={{ ...sans, fontSize: 12, fontWeight: 700, color: lc }}>{days < 0 ? "Scaduto" : `${days}gg`}</div>
                </div>
                <div style={{ ...sans, fontSize: 12, color: C.muted, marginTop: 2 }}>{c.object}</div>
                {boStep?.boDecision && (
                  <div style={{ marginTop: 8 }}>
                    <span style={{ ...sans, fontSize: 11, fontWeight: 600, color: BO_COLORS[boStep.boDecision]?.color, background: BO_COLORS[boStep.boDecision]?.bg, borderRadius: 4, padding: "2px 8px" }}>✓ {boStep.boDecision}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {myContracts.length === 0 && (
        <div style={{ textAlign: "center", padding: 40 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
          <div style={{ ...sans, color: C.muted, fontSize: 14 }}>Nessun contratto assegnato al momento.</div>
        </div>
      )}
    </div>
  );
}

// ─── PLANNING VIEW ────────────────────────────────────────────
function PlanningView({ contracts, plans, auditLogs, currentUser, onSendBO, onCompleteStep, onOpenBOForm, onUpdateStepDate }: {
  contracts: Contract[]; plans: Plans; auditLogs: AuditLogs; currentUser: User;
  onSendBO: (id: number) => void; onCompleteStep: (id: number, stepId: string) => void;
  onOpenBOForm: (c: Contract) => void; onUpdateStepDate: (id: number, stepId: string, date: string, reason: string) => void;
}) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [editingStep, setEditingStep] = useState<{ step: PlanStep; tmpl: StepTemplate } | null>(null);

  const myContracts = currentUser.role === ROLES.MANAGER
    ? contracts.filter(c => !c.ceased && daysToExpiry(c.end) <= 120)
    : contracts.filter(c => !c.ceased && c.owner === currentUser.name && daysToExpiry(c.end) <= 120);

  const sorted = [...myContracts].sort((a, b) => daysToExpiry(a.end) - daysToExpiry(b.end));

  const contract = selectedId !== null ? contracts.find(c => c.id === selectedId) : undefined;
  if (contract) {
    const plan = plans[contract.id] || [];
    const audit = auditLogs[contract.id] || [];
    const canEdit = currentUser.role === ROLES.MANAGER || contract.owner === currentUser.name;

    return (
      <div>
        <button onClick={() => setSelectedId(null)} style={{ ...sans, background: "none", border: "none", color: C.accent, cursor: "pointer", marginBottom: 14, fontSize: 13, fontWeight: 600, padding: 0 }}>← Piano</button>
        <div style={{ background: C.navy, borderRadius: 12, padding: 18, marginBottom: 14, color: "#fff" }}>
          <div style={{ ...font, fontSize: 15, fontWeight: 700, marginBottom: 4 }}>{contract.supplier}</div>
          <div style={{ ...sans, fontSize: 12, color: "rgba(255,255,255,0.6)", marginBottom: 10 }}>{contract.object}</div>
          <div style={{ display: "flex", gap: 16 }}>
            <div><div style={{ ...sans, fontSize: 9, color: "rgba(255,255,255,0.4)" }}>SCADENZA</div><div style={{ ...sans, fontSize: 13, fontWeight: 600 }}>{fmtDate(contract.end)}</div></div>
            <div><div style={{ ...sans, fontSize: 9, color: "rgba(255,255,255,0.4)" }}>BUYER</div><div style={{ ...sans, fontSize: 13, fontWeight: 600 }}>{contract.owner}</div></div>
          </div>
        </div>

        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 18, marginBottom: 14 }}>
          <h4 style={{ ...font, margin: "0 0 16px", fontSize: 15, color: C.navy }}>Piano attività</h4>
          {plan.map((step, i) => {
            const tmpl = stepTemplate(step.stepId);
            const isLast = i === plan.length - 1;
            const sc = step.status === "done" ? C.green : step.status === "pending_bo" ? C.yellow : C.subtle;
            const isEditable = canEdit && step.status === "upcoming" && step.stepId !== "expiry";
            return (
              <div key={step.stepId} style={{ display: "flex", gap: 12, marginBottom: isLast ? 0 : 16 }}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 32, flexShrink: 0 }}>
                  <div style={{ width: 32, height: 32, borderRadius: "50%", background: step.status === "done" ? C.green : C.bg, border: `2px solid ${sc}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13 }}>{step.status === "done" ? "✓" : tmpl.icon}</div>
                  {!isLast && <div style={{ width: 2, flex: 1, background: step.status === "done" ? C.green : C.borderLight, marginTop: 4, marginBottom: -8 }} />}
                </div>
                <div style={{ flex: 1, paddingBottom: isLast ? 0 : 6 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <div style={{ ...sans, fontSize: 13, fontWeight: 700, color: step.status === "done" ? C.green : step.status === "pending_bo" ? C.yellow : C.navy }}>{tmpl.label}</div>
                    <button onClick={() => isEditable && setEditingStep({ step, tmpl })} style={{ ...sans, fontSize: 11, color: isEditable ? C.accent : C.subtle, background: "none", border: "none", cursor: isEditable ? "pointer" : "default", padding: 0, fontWeight: step.modified ? 700 : 400 }}>
                      {step.modified ? "✏️ " : ""}{fmtDate(step.scheduledDate)}
                    </button>
                  </div>
                  {step.modified && <div style={{ ...sans, fontSize: 11, color: C.blue, marginTop: 2 }}>⏩ {step.modifiedReason}</div>}
                  {step.stepId === "bo_response" && step.boDecision && (
                    <div style={{ marginTop: 8, padding: "8px 12px", borderRadius: 8, background: BO_COLORS[step.boDecision]?.bg, border: `1px solid ${BO_COLORS[step.boDecision]?.color}` }}>
                      <div style={{ ...sans, fontSize: 11, color: C.subtle, marginBottom: 2 }}>Decisione BO · {step.boRespondedAt}</div>
                      <div style={{ ...sans, fontSize: 13, fontWeight: 700, color: BO_COLORS[step.boDecision]?.color }}>{step.boDecision}</div>
                      {step.boNotes && <div style={{ ...sans, fontSize: 12, color: C.text, marginTop: 4, fontStyle: "italic" }}>"{step.boNotes}"</div>}
                    </div>
                  )}
                  {step.stepId === "bo_notify" && step.status !== "done" && canEdit && <button onClick={() => onSendBO(contract.id)} style={{ ...sans, marginTop: 8, padding: "6px 12px", background: C.navy, border: "none", borderRadius: 6, color: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>✉️ Invia notifica BO</button>}
                  {step.stepId === "bo_notify" && step.status === "done" && canEdit && <button onClick={() => onOpenBOForm(contract)} style={{ ...sans, marginTop: 8, padding: "6px 12px", background: C.blue, border: "none", borderRadius: 6, color: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>📋 Simula risposta BO</button>}
                  {isEditable && step.stepId !== "bo_notify" && step.stepId !== "bo_response" && <button onClick={() => onCompleteStep(contract.id, step.stepId)} style={{ ...sans, marginTop: 8, padding: "5px 10px", background: "transparent", border: `1px solid ${C.border}`, borderRadius: 6, color: C.muted, cursor: "pointer", fontSize: 11 }}>✓ Completato</button>}
                  {step.completedBy && <div style={{ ...sans, fontSize: 11, color: C.subtle, marginTop: 4 }}>Da {step.completedBy} · {step.completedAt}</div>}
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
          <h4 style={{ ...font, margin: "0 0 12px", fontSize: 14, color: C.navy }}>📋 Audit Trail</h4>
          {[...audit].reverse().map((log, i) => (
            <div key={i} style={{ display: "flex", gap: 8, padding: "6px 0", borderBottom: i < audit.length - 1 ? `1px solid ${C.borderLight}` : "none" }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: C.accent, marginTop: 5, flexShrink: 0 }} />
              <div><div style={{ ...sans, fontSize: 12, fontWeight: 600 }}>{log.action}</div>{log.detail && <div style={{ ...sans, fontSize: 11, color: C.muted }}>{log.detail}</div>}<div style={{ ...sans, fontSize: 11, color: C.subtle }}>{log.user} · {log.ts}</div></div>
            </div>
          ))}
        </div>

        {editingStep && <StepDateEditor step={editingStep.step} tmpl={editingStep.tmpl} onSave={(d, r) => { onUpdateStepDate(contract.id, editingStep.step.stepId, d, r); setEditingStep(null); }} onClose={() => setEditingStep(null)} />}
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <div style={{ ...font, fontSize: 15, fontWeight: 700, color: C.navy }}>
          {currentUser.role === ROLES.MANAGER ? "Piano acquisti — tutto il team" : "Il mio piano acquisti"}
        </div>
        <div style={{ ...sans, fontSize: 12, color: C.muted }}>{sorted.length} contratti con scadenza entro 120 giorni</div>
      </div>
      {sorted.length === 0 && <p style={{ ...sans, color: C.muted, fontSize: 13 }}>Nessun contratto da pianificare nei prossimi 120 giorni.</p>}
      {sorted.map(c => {
        const plan = plans[c.id] || [];
        const prog = planProgress(plan);
        const next = plan.find(s => s.status !== "done" && s.stepId !== "expiry");
        const nextTmpl = next ? stepTemplate(next.stepId) : null;
        const days = daysToExpiry(c.end);
        const uColor = URGENCY_COLORS[urgency(c)];
        const bColor = userByName(c.owner)?.color || C.navy;
        const boStep = plan.find(s => s.stepId === "bo_response");
        return (
          <div key={c.id} onClick={() => setSelectedId(c.id)} style={{ background: C.card, border: `1px solid ${C.border}`, borderLeft: `3px solid ${uColor}`, borderRadius: 10, padding: 14, marginBottom: 10, cursor: "pointer" }}
            onMouseEnter={e => e.currentTarget.style.boxShadow = "0 4px 16px rgba(0,0,0,0.07)"}
            onMouseLeave={e => e.currentTarget.style.boxShadow = "none"}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 4 }}>
              <div style={{ ...sans, fontSize: 13, fontWeight: 700, color: C.navy, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.supplier}</div>
              <div style={{ ...sans, fontSize: 12, fontWeight: 700, color: uColor, flexShrink: 0 }}>{days < 0 ? "Scaduto" : `${days}gg`}</div>
            </div>
            <div style={{ ...sans, fontSize: 12, color: C.muted, marginBottom: 8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.object}</div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: bColor }} />
                <span style={{ ...sans, fontSize: 11, color: C.muted }}>{c.owner}</span>
                {plan.some(s => s.modified) && <span style={{ ...sans, fontSize: 10, color: C.blue, background: C.blueBg, borderRadius: 3, padding: "1px 5px" }}>✏️</span>}
              </div>
              <span style={{ ...sans, fontSize: 11, fontWeight: 600, color: C.navy }}>{prog}%</span>
            </div>
            <div style={{ height: 5, background: C.borderLight, borderRadius: 3, marginBottom: 8 }}><div style={{ height: "100%", width: `${prog}%`, background: uColor, borderRadius: 3 }} /></div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              {nextTmpl && <span style={{ ...sans, fontSize: 11, color: C.subtle }}>{nextTmpl.icon} {nextTmpl.label}</span>}
              {boStep?.boDecision && <span style={{ ...sans, fontSize: 11, fontWeight: 600, color: BO_COLORS[boStep.boDecision]?.color, background: BO_COLORS[boStep.boDecision]?.bg, borderRadius: 4, padding: "2px 6px" }}>BO: {boStep.boDecision}</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── TEAM VIEW (Manager only) ─────────────────────────────────
function TeamView({ contracts, plans, onApplySuggestion }: { contracts: Contract[]; plans: Plans; onApplySuggestion: (id: number, offset: number) => void }) {
  const [selectedBuyer, setSelectedBuyer] = useState("Tutti");
  const workload = useMemo(() => calcWorkload(contracts, plans), [contracts, plans]);
  const suggestions = useMemo(() => getSuggestions(contracts, plans), [contracts, plans]);
  const buyers = ["Tutti", ...new Set(contracts.filter(c => !c.ceased).map(c => c.owner).filter(Boolean))];
  const months = Object.entries(workload).slice(0, 10);
  const maxVal = Math.max(...months.map(([, m]) => m.total), 1);
  const filtered = useMemo(() => {
    const active = contracts.filter(c => !c.ceased);
    return selectedBuyer === "Tutti" ? active : active.filter(c => c.owner === selectedBuyer);
  }, [contracts, selectedBuyer]);

  return (
    <div>
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, marginBottom: 16 }}>
        <div style={{ ...font, fontSize: 14, fontWeight: 700, color: C.navy, marginBottom: 12 }}>Carico team per mese</div>
        <div style={{ display: "flex", gap: 6, alignItems: "flex-end", height: 90 }}>
          {months.map(([key, m]) => {
            const maxB = Math.max(...Object.values(m.byBuyer), 0);
            const isOver = maxB >= WORKLOAD_THRESHOLD * 2;
            const isHigh = maxB >= WORKLOAD_THRESHOLD;
            const bc = isOver ? C.red : isHigh ? C.yellow : C.green;
            const h = Math.max(4, (m.total / maxVal) * 72);
            return (
              <div key={key} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                {m.total > 0 && <div style={{ ...sans, fontSize: 8, color: isOver ? C.red : C.muted, fontWeight: isOver ? 700 : 400 }}>{m.total}</div>}
                <div style={{ width: "100%", height: `${h}px`, background: bc, borderRadius: "3px 3px 0 0", opacity: 0.85 }} />
                <div style={{ ...sans, fontSize: 8, color: C.muted, whiteSpace: "nowrap" }}>{m.label}</div>
              </div>
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
          {[["🟢", "OK"], ["🟡", "Alto"], ["🔴", "Critico"]].map(([e, l]) => <div key={l} style={{ display: "flex", alignItems: "center", gap: 3 }}><span style={{ fontSize: 10 }}>{e}</span><span style={{ ...sans, fontSize: 10, color: C.muted }}>{l}</span></div>)}
        </div>
      </div>

      {suggestions.length > 0 && (
        <div style={{ background: C.yellowBg, border: `1px solid #f0d080`, borderRadius: 12, padding: 14, marginBottom: 16 }}>
          <div style={{ ...font, fontSize: 14, fontWeight: 700, color: C.yellow, marginBottom: 10 }}>💡 {suggestions.length} suggerimento/i di anticipo</div>
          {suggestions.map(s => (
            <div key={s.contractId} style={{ background: "#fff", borderRadius: 8, padding: 12, marginBottom: 8 }}>
              <div style={{ ...sans, fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{s.supplier}</div>
              <div style={{ ...sans, fontSize: 12, color: C.muted, marginBottom: 8 }}>{s.reason}</div>
              <button onClick={() => onApplySuggestion(s.contractId, s.recommendedOffset)} style={{ ...sans, padding: "6px 14px", background: C.navy, border: "none", borderRadius: 6, color: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>⏩ Anticipa di {s.recommendedOffset}gg</button>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
        {buyers.map(b => { const u = userByName(b); const color = u?.color || C.navy; const sel = selectedBuyer === b; return (
          <button key={b} onClick={() => setSelectedBuyer(b)} style={{ ...sans, padding: "5px 10px", borderRadius: 20, border: `1px solid ${sel ? color : C.border}`, background: sel ? color : "transparent", color: sel ? "#fff" : C.muted, cursor: "pointer", fontSize: 11, fontWeight: 600 }}>{b}</button>
        ); })}
      </div>

      <div style={{ ...font, fontSize: 14, fontWeight: 700, color: C.navy, marginBottom: 10 }}>{selectedBuyer === "Tutti" ? "Tutti" : selectedBuyer} ({filtered.length})</div>
      {filtered.map(c => {
        const plan = plans[c.id] || [];
        const prog = planProgress(plan);
        const days = daysToExpiry(c.end);
        const uColor = URGENCY_COLORS[urgency(c)];
        const bColor = userByName(c.owner)?.color || C.navy;
        const boStep = plan.find(s => s.stepId === "bo_response");
        return (
          <div key={c.id} style={{ background: C.card, border: `1px solid ${C.border}`, borderLeft: `3px solid ${uColor}`, borderRadius: 10, padding: 14, marginBottom: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 4 }}>
              <div style={{ ...sans, fontSize: 13, fontWeight: 700, color: C.navy, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.supplier}</div>
              <div style={{ ...sans, fontSize: 12, fontWeight: 700, color: uColor, flexShrink: 0 }}>{days < 0 ? "Scaduto" : `${days}gg`}</div>
            </div>
            <div style={{ ...sans, fontSize: 12, color: C.muted, marginBottom: 8 }}>{c.object}</div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: bColor }} />
                <span style={{ ...sans, fontSize: 11, color: C.muted }}>{c.owner}</span>
              </div>
              <span style={{ ...sans, fontSize: 11, fontWeight: 600, color: C.navy }}>{prog}%</span>
            </div>
            <div style={{ height: 5, background: C.borderLight, borderRadius: 3 }}><div style={{ height: "100%", width: `${prog}%`, background: bColor, borderRadius: 3 }} /></div>
            {boStep?.boDecision && <div style={{ marginTop: 8 }}><span style={{ ...sans, fontSize: 11, fontWeight: 600, color: BO_COLORS[boStep.boDecision]?.color, background: BO_COLORS[boStep.boDecision]?.bg, borderRadius: 4, padding: "2px 8px" }}>BO: {boStep.boDecision}</span></div>}
          </div>
        );
      })}
    </div>
  );
}

// ─── DASHBOARD ────────────────────────────────────────────────
function Dashboard({ contracts, plans, currentUser, onNavigate }: { contracts: Contract[]; plans: Plans; currentUser: User; onNavigate: (v: View, c?: Contract) => void }) {
  const myContracts = currentUser.role === ROLES.BUYER ? contracts.filter(c => !c.ceased && c.owner === currentUser.name) : contracts.filter(c => !c.ceased);
  const totalEUR = myContracts.filter(c => c.currency === "EUR").reduce((a, c) => a + c.value, 0);
  const urgent = [...myContracts].filter(c => urgency(c) !== "green").sort((a, b) => daysToExpiry(a.end) - daysToExpiry(b.end)).slice(0, 4);
  const pendingBO = currentUser.role === ROLES.MANAGER ? myContracts.filter(c => (plans[c.id] || []).some(s => s.status === "pending_bo")).length : 0;
  const suggestions = currentUser.role === ROLES.MANAGER ? getSuggestions(contracts, plans) : [];

  return (
    <div>
      <div style={{ background: C.navy, borderRadius: 12, padding: 16, marginBottom: 20, display: "flex", alignItems: "center", gap: 12 }}>
        <Avatar user={currentUser} size={44} />
        <div>
          <div style={{ ...font, fontSize: 15, fontWeight: 700, color: "#fff" }}>{currentUser.name}</div>
          <div style={{ ...sans, fontSize: 12, color: "rgba(255,255,255,0.5)" }}>{currentUser.title}</div>
          <div style={{ marginTop: 4 }}><RoleBadge role={currentUser.role} /></div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 20 }}>
        <StatCard label={currentUser.role === ROLES.BUYER ? "Miei contratti" : "Contratti attivi"} value={myContracts.length} color={C.navy} />
        <StatCard label="Valore EUR" value={fmt(totalEUR)} color={C.accent} />
        <StatCard label="Urgenti/Scaduti" value={myContracts.filter(c => urgency(c) === "red").length} sub="azione richiesta" color={C.red} />
        {currentUser.role === ROLES.MANAGER
          ? <StatCard label="Attesa BO" value={pendingBO} sub="da completare" color={C.yellow} />
          : <StatCard label="In scadenza" value={myContracts.filter(c => urgency(c) === "yellow").length} sub="entro 90 giorni" color={C.yellow} />}
      </div>

      {suggestions.length > 0 && (
        <div style={{ background: C.yellowBg, border: `1px solid #f0d080`, borderRadius: 10, padding: 14, marginBottom: 14 }}>
          <div style={{ ...sans, fontSize: 12, color: C.yellow, fontWeight: 700, marginBottom: 4 }}>💡 {suggestions.length} suggerimento/i di anticipo</div>
          <button onClick={() => onNavigate("team")} style={{ ...sans, padding: "6px 14px", background: C.yellow, border: "none", borderRadius: 6, color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: 12 }}>Vedi vista team →</button>
        </div>
      )}

      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h3 style={{ ...font, margin: 0, fontSize: 15, color: C.navy }}>⚠️ Priorità immediate</h3>
          <button onClick={() => onNavigate("list")} style={{ ...sans, background: "none", border: "none", color: C.accent, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>Tutti →</button>
        </div>
        {urgent.length === 0 && <p style={{ ...sans, color: C.muted, fontSize: 13, margin: 0 }}>Nessuna urgenza ✅</p>}
        {urgent.map(c => { const days = daysToExpiry(c.end); const u = urgency(c); return (
          <div key={c.id} onClick={() => onNavigate("detail", c)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: `1px solid ${C.borderLight}`, cursor: "pointer" }}>
            <UrgencyDot level={u} size={9} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ ...sans, fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.supplier}</div>
              <div style={{ ...sans, fontSize: 11, color: C.muted }}>{c.owner}</div>
            </div>
            <div style={{ ...sans, fontSize: 12, fontWeight: 700, color: u === "red" ? C.red : C.yellow, flexShrink: 0 }}>{days < 0 ? "Scaduto" : `${days}gg`}</div>
          </div>
        ); })}
      </div>
    </div>
  );
}

// ─── CONTRACT LIST ────────────────────────────────────────────
function ContractList({ contracts, currentUser, onSelect, onNew }: { contracts: Contract[]; currentUser: User; onSelect: (c: Contract) => void; onNew: () => void }) {
  const [search, setSearch] = useState(""); const [filter, setFilter] = useState("Attivi"); const [showArchive, setShowArchive] = useState(false); const [sort, setSort] = useState("expiry");
  const base = useMemo(() => currentUser.role === ROLES.BUYER ? contracts.filter(c => c.owner === currentUser.name)
    : currentUser.role === ROLES.BO ? contracts.filter(c => c.boEmail === currentUser.email)
    : contracts, [contracts, currentUser]);
  const filtered = useMemo(() => {
    let list = showArchive ? base.filter(c => c.ceased) : base.filter(c => !c.ceased);
    if (search) list = list.filter(c => `${c.supplier} ${c.object} ${c.owner}`.toLowerCase().includes(search.toLowerCase()));
    if (!showArchive) { if (filter === "Urgenti") list = list.filter(c => urgency(c) === "red"); else if (filter === "In scadenza") list = list.filter(c => urgency(c) === "yellow"); else if (filter === "OK") list = list.filter(c => urgency(c) === "green"); }
    if (sort === "expiry") list.sort((a, b) => daysToExpiry(a.end) - daysToExpiry(b.end)); else if (sort === "value") list.sort((a, b) => b.value - a.value); else list.sort((a, b) => a.supplier.localeCompare(b.supplier));
    return list;
  }, [base, search, filter, sort, showArchive]);

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button onClick={() => setShowArchive(false)} style={{ ...sans, flex: 1, padding: "8px", borderRadius: 8, border: `1px solid ${!showArchive ? C.navy : C.border}`, background: !showArchive ? C.navy : "transparent", color: !showArchive ? "#fff" : C.muted, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>🟢 Attivi ({base.filter(c => !c.ceased).length})</button>
        <button onClick={() => setShowArchive(true)} style={{ ...sans, flex: 1, padding: "8px", borderRadius: 8, border: `1px solid ${showArchive ? C.gray : C.border}`, background: showArchive ? C.gray : "transparent", color: showArchive ? "#fff" : C.muted, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>⚫ Archivio ({base.filter(c => c.ceased).length})</button>
      </div>
      <div style={{ position: "relative", marginBottom: 10 }}>
        <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: C.subtle }}>🔍</span>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Cerca..." style={{ ...sans, width: "100%", boxSizing: "border-box", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 12px 10px 36px", fontSize: 14, color: C.text, outline: "none" }} />
      </div>
      {!showArchive && <div style={{ display: "flex", gap: 6, marginBottom: 10, overflowX: "auto" }}>{["Attivi", "Urgenti", "In scadenza", "OK"].map(s => <button key={s} onClick={() => setFilter(s)} style={{ ...sans, padding: "5px 10px", borderRadius: 20, border: `1px solid ${filter === s ? C.accent : C.border}`, background: filter === s ? C.accentLight : "transparent", color: filter === s ? C.accent : C.muted, cursor: "pointer", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap", flexShrink: 0 }}>{s}</button>)}</div>}
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
        <span style={{ ...sans, fontSize: 12, color: C.muted }}>{filtered.length} contratti</span>
        <select value={sort} onChange={e => setSort(e.target.value)} style={{ ...sans, background: "transparent", border: `1px solid ${C.border}`, borderRadius: 6, padding: "4px 8px", fontSize: 11, color: C.muted, outline: "none" }}>
          <option value="expiry">Per scadenza</option><option value="value">Per valore</option><option value="supplier">Per fornitore</option>
        </select>
      </div>
      {filtered.map(c => {
        const days = daysToExpiry(c.end); const lc = URGENCY_COLORS[urgency(c)];
        return (
          <div key={c.id} onClick={() => onSelect(c)} style={{ background: C.card, border: `1px solid ${C.border}`, borderLeft: `3px solid ${lc}`, borderRadius: 10, padding: 14, marginBottom: 8, cursor: "pointer", opacity: c.ceased ? 0.7 : 1 }}
            onMouseEnter={e => e.currentTarget.style.boxShadow = "0 4px 16px rgba(0,0,0,0.07)"}
            onMouseLeave={e => e.currentTarget.style.boxShadow = "none"}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <div style={{ ...sans, fontSize: 13, fontWeight: 700, color: C.navy, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.supplier}</div>
              <div style={{ ...sans, fontSize: 13, fontWeight: 700, flexShrink: 0 }}>{fmt(c.value, c.currency)}</div>
            </div>
            <div style={{ ...sans, fontSize: 12, color: C.muted, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.object}</div>
            <div style={{ display: "flex", gap: 6, marginTop: 8, alignItems: "center" }}>
              {c.ceased ? <span style={{ ...sans, fontSize: 11, color: C.gray, background: C.grayBg, borderRadius: 4, padding: "2px 8px", fontWeight: 600 }}>⚫ Cessato</span> : <RenewalBadge status={c.renewal} />}
              <span style={{ ...sans, fontSize: 11, marginLeft: "auto", color: lc, fontWeight: 600 }}>{c.ceased ? fmtDate(c.end) : days < 0 ? "Scaduto" : days <= 90 ? `${days}gg` : fmtDate(c.end)}</span>
            </div>
            {currentUser.role === ROLES.MANAGER && <div style={{ ...sans, fontSize: 11, color: C.subtle, marginTop: 4 }}>Owner: {c.owner || "—"}</div>}
          </div>
        );
      })}
      {!showArchive && currentUser.role !== ROLES.BO && <button onClick={onNew} style={{ position: "fixed", bottom: 90, right: 20, width: 52, height: 52, borderRadius: "50%", background: C.accent, border: "none", color: "#fff", fontSize: 24, cursor: "pointer", boxShadow: "0 4px 16px rgba(200,82,42,0.4)", zIndex: 50 }}>+</button>}
    </div>
  );
}

// ─── CONTRACT DETAIL ──────────────────────────────────────────
function ContractDetail({ contract, auditLog, currentUser, onBack, onEdit }: { contract: Contract; auditLog: AuditEntry[]; currentUser: User; onBack: () => void; onEdit: () => void }) {
  const u = urgency(contract); const days = daysToExpiry(contract.end);
  const startMs = new Date(contract.start).getTime(), endMs = new Date(contract.end).getTime();
  const prog = contract.start && endMs > startMs ? Math.min(100, Math.max(0, ((NOW.getTime() - startMs) / (endMs - startMs)) * 100)) : 0;
  const uc = URGENCY_COLORS[u];
  const canEdit = currentUser.role === ROLES.MANAGER || contract.owner === currentUser.name;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14 }}>
        <button onClick={onBack} style={{ ...sans, background: "none", border: "none", color: C.accent, cursor: "pointer", fontSize: 13, fontWeight: 600, padding: 0 }}>← Lista</button>
        {canEdit && <button onClick={onEdit} style={{ ...sans, background: C.navy, border: "none", borderRadius: 6, color: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 600, padding: "6px 14px" }}>✏️ Modifica</button>}
      </div>
      <div style={{ background: contract.ceased ? C.gray : C.navy, borderRadius: 14, padding: 20, marginBottom: 14, color: "#fff" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
          <div><div style={{ ...font, fontSize: 17, fontWeight: 700 }}>{contract.supplier}</div><div style={{ ...sans, fontSize: 11, color: "rgba(255,255,255,0.5)", marginTop: 2 }}>{contract.country}</div></div>
          <div style={{ background: uc, borderRadius: 20, padding: "3px 10px", fontSize: 11, fontWeight: 700, ...sans, color: "#fff", height: "fit-content" }}>{contract.ceased ? "Cessato" : days < 0 ? "Scaduto" : days <= 30 ? "Urgente" : days <= 90 ? "In scadenza" : "Regolare"}</div>
        </div>
        <div style={{ ...sans, fontSize: 13, color: "rgba(255,255,255,0.65)", marginBottom: 14 }}>{contract.object}</div>
        <div style={{ ...font, fontSize: 24, fontWeight: 700 }}>{fmt(contract.value, contract.currency)}</div>
      </div>
      {!contract.ceased && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, marginBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <span style={{ ...sans, fontSize: 11, color: C.muted }}>{contract.start ? fmtDate(contract.start) : "—"}</span>
            <span style={{ ...sans, fontSize: 11, color: C.muted }}>{fmtDate(contract.end)}</span>
          </div>
          <div style={{ height: 8, background: C.borderLight, borderRadius: 4 }}><div style={{ height: "100%", width: `${prog}%`, background: uc, borderRadius: 4 }} /></div>
          <div style={{ ...sans, fontSize: 12, color: C.muted, marginTop: 8, textAlign: "center" }}>{days < 0 ? <b style={{ color: C.red }}>Scaduto da {Math.abs(days)} giorni</b> : <span>Scade tra <b style={{ color: uc }}>{days} giorni</b></span>}</div>
        </div>
      )}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, marginBottom: 12 }}>
        {[["Categoria", contract.category || "—"], ["Tipo", contract.type || "—"], ["Owner", contract.owner || "—"], ["BO Email", contract.boEmail || "—"], ["Rinnovo", contract.renewal]].map(([k, v]) => (
          <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: `1px solid ${C.borderLight}` }}>
            <span style={{ ...sans, fontSize: 13, color: C.muted }}>{k}</span>
            <span style={{ ...sans, fontSize: 13, fontWeight: 500 }}>{v}</span>
          </div>
        ))}
      </div>
      {contract.fileName && <div style={{ background: C.greenBg, border: `1px solid ${C.green}`, borderRadius: 10, padding: 14, marginBottom: 12, display: "flex", alignItems: "center", gap: 10 }}>📄<div style={{ ...sans, fontSize: 13, fontWeight: 600, color: C.green }}>{contract.fileName}</div></div>}
      {contract.notes && <div style={{ background: C.yellowBg, border: `1px solid #f0d080`, borderRadius: 10, padding: 14, marginBottom: 12 }}><div style={{ ...sans, fontSize: 11, color: C.yellow, fontWeight: 700, marginBottom: 4 }}>📝 NOTE</div><div style={{ ...sans, fontSize: 13 }}>{contract.notes}</div></div>}
      {auditLog.length > 0 && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
          <h4 style={{ ...font, margin: "0 0 10px", fontSize: 14, color: C.navy }}>📋 Audit Trail</h4>
          {[...auditLog].reverse().map((log, i) => (
            <div key={i} style={{ display: "flex", gap: 8, padding: "6px 0", borderBottom: i < auditLog.length - 1 ? `1px solid ${C.borderLight}` : "none" }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: C.accent, marginTop: 5, flexShrink: 0 }} />
              <div><div style={{ ...sans, fontSize: 12, fontWeight: 600 }}>{log.action}</div>{log.detail && <div style={{ ...sans, fontSize: 11, color: C.muted }}>{log.detail}</div>}<div style={{ ...sans, fontSize: 11, color: C.subtle }}>{log.user} · {log.ts}</div></div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── ALERTS VIEW ─────────────────────────────────────────────
function AlertsView({ contracts, currentUser }: { contracts: Contract[]; currentUser: User }) {
  const mine = currentUser.role === ROLES.BUYER ? contracts.filter(c => c.owner === currentUser.name) : contracts;
  const alerts = mine.filter(c => !c.ceased && daysToExpiry(c.end) >= 0 && daysToExpiry(c.end) <= 90).sort((a, b) => daysToExpiry(a.end) - daysToExpiry(b.end));
  return (
    <div>
      <div style={{ background: C.blueBg, border: `1px solid #c0d8f5`, borderRadius: 10, padding: 14, marginBottom: 16 }}>
        <div style={{ ...sans, fontSize: 12, color: C.blue, fontWeight: 700, marginBottom: 4 }}>ℹ️ Notifiche simulate</div>
        <div style={{ ...sans, fontSize: 12, color: C.blue }}>In produzione inviate automaticamente con Azure AD.</div>
      </div>
      {alerts.length === 0 && <p style={{ ...sans, color: C.muted, fontSize: 13 }}>Nessun contratto in scadenza nei prossimi 90 giorni ✅</p>}
      {alerts.map(c => { const days = daysToExpiry(c.end); return (
        <div key={c.id} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16, marginBottom: 10 }}>
          <div style={{ ...sans, fontSize: 11, color: C.subtle, marginBottom: 6 }}>A: <b>{userByName(c.owner)?.email || c.owner || "—"}</b></div>
          <div style={{ ...sans, fontSize: 13, fontWeight: 600, marginBottom: 8 }}>⚠️ Scadenza: {c.supplier}</div>
          <div style={{ ...sans, fontSize: 12, color: C.muted, background: C.bg, borderRadius: 6, padding: 10, lineHeight: 1.6 }}>Scade il <b>{fmtDate(c.end)}</b> — tra <b style={{ color: days <= 30 ? C.red : C.yellow }}>{days} giorni</b>. Stato: <b>{c.renewal}</b>.</div>
        </div>
      ); })}
    </div>
  );
}

// ─── APP ─────────────────────────────────────────────────────
type Mode = "loading" | "api" | "local";
const demoState = (): AppState => ({ contracts: MOCK_CONTRACTS, plans: initialPlans(), auditLogs: initialAudit() });

export default function App() {
  const [mode, setMode] = useState<Mode>("loading");
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [view, setView] = useState<View>("dashboard");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [plans, setPlans] = useState<Plans>({});
  const [auditLogs, setAuditLogs] = useState<AuditLogs>({});
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [showForm, setShowForm] = useState(false);
  const [editingContract, setEditingContract] = useState<Contract | null>(null);
  const [boFormContract, setBOFormContract] = useState<Contract | null>(null);

  // Il dettaglio legge sempre la versione aggiornata del contratto (es. dopo una risposta BO).
  const selected = selectedId !== null ? contracts.find(c => c.id === selectedId) ?? null : null;

  const applyState = (st: AppState) => { setContracts(st.contracts); setPlans(st.plans); setAuditLogs(st.auditLogs); };

  // Caricamento iniziale: dal database se disponibile, altrimenti dati locali del browser.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        let st = await api.loadState();
        if (st.contracts.length === 0) { await api.seed(demoState()); st = await api.loadState(); }
        if (!cancelled) { applyState(st); setMode("api"); }
      } catch {
        if (!cancelled) { applyState(loadLocal() ?? demoState()); setMode("local"); }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Con più utenti sul database, ricarica i dati quando si torna sulla scheda.
  useEffect(() => {
    if (mode !== "api") return;
    const refresh = () => { if (document.visibilityState === "visible") api.loadState().then(applyState).catch(() => undefined); };
    document.addEventListener("visibilitychange", refresh);
    return () => document.removeEventListener("visibilitychange", refresh);
  }, [mode]);

  useEffect(() => { if (mode === "local") saveLocal({ contracts, plans, auditLogs }); }, [mode, contracts, plans, auditLogs]);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const showToast = (msg: string) => { clearTimeout(toastTimer.current); setToast(msg); toastTimer.current = setTimeout(() => setToast(null), 3000); };
  const entry = (action: string, detail: string, user?: string): AuditEntry => ({ ts: tsNow(), user: user || currentUser?.name || "Sistema", action, detail });
  const pushAudit = (id: number, entries: AuditEntry[]) => setAuditLogs(prev => ({ ...prev, [id]: [...(prev[id] || []), ...entries] }));

  // Salva sul database (no-op in modalità locale). Se fallisce ricarica lo stato dal server per annullare le modifiche ottimistiche.
  const persist = async (payload: CommitPayload): Promise<{ ok: boolean; contractId?: number }> => {
    if (mode !== "api") return { ok: true };
    try { return { ok: true, contractId: (await api.commit(payload)).contractId }; }
    catch {
      showToast("⚠️ Salvataggio non riuscito: dati ricaricati dal server");
      api.loadState().then(applyState).catch(() => undefined);
      return { ok: false };
    }
  };

  const handleLogin = (user: User) => { setCurrentUser(user); setView(user.role === ROLES.BO ? "bo" : "dashboard"); };
  const handleLogout = () => { setCurrentUser(null); setView("dashboard"); setSelectedId(null); };
  const handleResetDemo = () => {
    clearLocal();
    applyState(demoState());
    showToast("↺ Dati demo ripristinati");
  };
  const openDetail = (c: Contract) => { setSelectedId(c.id); setView("detail"); };

  const handleSave = async (data: ContractData) => {
    if (!currentUser) return;
    if (editingContract) {
      const id = editingContract.id;
      const audit = [entry("Contratto modificato", `Da ${currentUser.name}`)];
      let plan: PlanStep[] | undefined;
      if (data.end !== editingContract.end) {
        plan = reschedulePlan(plans[id] || [], id, data.end);
        audit.push(entry("Piano ricalcolato", `Nuova scadenza: ${fmtDate(data.end)}`, "Sistema"));
      }
      const res = await persist({ contract: { ...data, id }, plan, audit });
      if (!res.ok) return;
      setContracts(cs => cs.map(c => c.id === id ? { ...c, ...data } : c));
      if (plan) setPlans(p => ({ ...p, [id]: plan }));
      pushAudit(id, audit);
      showToast("💾 Aggiornato");
    } else {
      const audit = [entry("Contratto creato", `${data.supplier} · ${data.object}`)];
      const plan = makePlan(0, data.end);
      const res = await persist({ contract: data, plan, audit });
      if (!res.ok) return;
      const newId = res.contractId ?? Math.max(...contracts.map(c => c.id), 0) + 1;
      setContracts(cs => [...cs, { ...data, id: newId }]);
      setPlans(p => ({ ...p, [newId]: plan.map(st => ({ ...st, contractId: newId })) }));
      pushAudit(newId, audit);
      showToast("✅ Contratto aggiunto");
    }
    setShowForm(false); setEditingContract(null);
  };

  const updatePlan = async (id: number, plan: PlanStep[], audit: AuditEntry[], contract?: Contract) => {
    const res = await persist({ contractId: id, contract, plan, audit });
    if (!res.ok) return false;
    setPlans(p => ({ ...p, [id]: plan }));
    if (contract) setContracts(cs => cs.map(c => c.id === id ? contract : c));
    pushAudit(id, audit);
    return true;
  };

  const handleSendBO = async (id: number) => {
    const c = contracts.find(x => x.id === id);
    if (!c) return;
    const plan = (plans[id] || []).map(s => s.stepId === "bo_notify" ? { ...s, status: "done" as const, completedAt: fmtDate(new Date()), completedBy: "Sistema" } : s.stepId === "bo_response" ? { ...s, status: "pending_bo" as const } : s);
    if (await updatePlan(id, plan, [entry("Notifica BO inviata", `A: ${c.boEmail || "—"}`, "Sistema")]))
      showToast(c.boEmail ? `✉️ Notifica inviata a ${c.boEmail}` : "⚠️ Nessuna email BO impostata per questo contratto");
  };

  const handleBOResponse = async (id: number, { decision, notes }: { decision: string; notes: string }) => {
    const c = contracts.find(x => x.id === id);
    if (!c) return;
    const boUser = userByEmail(c.boEmail);
    const plan = (plans[id] || []).map(s => s.stepId === "bo_response" ? { ...s, status: "done" as const, completedAt: fmtDate(new Date()), completedBy: c.boEmail, boDecision: decision, boNotes: notes, boRespondedAt: fmtDate(new Date()) } : s);
    const rm: Record<string, string> = { "Rinnovare alle stesse condizioni": "Rinnovo automatico", "Rinnovare con rinegoziazione": "In negoziazione", "Mettere in gara (RFQ/RFP)": "Da rilanciare a gara", "Prorogare temporaneamente": "In negoziazione", "Cessare l'attività": "Da rescindere" };
    const updated = rm[decision] ? { ...c, renewal: rm[decision] } : c;
    const audit = [entry("Risposta BO ricevuta", `Decisione: ${decision}${notes ? ` · "${notes}"` : ""}`, boUser?.name || c.boEmail)];
    if (await updatePlan(id, plan, audit, updated)) showToast("✅ Decisione BO registrata");
    setBOFormContract(null);
  };

  const handleCompleteStep = async (id: number, stepId: string) => {
    if (!currentUser) return;
    const tmpl = stepTemplate(stepId);
    const plan = (plans[id] || []).map(s => s.stepId === stepId ? { ...s, status: "done" as const, completedAt: fmtDate(new Date()), completedBy: currentUser.name } : s);
    if (await updatePlan(id, plan, [entry(`Attività completata: ${tmpl.label}`, `Da ${currentUser.name}`)])) showToast(`✓ "${tmpl.label}" completata`);
  };

  const handleUpdateStepDate = async (id: number, stepId: string, newDate: string, reason: string) => {
    const tmpl = stepTemplate(stepId);
    const plan = (plans[id] || []).map(s => s.stepId === stepId ? { ...s, scheduledDate: newDate, modified: true, modifiedReason: reason } : s);
    if (await updatePlan(id, plan, [entry(`Data modificata: ${tmpl.label}`, `Nuova data: ${fmtDate(newDate)} · Motivo: ${reason}`)])) showToast("📅 Data aggiornata");
  };

  const handleApplySuggestion = async (id: number, offset: number) => {
    const c = contracts.find(x => x.id === id);
    if (!c) return;
    if (await updatePlan(id, makePlan(id, c.end, offset), [entry("Piano anticipato", `Anticipo di ${offset} giorni`, "Sistema")])) showToast(`⏩ Piano anticipato di ${offset} giorni`);
  };

  const toastEl = toast && (
    <div role="status" style={{ position: "fixed", top: 80, left: "50%", transform: "translateX(-50%)", background: C.navy, color: "#fff", padding: "11px 22px", borderRadius: 24, fontWeight: 600, fontSize: 13, zIndex: 400, boxShadow: "0 4px 20px rgba(0,0,0,0.2)", ...sans, whiteSpace: "nowrap" }}>
      {toast}
    </div>
  );

  if (mode === "loading") return <div style={{ ...sans, minHeight: "100vh", background: C.navy, color: "rgba(255,255,255,0.6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>Caricamento…</div>;

  if (!currentUser) return <><LoginScreen onLogin={handleLogin} onResetDemo={mode === "local" ? handleResetDemo : undefined} />{toastEl}</>;

  // Nav by role
  const navByRole: Record<Role, { key: View; icon: string; label: string }[]> = {
    [ROLES.MANAGER]: [
      { key: "dashboard", icon: "◈", label: "Overview" },
      { key: "list",      icon: "≡",  label: "Contratti" },
      { key: "planning",  icon: "▦",  label: "Piano" },
      { key: "team",      icon: "👥",  label: "Team" },
      { key: "notifiche", icon: "✉",  label: "Alert" },
    ],
    [ROLES.BUYER]: [
      { key: "dashboard", icon: "◈", label: "Overview" },
      { key: "list",      icon: "≡",  label: "Contratti" },
      { key: "planning",  icon: "▦",  label: "Piano" },
      { key: "notifiche", icon: "✉",  label: "Alert" },
    ],
    [ROLES.BO]: [
      { key: "bo",        icon: "📋", label: "Richieste" },
      { key: "list",      icon: "≡",  label: "Contratti" },
    ],
  };
  const navItems = navByRole[currentUser.role];
  const titles: Record<View, string> = { dashboard: "Overview", list: "Contratti", planning: currentUser.role === ROLES.MANAGER ? "Piano — Team" : "Il mio piano", team: "Vista Team", notifiche: "Alert Email", bo: "Le mie richieste", detail: selected?.supplier ?? "" };

  return (
    <div style={{ ...sans, background: C.bg, minHeight: "100vh", color: C.text }}>
      {/* Header */}
      <div style={{ background: C.navy, padding: "12px 16px", position: "sticky", top: 0, zIndex: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {view === "detail" && <button onClick={() => setView("list")} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.6)", cursor: "pointer", fontSize: 18, padding: 0, flexShrink: 0 }}>←</button>}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ ...font, fontSize: 9, color: "rgba(255,255,255,0.4)", letterSpacing: "0.1em", textTransform: "uppercase" }}>Prometeon · {ROLE_LABELS[currentUser.role]}</div>
            <div style={{ ...font, fontSize: 15, color: "#fff", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{titles[view]}</div>
          </div>
          {/* Avatar + logout */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {currentUser.role !== ROLES.BO && (
              <button onClick={() => { setEditingContract(null); setShowForm(true); }} style={{ ...sans, background: C.green, border: "none", borderRadius: 6, color: "#fff", cursor: "pointer", fontSize: 11, padding: "5px 9px", fontWeight: 600, flexShrink: 0 }}>➕</button>
            )}
            <button onClick={handleLogout} title="Logout" style={{ background: "none", border: "none", cursor: "pointer", flexShrink: 0 }}>
              <Avatar user={currentUser} size={30} />
            </button>
          </div>
        </div>
      </div>

      {mode === "local" && (
        <div style={{ ...sans, background: C.yellowBg, color: C.yellow, fontSize: 11, fontWeight: 600, textAlign: "center", padding: "6px 12px" }}>
          ⚠️ Database non raggiungibile: i dati sono salvati solo in questo browser
        </div>
      )}

      {/* Content */}
      <div style={{ padding: "18px 16px", maxWidth: 480, margin: "0 auto", paddingBottom: 90 }}>
        {view === "dashboard" && <Dashboard contracts={contracts} plans={plans} currentUser={currentUser} onNavigate={(v, c) => { setView(v); if (c) setSelectedId(c.id); }} />}
        {view === "list" && <ContractList contracts={contracts} currentUser={currentUser} onSelect={openDetail} onNew={() => { setEditingContract(null); setShowForm(true); }} />}
        {view === "planning" && <PlanningView contracts={contracts} plans={plans} auditLogs={auditLogs} currentUser={currentUser} onSendBO={handleSendBO} onCompleteStep={handleCompleteStep} onOpenBOForm={setBOFormContract} onUpdateStepDate={handleUpdateStepDate} />}
        {view === "team" && currentUser.role === ROLES.MANAGER && <TeamView contracts={contracts} plans={plans} onApplySuggestion={handleApplySuggestion} />}
        {view === "bo" && currentUser.role === ROLES.BO && <BOView contracts={contracts} plans={plans} currentUser={currentUser} onOpenBOForm={setBOFormContract} />}
        {view === "notifiche" && <AlertsView contracts={contracts} currentUser={currentUser} />}
        {view === "detail" && selected && <ContractDetail contract={selected} auditLog={auditLogs[selected.id] || []} currentUser={currentUser} onBack={() => setView("list")} onEdit={() => { setEditingContract(selected); setShowForm(true); }} />}
      </div>

      {/* Bottom nav */}
      {view !== "detail" && (
        <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: C.surface, borderTop: `1px solid ${C.border}`, display: "flex", padding: "8px 0 18px", boxShadow: "0 -4px 20px rgba(0,0,0,0.06)" }}>
          {navItems.map(n => (
            <button key={n.key} onClick={() => setView(n.key)} style={{ flex: 1, background: "none", border: "none", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
              <span style={{ fontSize: 16, color: view === n.key ? C.accent : C.subtle }}>{n.icon}</span>
              <span style={{ ...sans, fontSize: 9, color: view === n.key ? C.accent : C.muted, fontWeight: view === n.key ? 700 : 400 }}>{n.label}</span>
              {view === n.key && <div style={{ width: 16, height: 2, background: C.accent, borderRadius: 2 }} />}
            </button>
          ))}
        </div>
      )}

      {showForm && <ContractForm initial={editingContract} currentUser={currentUser} onSave={handleSave} onClose={() => { setShowForm(false); setEditingContract(null); }} />}
      {boFormContract && <BOFormModal contract={boFormContract} currentUser={currentUser} onSubmit={handleBOResponse} onClose={() => setBOFormContract(null)} />}

      {toastEl}
    </div>
  );
}