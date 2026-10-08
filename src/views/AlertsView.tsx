import type { Contract, User } from "../types.ts";
import { C, sans } from "../theme.ts";
import { daysToExpiry, fmtDate } from "../lib/format.ts";
import { Card, Grid } from "../components/ui.tsx";

export function AlertsView({ contracts, users }: { contracts: Contract[]; users: User[] }) {
  const alerts = contracts.filter(c => !c.ceased && daysToExpiry(c.end) >= 0 && daysToExpiry(c.end) <= 90).sort((a, b) => daysToExpiry(a.end) - daysToExpiry(b.end));
  const emailOf = (owner: string) => users.find(u => u.name === owner)?.email ?? owner ?? "—";
  return (
    <div>
      <div style={{ background: C.blueBg, border: `1px solid #c0d8f5`, borderRadius: 10, padding: 14, marginBottom: 16 }}>
        <div style={{ ...sans, fontSize: 12, color: C.blue, fontWeight: 700, marginBottom: 4 }}>ℹ️ Notifiche simulate</div>
        <div style={{ ...sans, fontSize: 12, color: C.blue }}>Anteprima delle email di scadenza: l'invio automatico non è ancora attivo.</div>
      </div>
      {alerts.length === 0 && <p style={{ ...sans, color: C.muted, fontSize: 13 }}>Nessun contratto in scadenza nei prossimi 90 giorni ✅</p>}
      <Grid min={360}>
        {alerts.map(c => { const days = daysToExpiry(c.end); return (
          <Card key={c.id}>
            <div style={{ ...sans, fontSize: 11, color: C.subtle, marginBottom: 6 }}>A: <b>{emailOf(c.owner)}</b></div>
            <div style={{ ...sans, fontSize: 13, fontWeight: 600, marginBottom: 8 }}>⚠️ Scadenza: {c.supplier}</div>
            <div style={{ ...sans, fontSize: 12, color: C.muted, background: C.bg, borderRadius: 6, padding: 10, lineHeight: 1.6 }}>Scade il <b>{fmtDate(c.end)}</b> — tra <b style={{ color: days <= 30 ? C.red : C.yellow }}>{days} giorni</b>. Stato: <b>{c.renewal}</b>.</div>
          </Card>
        ); })}
      </Grid>
    </div>
  );
}
