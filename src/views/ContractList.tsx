import { useMemo, useState } from "react";
import type { Contract, User } from "../types.ts";
import { C, iStyle, radius, sans, shadow, URGENCY_COLORS } from "../theme.ts";
import { daysToExpiry, fmt, fmtDate, urgency } from "../lib/format.ts";
import { canCreateContract, canViewTeam } from "../permissions.ts";
import { Avatar, Card, DaysChip, EmptyState, Grid, RenewalBadge } from "../components/ui.tsx";
import { Archive, FileText, LayoutGrid, Paperclip, Plus, Rows3, Search } from "../components/icons.tsx";

const VIEW_KEY = "contract-tracker:list-view";
const readView = (): "cards" | "table" => { try { return localStorage.getItem(VIEW_KEY) === "cards" ? "cards" : "table"; } catch { return "table"; } };

interface Props { contracts: Contract[]; currentUser: User; search: string; onSearch: (s: string) => void; onSelect: (c: Contract) => void; onNew: () => void }

export function ContractList({ contracts, currentUser, search, onSearch, onSelect, onNew }: Props) {
  const [filter, setFilter] = useState("Tutti"); const [showArchive, setShowArchive] = useState(false); const [sort, setSort] = useState("expiry");
  const [layout, setLayout] = useState<"cards" | "table">(readView);
  const setLayoutSaved = (l: "cards" | "table") => { setLayout(l); try { localStorage.setItem(VIEW_KEY, l); } catch { /* ignore */ } };
  const showOwner = canViewTeam(currentUser);

  const filtered = useMemo(() => {
    let list = showArchive ? contracts.filter(c => c.ceased) : contracts.filter(c => !c.ceased);
    if (search) list = list.filter(c => `${c.supplier} ${c.object} ${c.owner} ${c.category}`.toLowerCase().includes(search.toLowerCase()));
    if (!showArchive) { if (filter === "Urgenti") list = list.filter(c => urgency(c) === "red"); else if (filter === "In scadenza") list = list.filter(c => urgency(c) === "yellow"); else if (filter === "Regolari") list = list.filter(c => urgency(c) === "green"); }
    list = [...list];
    if (sort === "expiry") list.sort((a, b) => daysToExpiry(a.end) - daysToExpiry(b.end)); else if (sort === "value") list.sort((a, b) => b.value - a.value); else list.sort((a, b) => a.supplier.localeCompare(b.supplier));
    return list;
  }, [contracts, search, filter, sort, showArchive]);

  const count = (f: (c: Contract) => boolean) => contracts.filter(c => !c.ceased && f(c)).length;
  const filters: [string, number][] = [["Tutti", count(() => true)], ["Urgenti", count(c => urgency(c) === "red")], ["In scadenza", count(c => urgency(c) === "yellow")], ["Regolari", count(c => urgency(c) === "green")]];
  const seg = (active: boolean): React.CSSProperties => ({ ...sans, display: "flex", alignItems: "center", justifyContent: "center", gap: 7, padding: "8px 14px", border: "none", borderRadius: 9, background: active ? "#fff" : "transparent", color: active ? C.text : C.muted, cursor: "pointer", fontSize: 13, fontWeight: 600, boxShadow: active ? shadow.sm : "none", whiteSpace: "nowrap" });
  const iconBtn = (active: boolean): React.CSSProperties => ({ display: "flex", alignItems: "center", justifyContent: "center", width: 32, height: 30, border: "none", borderRadius: 8, background: active ? "#fff" : "transparent", color: active ? C.text : C.subtle, cursor: "pointer", boxShadow: active ? shadow.sm : "none" });

  return (
    <div style={{ display: "grid", gap: 14, gridTemplateColumns: "minmax(0,1fr)" }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
        <div role="tablist" style={{ display: "flex", gap: 2, background: "#e9ecf2", borderRadius: 12, padding: 3 }}>
          <button role="tab" aria-selected={!showArchive} onClick={() => setShowArchive(false)} style={seg(!showArchive)}><FileText size={15} />Attivi <span className="tabular" style={{ color: C.subtle, fontWeight: 600 }}>{contracts.filter(c => !c.ceased).length}</span></button>
          <button role="tab" aria-selected={showArchive} onClick={() => setShowArchive(true)} style={seg(showArchive)}><Archive size={15} />Archivio <span className="tabular" style={{ color: C.subtle, fontWeight: 600 }}>{contracts.filter(c => c.ceased).length}</span></button>
        </div>
        <div style={{ position: "relative", flex: "1 1 220px", minWidth: 200 }} className="mobile-only">
          <Search size={16} color={C.subtle} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }} />
          <input value={search} onChange={e => onSearch(e.target.value)} placeholder="Cerca fornitore, oggetto, owner…" aria-label="Cerca" style={{ ...iStyle, padding: "10px 12px 10px 36px" }} />
        </div>
        <div style={{ flex: 1 }} />
        <select value={sort} onChange={e => setSort(e.target.value)} aria-label="Ordina" style={{ ...iStyle, width: "auto", padding: "8px 10px", fontSize: 13, color: C.muted }}>
          <option value="expiry">Ordina per scadenza</option><option value="value">Ordina per valore</option><option value="supplier">Ordina per fornitore</option>
        </select>
        <div className="desktop-only-flex" role="group" aria-label="Vista" style={{ gap: 2, background: "#e9ecf2", borderRadius: 10, padding: 3 }}>
          <button onClick={() => setLayoutSaved("table")} aria-pressed={layout === "table"} title="Tabella" aria-label="Vista tabella" style={iconBtn(layout === "table")}><Rows3 size={16} /></button>
          <button onClick={() => setLayoutSaved("cards")} aria-pressed={layout === "cards"} title="Schede" aria-label="Vista a schede" style={iconBtn(layout === "cards")}><LayoutGrid size={16} /></button>
        </div>
      </div>

      {!showArchive && (
        <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 2 }}>
          {filters.map(([s, n]) => { const on = filter === s; return (
            <button key={s} onClick={() => setFilter(s)} aria-pressed={on} style={{ ...sans, display: "flex", alignItems: "center", gap: 7, padding: "6px 13px", borderRadius: 999, border: `1px solid ${on ? C.navy : C.border}`, background: on ? C.navy : "#fff", color: on ? "#fff" : C.muted, cursor: "pointer", fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap", flexShrink: 0 }}>
              {s}<span className="tabular" style={{ fontSize: 11.5, opacity: .75 }}>{n}</span>
            </button>
          ); })}
        </div>
      )}

      {filtered.length === 0 ? (
        contracts.length === 0 ? (
          <EmptyState title="Nessun contratto ancora" text="Aggiungi il primo contratto con il suo documento: da quel momento ne seguiamo scadenze e rinnovi." action={canCreateContract(currentUser) && <button onClick={onNew} style={{ ...sans, display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 18px", background: C.accent, border: "none", borderRadius: 10, color: "#fff", fontWeight: 650, cursor: "pointer" }}><Plus size={17} />Crea il primo contratto</button>} />
        ) : <EmptyState icon={<Search size={26} />} title="Nessun risultato" text="Nessun contratto corrisponde a ricerca e filtri. Prova a toglierne qualcuno." action={<button onClick={() => { onSearch(""); setFilter("Tutti"); }} style={{ ...sans, padding: "9px 16px", background: "#fff", border: `1px solid ${C.border}`, borderRadius: 10, color: C.text, fontWeight: 600, cursor: "pointer" }}>Azzera filtri</button>} />
      ) : (<>
        {/* Tabella: solo su schermi larghi */}
        {layout === "table" && (
          <div className="table-wrap desktop-only">
            <table className="data-table">
              <thead><tr><th>Fornitore</th>{showOwner && <th>Owner</th>}<th>Scadenza</th><th>Rinnovo</th><th className="num">Valore</th><th aria-label="Documento" /></tr></thead>
              <tbody>
                {filtered.map(c => {
                  const days = daysToExpiry(c.end); const u = urgency(c);
                  return (
                    <tr key={c.id} onClick={() => onSelect(c)} tabIndex={0} onKeyDown={e => { if (e.key === "Enter") onSelect(c); }} style={{ opacity: c.ceased ? 0.7 : 1 }}>
                      <td style={{ boxShadow: `inset 3px 0 0 ${URGENCY_COLORS[u]}`, minWidth: 220 }}>
                        <div style={{ fontWeight: 650, color: C.text }}>{c.supplier}</div>
                        <div style={{ fontSize: 12, color: C.muted, marginTop: 1 }}>{c.object}</div>
                      </td>
                      {showOwner && <td><div style={{ display: "flex", alignItems: "center", gap: 8, whiteSpace: "nowrap" }}><Avatar name={c.owner || "?"} size={26} /><span style={{ color: C.muted }}>{c.owner || "—"}</span></div></td>}
                      <td style={{ whiteSpace: "nowrap" }}><div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-start" }}><span className="tabular" style={{ color: C.text }}>{fmtDate(c.end)}</span><DaysChip days={days} level={u} ceased={c.ceased} /></div></td>
                      <td>{c.ceased ? <span style={{ color: C.muted }}>Cessato</span> : <RenewalBadge status={c.renewal} />}</td>
                      <td className="num" style={{ fontWeight: 650, color: C.text, whiteSpace: "nowrap" }}>{fmt(c.value, c.currency)}</td>
                      <td style={{ width: 36, color: c.fileName ? C.subtle : "transparent" }}>{c.fileName && <Paperclip size={15} aria-label="Ha un documento" />}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Schede: telefono, oppure scelta esplicita su desktop */}
        <div className={layout === "table" ? "mobile-only" : undefined}>
          <Grid min={340} gap={12}>
            {filtered.map(c => {
              const days = daysToExpiry(c.end); const u = urgency(c);
              return (
                <Card key={c.id} className="lift" onClick={() => onSelect(c)} role="button" tabIndex={0} onKeyDown={e => { if (e.key === "Enter") onSelect(c); }}
                  style={{ padding: 16, cursor: "pointer", borderLeft: `4px solid ${URGENCY_COLORS[u]}`, borderRadius: radius.md, opacity: c.ceased ? 0.7 : 1 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ ...sans, fontSize: 14, fontWeight: 650, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.supplier}</div>
                      <div style={{ ...sans, fontSize: 12.5, color: C.muted, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.object}</div>
                    </div>
                    <div className="tabular" style={{ ...sans, fontSize: 14, fontWeight: 700, flexShrink: 0, color: C.text }}>{fmt(c.value, c.currency)}</div>
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center", flexWrap: "wrap" }}>
                    {c.ceased ? <span style={{ ...sans, fontSize: 11.5, color: C.gray, background: C.grayBg, borderRadius: 999, padding: "3px 10px", fontWeight: 600 }}>Cessato</span> : <RenewalBadge status={c.renewal} />}
                    <span style={{ marginLeft: "auto" }}><DaysChip days={days} level={u} ceased={c.ceased} /></span>
                  </div>
                  {showOwner && <div style={{ ...sans, display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: C.subtle, marginTop: 10 }}><Avatar name={c.owner || "?"} size={22} />{c.owner || "—"}<span style={{ marginLeft: "auto" }}>Scade il {fmtDate(c.end)}</span></div>}
                </Card>
              );
            })}
          </Grid>
        </div>
      </>)}
    </div>
  );
}
