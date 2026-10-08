import { useMemo, useState } from "react";
import type { Contract, User } from "../types.ts";
import { C, iStyle, sans, URGENCY_COLORS } from "../theme.ts";
import { daysToExpiry, fmt, fmtDate, urgency } from "../lib/format.ts";
import { canViewTeam } from "../permissions.ts";
import { Card, Grid, RenewalBadge } from "../components/ui.tsx";

export function ContractList({ contracts, currentUser, onSelect }: { contracts: Contract[]; currentUser: User; onSelect: (c: Contract) => void }) {
  const [search, setSearch] = useState(""); const [filter, setFilter] = useState("Attivi"); const [showArchive, setShowArchive] = useState(false); const [sort, setSort] = useState("expiry");
  const filtered = useMemo(() => {
    let list = showArchive ? contracts.filter(c => c.ceased) : contracts.filter(c => !c.ceased);
    if (search) list = list.filter(c => `${c.supplier} ${c.object} ${c.owner}`.toLowerCase().includes(search.toLowerCase()));
    if (!showArchive) { if (filter === "Urgenti") list = list.filter(c => urgency(c) === "red"); else if (filter === "In scadenza") list = list.filter(c => urgency(c) === "yellow"); else if (filter === "OK") list = list.filter(c => urgency(c) === "green"); }
    list = [...list];
    if (sort === "expiry") list.sort((a, b) => daysToExpiry(a.end) - daysToExpiry(b.end)); else if (sort === "value") list.sort((a, b) => b.value - a.value); else list.sort((a, b) => a.supplier.localeCompare(b.supplier));
    return list;
  }, [contracts, search, filter, sort, showArchive]);

  const tab = (active: boolean, color: string): React.CSSProperties => ({ ...sans, flex: 1, padding: "8px 14px", borderRadius: 8, border: `1px solid ${active ? color : C.border}`, background: active ? color : "transparent", color: active ? "#fff" : C.muted, cursor: "pointer", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" });

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 14, alignItems: "center" }}>
        <div style={{ display: "flex", gap: 8, flex: "1 1 280px", maxWidth: 420 }}>
          <button onClick={() => setShowArchive(false)} style={tab(!showArchive, C.navy)}>🟢 Attivi ({contracts.filter(c => !c.ceased).length})</button>
          <button onClick={() => setShowArchive(true)} style={tab(showArchive, C.gray)}>⚫ Archivio ({contracts.filter(c => c.ceased).length})</button>
        </div>
        <div style={{ position: "relative", flex: "2 1 220px" }}>
          <span aria-hidden style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: C.subtle }}>🔍</span>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Cerca fornitore, oggetto, owner…" aria-label="Cerca" style={{ ...iStyle, background: C.surface, padding: "10px 12px 10px 36px" }} />
        </div>
        <select value={sort} onChange={e => setSort(e.target.value)} aria-label="Ordina" style={{ ...iStyle, width: "auto", background: C.surface, padding: "9px 10px", fontSize: 12, color: C.muted }}>
          <option value="expiry">Per scadenza</option><option value="value">Per valore</option><option value="supplier">Per fornitore</option>
        </select>
      </div>
      {!showArchive && <div style={{ display: "flex", gap: 6, marginBottom: 12, overflowX: "auto" }}>{["Attivi", "Urgenti", "In scadenza", "OK"].map(s => <button key={s} onClick={() => setFilter(s)} aria-pressed={filter === s} style={{ ...sans, padding: "5px 12px", borderRadius: 20, border: `1px solid ${filter === s ? C.accent : C.border}`, background: filter === s ? C.accentLight : "transparent", color: filter === s ? C.accent : C.muted, cursor: "pointer", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap", flexShrink: 0 }}>{s}</button>)}</div>}
      <div style={{ ...sans, fontSize: 12, color: C.muted, marginBottom: 10 }}>{filtered.length} contratti</div>
      {filtered.length === 0 && <Card style={{ textAlign: "center", color: C.muted, ...sans, fontSize: 13, padding: 32 }}>{contracts.length === 0 ? "Nessun contratto ancora. Creane uno con il pulsante ➕." : "Nessun contratto corrisponde ai filtri."}</Card>}
      <Grid min={340} gap={10}>
        {filtered.map(c => {
          const days = daysToExpiry(c.end); const lc = URGENCY_COLORS[urgency(c)];
          return (
            <div key={c.id} onClick={() => onSelect(c)} role="button" tabIndex={0} onKeyDown={e => { if (e.key === "Enter") onSelect(c); }}
              style={{ background: C.card, border: `1px solid ${C.border}`, borderLeft: `3px solid ${lc}`, borderRadius: 10, padding: 14, cursor: "pointer", opacity: c.ceased ? 0.7 : 1 }}
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
              {canViewTeam(currentUser) && <div style={{ ...sans, fontSize: 11, color: C.subtle, marginTop: 4 }}>Owner: {c.owner || "—"}</div>}
            </div>
          );
        })}
      </Grid>
    </div>
  );
}
