import type { Contract, User } from "../types.ts";
import { C, font, radius, sans, URGENCY_COLORS } from "../theme.ts";
import { daysToExpiry, fmtDate, urgency } from "../lib/format.ts";
import { Card, DaysChip, EmptyState, Grid } from "../components/ui.tsx";
import { Bell, CheckCircle2, Info, Mail } from "../components/icons.tsx";

export function AlertsView({ contracts, users }: { contracts: Contract[]; users: User[] }) {
  const alerts = contracts.filter(c => !c.ceased && daysToExpiry(c.end) >= 0 && daysToExpiry(c.end) <= 90).sort((a, b) => daysToExpiry(a.end) - daysToExpiry(b.end));
  const emailOf = (owner: string) => users.find(u => u.name === owner)?.email ?? owner ?? "—";
  return (
    <div style={{ display: "grid", gap: 16, gridTemplateColumns: "minmax(0,1fr)" }}>
      <div style={{ display: "flex", gap: 12, background: C.blueBg, border: "1px solid #cfe0f8", borderRadius: radius.lg, padding: "14px 16px" }}>
        <Info size={19} color={C.blue} style={{ flexShrink: 0, marginTop: 1 }} />
        <div><div style={{ ...sans, fontSize: 13.5, color: C.blue, fontWeight: 650 }}>Anteprima degli avvisi</div><div style={{ ...sans, fontSize: 13, color: C.muted, marginTop: 2 }}>Queste sono le email di scadenza che riceveranno i buyer. L'invio automatico non è ancora attivo.</div></div>
      </div>
      {alerts.length === 0 && <EmptyState icon={<CheckCircle2 size={28} />} title="Nessuna scadenza imminente" text="Nessun contratto scade nei prossimi 90 giorni." />}
      <Grid min={360}>
        {alerts.map(c => { const days = daysToExpiry(c.end); const u = urgency(c); return (
          <Card key={c.id} style={{ borderRadius: radius.md }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, ...sans, fontSize: 12, color: C.subtle, marginBottom: 10 }}><Mail size={14} />A: <b style={{ color: C.muted, fontWeight: 600 }}>{emailOf(c.owner)}</b></div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <div style={{ ...font, fontSize: 15, fontWeight: 650, display: "flex", alignItems: "center", gap: 8 }}><Bell size={16} color={URGENCY_COLORS[u]} />Scadenza: {c.supplier}</div>
              <DaysChip days={days} level={u} />
            </div>
            <div style={{ ...sans, fontSize: 13, color: C.muted, background: C.bg, borderRadius: 10, padding: 12, lineHeight: 1.6 }}>Il contratto scade il <b style={{ color: C.text }}>{fmtDate(c.end)}</b>. Stato del rinnovo: <b style={{ color: C.text }}>{c.renewal}</b>.</div>
          </Card>
        ); })}
      </Grid>
    </div>
  );
}
