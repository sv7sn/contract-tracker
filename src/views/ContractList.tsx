import { useMemo, useState } from "react";
import type { Contract, Plans, User } from "../types.ts";
import { ContractCharts } from "./Dashboard.tsx";
import { contractCounts, type ContractFilter } from "../lib/contractCounts.ts";
import { ListHeader } from "../components/ListHeader.tsx";
import { filterButton, filterSelect } from "../components/listHeaderStyles.ts";
import { C, radius, sans, shadow, URGENCY_COLORS } from "../theme.ts";
import { closedLabel, daysToDeadline, expiredWithoutOutcome, fmt, fmtDate, urgency } from "../lib/format.ts";
import { canCreateContract, canViewTeam } from "../permissions.ts";
import { Avatar, Card, DaysChip, EmptyState, Grid, RenewalBadge } from "../components/ui.tsx";
import { BookOpen, LayoutGrid, Paperclip, Plus, Rows3, Search } from "../components/icons.tsx";
import { t } from "../i18n/index.ts";

const VIEW_KEY = "contract-tracker:list-view";
const readView = (): "cards" | "table" => {
  try {
    return localStorage.getItem(VIEW_KEY) === "cards" ? "cards" : "table";
  } catch {
    return "table";
  }
};

interface Props {
  contracts: Contract[];
  plans: Plans;
  currentUser: User;
  search: string;
  onSearch: (s: string) => void;
  onSelect: (c: Contract) => void;
  onNew: () => void;
  onOpenClauses?: () => void;
  onOpenKpi?: () => void;
}

export function ContractList({ contracts, plans, currentUser, search, onSearch, onSelect, onNew, onOpenClauses, onOpenKpi }: Props) {
  const [filter, setFilter] = useState<ContractFilter>("Tutti");
  const [showArchive, setShowArchive] = useState(false);
  const [sort, setSort] = useState("expiry");
  const [layout, setLayout] = useState<"cards" | "table">(readView);
  const setLayoutSaved = (l: "cards" | "table") => {
    setLayout(l);
    try {
      localStorage.setItem(VIEW_KEY, l);
    } catch {
      /* ignore */
    }
  };
  const showOwner = canViewTeam(currentUser);

  const filtered = useMemo(() => {
    let list = showArchive ? contracts.filter(c => c.ceased) : contracts.filter(c => !c.ceased);
    if (search) list = list.filter(c => `${c.supplier} ${c.object} ${c.owner} ${c.category}`.toLowerCase().includes(search.toLowerCase()));
    if (!showArchive) {
      if (filter === "Urgenti") list = list.filter(c => urgency(c) === "red");
      else if (filter === "In scadenza") list = list.filter(c => urgency(c) === "yellow");
      else if (filter === "In attesa del BO") list = list.filter(c => (plans[c.id] || []).some(s => s.status === "pending_bo"));
      else if (filter === "Regolari") list = list.filter(c => urgency(c) === "green");
    }
    list = [...list];
    if (sort === "expiry") list.sort((a, b) => daysToDeadline(a) - daysToDeadline(b));
    else if (sort === "value") list.sort((a, b) => b.value - a.value);
    else list.sort((a, b) => a.supplier.localeCompare(b.supplier));
    return list;
  }, [contracts, plans, search, filter, sort, showArchive]);

  const iconBtn = (active: boolean): React.CSSProperties => ({
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 32,
    height: 30,
    border: "none",
    borderRadius: 8,
    background: active ? "#fff" : "transparent",
    color: active ? C.text : C.subtle,
    cursor: "pointer",
    boxShadow: active ? shadow.sm : "none",
  });

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr)" }}>
      <ListHeader
        search={search}
        onSearch={onSearch}
        placeholder={t("Cerca fornitore, oggetto, owner…")}
        filtered={showArchive || sort !== "expiry"}
        counts={
          showArchive
            ? []
            : contractCounts(contracts, plans).map(x => ({
                ...x,
                active: !!x.filter && filter === x.filter,
                onClick: x.filter ? () => setFilter(filter === x.filter ? "Tutti" : x.filter!) : undefined,
              }))
        }
        add={canCreateContract(currentUser) ? { label: t("Nuovo contratto"), onClick: onNew } : undefined}
        filters={
          <>
            <select
              value={showArchive ? "archive" : "active"}
              onChange={e => setShowArchive(e.target.value === "archive")}
              aria-label={t("Contratti")}
              style={filterSelect}
            >
              <option value="active">
                {t("Attivi")} ({contracts.filter(c => !c.ceased).length})
              </option>
              <option value="archive">
                {t("Storico")} ({contracts.filter(c => c.ceased).length})
              </option>
            </select>
            <select value={sort} onChange={e => setSort(e.target.value)} aria-label={t("Ordina")} style={filterSelect}>
              <option value="expiry">{t("Ordina per scadenza")}</option>
              <option value="value">{t("Ordina per valore")}</option>
              <option value="supplier">{t("Ordina per fornitore")}</option>
            </select>
            {onOpenClauses && (
              <button onClick={onOpenClauses} style={filterButton}>
                <BookOpen size={15} />
                {t("Libreria clausole")}
              </button>
            )}
            <div
              className="desktop-only-flex"
              role="group"
              aria-label={t("Vista")}
              style={{ gap: 2, background: "#e9ecf2", borderRadius: 10, padding: 3 }}
            >
              <button
                onClick={() => setLayoutSaved("table")}
                aria-pressed={layout === "table"}
                title={t("Tabella")}
                aria-label={t("Vista tabella")}
                style={iconBtn(layout === "table")}
              >
                <Rows3 size={16} />
              </button>
              <button
                onClick={() => setLayoutSaved("cards")}
                aria-pressed={layout === "cards"}
                title={t("Schede")}
                aria-label={t("Vista a schede")}
                style={iconBtn(layout === "cards")}
              >
                <LayoutGrid size={16} />
              </button>
            </div>
          </>
        }
      />
      {filtered.length === 0 ? (
        contracts.length === 0 ? (
          <EmptyState
            title={t("Nessun contratto ancora")}
            text={t("Aggiungi il primo contratto con il suo documento: da quel momento ne seguiamo scadenze e rinnovi.")}
            action={
              canCreateContract(currentUser) && (
                <button
                  onClick={onNew}
                  style={{
                    ...sans,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "10px 18px",
                    background: C.accent,
                    border: "none",
                    borderRadius: 10,
                    color: "#fff",
                    fontWeight: 650,
                    cursor: "pointer",
                  }}
                >
                  <Plus size={17} />
                  {t("Crea il primo contratto")}
                </button>
              )
            }
          />
        ) : (
          <EmptyState
            icon={<Search size={26} />}
            title={t("Nessun risultato")}
            text={t("Nessun contratto corrisponde a ricerca e filtri. Prova a toglierne qualcuno.")}
            action={
              <button
                onClick={() => {
                  onSearch("");
                  setFilter("Tutti");
                }}
                style={{
                  ...sans,
                  padding: "9px 16px",
                  background: "#fff",
                  border: `1px solid ${C.border}`,
                  borderRadius: 10,
                  color: C.text,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {t("Azzera filtri")}
              </button>
            }
          />
        )
      ) : (
        <>
          {/* Tabella: solo su schermi larghi */}
          {layout === "table" && (
            <div className="table-wrap desktop-only">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t("Fornitore")}</th>
                    {showOwner && <th>{t("Owner")}</th>}
                    <th>{t("Scadenza")}</th>
                    <th>{t("Rinnovo")}</th>
                    <th className="num">{t("Valore")}</th>
                    <th aria-label={t("Documento")} />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(c => {
                    const days = daysToDeadline(c);
                    const u = urgency(c);
                    return (
                      <tr
                        key={c.id}
                        onClick={() => onSelect(c)}
                        tabIndex={0}
                        onKeyDown={e => {
                          if (e.key === "Enter") onSelect(c);
                        }}
                        style={{ opacity: c.ceased ? 0.7 : 1 }}
                      >
                        <td style={{ boxShadow: `inset 3px 0 0 ${URGENCY_COLORS[u]}`, minWidth: 220 }}>
                          <div style={{ fontWeight: 650, color: C.text }}>{c.supplier}</div>
                          <div style={{ fontSize: 12, color: C.muted, marginTop: 1 }}>{c.object}</div>
                        </td>
                        {showOwner && (
                          <td>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, whiteSpace: "nowrap" }}>
                              <Avatar name={c.owner || "?"} size={26} />
                              <span style={{ color: C.muted }}>{c.owner || "—"}</span>
                            </div>
                          </td>
                        )}
                        <td style={{ whiteSpace: "nowrap" }}>
                          <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-start" }}>
                            <span className="tabular" style={{ color: C.text }}>
                              {fmtDate(c.end)}
                            </span>
                            {c.noticeDate && (
                              <span className="tabular" style={{ fontSize: 11.5, color: C.muted }}>
                                {t("Disdetta entro {date}", { date: fmtDate(c.noticeDate) })}
                              </span>
                            )}
                            <DaysChip days={days} level={u} ceased={c.ceased && (closedLabel(c) ?? true)} />
                          </div>
                        </td>
                        <td>
                          {c.ceased ? (
                            <span style={{ color: C.muted }}>{closedLabel(c)}</span>
                          ) : expiredWithoutOutcome(c) ? (
                            <span style={{ color: C.text, fontWeight: 600 }}>{t("Scaduto senza esito")}</span>
                          ) : (
                            <RenewalBadge status={c.renewal} />
                          )}
                        </td>
                        <td className="num" style={{ fontWeight: 650, color: C.text, whiteSpace: "nowrap" }}>
                          {fmt(c.value, c.currency)}
                        </td>
                        <td style={{ width: 36, color: c.fileName ? C.subtle : "transparent" }}>
                          {c.fileName && <Paperclip size={15} aria-label={t("Ha un documento")} />}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Telefono: righe compatte di due righe, come i task */}
          <div className="mobile-only" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 8 }}>
            {filtered.map(c => {
              const days = daysToDeadline(c);
              const u = urgency(c);
              const status = c.ceased
                ? closedLabel(c)
                : expiredWithoutOutcome(c)
                  ? t("Scaduto senza esito")
                  : c.renewal && c.renewal !== "Non definito"
                    ? t(c.renewal)
                    : null;
              const rel = c.ceased
                ? ""
                : days < 0
                  ? t("scaduto da {n} gg", { n: -days })
                  : days === 0
                    ? t("scade oggi")
                    : t("tra {n} gg", { n: days });
              return (
                <Card
                  key={c.id}
                  className="task-row"
                  onClick={() => onSelect(c)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={e => {
                    if (e.key === "Enter") onSelect(c);
                  }}
                  style={{
                    padding: "0 13px",
                    cursor: "pointer",
                    borderRadius: radius.md,
                    borderLeft: `4px solid ${URGENCY_COLORS[u]}`,
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    boxSizing: "border-box",
                    opacity: c.ceased ? 0.7 : 1,
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="one-line" style={{ ...sans, fontSize: 14, color: C.text }}>
                      <b style={{ fontWeight: 650 }}>{c.supplier}</b> <span style={{ color: C.muted }}>{c.object}</span>
                    </div>
                    <div
                      className="one-line"
                      style={{ ...sans, display: "flex", gap: 6, alignItems: "center", marginTop: 5, fontSize: 12.5, color: C.muted }}
                    >
                      {status && (
                        <span
                          style={{
                            ...sans,
                            background: C.grayBg,
                            color: C.gray,
                            borderRadius: 999,
                            padding: "3px 10px",
                            fontSize: 11.5,
                            fontWeight: 650,
                            whiteSpace: "nowrap",
                          }}
                        >
                          {status}
                        </span>
                      )}
                      <span className="tabular one-line">
                        {fmtDate(c.end)}
                        {rel && (
                          <>
                            {" "}
                            · <span style={{ color: u === "green" ? undefined : URGENCY_COLORS[u] }}>{rel}</span>
                          </>
                        )}{" "}
                        · {fmt(c.value, c.currency)}
                      </span>
                    </div>
                  </div>
                  {showOwner && (
                    <span title={c.owner}>
                      <Avatar name={c.owner || "?"} size={24} />
                    </span>
                  )}
                </Card>
              );
            })}
          </div>

          {/* Schede: solo su desktop, se scelte */}
          {layout === "cards" && (
            <div className="desktop-only">
              <Grid min={340} gap={12}>
                {filtered.map(c => {
                  const days = daysToDeadline(c);
                  const u = urgency(c);
                  return (
                    <Card
                      key={c.id}
                      className="lift"
                      onClick={() => onSelect(c)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={e => {
                        if (e.key === "Enter") onSelect(c);
                      }}
                      style={{
                        padding: 16,
                        cursor: "pointer",
                        borderLeft: `4px solid ${URGENCY_COLORS[u]}`,
                        borderRadius: radius.md,
                        opacity: c.ceased ? 0.7 : 1,
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                        <div style={{ minWidth: 0 }}>
                          <div
                            style={{
                              ...sans,
                              fontSize: 14,
                              fontWeight: 650,
                              color: C.text,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {c.supplier}
                          </div>
                          <div
                            style={{
                              ...sans,
                              fontSize: 12.5,
                              color: C.muted,
                              marginTop: 1,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {c.object}
                          </div>
                        </div>
                        <div className="tabular" style={{ ...sans, fontSize: 14, fontWeight: 700, flexShrink: 0, color: C.text }}>
                          {fmt(c.value, c.currency)}
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center", flexWrap: "wrap" }}>
                        {c.ceased ? (
                          <span
                            style={{
                              ...sans,
                              fontSize: 11.5,
                              color: C.gray,
                              background: C.grayBg,
                              borderRadius: 999,
                              padding: "3px 10px",
                              fontWeight: 600,
                            }}
                          >
                            {closedLabel(c)}
                          </span>
                        ) : expiredWithoutOutcome(c) ? (
                          <span
                            style={{
                              ...sans,
                              fontSize: 11.5,
                              color: C.gray,
                              background: C.grayBg,
                              borderRadius: 999,
                              padding: "3px 10px",
                              fontWeight: 650,
                            }}
                          >
                            {t("Scaduto senza esito")}
                          </span>
                        ) : (
                          <RenewalBadge status={c.renewal} />
                        )}
                        <span style={{ marginLeft: "auto" }}>
                          <DaysChip days={days} level={u} ceased={c.ceased && (closedLabel(c) ?? true)} />
                        </span>
                      </div>
                      {showOwner && (
                        <div
                          style={{ ...sans, display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: C.subtle, marginTop: 10 }}
                        >
                          <Avatar name={c.owner || "?"} size={22} />
                          {c.owner || "—"}
                          <span style={{ marginLeft: "auto" }}>
                            {c.noticeDate
                              ? t("Disdetta entro {date}", { date: fmtDate(c.noticeDate) })
                              : t("Scade il {date}", { date: fmtDate(c.end) })}
                          </span>
                        </div>
                      )}
                    </Card>
                  );
                })}
              </Grid>
            </div>
          )}
        </>
      )}
      {!showArchive && <ContractCharts contracts={contracts} plans={plans} currentUser={currentUser} onOpenKpi={onOpenKpi} />}
    </div>
  );
}
