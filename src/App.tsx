import { useState, useMemo, useRef } from "react";

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
const font = { fontFamily: "'Georgia','Times New Roman',serif" };
const sans = { fontFamily: "'Helvetica Neue','Arial',sans-serif" };
const iStyle = { fontFamily: "'Helvetica Neue','Arial',sans-serif", width: "100%", boxSizing: "border-box", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: "9px 12px", fontSize: 14, color: C.text, outline: "none" };

// ─── USERS & ROLES ───────────────────────────────────────────
const ROLES = { MANAGER: "manager", BUYER: "buyer", BO: "bo" };

const USERS = [
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

const ROLE_LABELS = { manager: "Manager", buyer: "Buyer", bo: "Business Owner" };
const ROLE_COLORS = { manager: C.accent, buyer: C.blue, bo: C.green };

// ─── PLANNING ────────────────────────────────────────────────
const PLANNING_STEPS = [
  { id: "analysis",    daysBeforeEnd: 90, icon: "📊", label: "Analisi spend",           actor: "buyer"  },
  { id: "bo_notify",   daysBeforeEnd: 75, icon: "✉️",  label: "Notifica Business Owner", actor: "system" },
  { id: "bo_response", daysBeforeEnd: 60, icon: "📋",  label: "Risposta Business Owner", actor: "bo"     },
  { id: "action",      daysBeforeEnd: 45, icon: "🎯",  label: "Avvio azione",            actor: "buyer"  },
  { id: "negotiation", daysBeforeEnd: 30, icon: "🤝",  label: "Negoziazione",            actor: "buyer"  },
  { id: "signature",   daysBeforeEnd: 15, icon: "✍️",  label: "Firma / formalizzazione", actor: "buyer"  },
  { id: "expiry",      daysBeforeEnd: 0,  icon: "🏁",  label: "Scadenza",                actor: "system" },
];

const BO_DECISIONS = ["Rinnovare alle stesse condizioni", "Rinnovare con rinegoziazione", "Mettere in gara (RFQ/RFP)", "Prorogare temporaneamente", "Cessare l'attività"];
const BO_COLORS = {
  "Rinnovare alle stesse condizioni": { bg: C.greenBg,  color: C.green  },
  "Rinnovare con rinegoziazione":     { bg: C.blueBg,   color: C.blue   },
  "Mettere in gara (RFQ/RFP)":        { bg: C.yellowBg, color: C.yellow },
  "Prorogare temporaneamente":         { bg: C.purpleBg, color: C.purple },
  "Cessare l'attività":                { bg: C.redBg,    color: C.red    },
};

const WORKLOAD_THRESHOLD = 3;
const NOW = new Date();

// ─── HELPERS ─────────────────────────────────────────────────
function daysToExpiry(end) { return Math.ceil((new Date(end) - NOW) / 864e5); }
function urgency(c) { if (c.ceased) return "gray"; const d = daysToExpiry(c.end); return d < 0 ? "red" : d <= 30 ? "red" : d <= 90 ? "yellow" : "green"; }
function fmt(n, cur = "EUR") { try { return new Intl.NumberFormat("it-IT", { style: "currency", currency: cur, maximumFractionDigits: 0 }).format(n); } catch { return `${n} ${cur}`; } }
function fmtDate(d) { return new Date(d).toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" }); }
function fmtMonth(d) { return new Date(d).toLocaleDateString("it-IT", { month: "short", year: "2-digit" }); }
function addDays(date, days) { const d = new Date(date); d.setDate(d.getDate() + days); return d; }
function tsNow() { return NOW.toLocaleString("it-IT"); }
function userByEmail(email) { return USERS.find(u => u.email === email); }

function makePlan(contractId, end, offsetDays = 0) {
  const endDate = new Date(end);
  return PLANNING_STEPS.map(s => {
    const scheduled = addDays(endDate, -(s.daysBeforeEnd + offsetDays));
    const isPast = scheduled < NOW;
    return { contractId, stepId: s.id, scheduledDate: scheduled.toISOString().slice(0, 10), originalDate: scheduled.toISOString().slice(0, 10), status: isPast ? (s.id === "bo_response" ? "pending_bo" : "done") : "upcoming", completedAt: isPast && s.id !== "bo_response" ? fmtDate(scheduled) : null, completedBy: isPast && s.id !== "bo_response" ? (s.actor === "system" ? "Sistema" : "Buyer") : null, boDecision: null, boNotes: "", boRespondedAt: null, modified: false, modifiedReason: "" };
  });
}

// ─── MOCK DATA ────────────────────────────────────────────────
const MOCK_CONTRACTS = [
  { id: 1,  supplier: "Mesnac Co. Ltd",      object: "Macchinari - Linea Egitto",  category: "Capex",    country: "Cina",     value: 2400000, currency: "EUR", start: "2024-03-01", end: "2025-06-30", owner: "Andrea Lizza",      boEmail: "ops@prometeon.com",   renewal: "Da rilanciare a gara", type: "Fornitura", notes: "", ceased: false, fileName: "mesnac.pdf" },
  { id: 2,  supplier: "Deloitte Consulting", object: "SAP S/4HANA",               category: "IT",       country: "Italia",   value: 850000,  currency: "EUR", start: "2024-01-01", end: "2025-12-31", owner: "Salvatore",         boEmail: "it@prometeon.com",    renewal: "In negoziazione",      type: "Servizi",  notes: "", ceased: false, fileName: null },
  { id: 3,  supplier: "DHL Supply Chain",    object: "Logistica outbound Europa", category: "Logistica",country: "Germania", value: 320000,  currency: "EUR", start: "2023-07-01", end: "2025-12-31", owner: "Teresa Mingione",   boEmail: "supply@prometeon.com",renewal: "In negoziazione",      type: "Servizi",  notes: "", ceased: false, fileName: "dhl.pdf" },
  { id: 4,  supplier: "Oracle Italia Srl",   object: "Licenze database AMS",      category: "ICT",      country: "Italia",   value: 180000,  currency: "EUR", start: "2022-01-01", end: "2025-12-31", owner: "Marzia",            boEmail: "it@prometeon.com",    renewal: "Da rescindere",        type: "AMS",      notes: "", ceased: false, fileName: null },
  { id: 5,  supplier: "Aeolus Tyre Co.",     object: "Raw materials supply",      category: "Mat.Prime",country: "Cina",     value: 5600000, currency: "USD", start: "2024-06-01", end: "2026-05-31", owner: "Harris Xia",        boEmail: "ops@prometeon.com",   renewal: "Rinnovo automatico",   type: "Fornitura",notes: "", ceased: false, fileName: "aeolus.pdf" },
  { id: 6,  supplier: "Securitas Italia",    object: "Vigilanza stabilimenti",    category: "Facility", country: "Italia",   value: 95000,   currency: "EUR", start: "2021-01-01", end: "2025-12-31", owner: "Rafael Latorre Jr.",boEmail: "fac@prometeon.com",   renewal: "Da rilanciare a gara", type: "Servizi",  notes: "", ceased: false, fileName: null },
  { id: 7,  supplier: "Microsoft Azure",     object: "Cloud & M365",              category: "ICT",      country: "USA",      value: 240000,  currency: "EUR", start: "2024-01-01", end: "2026-12-31", owner: "Marzia",            boEmail: "it@prometeon.com",    renewal: "Rinnovo automatico",   type: "SaaS",     notes: "", ceased: false, fileName: null },
  { id: 8,  supplier: "Manpower Group",      object: "Somministrazione lavoro",   category: "HR",       country: "Italia",   value: 410000,  currency: "EUR", start: "2024-04-01", end: "2025-12-31", owner: "Teresa Mingione",   boEmail: "hr@prometeon.com",    renewal: "In negoziazione",      type: "Servizi",  notes: "", ceased: false, fileName: null },
  { id: 9,  supplier: "Randstad Italia",     object: "Ricerca & selezione",       category: "HR",       country: "Italia",   value: 85000,   currency: "EUR", start: "2024-01-01", end: "2025-12-31", owner: "Teresa Mingione",   boEmail: "hr@prometeon.com",    renewal: "In negoziazione",      type: "Servizi",  notes: "", ceased: false, fileName: null },
  { id: 10, supplier: "IBM Italia",          object: "Manutenzione server legacy",category: "ICT",      country: "Italia",   value: 120000,  currency: "EUR", start: "2023-01-01", end: "2025-12-31", owner: "Marzia",            boEmail: "it@prometeon.com",    renewal: "Da rescindere",        type: "AMS",      notes: "", ceased: false, fileName: null },
];

const INIT_PLANS = {};
MOCK_CONTRACTS.forEach(c => { INIT_PLANS[c.id] = makePlan(c.id, c.end); });
const INIT_AUDIT = {};
MOCK_CONTRACTS.forEach(c => { INIT_AUDIT[c.id] = [{ ts: "01 gen 2025, 09:00", user: c.owner, action: "Contratto creato", detail: `${c.supplier} · ${c.object}` }]; });

// ─── SMALL COMPONENTS ────────────────────────────────────────
function UrgencyDot({ level, size = 8 }) {
  return <span style={{ display: "inline-block", width: size, height: size, borderRadius: "50%", background: { green: C.green, yellow: C.yellow, red: C.red, gray: "#9ca3af" }[level] || C.muted, flexShrink: 0 }} />;
}
function RenewalBadge({ status }) {
  const map = { "In negoziazione": { bg: C.blueBg, color: C.blue }, "Rinnovo automatico": { bg: C.greenBg, color: C.green }, "Da rescindere": { bg: C.redBg, color: C.red }, "Da rilanciare a gara": { bg: C.yellowBg, color: C.yellow }, "Non definito": { bg: "#f0ece4", color: C.muted } };
  const s = map[status] || map["Non definito"];
  return <span style={{ ...sans, background: s.bg, color: s.color, borderRadius: 4, padding: "2px 8px", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap" }}>{status || "Non definito"}</span>;
}
function Avatar({ user, size = 36 }) {
  return <div style={{ width: size, height: size, borderRadius: "50%", background: user.color, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.35, fontWeight: 700, flexShrink: 0, ...sans }}>{user.avatar}</div>;
}
function RoleBadge({ role }) {
  return <span style={{ ...sans, background: `${ROLE_COLORS[role]}20`, color: ROLE_COLORS[role], borderRadius: 4, padding: "2px 8px", fontSize: 11, fontWeight: 700 }}>{ROLE_LABELS[role]}</span>;
}
function StatCard({ label, value, sub, color = C.accent }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "16px 18px", flex: 1 }}>
      <div style={{ ...sans, fontSize: 10, color: C.subtle, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>{label}</div>
      <div style={{ ...font, fontSize: 22, fontWeight: 700, color, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ ...sans, fontSize: 11, color: C.muted, marginTop: 5 }}>{sub}</div>}
    </div>
  );
}

// ─── WORKLOAD ─────────────────────────────────────────────────
function calcWorkload(contracts, plans) {
  const months = {};
  for (let i = -1; i < 12; i++) {
    const d = new Date(NOW.getFullYear(), NOW.getMonth() + i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    months[key] = { label: fmtMonth(d), total: 0, byBuyer: {} };
  }
  contracts.filter(c => !c.ceased).forEach(c => {
    (plans[c.id] || []).filter(s => s.status !== "done" && s.stepId !== "expiry").forEach(s => {
      const d = new Date(s.scheduledDate);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      if (months[key]) { months[key].total++; if (!months[key].byBuyer[c.owner]) months[key].byBuyer[c.owner] = 0; months[key].byBuyer[c.owner]++; }
    });
  });
  return months;
}

function getSuggestions(contracts, plans) {
  const workload = calcWorkload(contracts, plans);
  return contracts.filter(c => !c.ceased).reduce((acc, c) => {
    const first = (plans[c.id] || []).find(s => s.stepId === "analysis");
    if (!first || first.status === "done") return acc;
    const d = new Date(first.scheduledDate);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const load = workload[key]?.byBuyer[c.owner] || 0;
    if (load >= WORKLOAD_THRESHOLD) acc.push({ contractId: c.id, supplier: c.supplier, owner: c.owner, reason: `${c.owner} ha ${load} attività a ${fmtMonth(d)}`, recommendedOffset: 30 });
    return acc;
  }, []);
}

// ─── LOGIN SCREEN ─────────────────────────────────────────────
function LoginScreen({ onLogin }) {
  const [selected, setSelected] = useState(null);
  const [hoverId, setHoverId] = useState(null);

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

        <button onClick={() => selected && onLogin(USERS.find(u => u.id === selected))}
          disabled={!selected}
          style={{ ...sans, width: "100%", padding: 16, background: selected ? C.accent : "rgba(255,255,255,0.1)", border: "none", borderRadius: 12, color: selected ? "#fff" : "rgba(255,255,255,0.3)", fontWeight: 700, cursor: selected ? "pointer" : "default", fontSize: 16, marginTop: 8, transition: "all 0.2s" }}>
          {selected ? `Accedi come ${USERS.find(u => u.id === selected)?.name} →` : "Seleziona un profilo"}
        </button>
      </div>
    </div>
  );
}

// ─── BO FORM MODAL ────────────────────────────────────────────
function BOFormModal({ contract, currentUser, onSubmit, onClose }) {
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
function StepDateEditor({ step, tmpl, onSave, onClose }) {
  const [newDate, setNewDate] = useState(step.scheduledDate); const [reason, setReason] = useState("");
  const diff = newDate ? Math.round((new Date(newDate) - new Date(step.originalDate)) / 864e5) : 0;
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
          <button onClick={() => newDate && reason.trim() && onSave(newDate, reason)} disabled={!newDate || !reason.trim()} style={{ ...sans, flex: 2, padding: 11, background: newDate && reason.trim() ? C.accent : C.border, border: "none", borderRadius: 8, color: "#fff", fontWeight: 700, cursor: "pointer" }}>💾 Salva</button>
        </div>
      </div>
    </div>
  );
}

// ─── CONTRACT FORM ────────────────────────────────────────────
function ContractForm({ initial, currentUser, onSave, onClose }) {
  const CATEGORIES = ["Capex / Machinery","Professional Services IT","Logistica","ICT / Software","Materie Prime","Facility Services","HR Services","AMS","Utilities","Marketing","Legal","Finance","Altro"];
  const TYPES = ["Fornitura","Servizi","AMS","SaaS","Licenza","Framework","NDA","Altro"];
  const CURRENCIES = ["EUR","USD","GBP","CNY","CHF"];
  const BUYER_NAMES = USERS.filter(u => u.role === ROLES.BUYER || u.role === ROLES.MANAGER).map(u => u.name);
  const RENEWAL_OPTIONS = ["In negoziazione","Rinnovo automatico","Da rescindere","Da rilanciare a gara","Non definito"];
  const defaultOwner = currentUser.role === ROLES.BUYER ? currentUser.name : "";
  const [form, setForm] = useState(initial || { supplier: "", object: "", category: "", country: "Italia", value: "", currency: "EUR", start: "", end: "", owner: defaultOwner, boEmail: "", renewal: "Non definito", type: "Servizi", notes: "", ceased: false });
  const [errors, setErrors] = useState({});
  const [attachedFile, setAttachedFile] = useState(initial?.fileName ? { name: initial.fileName } : null);
  const fileRef = useRef();
  const up = k => v => setForm(f => ({ ...f, [k]: v }));
  const isNew = !initial;
  const validate = () => { const e = {}; if (!form.supplier.trim()) e.supplier = "Obbligatorio"; if (!form.object.trim()) e.object = "Obbligatorio"; if (!form.end) e.end = "Obbligatorio"; if (isNew && !attachedFile) e.file = "Documento obbligatorio"; setErrors(e); return !Object.keys(e).length; };
  const handleSave = () => { if (validate()) onSave({ ...form, value: parseFloat(String(form.value).replace(",", ".")) || 0, fileName: attachedFile?.name || form.fileName || null }); };
  const fi = (key, ph, type = "text") => <input value={form[key]} onChange={e => up(key)(e.target.value)} placeholder={ph} type={type} style={{ ...iStyle, borderColor: errors[key] ? C.red : C.border }} />;
  const sel = (key, opts) => <select value={form[key]} onChange={e => up(key)(e.target.value)} style={iStyle}><option value="">— Seleziona —</option>{opts.map(o => <option key={o}>{o}</option>)}</select>;
  const F = ({ label, children, req }) => <div style={{ marginBottom: 14 }}><label style={{ ...sans, display: "block", fontSize: 11, color: C.subtle, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 5 }}>{label}{req && <span style={{ color: C.red }}> *</span>}</label>{children}</div>;
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 100, display: "flex", alignItems: "flex-end" }}>
      <div style={{ background: C.surface, borderRadius: "16px 16px 0 0", padding: 20, width: "100%", boxSizing: "border-box", maxHeight: "90vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <h3 style={{ ...font, margin: 0, fontSize: 17, color: C.navy }}>{isNew ? "➕ Nuovo contratto" : "✏️ Modifica"}</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: C.muted }}>×</button>
        </div>
        <F label="Fornitore" req>{fi("supplier", "Es. Acme Srl")}</F>
        {errors.supplier && <div style={{ ...sans, fontSize: 11, color: C.red, marginTop: -10, marginBottom: 10 }}>{errors.supplier}</div>}
        <F label="Oggetto" req>{fi("object", "Es. Fornitura logistica")}</F>
        {errors.object && <div style={{ ...sans, fontSize: 11, color: C.red, marginTop: -10, marginBottom: 10 }}>{errors.object}</div>}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}><F label="Categoria">{sel("category", CATEGORIES)}</F><F label="Tipo">{sel("type", TYPES)}</F></div>
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12 }}><F label="Valore"><input value={form.value} onChange={e => up("value")(e.target.value)} type="number" style={iStyle} /></F><F label="Valuta">{sel("currency", CURRENCIES)}</F></div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}><F label="Inizio"><input value={form.start} onChange={e => up("start")(e.target.value)} type="date" style={iStyle} /></F><F label="Scadenza" req><input value={form.end} onChange={e => up("end")(e.target.value)} type="date" style={{ ...iStyle, borderColor: errors.end ? C.red : C.border }} /></F></div>
        {errors.end && <div style={{ ...sans, fontSize: 11, color: C.red, marginTop: -10, marginBottom: 10 }}>{errors.end}</div>}
        <F label="Paese">{fi("country", "Es. Italia")}</F>
        <F label="Contract Owner">
          {currentUser.role === ROLES.BUYER
            ? <div style={{ ...iStyle, background: "#f0ece4", color: C.muted }}>{currentUser.name} (tu)</div>
            : <select value={form.owner} onChange={e => up("owner")(e.target.value)} style={iStyle}><option value="">— Seleziona —</option>{BUYER_NAMES.map(o => <option key={o}>{o}</option>)}</select>}
        </F>
        <F label="Email Business Owner">{fi("boEmail", "bo@prometeon.com", "email")}</F>
        <F label="Stato rinnovo">{sel("renewal", RENEWAL_OPTIONS)}</F>
        <F label="Note"><textarea value={form.notes} onChange={e => up("notes")(e.target.value)} style={{ ...iStyle, height: 60, resize: "none" }} /></F>
        <F label="Documento" req={isNew}>
          <input ref={fileRef} type="file" accept=".pdf,.doc,.docx" onChange={e => { const f = e.target.files[0]; if (f) setAttachedFile(f); }} style={{ display: "none" }} />
          {!attachedFile
            ? <button onClick={() => fileRef.current.click()} style={{ ...sans, width: "100%", padding: "12px", background: errors.file ? C.redBg : C.bg, border: `2px dashed ${errors.file ? C.red : C.border}`, borderRadius: 8, color: errors.file ? C.red : C.muted, cursor: "pointer", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>📎 Allega PDF o Word{isNew && <span style={{ color: C.red }}>*</span>}</button>
            : <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: C.greenBg, border: `1px solid ${C.green}`, borderRadius: 8 }}>📄<div style={{ flex: 1, ...sans, fontSize: 13, fontWeight: 600, color: C.green, overflow: "hidden", textOverflow: "ellipsis" }}>{attachedFile.name}</div><button onClick={() => setAttachedFile(null)} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer" }}>×</button></div>}
          {errors.file && <div style={{ ...sans, fontSize: 11, color: C.red, marginTop: 6 }}>⚠️ {errors.file}</div>}
        </F>
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
function BOView({ contracts, plans, currentUser, onOpenBOForm }) {
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
          <div><div style={{ ...sans, fontSize: 10, color: "rgba(255,255,255,0.4)" }}>IN ATTESA RISPOSTA</div><div style={{ ...font, fontSize: 20, fontWeight: 700, color: C.yellow === "#b07d10" ? "#f5c55a" : C.yellow }}>{pending.length}</div></div>
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
            const u = urgency(c); const days = daysToExpiry(c.end);
            const lc = { green: C.green, yellow: C.yellow, red: C.red }[u] || C.muted;
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
function PlanningView({ contracts, plans, auditLogs, currentUser, onSendBO, onCompleteStep, onOpenBOForm, onUpdateStepDate }) {
  const [selectedId, setSelectedId] = useState(null);
  const [editingStep, setEditingStep] = useState(null);

  const myContracts = currentUser.role === ROLES.MANAGER
    ? contracts.filter(c => !c.ceased && daysToExpiry(c.end) <= 120)
    : contracts.filter(c => !c.ceased && c.owner === currentUser.name && daysToExpiry(c.end) <= 120);

  const sorted = [...myContracts].sort((a, b) => daysToExpiry(a.end) - daysToExpiry(b.end));

  if (selectedId) {
    const contract = contracts.find(c => c.id === selectedId);
    const plan = plans[selectedId] || [];
    const audit = auditLogs[selectedId] || [];
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
            const tmpl = PLANNING_STEPS.find(s => s.id === step.stepId);
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
        const done = plan.filter(s => s.status === "done").length;
        const prog = Math.round((done / plan.length) * 100);
        const next = plan.find(s => s.status !== "done" && s.stepId !== "expiry");
        const nextTmpl = next ? PLANNING_STEPS.find(s => s.id === next.stepId) : null;
        const days = daysToExpiry(c.end);
        const u = urgency(c);
        const uColor = { green: C.green, yellow: C.yellow, red: C.red }[u] || C.muted;
        const bColor = USERS.find(u2 => u2.name === c.owner)?.color || C.navy;
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
function TeamView({ contracts, plans, onApplySuggestion }) {
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
          {suggestions.map((s, i) => (
            <div key={i} style={{ background: "#fff", borderRadius: 8, padding: 12, marginBottom: 8 }}>
              <div style={{ ...sans, fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{s.supplier}</div>
              <div style={{ ...sans, fontSize: 12, color: C.muted, marginBottom: 8 }}>{s.reason}</div>
              <button onClick={() => onApplySuggestion(s.contractId, s.recommendedOffset)} style={{ ...sans, padding: "6px 14px", background: C.navy, border: "none", borderRadius: 6, color: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>⏩ Anticipa a -120gg</button>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
        {buyers.map(b => { const u = USERS.find(x => x.name === b); const color = u?.color || C.navy; const sel = selectedBuyer === b; return (
          <button key={b} onClick={() => setSelectedBuyer(b)} style={{ ...sans, padding: "5px 10px", borderRadius: 20, border: `1px solid ${sel ? color : C.border}`, background: sel ? color : "transparent", color: sel ? "#fff" : C.muted, cursor: "pointer", fontSize: 11, fontWeight: 600 }}>{b}</button>
        ); })}
      </div>

      <div style={{ ...font, fontSize: 14, fontWeight: 700, color: C.navy, marginBottom: 10 }}>{selectedBuyer === "Tutti" ? "Tutti" : selectedBuyer} ({filtered.length})</div>
      {filtered.map(c => {
        const plan = plans[c.id] || [];
        const done = plan.filter(s => s.status === "done").length;
        const prog = Math.round((done / plan.length) * 100);
        const u = urgency(c); const days = daysToExpiry(c.end);
        const uColor = { green: C.green, yellow: C.yellow, red: C.red }[u] || C.muted;
        const bUser = USERS.find(x => x.name === c.owner);
        const bColor = bUser?.color || C.navy;
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
function Dashboard({ contracts, plans, currentUser, onNavigate }) {
  const myContracts = currentUser.role === ROLES.BUYER ? contracts.filter(c => !c.ceased && c.owner === currentUser.name) : contracts.filter(c => !c.ceased);
  const totalEUR = myContracts.filter(c => c.currency === "EUR").reduce((a, c) => a + c.value, 0);
  const urgent = [...myContracts].filter(c => urgency(c) !== "green").sort((a, b) => daysToExpiry(a.end) - daysToExpiry(b.end)).slice(0, 4);
  const pendingBO = currentUser.role === ROLES.MANAGER ? Object.values(plans).flat().filter(s => s.status === "pending_bo").length : 0;
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
function ContractList({ contracts, currentUser, onSelect, onNew }) {
  const [search, setSearch] = useState(""); const [filter, setFilter] = useState("Attivi"); const [showArchive, setShowArchive] = useState(false); const [sort, setSort] = useState("expiry");
  const base = currentUser.role === ROLES.BUYER ? contracts.filter(c => c.owner === currentUser.name) : contracts;
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
        const u = urgency(c); const days = daysToExpiry(c.end); const lc = { green: C.green, yellow: C.yellow, red: C.red, gray: "#9ca3af" }[u];
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
function ContractDetail({ contract, auditLog, currentUser, onBack, onEdit }) {
  const u = urgency(contract); const days = daysToExpiry(contract.end);
  const prog = Math.min(100, Math.max(0, ((NOW - new Date(contract.start)) / (new Date(contract.end) - new Date(contract.start))) * 100));
  const uc = { green: C.green, yellow: C.yellow, red: C.red, gray: "#9ca3af" }[u];
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
            <span style={{ ...sans, fontSize: 11, color: C.muted }}>{fmtDate(contract.start)}</span>
            <span style={{ ...sans, fontSize: 11, color: C.muted }}>{fmtDate(contract.end)}</span>
          </div>
          <div style={{ height: 8, background: C.borderLight, borderRadius: 4 }}><div style={{ height: "100%", width: `${prog}%`, background: uc, borderRadius: 4 }} /></div>
          <div style={{ ...sans, fontSize: 12, color: C.muted, marginTop: 8, textAlign: "center" }}>{days < 0 ? <b style={{ color: C.red }}>Scaduto da {Math.abs(days)} giorni</b> : <span>Scade tra <b style={{ color: uc }}>{days} giorni</b></span>}</div>
        </div>
      )}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, marginBottom: 12 }}>
        {[["Categoria", contract.category], ["Tipo", contract.type], ["Owner", contract.owner || "—"], ["BO Email", contract.boEmail || "—"], ["Rinnovo", contract.renewal]].map(([k, v]) => (
          <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: `1px solid ${C.borderLight}` }}>
            <span style={{ ...sans, fontSize: 13, color: C.muted }}>{k}</span>
            <span style={{ ...sans, fontSize: 13, fontWeight: 500 }}>{v}</span>
          </div>
        ))}
      </div>
      {contract.fileName && <div style={{ background: C.greenBg, border: `1px solid ${C.green}`, borderRadius: 10, padding: 14, marginBottom: 12, display: "flex", alignItems: "center", gap: 10 }}>📄<div style={{ ...sans, fontSize: 13, fontWeight: 600, color: C.green }}>{contract.fileName}</div></div>}
      {contract.notes && <div style={{ background: C.yellowBg, border: `1px solid #f0d080`, borderRadius: 10, padding: 14, marginBottom: 12 }}><div style={{ ...sans, fontSize: 11, color: C.yellow, fontWeight: 700, marginBottom: 4 }}>📝 NOTE</div><div style={{ ...sans, fontSize: 13 }}>{contract.notes}</div></div>}
      {auditLog?.length > 0 && (
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

// ─── APP ─────────────────────────────────────────────────────
export default function App() {
  const [currentUser, setCurrentUser] = useState(null);
  const [view, setView] = useState("dashboard");
  const [selected, setSelected] = useState(null);
  const [contracts, setContracts] = useState(MOCK_CONTRACTS);
  const [plans, setPlans] = useState(INIT_PLANS);
  const [auditLogs, setAuditLogs] = useState(INIT_AUDIT);
  const [toast, setToast] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [editingContract, setEditingContract] = useState(null);
  const [boFormContract, setBOFormContract] = useState(null);

  const showToast = msg => { setToast(msg); setTimeout(() => setToast(null), 3000); };
  const addAudit = (contractId, action, detail, user) => setAuditLogs(prev => ({ ...prev, [contractId]: [...(prev[contractId] || []), { ts: tsNow(), user: user || currentUser.name, action, detail }] }));

  const handleLogin = (user) => { setCurrentUser(user); setView(user.role === ROLES.BO ? "bo" : "dashboard"); };
  const handleLogout = () => { setCurrentUser(null); setView("dashboard"); setSelected(null); };

  const handleSave = (data) => {
    const owner = data.owner || currentUser.name;
    if (editingContract) {
      setContracts(cs => cs.map(c => c.id === editingContract.id ? { ...c, ...data } : c));
      setSelected(s => s?.id === editingContract.id ? { ...s, ...data } : s);
      addAudit(editingContract.id, "Contratto modificato", `Da ${currentUser.name}`);
      showToast("💾 Aggiornato");
    } else {
      const newId = Math.max(...contracts.map(c => c.id), 0) + 1;
      setContracts(cs => [...cs, { ...data, id: newId, owner }]);
      setPlans(p => ({ ...p, [newId]: makePlan(newId, data.end) }));
      addAudit(newId, "Contratto creato", `${data.supplier} · ${data.object}`, currentUser.name);
      showToast("✅ Contratto aggiunto");
    }
    setShowForm(false); setEditingContract(null);
  };

  const handleSendBO = (id) => {
    const c = contracts.find(x => x.id === id);
    setPlans(p => ({ ...p, [id]: p[id].map(s => s.stepId === "bo_notify" ? { ...s, status: "done", completedAt: fmtDate(NOW), completedBy: "Sistema" } : s.stepId === "bo_response" ? { ...s, status: "pending_bo" } : s) }));
    addAudit(id, "Notifica BO inviata", `A: ${c.boEmail}`, "Sistema");
    showToast(`✉️ Notifica inviata a ${c.boEmail}`);
  };

  const handleBOResponse = (id, { decision, notes }) => {
    const c = contracts.find(x => x.id === id);
    const boUser = userByEmail(c.boEmail);
    setPlans(p => ({ ...p, [id]: p[id].map(s => s.stepId === "bo_response" ? { ...s, status: "done", completedAt: fmtDate(NOW), completedBy: c.boEmail, boDecision: decision, boNotes: notes, boRespondedAt: fmtDate(NOW) } : s) }));
    const rm = { "Rinnovare alle stesse condizioni": "Rinnovo automatico", "Rinnovare con rinegoziazione": "In negoziazione", "Mettere in gara (RFQ/RFP)": "Da rilanciare a gara", "Prorogare temporaneamente": "In negoziazione", "Cessare l'attività": "Da rescindere" };
    if (rm[decision]) setContracts(cs => cs.map(c2 => c2.id === id ? { ...c2, renewal: rm[decision] } : c2));
    addAudit(id, "Risposta BO ricevuta", `Decisione: ${decision}${notes ? ` · "${notes}"` : ""}`, boUser?.name || c.boEmail);
    setBOFormContract(null);
    showToast("✅ Decisione BO registrata");
  };

  const handleCompleteStep = (id, stepId) => {
    const tmpl = PLANNING_STEPS.find(s => s.id === stepId);
    setPlans(p => ({ ...p, [id]: p[id].map(s => s.stepId === stepId ? { ...s, status: "done", completedAt: fmtDate(NOW), completedBy: currentUser.name } : s) }));
    addAudit(id, `Attività completata: ${tmpl?.label}`, `Da ${currentUser.name}`);
    showToast(`✓ "${tmpl?.label}" completata`);
  };

  const handleUpdateStepDate = (id, stepId, newDate, reason) => {
    const tmpl = PLANNING_STEPS.find(s => s.id === stepId);
    setPlans(p => ({ ...p, [id]: p[id].map(s => s.stepId === stepId ? { ...s, scheduledDate: newDate, modified: true, modifiedReason: reason } : s) }));
    addAudit(id, `Data modificata: ${tmpl?.label}`, `Nuova data: ${fmtDate(newDate)} · Motivo: ${reason}`);
    showToast("📅 Data aggiornata");
  };

  const handleApplySuggestion = (id, offset) => {
    const c = contracts.find(x => x.id === id);
    setPlans(p => ({ ...p, [id]: makePlan(id, c.end, offset) }));
    addAudit(id, "Piano anticipato", `Anticipo di ${offset} giorni`, "Sistema");
    showToast(`⏩ Piano anticipato di ${offset} giorni`);
  };

  if (!currentUser) return <LoginScreen onLogin={handleLogin} />;

  // Nav by role
  const navByRole = {
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
  const navItems = navByRole[currentUser.role] || navByRole[ROLES.BUYER];
  const titles = { dashboard: "Overview", list: "Contratti", planning: currentUser.role === ROLES.MANAGER ? "Piano — Team" : "Il mio piano", team: "Vista Team", notifiche: "Alert Email", bo: "Le mie richieste", detail: selected?.supplier };

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

      {/* Content */}
      <div style={{ padding: "18px 16px", maxWidth: 480, margin: "0 auto", paddingBottom: 90 }}>
        {view === "dashboard" && <Dashboard contracts={contracts} plans={plans} currentUser={currentUser} onNavigate={(v, c) => { setView(v); if (c) setSelected(c); }} />}
        {view === "list" && <ContractList contracts={contracts} currentUser={currentUser} onSelect={c => { setSelected(c); setView("detail"); }} onNew={() => { setEditingContract(null); setShowForm(true); }} />}
        {view === "planning" && <PlanningView contracts={contracts} plans={plans} auditLogs={auditLogs} currentUser={currentUser} onSendBO={handleSendBO} onCompleteStep={handleCompleteStep} onOpenBOForm={setBOFormContract} onUpdateStepDate={handleUpdateStepDate} />}
        {view === "team" && currentUser.role === ROLES.MANAGER && <TeamView contracts={contracts} plans={plans} onApplySuggestion={handleApplySuggestion} />}
        {view === "bo" && currentUser.role === ROLES.BO && <BOView contracts={contracts} plans={plans} currentUser={currentUser} onOpenBOForm={setBOFormContract} />}
        {view === "notifiche" && (() => {
          const mine = currentUser.role === ROLES.BUYER ? contracts.filter(c => c.owner === currentUser.name) : contracts;
          const alerts = mine.filter(c => !c.ceased && daysToExpiry(c.end) >= 0 && daysToExpiry(c.end) <= 90).sort((a, b) => daysToExpiry(a.end) - daysToExpiry(b.end));
          return (
            <div>
              <div style={{ background: C.blueBg, border: `1px solid #c0d8f5`, borderRadius: 10, padding: 14, marginBottom: 16 }}>
                <div style={{ ...sans, fontSize: 12, color: C.blue, fontWeight: 700, marginBottom: 4 }}>ℹ️ Notifiche simulate</div>
                <div style={{ ...sans, fontSize: 12, color: C.blue }}>In produzione inviate automaticamente con Azure AD.</div>
              </div>
              {alerts.map((c, i) => { const days = daysToExpiry(c.end); return (
                <div key={i} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16, marginBottom: 10 }}>
                  <div style={{ ...sans, fontSize: 11, color: C.subtle, marginBottom: 6 }}>A: <b>{c.owner?.toLowerCase().replace(" ", ".")}@prometeon.com</b></div>
                  <div style={{ ...sans, fontSize: 13, fontWeight: 600, marginBottom: 8 }}>⚠️ Scadenza: {c.supplier}</div>
                  <div style={{ ...sans, fontSize: 12, color: C.muted, background: C.bg, borderRadius: 6, padding: 10, lineHeight: 1.6 }}>Scade il <b>{fmtDate(c.end)}</b> — tra <b style={{ color: days <= 30 ? C.red : C.yellow }}>{days} giorni</b>. Stato: <b>{c.renewal}</b>.</div>
                </div>
              ); })}
            </div>
          );
        })()}
        {view === "detail" && selected && <ContractDetail contract={selected} auditLog={auditLogs[selected.id]} currentUser={currentUser} onBack={() => setView("list")} onEdit={() => { setEditingContract(selected); setShowForm(true); }} />}
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

      {toast && (
        <div style={{ position: "fixed", top: 80, left: "50%", transform: "translateX(-50%)", background: C.navy, color: "#fff", padding: "11px 22px", borderRadius: 24, fontWeight: 600, fontSize: 13, zIndex: 200, boxShadow: "0 4px 20px rgba(0,0,0,0.2)", ...sans, whiteSpace: "nowrap" }}>
          {toast}
        </div>
      )}
    </div>
  );
}