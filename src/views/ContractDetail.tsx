import type { AuditEntry, Contract, User } from "../types.ts";
import { C, font, radius, sans, URGENCY_COLORS } from "../theme.ts";
import { daysToExpiry, fmt, fmtDate, NOW, urgency } from "../lib/format.ts";
import { canDeleteContract, canEditContract } from "../permissions.ts";
import { AuditTrail, Avatar, Card, DaysChip, Grid, RenewalBadge } from "../components/ui.tsx";
import { AlertTriangle, ArrowLeft, Download, ExternalLink, FileText, Pencil, StickyNote, Trash2 } from "../components/icons.tsx";
import { documentUrl } from "../api.ts";

const fact = (label: string, value: React.ReactNode) => (
  <div style={{ minWidth: 0 }}><div style={{ ...sans, fontSize: 11, color: "rgba(255,255,255,.55)", fontWeight: 600, marginBottom: 3 }}>{label}</div><div style={{ ...sans, fontSize: 14.5, fontWeight: 650, color: "#fff" }}>{value}</div></div>
);

export function ContractDetail({ contract, auditLog, currentUser, canOpenDocuments, onBack, onEdit, onDelete }: { contract: Contract; auditLog: AuditEntry[]; currentUser: User; canOpenDocuments: boolean; onBack: () => void; onEdit: () => void; onDelete: () => void }) {
  const u = urgency(contract); const days = daysToExpiry(contract.end);
  const startMs = new Date(contract.start).getTime(), endMs = new Date(contract.end).getTime();
  const prog = contract.start && endMs > startMs ? Math.min(100, Math.max(0, ((NOW.getTime() - startMs) / (endMs - startMs)) * 100)) : 0;
  const uc = URGENCY_COLORS[u];
  const rows: [string, React.ReactNode][] = [["Categoria", contract.category || "—"], ["Tipo", contract.type || "—"], ["Paese", contract.country || "—"], ["Contract owner", contract.owner ? <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><Avatar name={contract.owner} size={22} />{contract.owner}</span> : "—"], ["Business Owner", contract.boEmail || "—"], ["Stato del rinnovo", <RenewalBadge status={contract.renewal} />]];
  const action = (color: string, filled: boolean): React.CSSProperties => ({ ...sans, display: "inline-flex", alignItems: "center", gap: 7, background: filled ? color : "#fff", border: `1px solid ${color}`, borderRadius: 10, color: filled ? "#fff" : color, cursor: "pointer", fontSize: 13, fontWeight: 650, padding: "8px 14px" });

  return (
    <div style={{ display: "grid", gap: 14, gridTemplateColumns: "minmax(0,1fr)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
        <button onClick={onBack} style={{ ...sans, display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: C.accent, cursor: "pointer", fontSize: 13, fontWeight: 650, padding: 0 }}><ArrowLeft size={16} />Tutti i contratti</button>
        <div style={{ display: "flex", gap: 8 }}>
          {canDeleteContract(currentUser) && <button onClick={onDelete} style={action(C.red, false)}><Trash2 size={15} />Elimina</button>}
          {canEditContract(currentUser, contract) && <button onClick={onEdit} style={action(C.navy, true)}><Pencil size={15} />Modifica</button>}
        </div>
      </div>

      <div style={{ background: contract.ceased ? `linear-gradient(135deg, ${C.gray}, #374151)` : `linear-gradient(135deg, ${C.navy}, ${C.navySoft})`, borderRadius: radius.lg + 2, padding: 24, color: "#fff", boxShadow: "0 8px 24px rgba(22,33,59,.18)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ ...font, fontSize: 22, fontWeight: 700 }}>{contract.supplier}</div>
            <div style={{ ...sans, fontSize: 14, color: "rgba(255,255,255,.7)", marginTop: 3 }}>{contract.object}</div>
          </div>
          <DaysChip days={days} level={u} ceased={contract.ceased} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 20, marginTop: 24 }}>
          {fact("Valore", <span className="tabular" style={{ ...font, fontSize: 26, fontWeight: 700 }}>{fmt(contract.value, contract.currency)}</span>)}
          {fact("Scadenza", <span className="tabular">{fmtDate(contract.end)}</span>)}
          {fact("Inizio", <span className="tabular">{contract.start ? fmtDate(contract.start) : "—"}</span>)}
        </div>
      </div>

      <Grid min={380}>
        <div style={{ display: "grid", gap: 14, gridTemplateColumns: "minmax(0,1fr)" }}>
          {!contract.ceased && (
            <Card>
              <div style={{ display: "flex", justifyContent: "space-between", ...sans, fontSize: 12, color: C.muted, marginBottom: 8 }}><span>Durata del contratto</span><b className="tabular" style={{ color: C.text }}>{Math.round(prog)}% trascorso</b></div>
              <div style={{ height: 8, background: C.borderLight, borderRadius: 4 }}><div style={{ height: "100%", width: `${prog}%`, background: uc, borderRadius: 4 }} /></div>
              <div style={{ ...sans, fontSize: 13, color: C.muted, marginTop: 10 }}>{days < 0 ? <b style={{ color: C.red }}>Scaduto da {Math.abs(days)} giorni</b> : <span>Scade tra <b style={{ color: uc }}>{days} giorni</b></span>}</div>
            </Card>
          )}
          <Card style={{ padding: "6px 18px" }}>
            {rows.map(([k, v], i) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "12px 0", borderTop: i ? `1px solid ${C.borderLight}` : "none" }}>
                <span style={{ ...sans, fontSize: 13, color: C.muted }}>{k}</span>
                <span style={{ ...sans, fontSize: 13.5, fontWeight: 550, textAlign: "right", overflowWrap: "anywhere" }}>{v}</span>
              </div>
            ))}
          </Card>
          {contract.fileName && (contract.filePath && canOpenDocuments ? (
            <Card style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: 14 }}>
              <div aria-hidden style={{ width: 42, height: 42, borderRadius: 12, background: C.greenBg, color: C.green, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><FileText size={21} /></div>
              <div style={{ flex: "1 1 150px", minWidth: 0 }}><div style={{ ...sans, fontSize: 13.5, fontWeight: 650, overflowWrap: "anywhere" }}>{contract.fileName}</div><div style={{ ...sans, fontSize: 12, color: C.muted }}>Documento del contratto</div></div>
              <a href={documentUrl(contract.id)} target="_blank" rel="noopener noreferrer" style={{ ...sans, display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px", background: C.green, borderRadius: 9, color: "#fff", fontSize: 12.5, fontWeight: 650, textDecoration: "none" }}><ExternalLink size={14} />Apri</a>
              <a href={documentUrl(contract.id, true)} style={{ ...sans, display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px", border: `1px solid ${C.border}`, borderRadius: 9, color: C.text, fontSize: 12.5, fontWeight: 650, textDecoration: "none", background: "#fff" }}><Download size={14} />Scarica</a>
            </Card>
          ) : (
            <div style={{ background: C.yellowBg, border: "1px solid #f3dca0", borderRadius: radius.lg, padding: 16, display: "flex", gap: 12 }}>
              <AlertTriangle size={20} color={C.yellow} style={{ flexShrink: 0, marginTop: 1 }} />
              <div><div style={{ ...sans, fontSize: 13.5, fontWeight: 650, color: C.text, overflowWrap: "anywhere" }}>{contract.fileName}</div>
                <div style={{ ...sans, fontSize: 12.5, color: C.muted, marginTop: 3, lineHeight: 1.5 }}>{canOpenDocuments ? <>Il documento non è stato salvato (risulta solo il nome del file).{canEditContract(currentUser, contract) && " Usa Modifica per ricaricarlo."}</> : "In modalità demo i documenti non vengono salvati."}</div></div>
            </div>
          ))}
          {contract.notes && <Card style={{ background: C.yellowBg, borderColor: "#f3dca0" }}><div style={{ ...sans, display: "flex", alignItems: "center", gap: 7, fontSize: 12, color: C.yellow, fontWeight: 650, marginBottom: 6 }}><StickyNote size={15} />Note</div><div style={{ ...sans, fontSize: 13.5, whiteSpace: "pre-wrap", lineHeight: 1.55 }}>{contract.notes}</div></Card>}
        </div>
        <AuditTrail entries={auditLog} />
      </Grid>
    </div>
  );
}
