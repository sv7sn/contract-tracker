import { useMemo, useState } from "react";
import type { Contract, Plans, User } from "../types.ts";
import { ContractSummary, type ContractFilter } from "./Dashboard.tsx";
import { C, iStyle, radius, sans, shadow, URGENCY_COLORS } from "../theme.ts";
import { closedLabel, daysToDeadline, expiredWithoutOutcome, fmt, fmtDate, urgency } from "../lib/format.ts";
import { canCreateContract, canViewTeam } from "../permissions.ts";
import { Avatar, Card, DaysChip, EmptyState, Grid, RenewalBadge } from "../components/ui.tsx";
import { Archive, BookOpen, FileText, LayoutGrid, Paperclip, Plus, Rows3, Search, X } from "../components/icons.tsx";
import { t } from "../i18n/index.ts";

const VIEW_KEY = "contract-tracker:list-view";
const readView = (): "cards" | "table" => { try { return localStorage.getItem(VIEW_KEY) === "cards" ? "cards" : "table"; } catch { return "table"; } };

interface Props { contracts: Contract[]; plans: Plans; currentUser: User; search: string; onSearch: (s: string) => void; onSelect: (c: Contract) => void; onNew: () => void; onOpenClauses?: () => void; onOpenKpi?: () => void }

export function ContractList({ contracts, plans, currentUser, search, onSearch, onSelect, onNew, onOpenClauses, onOpenKpi }: Props) {
  const [filter, setFilter] = useState<ContractFilter>("Tutti"); const [showArchive, setShowArchive] = useState(false); const [sort, setSort] = useState("expiry");
  const [layout, setLayout] = useState<"cards" | "table">(readView);
  const setLayoutSaved = (l: "cards" | "table") => { setLayout(l); try { localStorage.setItem(VIEW_KEY, l); } catch { /* ignore */ } };
  const showOwner = canViewTeam(currentUser);

  const filtered = useMemo(() => {
    let list = showArchive ? contracts.filter(c => c.ceased) : contracts.filter(c => !c.ceased);
    if (search) list = list.filter(c => `${c.supplier} ${c.object} ${c.owner} ${c.category}`.toLowerCase().includes(search.toLowerCase()));
    if (!showArchive) { if (filter === "Urgenti") list = list.filter(c => urgency(c) === "red"); else if (filter === "In scadenza") list = list.filter(c => urgency(c) === "yellow"); else if (filter === "In attesa del BO") list = list.filter(c => (plans[c.id] || []).some(s => s.status === "pending_bo")); else if (filter === "Regolari") list = list.filter(c => urgency(c) === "green"); }
    list = [...list];
    if (sort === "expiry") list.sort((a, b) => daysToDeadline(a) - daysToDeadline(b)); else if (sort === "value") list.sort((a, b) => b.value - a.value); else list.sort((a, b) => a.supplier.localeCompare(b.supplier));
    return list;
  }, [contracts, plans, search, filter, sort, showArchive]);

  const seg = (active: boolean): React.CSSProperties => ({ ...sans, display: "flex", alignItems: "center", justifyContent: "center", gap: 7, padding: "8px 14px", border: "none", borderRadius: 9, background: active ? "#fff" : "transparent", color: active ? C.text : C.muted, cursor: "pointer", fontSize: 13, fontWeight: 600, boxShadow: active ? shadow.sm : "none", whiteSpace: "nowrap" });
  const iconBtn = (active: boolean): React.CSSProperties => ({ display: "flex", alignItems: "center", justifyContent: "center", width: 32, height: 30, border: "none", borderRadius: 8, background: active ? "#fff" : "transparent", color: active ? C.text : C.subtle, cursor: "pointer", boxShadow: active ? shadow.sm : "none" });

  return (
    <div style={{ display: "grid", gap: 14, gridTemplateColumns: "minmax(0,1fr)" }}>
      {!showArchive && <ContractSummary contracts={contracts} plans={plans} currentUser={currentUser} filter={filter} onFilter={setFilter} onOpenKpi={onOpenKpi} />}
      <div className="mobile-only" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <span className="desktop-only-flex" style={{ gap: 12, alignItems: "center" }}>{onOpenClauses && <button onClick={onOpenClauses} style={{ ...sans, display: "inline-flex", alignItems: "center", gap: 6, background: "#fff", border: `1px solid ${C.border}`, borderRadius: 10, padding: "7px 12px", fontSize: 13, fontWeight: 600, color: C.text, cursor: "pointer" }}><BookOpen size={15} />{t("Libreria clausole")}</button>}
        <select value={sort} onChange={e => setSort(e.target.value)} aria-label={t("Ordina")} style={{ ...iStyle, flex: 1, width: "auto", padding: "8px 10px", fontSize: 13, color: C.muted }}>
          <option value="expiry">{t("Ordina per scadenza")}</option><option value="value">{t("Ordina per valore")}</option><option value="supplier">{t("Ordina per fornitore")}</option>
        </select></span>
      </div>
      <div className="sticky-filters" style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
        <div role="tablist" style={{ display: "flex", gap: 2, background: "#e9ecf2", borderRadius: 12, padding: 3 }}>
          <button role="tab" aria-selected={!showArchive} onClick={() => setShowArchive(false)} style={seg(!showArchive)}><FileText size={15} />{t("Attivi")} <span className="tabular" style={{ color: C.subtle, fontWeight: 600 }}>{contracts.filter(c => !c.ceased).length}</span></button>
          <button role="tab" aria-selected={showArchive} onClick={() => setShowArchive(true)} style={seg(showArchive)}><Archive size={15} />{t("Storico")} <span className="tabular" style={{ color: C.subtle, fontWeight: 600 }}>{contracts.filter(c => c.ceased).length}</span></button>
        </div>
        <div style={{ position: "relative", flex: "1 1 220px", minWidth: 200 }} className="mobile-only">
          <Search size={16} color={C.subtle} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }} />
          <input value={search} onChange={e => onSearch(e.target.value)} placeholder={t("Cerca fornitore, oggetto, owner…")} aria-label={t("Cerca")} style={{ ...iStyle, padding: "10px 12px 10px 36px" }} />
        </div>
        <div style={{ flex: 1 }} />
        {onOpenClauses && <button onClick={onOpenClauses} style={{ ...sans, display: "inline-flex", alignItems: "center", gap: 6, background: "#fff", border: `1px solid ${C.border}`, borderRadius: 10, padding: "7px 12px", fontSize: 13, fontWeight: 600, color: C.text, cursor: "pointer" }}><BookOpen size={15} />{t("Libreria clausole")}</button>}
        <select value={sort} onChange={e => setSort(e.target.value)} aria-label={t("Ordina")} style={{ ...iStyle, width: "auto", padding: "8px 10px", fontSize: 13, color: C.muted }}>
          <option value="expiry">{t("Ordina per scadenza")}</option><option value="value">{t("Ordina per valore")}</option><option value="supplier">{t("Ordina per fornitore")}</option>
        </select>
        <div className="desktop-only-flex" role="group" aria-label={t("Vista")} style={{ gap: 2, background: "#e9ecf2", borderRadius: 10, padding: 3 }}>
          <button onClick={() => setLayoutSaved("table")} aria-pressed={layout === "table"} title={t("Tabella")} aria-label={t("Vista tabella")} style={iconBtn(layout === "table")}><Rows3 size={16} /></button>
          <button onClick={() => setLayoutSaved("cards")} aria-pressed={layout === "cards"} title={t("Schede")} aria-label={t("Vista a schede")} style={iconBtn(layout === "cards")}><LayoutGrid size={16} /></button>
        </div>
      </div>

      {!showArchive && filter !== "Tutti" && (
        <div style={{ ...sans, display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: C.muted }}>
          {t("Filtro")}: <b style={{ color: C.text }}>{t(filter)}</b>
          <button onClick={() => setFilter("Tutti")} style={{ ...sans, display: "inline-flex", alignItems: "center", gap: 4, background: "none", border: `1px solid ${C.border}`, borderRadius: 999, padding: "3px 10px", cursor: "pointer", fontSize: 12, color: C.muted }}><X size={12} />{t("Mostra tutti")}</button>
        </div>
      )}

      {filtered.length === 0 ? (
        contracts.length === 0 ? (
          <EmptyState title={t("Nessun contratto ancora")} text={t("Aggiungi il primo contratto con il suo documento: da quel momento ne seguiamo scadenze e rinnovi.")} action={canCreateContract(currentUser) && <button onClick={onNew} style={{ ...sans, display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 18px", background: C.accent, border: "none", borderRadius: 10, color: "#fff", fontWeight: 650, cursor: "pointer" }}><Plus size={17} />{t("Crea il primo contratto")}</button>} />
        ) : <EmptyState icon={<Search size={26} />} title={t("Nessun risultato")} text={t("Nessun contratto corrisponde a ricerca e filtri. Prova a toglierne qualcuno.")} action={<button onClick={() => { onSearch(""); setFilter("Tutti"); }} style={{ ...sans, padding: "9px 16px", background: "#fff", border: `1px solid ${C.border}`, borderRadius: 10, color: C.text, fontWeight: 600, cursor: "pointer" }}>{t("Azzera filtri")}</button>} />
      ) : (<>
        {/* Tabella: solo su schermi larghi */}
        {layout === "table" && (
          <div className="table-wrap desktop-only">
            <table className="data-table">
              <thead><tr><th>{t("Fornitore")}</th>{showOwner && <th>{t("Owner")}</th>}<th>{t("Scadenza")}</th><th>{t("Rinnovo")}</th><th className="num">{t("Valore")}</th><th aria-label={t("Documento")} /></tr></thead>
              <tbody>
                {filtered.map(c => {
                  const days = daysToDeadline(c); const u = urgency(c);
                  return (
                    <tr key={c.id} onClick={() => onSelect(c)} tabIndex={0} onKeyDown={e => { if (e.key === "Enter") onSelect(c); }} style={{ opacity: c.ceased ? 0.7 : 1 }}>
                      <td style={{ boxShadow: `inset 3px 0 0 ${URGENCY_COLORS[u]}`, minWidth: 220 }}>
                        <div style={{ fontWeight: 650, color: C.text }}>{c.supplier}</div>
                        <div style={{ fontSize: 12, color: C.muted, marginTop: 1 }}>{c.object}</div>
                      </td>
                      {showOwner && <td><div style={{ display: "flex", alignItems: "center", gap: 8, whiteSpace: "nowrap" }}><Avatar name={c.owner || "?"} size={26} /><span style={{ color: C.muted }}>{c.owner || "—"}</span></div></td>}
                      <td style={{ whiteSpace: "nowrap" }}><div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-start" }}><span className="tabular" style={{ color: C.text }}>{fmtDate(c.end)}</span>{c.noticeDate && <span className="tabular" style={{ fontSize: 11.5, color: C.muted }}>{t("Disdetta entro {date}", { date: fmtDate(c.noticeDate) })}</span>}<DaysChip days={days} level={u} ceased={c.ceased && (closedLabel(c) ?? true)} /></div></td>
                      <td>{c.ceased ? <span style={{ color: C.muted }}>{closedLabel(c)}</span> : expiredWithoutOutcome(c) ? <span style={{ color: C.red, fontWeight: 650 }}>{t("Scaduto senza esito")}</span> : <RenewalBadge status={c.renewal} />}</td>
                      <td className="num" style={{ fontWeight: 650, color: C.text, whiteSpace: "nowrap" }}>{fmt(c.value, c.currency)}</td>
                      <td style={{ width: 36, color: c.fileName ? C.subtle : "transparent" }}>{c.fileName && <Paperclip size={15} aria-label={t("Ha un documento")} />}</td>
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
              const days = daysToDeadline(c); const u = urgency(c);
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
                    {c.ceased ? <span style={{ ...sans, fontSize: 11.5, color: C.gray, background: C.grayBg, borderRadius: 999, padding: "3px 10px", fontWeight: 600 }}>{closedLabel(c)}</span> : expiredWithoutOutcome(c) ? <span style={{ ...sans, fontSize: 11.5, color: C.red, background: C.redBg, borderRadius: 999, padding: "3px 10px", fontWeight: 650 }}>{t("Scaduto senza esito")}</span> : <RenewalBadge status={c.renewal} />}
                    <span style={{ marginLeft: "auto" }}><DaysChip days={days} level={u} ceased={c.ceased && (closedLabel(c) ?? true)} /></span>
                  </div>
                  {showOwner && <div style={{ ...sans, display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: C.subtle, marginTop: 10 }}><Avatar name={c.owner || "?"} size={22} />{c.owner || "—"}<span style={{ marginLeft: "auto" }}>{c.noticeDate ? t("Disdetta entro {date}", { date: fmtDate(c.noticeDate) }) : t("Scade il {date}", { date: fmtDate(c.end) })}</span></div>}
                </Card>
              );
            })}
          </Grid>
        </div>
      </>)}
    </div>
  );
}
