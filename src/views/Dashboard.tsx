import type { Contract, Plans, User, View } from "../types.ts";
import { C, font, radius, sans, shadow, URGENCY_COLORS } from "../theme.ts";
import { daysToDeadline, fmt, fmtCompact, NOW, urgency } from "../lib/format.ts";
import { getSuggestions } from "../lib/plan.ts";
import { canCreateContract } from "../permissions.ts";
import { Card, CardTitle, DaysChip, EmptyState, Grid, StatCard } from "../components/ui.tsx";
import { AlertTriangle, ArrowRight, CalendarClock, FileText, Hourglass, Lightbulb, Plus, Wallet } from "../components/icons.tsx";
import { ExpiryColumns, RenewalStack, ValueBars } from "../components/charts.tsx";

const greeting = () => { const h = new Date().getHours(); return h < 13 ? "Buongiorno" : h < 18 ? "Buon pomeriggio" : "Buonasera"; };

export function Dashboard({ contracts, plans, currentUser, onNavigate, onNew }: { contracts: Contract[]; plans: Plans; currentUser: User; onNavigate: (v: View, c?: Contract) => void; onNew: () => void }) {
  const mine = contracts.filter(c => !c.ceased);
  const totalEUR = mine.filter(c => c.currency === "EUR").reduce((a, c) => a + c.value, 0);
  const urgent = [...mine].filter(c => urgency(c) !== "green").sort((a, b) => daysToDeadline(a) - daysToDeadline(b)).slice(0, 6);
  const isManager = currentUser.role === "manager";
  const pendingBO = isManager ? mine.filter(c => (plans[c.id] || []).some(s => s.status === "pending_bo")).length : 0;
  const suggestions = isManager ? getSuggestions(contracts, plans) : [];
  const red = mine.filter(c => urgency(c) === "red").length;
  const yellow = mine.filter(c => urgency(c) === "yellow").length;
  const first = currentUser.name.split(" ")[0];
  const today = NOW.toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" });

  return (
    <div style={{ display: "grid", gap: 20, gridTemplateColumns: "minmax(0,1fr)" }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <div style={{ ...sans, fontSize: 12.5, color: C.subtle, textTransform: "capitalize", marginBottom: 2 }}>{today}</div>
          <h2 style={{ ...font, margin: 0, fontSize: 24, fontWeight: 700, color: C.text }}>{greeting()}, {first}</h2>
          <p style={{ ...sans, margin: "4px 0 0", fontSize: 14, color: C.muted, maxWidth: 620, lineHeight: 1.5 }}>
            {mine.length === 0 ? "Non ci sono ancora contratti: creane uno per iniziare."
              : red > 0 ? <>Hai <b style={{ color: C.red }}>{red} {red === 1 ? "contratto" : "contratti"}</b> che richiedono attenzione entro 30 giorni{pendingBO ? `, e ${pendingBO} in attesa della risposta del Business Owner` : ""}.</>
              : yellow > 0 ? <>Nessuna scadenza urgente. <b>{yellow}</b> {yellow === 1 ? "contratto scade" : "contratti scadono"} entro 90 giorni.</>
              : "Nessuna scadenza urgente nei prossimi 90 giorni."}
          </p>
        </div>
        {canCreateContract(currentUser) && <button className="mobile-only" onClick={onNew} style={{ ...sans, display: "flex", alignItems: "center", gap: 8, padding: "10px 16px", background: C.accent, border: "none", borderRadius: 10, color: "#fff", fontWeight: 650, fontSize: 13.5, cursor: "pointer", boxShadow: "0 1px 2px rgba(200,82,42,.35)" }}><Plus size={17} />Nuovo contratto</button>}
      </div>

      <Grid min={220} gap={14} fill>
        <StatCard label={isManager ? "Contratti attivi" : "I tuoi contratti"} value={mine.length} color={C.blue} icon={<FileText size={18} />} sub="in portafoglio" />
        <StatCard label="Valore in euro" value={fmtCompact(totalEUR)} title={fmt(totalEUR)} color={C.accent} icon={<Wallet size={18} />} sub="dei contratti attivi" />
        <StatCard label="Da gestire subito" value={red} color={C.red} icon={<AlertTriangle size={18} />} sub="scaduti o entro 30 giorni" />
        {isManager
          ? <StatCard label="In attesa del BO" value={pendingBO} color={C.yellow} icon={<Hourglass size={18} />} sub="decisioni da ricevere" />
          : <StatCard label="In scadenza" value={yellow} color={C.yellow} icon={<CalendarClock size={18} />} sub="entro 90 giorni" />}
      </Grid>

      {mine.length === 0 ? (
        <EmptyState title="Nessun contratto da mostrare" text="Quando inserirai i primi contratti qui vedrai scadenze, stato dei rinnovi e dove si concentra la spesa." action={canCreateContract(currentUser) && <button onClick={onNew} style={{ ...sans, padding: "10px 18px", background: C.accent, border: "none", borderRadius: 10, color: "#fff", fontWeight: 650, cursor: "pointer" }}>Crea il primo contratto</button>} />
      ) : (<>
        <Grid min={420} gap={14} style={{ alignItems: "stretch" }}>
          <ExpiryColumns contracts={contracts} />
          <Card style={{ padding: 18 }}>
            <CardTitle icon={<AlertTriangle size={16} />} action={<button onClick={() => onNavigate("list")} style={{ ...sans, display: "flex", alignItems: "center", gap: 4, background: "none", border: "none", color: C.accent, cursor: "pointer", fontSize: 12.5, fontWeight: 650 }}>Tutti <ArrowRight size={14} /></button>}>Priorità immediate</CardTitle>
            {urgent.length === 0 && <p style={{ ...sans, color: C.muted, fontSize: 13, margin: 0 }}>Nessuna urgenza: tutto sotto controllo.</p>}
            {urgent.map((c, i) => { const days = daysToDeadline(c); const u = urgency(c); return (
              <div key={c.id} onClick={() => onNavigate("detail", c)} role="button" tabIndex={0} onKeyDown={e => { if (e.key === "Enter") onNavigate("detail", c); }}
                style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 8px", margin: "0 -8px", borderTop: i ? `1px solid ${C.borderLight}` : "none", cursor: "pointer", borderRadius: 8 }}
                onMouseEnter={e => e.currentTarget.style.background = "#f7f9fc"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                <span aria-hidden style={{ width: 4, alignSelf: "stretch", borderRadius: 2, background: URGENCY_COLORS[u] }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ ...sans, fontSize: 13.5, fontWeight: 600, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.supplier}</div>
                  <div style={{ ...sans, fontSize: 12, color: C.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.object} · {c.owner}</div>
                </div>
                <DaysChip days={days} level={u} />
              </div>
            ); })}
          </Card>
        </Grid>

        <Grid min={420} gap={14} style={{ alignItems: "stretch" }}>
          <RenewalStack contracts={contracts} />
          <ValueBars contracts={contracts} />
        </Grid>

        {suggestions.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 14, background: C.yellowBg, border: "1px solid #f3dca0", borderRadius: radius.lg, padding: "14px 18px", boxShadow: shadow.sm, flexWrap: "wrap" }}>
            <span aria-hidden style={{ color: C.yellow, display: "flex" }}><Lightbulb size={22} /></span>
            <div style={{ flex: 1, minWidth: 220 }}>
              <div style={{ ...sans, fontSize: 13.5, fontWeight: 650, color: C.text }}>{suggestions.length} {suggestions.length === 1 ? "suggerimento" : "suggerimenti"} per bilanciare il carico</div>
              <div style={{ ...sans, fontSize: 12.5, color: C.muted }}>Alcuni buyer hanno troppe attività nello stesso mese.</div>
            </div>
            <button onClick={() => onNavigate("team")} style={{ ...sans, padding: "8px 14px", background: C.navy, border: "none", borderRadius: 9, color: "#fff", fontWeight: 650, fontSize: 12.5, cursor: "pointer" }}>Apri la vista team</button>
          </div>
        )}
      </>)}
    </div>
  );
}
