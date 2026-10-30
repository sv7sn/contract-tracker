import { useCallback, useEffect, useMemo, useState } from "react";
import type { SpendGroup, SpendPo, SplitCase, SpendSupplier, SpendView as View } from "../types.ts";
import { ApiError, portalApi } from "../api.ts";
import { btnGhost, C, font, iStyle, sans } from "../theme.ts";
import { fmt, fmtCompact, fmtDate } from "../lib/format.ts";
import { Card, CardTitle, EmptyState, Grid, StatCard } from "../components/ui.tsx";
import { HBars, MonthColumns } from "../components/charts.tsx";
import { AlertTriangle, Building2, FileText, Loader2, Scale, Search, Wallet } from "../components/icons.tsx";
import { CloseButton, Notice, Portal } from "../components/vendorUi.tsx";
import { locale, t } from "../i18n/index.ts";

const short = (n: number) =>
  Math.abs(n) >= 1e6
    ? `${(n / 1e6).toLocaleString(locale(), { maximumFractionDigits: 1 })} M`
    : Math.abs(n) >= 1e3
      ? `${Math.round(n / 1e3)}k`
      : String(Math.round(n));
const pct = (n: number) => `${n.toLocaleString(locale(), { maximumFractionDigits: 1 })}%`;
const SOURCE: Record<string, string> = { net: "Valore netto del PO", pr: "Valore della RDA", gr: "Importo ricevuto", none: "Senza valore" };
const th = { textAlign: "right" as const };

/** Spesa reale dai file ordini SAP: dove va la spesa, quanto è coperta da contratti e quali ordini sfuggono al processo. */
export function SpendView({ onSessionExpired, canImport = true }: { onSessionExpired: () => void; canImport?: boolean }) {
  const [year, setYear] = useState<number | undefined>(undefined);
  const [v, setV] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [openSup, setOpenSup] = useState<SpendSupplier | null>(null);
  const fail = useCallback(
    (err: unknown) => {
      if (err instanceof ApiError && err.status === 401) {
        onSessionExpired();
        return t("Sessione scaduta");
      }
      return err instanceof Error ? err.message : t("Caricamento non riuscito");
    },
    [onSessionExpired],
  );
  const load = useCallback(
    () =>
      portalApi
        .spend(year)
        .then(x => {
          setV(x);
          setError(null);
        })
        .catch(err => setError(fail(err))),
    [year, fail],
  );
  useEffect(() => {
    let off = false;
    portalApi
      .spend(year)
      .then(x => {
        if (!off) {
          setV(x);
          setError(null);
        }
      })
      .catch(err => {
        if (!off) setError(fail(err));
      });
    return () => {
      off = true;
    };
  }, [year, fail]);

  const suppliers = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (v?.bySupplier ?? []).filter(x => !s || `${x.code} ${x.name}`.toLowerCase().includes(s));
  }, [v, q]);

  if (error)
    return (
      <EmptyState
        icon={<AlertTriangle size={26} />}
        title={t("Impossibile calcolare la spesa")}
        text={error}
        action={
          <button onClick={load} style={{ ...btnGhost, padding: "9px 16px" }}>
            {t("Riprova")}
          </button>
        }
      />
    );
  if (!v)
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: 60 }}>
        <Loader2 className="spin" size={26} color={C.subtle} />
      </div>
    );
  if (v.year === null)
    return (
      <EmptyState
        icon={<Wallet size={26} />}
        title={t("Nessun ordine importato")}
        text={
          canImport
            ? t(
                "La spesa si costruisce dai file ordini di SAP (PO_LAST_7D) caricati dal modulo Task: ogni import aggiunge le righe nuove. Per avere subito lo storico, importa una volta un'estrazione ordini di un periodo più lungo con le stesse colonne.",
              )
            : t(
                "Non sono ancora stati caricati ordini da SAP, quindi non c'è nulla da analizzare. Li carica il Buyer o il Manager dal modulo Task: appena ci sono, qui compaiono spesa, fornitori e categorie.",
              )
        }
      />
    );

  const unvalued = v.valued.none;
  const fromPr = v.valued.pr + v.valued.gr;
  const top10 = v.bySupplier.slice(0, 10);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <div>
          <div style={{ ...font, fontSize: 18, fontWeight: 700, color: C.text }}>{t("Spesa {y}", { y: v.year })}</div>
          <div style={{ ...sans, fontSize: 12, color: C.muted }}>
            {t("Dagli ordini SAP importati")}
            {v.from && v.to ? " · " + t("ordini dal {a} al {b}", { a: fmtDate(v.from), b: fmtDate(v.to) }) : ""}
          </div>
        </div>
        <select
          value={v.year}
          onChange={e => setYear(Number(e.target.value))}
          aria-label={t("Anno")}
          style={{ ...iStyle, width: "auto", minWidth: 110 }}
        >
          {v.years.map(y => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>

      <Grid min={180} gap={12} fill style={{ marginBottom: 14 }}>
        <StatCard
          label={t("Spesa ordinata")}
          value={fmtCompact(v.total)}
          sub={t("{p} PO · {l} righe", { p: v.pos, l: v.lines })}
          color={C.blue}
          icon={<Wallet size={18} />}
        />
        <StatCard
          label={t("Fornitori")}
          value={v.suppliers}
          sub={t("{a} fanno l'80% · coda lunga {b}", { a: v.concentration.coreSuppliers, b: v.concentration.tailSuppliers })}
          color={C.accent}
          icon={<Building2 size={18} />}
        />
        <StatCard
          label={t("Copertura")}
          value={pct(v.coverage.coveredShare)}
          sub={t("Accordi SAP {a} · registro {b}", { a: fmtCompact(v.coverage.agreement), b: fmtCompact(v.coverage.contract) })}
          color={v.coverage.coveredShare >= 70 ? C.green : v.coverage.coveredShare >= 40 ? C.yellow : C.red}
          icon={<FileText size={18} />}
        />
        <StatCard
          label={t("Fuori processo")}
          value={fmtCompact(v.noRda.value)}
          sub={t("{n} righe senza RDA né contratto", { n: v.noRda.lines })}
          color={v.noRda.lines ? C.red : C.green}
          icon={<AlertTriangle size={18} />}
        />
        <StatCard
          label={t("Possibili frazionamenti")}
          value={v.splits.cases.length}
          sub={
            v.splits.cases.length
              ? t("{v} complessivi", { v: fmtCompact(v.splits.cases.reduce((a, c) => a + c.total, 0)) })
              : t("Nessun caso")
          }
          color={v.splits.cases.length ? C.red : C.green}
          icon={<Scale size={18} />}
        />
        <StatCard
          label={t("Primi 5 fornitori")}
          value={pct(v.concentration.top5)}
          sub={t("Primo: {a} · primi 10: {b}", { a: pct(v.concentration.top1), b: pct(v.concentration.top10) })}
          color={C.purple}
          icon={<Scale size={18} />}
        />
      </Grid>

      {fromPr > 0 && (
        <Notice kind="info">
          {t("Il file ordini standard non ha il valore netto del PO: per {a} righe su {b} il valore è quello della riga di RDA collegata", {
            a: fromPr,
            b: v.lines,
          })}
          {v.valued.gr ? " " + t("o l'importo già ricevuto") : ""}.{" "}
          {unvalued > 0 && (
            <>{t("{n} righe (ordini su accordo quadro o senza RDA) non hanno nessun valore e non entrano nei totali.", { n: unvalued })} </>
          )}
          {t('Per la spesa esatta e il controllo "PO oltre la RDA" chiedi a IT di aggiungere all\'estrazione la colonna')}{" "}
          <b>Net Order Value</b>
          {t(": viene letta in automatico.")}
        </Notice>
      )}
      {v.otherCurrency.lines > 0 && (
        <Notice kind="warn">
          {t("{n} righe in {c} non sono sommate ai totali in euro.", {
            n: v.otherCurrency.lines,
            c: v.otherCurrency.currencies.join(", "),
          })}
        </Notice>
      )}

      <Grid min={340} gap={14} style={{ marginBottom: 14 }}>
        <MonthColumns
          title={t("Spesa per mese")}
          subtitle={t("Valore delle righe d'ordine per data del PO")}
          unit="€"
          valueHead={t("Spesa")}
          format={short}
          data={v.monthly.map(m => ({ month: m.month, value: m.value || null, note: `${m.pos} PO · ${fmt(m.value)}` }))}
        />
        <HBars
          title={t("Primi 10 fornitori")}
          subtitle={t("{p} della spesa dell'anno", { p: pct(v.concentration.top10) })}
          data={top10.map(s => ({ label: s.name, n: s.value }))}
          format={fmtCompact}
          empty={t("Nessuna spesa")}
        />
      </Grid>
      <Grid min={340} gap={14} style={{ marginBottom: 14 }}>
        <GroupBars title={t("Per categoria")} subtitle={t("Gruppo merci SAP")} data={v.byCategory} />
        <GroupBars title={t("Per funzione")} subtitle={t("Dal Master Plan, per internal order o centro di costo")} data={v.byFunction} />
      </Grid>

      {v.unclassified.groups > 0 && (
        <Notice kind="warn">
          {t(
            "{v} di spesa ({g} gruppi merci SAP) non sono collegati a una categoria unificata: classificali in Amministrazione → Configurazione → Categorie merceologiche.",
            { v: fmtCompact(v.unclassified.value), g: v.unclassified.groups },
          )}
        </Notice>
      )}
      {v.categoryBudget.length > 0 && (
        <Card style={{ marginBottom: 14 }}>
          <CardTitle icon={<Wallet size={17} />}>{t("Budget e spesa per categoria")}</CardTitle>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t("Categoria")}</th>
                  <th style={th}>{t("Budget Master Plan")}</th>
                  <th style={th}>{t("Spesa ordinata")}</th>
                  <th style={th}>{t("Scostamento")}</th>
                </tr>
              </thead>
              <tbody>
                {v.categoryBudget.map(c => {
                  const d = c.budget - c.spend;
                  return (
                    <tr key={c.label} style={{ cursor: "default" }}>
                      <td style={{ fontWeight: 650 }}>{c.label}</td>
                      <td className="num tabular">{c.budget ? fmt(c.budget) : "—"}</td>
                      <td className="num tabular">{fmt(c.spend)}</td>
                      <td className="num tabular" style={{ color: c.budget && d < 0 ? C.red : C.muted }}>
                        {c.budget ? fmt(d) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p style={{ ...sans, fontSize: 12, color: C.subtle, margin: "10px 0 0" }}>
            {t("La spesa è quella dei PO già emessi: il budget residuo include anche RDA aperte e contratti (vedi Master Plan).")}
          </p>
        </Card>
      )}

      <Card style={{ marginBottom: 14 }}>
        <CardTitle icon={<FileText size={17} />}>{t("Copertura contrattuale")}</CardTitle>
        <CoverageBar v={v} />
        <p style={{ ...sans, fontSize: 12, color: C.subtle, margin: "10px 0 0", lineHeight: 1.55 }}>
          {t(
            "Coperta: ordine su accordo quadro SAP (colonna Agmt) oppure fornitore con un contratto nel registro valido alla data del PO. Il collegamento contratto–fornitore si fa dalla scheda del contratto.",
          )}
        </p>
      </Card>

      {v.candidates.length > 0 && (
        <Card style={{ marginBottom: 14 }}>
          <CardTitle icon={<Scale size={17} />}>{t("Candidati a contratto")}</CardTitle>
          <div style={{ ...sans, fontSize: 12.5, color: C.muted, marginBottom: 10 }}>
            {t("Fornitori con più di {v} di ordini nell'anno senza contratto né accordo quadro: valuta un contratto quadro o una gara.", {
              v: fmt(v.threshold),
            })}
          </div>
          <SupplierTable rows={v.candidates} onOpen={setOpenSup} />
        </Card>
      )}

      <Card style={{ marginBottom: 14 }}>
        <CardTitle icon={<AlertTriangle size={17} />}>{t("Ordini senza RDA né contratto")}</CardTitle>
        {v.noRda.items.length === 0 ? (
          <div style={{ ...sans, fontSize: 13, color: C.subtle }}>
            {t("Nessuno: tutti gli ordini hanno una RDA, un accordo quadro o un contratto.")}
          </div>
        ) : (
          <>
            <div style={{ ...sans, fontSize: 12.5, color: C.muted, marginBottom: 10 }}>
              {t("Ordini emessi fuori dal processo RDA e senza copertura contrattuale")}
              {v.noRda.items.length < v.noRda.lines ? " " + t("(i {n} di valore più alto)", { n: v.noRda.items.length }) : ""}.
            </div>
            <PoTable rows={v.noRda.items} />
          </>
        )}
      </Card>

      <Card style={{ marginBottom: 14 }}>
        <CardTitle icon={<Scale size={17} />}>{t("Possibili frazionamenti")}</CardTitle>
        <div style={{ ...sans, fontSize: 12.5, color: C.muted, marginBottom: 10 }}>
          {t(
            "Più ordini o RDA entro {d} giorni, ciascuno sotto i {v}, che insieme superano la soglia del confronto tra offerte. Per gli ordini si guardano fornitore e categoria (esclusi quelli a contratto o accordo quadro); per le RDA richiedente e internal order. Sono segnalazioni da verificare, non violazioni.",
            { d: v.splits.windowDays, v: fmt(v.threshold) },
          )}
        </div>
        {v.splits.cases.length === 0 ? (
          <div style={{ ...sans, fontSize: 13, color: C.subtle }}>{t("Nessun caso.")}</div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {v.splits.cases.map((c, i) => (
              <SplitRow key={i} c={c} />
            ))}
          </div>
        )}
      </Card>

      {v.overRda.available && (
        <Card style={{ marginBottom: 14 }}>
          <CardTitle icon={<AlertTriangle size={17} />}>{t("PO oltre il valore della RDA")}</CardTitle>
          {v.overRda.items.length === 0 ? (
            <div style={{ ...sans, fontSize: 13, color: C.subtle }}>{t("Nessun ordine supera la RDA approvata.")}</div>
          ) : (
            <PoTable rows={v.overRda.items} showPr />
          )}
        </Card>
      )}

      <Card style={{ marginBottom: 14 }}>
        <CardTitle icon={<Building2 size={17} />}>{t("Tutti i fornitori")}</CardTitle>
        <div style={{ position: "relative", maxWidth: 360, marginBottom: 10 }}>
          <Search size={16} color={C.subtle} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }} />
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder={t("Cerca fornitore o codice SAP…")}
            aria-label={t("Cerca fornitore")}
            style={{ ...iStyle, paddingLeft: 36 }}
          />
        </div>
        <SupplierTable rows={suppliers} onOpen={setOpenSup} />
      </Card>
      <p style={{ ...sans, fontSize: 12, color: C.subtle, margin: "0 0 18px", lineHeight: 1.55 }}>
        {t(
          "Ogni import del file ordini dal modulo Task aggiunge le righe nuove e aggiorna quelle già viste: lo storico cresce giorno per giorno. Coda lunga: i fornitori oltre l'80% cumulato della spesa. Funzione: dal Master Plan, per internal order dell'ordine o, se manca, per centro di costo.",
        )}
      </p>
      {openSup && (
        <Portal>
          <SupplierSheet s={openSup} year={v.year} fail={fail} onClose={() => setOpenSup(null)} />
        </Portal>
      )}
    </div>
  );
}

function SplitRow({ c }: { c: SplitCase }) {
  return (
    <details style={{ border: `1px solid ${C.borderLight}`, borderRadius: 12, padding: "10px 14px" }}>
      <summary style={{ ...sans, cursor: "pointer", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", fontSize: 13.5 }}>
        <span style={{ fontWeight: 650, flex: "1 1 240px" }}>{c.who}</span>
        <span style={{ color: C.muted, fontSize: 12.5 }}>
          {c.kind === "po" ? t("Ordini") : t("RDA")} ·{" "}
          {t("{n} dal {a} al {b}", { n: c.items.length, a: fmtDate(c.from), b: fmtDate(c.to) })}
        </span>
        <b className="tabular" style={{ color: C.red }}>
          {fmt(c.total)}
        </b>
      </summary>
      <div style={{ marginTop: 8 }}>
        {c.items.map(i => (
          <div
            key={i.id}
            style={{ ...sans, display: "flex", gap: 10, padding: "5px 0", borderTop: `1px solid ${C.borderLight}`, fontSize: 12.5 }}
          >
            <span className="tabular" style={{ minWidth: 110 }}>
              {i.id}
            </span>
            <span style={{ color: C.muted, minWidth: 90 }}>{fmtDate(i.date)}</span>
            <span style={{ flex: 1, color: C.muted }}>{i.label}</span>
            <span className="tabular">{fmt(i.value)}</span>
          </div>
        ))}
      </div>
    </details>
  );
}

function GroupBars({ title, subtitle, data }: { title: string; subtitle: string; data: SpendGroup[] }) {
  const top = data.slice(0, 8);
  const rest = data.slice(8).reduce((a, g) => a + g.value, 0);
  return (
    <HBars
      title={title}
      subtitle={subtitle}
      format={fmtCompact}
      empty={t("Nessuna spesa")}
      data={[
        ...top.map(g => ({ label: g.label, n: g.value })),
        ...(rest > 0 ? [{ label: t("Altre ({n})", { n: data.length - 8 }), n: Math.round(rest) }] : []),
      ]}
    />
  );
}

function CoverageBar({ v }: { v: View }) {
  const parts = [
    { k: "Accordo quadro SAP", n: v.coverage.agreement, c: C.green },
    { k: "Contratto in registro", n: v.coverage.contract, c: C.blue },
    { k: "Senza contratto", n: v.coverage.none, c: C.red },
  ];
  const tot = parts.reduce((a, p) => a + p.n, 0) || 1;
  return (
    <div>
      <div
        role="img"
        aria-label={parts.map(p => `${t(p.k)}: ${fmt(p.n)}`).join(", ")}
        style={{ display: "flex", gap: 2, height: 16, borderRadius: 4, overflow: "hidden", background: C.bg }}
      >
        {parts
          .filter(p => p.n > 0)
          .map(p => (
            <div key={p.k} style={{ width: `${(p.n / tot) * 100}%`, background: p.c }} />
          ))}
      </div>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 8, ...sans, fontSize: 12.5, color: C.muted }}>
        {parts.map(p => (
          <span key={p.k} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: p.c }} />
            {t(p.k)}:{" "}
            <b className="tabular" style={{ color: C.text }}>
              {fmt(p.n)}
            </b>{" "}
            ({pct(Math.round((p.n / tot) * 1000) / 10)})
          </span>
        ))}
      </div>
    </div>
  );
}

function SupplierTable({ rows, onOpen }: { rows: SpendSupplier[]; onOpen: (s: SpendSupplier) => void }) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, 25);
  if (!rows.length) return <div style={{ ...sans, fontSize: 13, color: C.subtle }}>{t("Nessun fornitore.")}</div>;
  return (
    <>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>{t("Fornitore")}</th>
              <th style={th}>{t("Spesa")}</th>
              <th style={th}>{t("Quota")}</th>
              <th style={th}>{t("PO")}</th>
              <th style={th}>{t("Senza contratto")}</th>
            </tr>
          </thead>
          <tbody>
            {shown.map(s => (
              <tr
                key={s.code || s.name}
                onClick={() => onOpen(s)}
                tabIndex={0}
                onKeyDown={e => {
                  if (e.key === "Enter") onOpen(s);
                }}
              >
                <td style={{ minWidth: 220 }}>
                  <div style={{ fontWeight: 650, color: C.text }}>{s.name}</div>
                  <div style={{ fontSize: 12, color: C.muted }} className="tabular">
                    {s.code || t("senza codice")}
                    {s.supplierId ? " · " + t("in anagrafica") : ""}
                  </div>
                </td>
                <td className="num tabular" style={{ fontWeight: 650 }}>
                  {fmt(s.value)}
                </td>
                <td className="num tabular">{pct(s.share)}</td>
                <td className="num tabular">{s.pos}</td>
                <td className="num tabular" style={{ color: s.none > 0 ? C.red : C.subtle }}>
                  {s.none > 0 ? fmt(s.none) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > 25 && (
        <button onClick={() => setAll(x => !x)} style={{ ...btnGhost, marginTop: 10, padding: "7px 12px", fontSize: 12.5 }}>
          {all ? t("Mostra i primi 25") : t("Mostra tutti ({n})", { n: rows.length })}
        </button>
      )}
    </>
  );
}

function PoTable({ rows, showPr = false, showSupplier = true }: { rows: SpendPo[]; showPr?: boolean; showSupplier?: boolean }) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>{t("PO")}</th>
            <th>{t("Data")}</th>
            {showSupplier && <th>{t("Fornitore")}</th>}
            <th>{t("Descrizione")}</th>
            <th>{t("Categoria")}</th>
            <th style={th}>{t("Valore")}</th>
            {showPr && <th style={th}>{t("RDA")}</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map(p => (
            <tr key={`${p.po}-${p.item}`} style={{ cursor: "default" }}>
              <td className="tabular" style={{ whiteSpace: "nowrap" }}>
                <b>{p.po}</b>
                <span style={{ color: C.subtle }}> / {p.item}</span>
                {p.pr && <div style={{ fontSize: 11.5, color: C.subtle }}>{t("RDA {pr}", { pr: p.pr })}</div>}
              </td>
              <td style={{ whiteSpace: "nowrap", color: C.muted }}>{p.docDate ? fmtDate(p.docDate) : "—"}</td>
              {showSupplier && <td style={{ maxWidth: 200 }}>{p.supplierName || p.supplierCode}</td>}
              <td style={{ maxWidth: 260, color: C.muted }}>{p.shortText || "—"}</td>
              <td style={{ color: C.muted }}>{p.category}</td>
              <td className="num tabular" title={SOURCE[p.valueSource] ? t(SOURCE[p.valueSource]) : undefined}>
                {p.valueSource === "none" ? "—" : fmt(p.value)}
              </td>
              {showPr && (
                <td className="num tabular" style={{ color: C.red }}>
                  {fmt(p.prValue)}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SupplierSheet({ s, year, fail, onClose }: { s: SpendSupplier; year: number; fail: (e: unknown) => string; onClose: () => void }) {
  const [rows, setRows] = useState<SpendPo[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let off = false;
    portalApi
      .spendLines(year, s.code || s.name)
      .then(x => {
        if (!off) setRows(x);
      })
      .catch(e => {
        if (!off) setErr(fail(e));
      });
    return () => {
      off = true;
    };
  }, [s, year, fail]);
  return (
    <div
      className="sheet-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={s.name}
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="sheet" style={{ maxWidth: 820 }}>
        <div className="sheet-head">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ ...font, fontSize: 18, fontWeight: 700 }}>{s.name}</div>
            <div style={{ ...sans, fontSize: 13, color: C.muted }}>
              {s.code ? t("Codice SAP {c}", { c: s.code }) : t("Senza codice SAP")} · {year} ·{" "}
              {t("{v} in {n} PO ({p} della spesa)", { v: fmt(s.value), n: s.pos, p: pct(s.share) })}
            </div>
          </div>
          <CloseButton onClick={onClose} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 14 }}>
          {(
            [
              ["Su accordo quadro SAP", s.agreement],
              ["Con contratto in registro", s.contract],
              ["Senza contratto", s.none],
            ] as [string, number][]
          ).map(([k, x]) => (
            <div key={k} style={{ background: C.bg, borderRadius: 12, padding: "10px 12px" }}>
              <div style={{ ...sans, fontSize: 11.5, color: C.muted }}>{t(k)}</div>
              <div
                className="tabular"
                style={{ ...sans, fontSize: 15, fontWeight: 650, color: k === "Senza contratto" && x > 0 ? C.red : C.text }}
              >
                {fmt(x)}
              </div>
            </div>
          ))}
        </div>
        {err && <Notice kind="error">{err}</Notice>}
        {!rows && !err && (
          <div style={{ display: "flex", justifyContent: "center", padding: 30 }}>
            <Loader2 className="spin" size={22} color={C.subtle} />
          </div>
        )}
        {rows && <PoTable rows={rows} showSupplier={false} />}
      </div>
    </div>
  );
}
