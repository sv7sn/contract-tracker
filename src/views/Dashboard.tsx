import type { Contract, Plans, User, View } from "../types.ts";
import { C, font, sans, URGENCY_COLORS } from "../theme.ts";
import { daysToExpiry, fmt, urgency } from "../lib/format.ts";
import { getSuggestions } from "../lib/plan.ts";
import { Avatar, Card, Grid, RoleBadge, StatCard, UrgencyDot } from "../components/ui.tsx";

export function Dashboard({ contracts, plans, currentUser, onNavigate }: { contracts: Contract[]; plans: Plans; currentUser: User; onNavigate: (v: View, c?: Contract) => void }) {
  const mine = contracts.filter(c => !c.ceased);
  const totalEUR = mine.filter(c => c.currency === "EUR").reduce((a, c) => a + c.value, 0);
  const urgent = [...mine].filter(c => urgency(c) !== "green").sort((a, b) => daysToExpiry(a.end) - daysToExpiry(b.end)).slice(0, 6);
  const isManager = currentUser.role === "manager";
  const pendingBO = isManager ? mine.filter(c => (plans[c.id] || []).some(s => s.status === "pending_bo")).length : 0;
  const suggestions = isManager ? getSuggestions(contracts, plans) : [];

  return (
    <div>
      <div style={{ background: C.navy, borderRadius: 12, padding: 16, marginBottom: 20, display: "flex", alignItems: "center", gap: 12 }}>
        <Avatar name={currentUser.name} size={44} />
        <div>
          <div style={{ ...font, fontSize: 15, fontWeight: 700, color: "#fff" }}>{currentUser.name}</div>
          <div style={{ ...sans, fontSize: 12, color: "rgba(255,255,255,0.5)" }}>{currentUser.title}</div>
          <div style={{ marginTop: 4 }}><RoleBadge role={currentUser.role} /></div>
        </div>
      </div>

      <Grid min={150} style={{ marginBottom: 20 }}>
        <StatCard label={isManager ? "Contratti attivi" : "Miei contratti"} value={mine.length} color={C.navy} />
        <StatCard label="Valore EUR" value={fmt(totalEUR)} color={C.accent} />
        <StatCard label="Urgenti/Scaduti" value={mine.filter(c => urgency(c) === "red").length} sub="azione richiesta" color={C.red} />
        {isManager
          ? <StatCard label="Attesa BO" value={pendingBO} sub="da completare" color={C.yellow} />
          : <StatCard label="In scadenza" value={mine.filter(c => urgency(c) === "yellow").length} sub="entro 90 giorni" color={C.yellow} />}
      </Grid>

      <Grid min={360}>
        <Card style={{ padding: 18 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <h3 style={{ ...font, margin: 0, fontSize: 15, color: C.navy }}>⚠️ Priorità immediate</h3>
            <button onClick={() => onNavigate("list")} style={{ ...sans, background: "none", border: "none", color: C.accent, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>Tutti →</button>
          </div>
          {urgent.length === 0 && <p style={{ ...sans, color: C.muted, fontSize: 13, margin: 0 }}>{mine.length === 0 ? "Nessun contratto: creane uno con il pulsante ➕." : "Nessuna urgenza ✅"}</p>}
          {urgent.map(c => { const days = daysToExpiry(c.end); const u = urgency(c); return (
            <div key={c.id} onClick={() => onNavigate("detail", c)} role="button" tabIndex={0} onKeyDown={e => { if (e.key === "Enter") onNavigate("detail", c); }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: `1px solid ${C.borderLight}`, cursor: "pointer" }}>
              <UrgencyDot level={u} size={9} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ ...sans, fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.supplier}</div>
                <div style={{ ...sans, fontSize: 11, color: C.muted }}>{c.owner}</div>
              </div>
              <div style={{ ...sans, fontSize: 12, fontWeight: 700, color: URGENCY_COLORS[u], flexShrink: 0 }}>{days < 0 ? "Scaduto" : `${days}gg`}</div>
            </div>
          ); })}
        </Card>

        {suggestions.length > 0 && (
          <div style={{ background: C.yellowBg, border: `1px solid #f0d080`, borderRadius: 12, padding: 18 }}>
            <div style={{ ...sans, fontSize: 13, color: C.yellow, fontWeight: 700, marginBottom: 6 }}>💡 {suggestions.length} suggerimento/i di anticipo</div>
            <div style={{ ...sans, fontSize: 12, color: C.muted, marginBottom: 12 }}>Alcuni buyer hanno troppe attività nello stesso mese.</div>
            <button onClick={() => onNavigate("team")} style={{ ...sans, padding: "7px 16px", background: C.yellow, border: "none", borderRadius: 6, color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: 12 }}>Vedi vista team →</button>
          </div>
        )}
      </Grid>
    </div>
  );
}
