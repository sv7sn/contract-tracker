import { useState, type ReactNode } from "react";
import { C, font, iStyle, sans } from "../theme.ts";
import { HeadButton } from "./ui.tsx";
import { Plus, Search, SlidersHorizontal } from "./icons.tsx";
import { t } from "../i18n/index.ts";

/** Un numero in cima alla lista. Con onClick filtra l'elenco (premuto di nuovo, toglie il filtro). */
export interface CountItem { key: string; label: string; value: number | string; color: string; title?: string; active?: boolean; onClick?: () => void }

/**
 * Intestazione comune di Task, Contratti e Fornitori, uguale su PC e telefono: numeri in pillole, poi ricerca, filtri e "+ Nuovo".
 * Resta ferma in alto mentre scorre l'elenco. Sul telefono i filtri stanno dietro il pulsante Filtri; su PC sono in linea.
 */
export function ListHeader({ counts, search, onSearch, placeholder, filters, filtered, add }: {
  counts: CountItem[]; search: string; onSearch: (s: string) => void; placeholder: string;
  /** Menu a tendina e azioni secondarie della pagina. */
  filters: ReactNode;
  /** Un filtro diverso da quello iniziale è attivo: il pulsante Filtri si colora. */
  filtered?: boolean;
  add?: { label: string; onClick: () => void };
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="sticky-filters list-head">
      {counts.length > 0 && (
        <div className="chip-row" style={{ display: "flex", gap: 8, marginBottom: 8, overflowX: "auto", paddingBottom: 2 }}>
          {counts.map(x => (
            <button key={x.key} onClick={x.onClick} disabled={!x.onClick} aria-pressed={x.onClick ? !!x.active : undefined} title={x.title} className="count-pill"
              style={{ ...sans, display: "inline-flex", alignItems: "center", gap: 8, flexShrink: 0, padding: "7px 14px", borderRadius: 12, border: `1px solid ${x.active ? x.color : C.border}`, background: x.active ? `${x.color}14` : "#fff", cursor: x.onClick ? "pointer" : "default", color: C.text, fontSize: 13, fontWeight: 600 }}>
              <b className="tabular" style={{ ...font, fontSize: 17, color: x.value ? x.color : C.subtle }}>{x.value}</b>{x.label}
            </button>
          ))}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: "1 1 200px", maxWidth: 340, minWidth: 0 }}>
          <Search size={16} color={C.subtle} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }} />
          <input value={search} onChange={e => onSearch(e.target.value)} placeholder={placeholder} aria-label={t("Cerca")} style={{ ...iStyle, paddingLeft: 36 }} />
        </div>
        <HeadButton onClick={() => setOpen(o => !o)} label={t("Filtri")} active={open || filtered}><SlidersHorizontal size={18} /></HeadButton>
        {add && <HeadButton primary onClick={add.onClick} label={add.label}><Plus size={19} /></HeadButton>}
        <div className={`head-filters${open ? " open" : ""}`} style={{ gap: 8, alignItems: "center", flexWrap: "wrap", flex: "0 1 auto" }}>{filters}</div>
        {add && <button className="desktop-only-flex" onClick={add.onClick} style={{ ...sans, alignItems: "center", gap: 7, padding: "9px 16px", background: C.accent, border: "none", borderRadius: 10, color: "#fff", fontWeight: 650, cursor: "pointer", fontSize: 13, flexShrink: 0, marginLeft: "auto", boxShadow: "0 1px 2px rgba(200,82,42,.35)" }}><Plus size={16} />{add.label}</button>}
      </div>
    </div>
  );
}
