import type { AuditEntry, Contract, User } from "../types.ts";
import { C, font, sans, URGENCY_COLORS } from "../theme.ts";
import { daysToExpiry, fmt, fmtDate, NOW, urgency } from "../lib/format.ts";
import { canDeleteContract, canEditContract } from "../permissions.ts";
import { AuditTrail, Card, Grid } from "../components/ui.tsx";

export function ContractDetail({ contract, auditLog, currentUser, onBack, onEdit, onDelete }: { contract: Contract; auditLog: AuditEntry[]; currentUser: User; onBack: () => void; onEdit: () => void; onDelete: () => void }) {
  const u = urgency(contract); const days = daysToExpiry(contract.end);
  const startMs = new Date(contract.start).getTime(), endMs = new Date(contract.end).getTime();
  const prog = contract.start && endMs > startMs ? Math.min(100, Math.max(0, ((NOW.getTime() - startMs) / (endMs - startMs)) * 100)) : 0;
  const uc = URGENCY_COLORS[u];
  const rows: [string, string][] = [["Categoria", contract.category || "—"], ["Tipo", contract.type || "—"], ["Owner", contract.owner || "—"], ["Business Owner", contract.boEmail || "—"], ["Rinnovo", contract.renewal]];

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 14 }}>
        <button onClick={onBack} style={{ ...sans, background: "none", border: "none", color: C.accent, cursor: "pointer", fontSize: 13, fontWeight: 600, padding: 0 }}>← Lista</button>
        <div style={{ display: "flex", gap: 8 }}>
          {canDeleteContract(currentUser) && <button onClick={onDelete} style={{ ...sans, background: "transparent", border: `1px solid ${C.red}`, borderRadius: 6, color: C.red, cursor: "pointer", fontSize: 12, fontWeight: 600, padding: "6px 14px" }}>🗑 Elimina</button>}
          {canEditContract(currentUser, contract) && <button onClick={onEdit} style={{ ...sans, background: C.navy, border: "none", borderRadius: 6, color: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 600, padding: "6px 14px" }}>✏️ Modifica</button>}
        </div>
      </div>
      <div style={{ background: contract.ceased ? C.gray : C.navy, borderRadius: 14, padding: 20, marginBottom: 14, color: "#fff" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
          <div><div style={{ ...font, fontSize: 17, fontWeight: 700 }}>{contract.supplier}</div><div style={{ ...sans, fontSize: 11, color: "rgba(255,255,255,0.5)", marginTop: 2 }}>{contract.country}</div></div>
          <div style={{ background: uc, borderRadius: 20, padding: "3px 10px", fontSize: 11, fontWeight: 700, ...sans, color: "#fff", height: "fit-content" }}>{contract.ceased ? "Cessato" : days < 0 ? "Scaduto" : days <= 30 ? "Urgente" : days <= 90 ? "In scadenza" : "Regolare"}</div>
        </div>
        <div style={{ ...sans, fontSize: 13, color: "rgba(255,255,255,0.65)", marginBottom: 14 }}>{contract.object}</div>
        <div style={{ ...font, fontSize: 24, fontWeight: 700 }}>{fmt(contract.value, contract.currency)}</div>
      </div>
      <Grid min={360}>
        <div style={{ display: "grid", gap: 12 }}>
          {!contract.ceased && (
            <Card>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ ...sans, fontSize: 11, color: C.muted }}>{contract.start ? fmtDate(contract.start) : "—"}</span>
                <span style={{ ...sans, fontSize: 11, color: C.muted }}>{fmtDate(contract.end)}</span>
              </div>
              <div style={{ height: 8, background: C.borderLight, borderRadius: 4 }}><div style={{ height: "100%", width: `${prog}%`, background: uc, borderRadius: 4 }} /></div>
              <div style={{ ...sans, fontSize: 12, color: C.muted, marginTop: 8, textAlign: "center" }}>{days < 0 ? <b style={{ color: C.red }}>Scaduto da {Math.abs(days)} giorni</b> : <span>Scade tra <b style={{ color: uc }}>{days} giorni</b></span>}</div>
            </Card>
          )}
          <Card>
            {rows.map(([k, v]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "8px 0", borderBottom: `1px solid ${C.borderLight}` }}>
                <span style={{ ...sans, fontSize: 13, color: C.muted }}>{k}</span>
                <span style={{ ...sans, fontSize: 13, fontWeight: 500, textAlign: "right", overflowWrap: "anywhere" }}>{v}</span>
              </div>
            ))}
          </Card>
          {contract.fileName && <div style={{ background: C.greenBg, border: `1px solid ${C.green}`, borderRadius: 10, padding: 14, display: "flex", alignItems: "center", gap: 10 }}>📄<div style={{ ...sans, fontSize: 13, fontWeight: 600, color: C.green, overflowWrap: "anywhere" }}>{contract.fileName}</div></div>}
          {contract.notes && <div style={{ background: C.yellowBg, border: `1px solid #f0d080`, borderRadius: 10, padding: 14 }}><div style={{ ...sans, fontSize: 11, color: C.yellow, fontWeight: 700, marginBottom: 4 }}>📝 NOTE</div><div style={{ ...sans, fontSize: 13, whiteSpace: "pre-wrap" }}>{contract.notes}</div></div>}
        </div>
        <AuditTrail entries={auditLog} />
      </Grid>
    </div>
  );
}
