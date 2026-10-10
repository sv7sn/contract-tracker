import { useCallback, useEffect, useMemo, useState } from "react";
import type { SpendGroup, SpendPo, SpendSupplier, SpendView as View } from "../types.ts";
import { ApiError, portalApi } from "../api.ts";
import { btnGhost, C, font, iStyle, sans } from "../theme.ts";
import { fmt, fmtCompact, fmtDate } from "../lib/format.ts";
import { Card, CardTitle, EmptyState, Grid, StatCard } from "../components/ui.tsx";
import { HBars, MonthColumns } from "../components/charts.tsx";
import { AlertTriangle, Building2, FileText, Loader2, Scale, Search, Wallet } from "../components/icons.tsx";
import { CloseButton, Notice, Portal } from "../components/vendorUi.tsx";

const short = (n: number) => (Math.abs(n) >= 1e6 ? `${(n / 1e6).toLocaleString("it-IT", { maximumFractionDigits: 1 })} M` : Math.abs(n) >= 1e3 ? `${Math.round(n / 1e3)}k` : String(Math.round(n)));
const pct = (n: number) => `${n.toLocaleString("it-IT", { maximumFractionDigits: 1 })}%`;
const SOURCE: Record<string, string> = { net: "Valore netto del PO", pr: "Valore della RDA", gr: "Importo ricevuto", none: "Senza valore" };
const th = { textAlign: "right" as const };

/** Spesa reale dai file ordini SAP: dove va la spesa, quanto è coperta da contratti e quali ordini sfuggono al processo. */
export function SpendView({ onSessionExpired }: { onSessionExpired: () => void }) {
  const [year, setYear] = useState<number | undefined>(undefined);
  const [v, setV] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [openSup, setOpenSup] = useState<SpendSupplier | null>(null);
  const fail = useCallback((err: unknown) => {
    if (err instanceof ApiError && err.status === 401) { onSessionExpired(); return "Sessione scaduta"; }
    return err instanceof Error ? err.message : "Caricamento non riuscito";
  }, [onSessionExpired]);
  const load = useCallback(() => portalApi.spend(year).then(x => { setV(x); setError(null); }).catch(err => setError(fail(err))), [year, fail]);
  useEffect(() => { let off = false; portalApi.spend(year).then(x => { if (!off) { setV(x); setError(null); } }).catch(err => { if (!off) setError(fail(err)); }); return () => { off = true; }; }, [year, fail]);

  const suppliers = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (v?.bySupplier ?? []).filter(x => !s || `${x.code} ${x.name}`.toLowerCase().includes(s));
  }, [v, q]);

  if (error) return <EmptyState icon={<AlertTriangle size={26} />} title="Impossibile calcolare la spesa" text={error} action={<button onClick={load} style={{ ...btnGhost, padding: "9px 16px" }}>Riprova</button>} />;
  if (!v) return <div style={{ display: "flex", justifyContent: "center", padding: 60 }}><Loader2 className="spin" size={26} color={C.subtle} /></div>;
  if (v.year === null) return <EmptyState icon={<Wallet size={26} />} title="Nessun ordine importato" text="La spesa si costruisce dai file ordini di SAP (PO_LAST_7D) caricati dal modulo Task: ogni import aggiunge le righe nuove. Per avere subito lo storico, importa una volta un'estrazione ordini di un periodo più lungo con le stesse colonne." />;

  const unvalued = v.valued.none;
  const fromPr = v.valued.pr + v.valued.gr;
  const top10 = v.bySupplier.slice(0, 10);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <div>
          <div style={{ ...font, fontSize: 18, fontWeight: 700, color: C.text }}>Spesa {v.year}</div>
          <div style={{ ...sans, fontSize: 12, color: C.muted }}>Dagli ordini SAP importati{v.from && v.to ? ` · ordini dal ${fmtDate(v.from)} al ${fmtDate(v.to)}` : ""}</div>
        </div>
        <select value={v.year} onChange={e => setYear(Number(e.target.value))} aria-label="Anno" style={{ ...iStyle, width: "auto", minWidth: 110 }}>
          {v.years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      <Grid min={180} gap={12} fill style={{ marginBottom: 14 }}>
        <StatCard label="Spesa ordinata" value={fmtCompact(v.total)} sub={`${v.pos} PO · ${v.lines} righe`} color={C.blue} icon={<Wallet size={18} />} />
        <StatCard label="Fornitori" value={v.suppliers} sub={`${v.concentration.coreSuppliers} fanno l'80% · coda lunga ${v.concentration.tailSuppliers}`} color={C.accent} icon={<Building2 size={18} />} />
        <StatCard label="Copertura" value={pct(v.coverage.coveredShare)} sub={`Accordi SAP ${fmtCompact(v.coverage.agreement)} · registro ${fmtCompact(v.coverage.contract)}`} color={v.coverage.coveredShare >= 70 ? C.green : v.coverage.coveredShare >= 40 ? C.yellow : C.red} icon={<FileText size={18} />} />
        <StatCard label="Fuori processo" value={fmtCompact(v.noRda.value)} sub={`${v.noRda.lines} righe senza RDA né contratto`} color={v.noRda.lines ? C.red : C.green} icon={<AlertTriangle size={18} />} />
        <StatCard label="Primi 5 fornitori" value={pct(v.concentration.top5)} sub={`Primo: ${pct(v.concentration.top1)} · primi 10: ${pct(v.concentration.top10)}`} color={C.purple} icon={<Scale size={18} />} />
      </Grid>

      {fromPr > 0 && <Notice kind="info">Il file ordini standard non ha il valore netto del PO: per {fromPr} righe su {v.lines} il valore è quello della riga di RDA collegata{v.valued.gr ? " o l'importo già ricevuto" : ""}. {unvalued > 0 && <>{unvalued} righe (ordini su accordo quadro o senza RDA) non hanno nessun valore e non entrano nei totali. </>}Per la spesa esatta e il controllo "PO oltre la RDA" chiedi a IT di aggiungere all'estrazione la colonna <b>Net Order Value</b>: viene letta in automatico.</Notice>}
      {v.otherCurrency.lines > 0 && <Notice kind="warn">{v.otherCurrency.lines} righe in {v.otherCurrency.currencies.join(", ")} non sono sommate ai totali in euro.</Notice>}

      <Grid min={340} gap={14} style={{ marginBottom: 14 }}>
        <MonthColumns title="Spesa per mese" subtitle="Valore delle righe d'ordine per data del PO" unit="€" valueHead="Spesa" format={short}
          data={v.monthly.map(m => ({ month: m.month, value: m.value || null, note: `${m.pos} PO · ${fmt(m.value)}` }))} />
        <HBars title="Primi 10 fornitori" subtitle={`${pct(v.concentration.top10)} della spesa dell'anno`} data={top10.map(s => ({ label: s.name, n: s.value }))} format={fmtCompact} empty="Nessuna spesa" />
      </Grid>
      <Grid min={340} gap={14} style={{ marginBottom: 14 }}>
        <GroupBars title="Per categoria" subtitle="Gruppo merci SAP" data={v.byCategory} />
        <GroupBars title="Per funzione" subtitle="Dal Master Plan, per internal order o centro di costo" data={v.byFunction} />
      </Grid>

      <Card style={{ marginBottom: 14 }}>
        <CardTitle icon={<FileText size={17} />}>Copertura contrattuale</CardTitle>
        <CoverageBar v={v} />
        <p style={{ ...sans, fontSize: 12, color: C.subtle, margin: "10px 0 0", lineHeight: 1.55 }}>Coperta: ordine su accordo quadro SAP (colonna Agmt) oppure fornitore con un contratto nel registro valido alla data del PO. Il collegamento contratto–fornitore si fa dalla scheda del contratto.</p>
      </Card>

      {v.candidates.length > 0 && (
        <Card style={{ marginBottom: 14 }}>
          <CardTitle icon={<Scale size={17} />}>Candidati a contratto</CardTitle>
          <div style={{ ...sans, fontSize: 12.5, color: C.muted, marginBottom: 10 }}>Fornitori con più di {fmt(v.threshold)} di ordini nell'anno senza contratto né accordo quadro: valuta un contratto quadro o una gara.</div>
          <SupplierTable rows={v.candidates} onOpen={setOpenSup} />
        </Card>
      )}

      <Card style={{ marginBottom: 14 }}>
        <CardTitle icon={<AlertTriangle size={17} />}>Ordini senza RDA né contratto</CardTitle>
        {v.noRda.items.length === 0 ? <div style={{ ...sans, fontSize: 13, color: C.subtle }}>Nessuno: tutti gli ordini hanno una RDA, un accordo quadro o un contratto.</div> : <>
          <div style={{ ...sans, fontSize: 12.5, color: C.muted, marginBottom: 10 }}>Ordini emessi fuori dal processo RDA e senza copertura contrattuale{v.noRda.items.length < v.noRda.lines ? ` (i ${v.noRda.items.length} di valore più alto)` : ""}.</div>
          <PoTable rows={v.noRda.items} />
        </>}
      </Card>

      {v.overRda.available && (
        <Card style={{ marginBottom: 14 }}>
          <CardTitle icon={<AlertTriangle size={17} />}>PO oltre il valore della RDA</CardTitle>
          {v.overRda.items.length === 0 ? <div style={{ ...sans, fontSize: 13, color: C.subtle }}>Nessun ordine supera la RDA approvata.</div> : <PoTable rows={v.overRda.items} showPr />}
        </Card>
      )}

      <Card style={{ marginBottom: 14 }}>
        <CardTitle icon={<Building2 size={17} />}>Tutti i fornitori</CardTitle>
        <div style={{ position: "relative", maxWidth: 360, marginBottom: 10 }}>
          <Search size={16} color={C.subtle} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }} />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Cerca fornitore o codice SAP…" aria-label="Cerca fornitore" style={{ ...iStyle, paddingLeft: 36 }} />
        </div>
        <SupplierTable rows={suppliers} onOpen={setOpenSup} />
      </Card>
      <p style={{ ...sans, fontSize: 12, color: C.subtle, margin: "0 0 18px", lineHeight: 1.55 }}>
        Ogni import del file ordini dal modulo Task aggiunge le righe nuove e aggiorna quelle già viste: lo storico cresce giorno per giorno. Coda lunga: i fornitori oltre l'80% cumulato della spesa. Funzione: dal Master Plan, per internal order dell'ordine o, se manca, per centro di costo.
      </p>
      {openSup && <Portal><SupplierSheet s={openSup} year={v.year} fail={fail} onClose={() => setOpenSup(null)} /></Portal>}
    </div>
  );
}

function GroupBars({ title, subtitle, data }: { title: string; subtitle: string; data: SpendGroup[] }) {
  const top = data.slice(0, 8);
  const rest = data.slice(8).reduce((a, g) => a + g.value, 0);
  return <HBars title={title} subtitle={subtitle} format={fmtCompact} empty="Nessuna spesa" data={[...top.map(g => ({ label: g.label, n: g.value })), ...(rest > 0 ? [{ label: `Altre (${data.length - 8})`, n: Math.round(rest) }] : [])]} />;
}

function CoverageBar({ v }: { v: View }) {
  const parts = [{ k: "Accordo quadro SAP", n: v.coverage.agreement, c: C.green }, { k: "Contratto in registro", n: v.coverage.contract, c: C.blue }, { k: "Senza contratto", n: v.coverage.none, c: C.red }];
  const tot = parts.reduce((a, p) => a + p.n, 0) || 1;
  return (
    <div>
      <div role="img" aria-label={parts.map(p => `${p.k}: ${fmt(p.n)}`).join(", ")} style={{ display: "flex", gap: 2, height: 16, borderRadius: 4, overflow: "hidden", background: C.bg }}>
        {parts.filter(p => p.n > 0).map(p => <div key={p.k} style={{ width: `${(p.n / tot) * 100}%`, background: p.c }} />)}
      </div>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 8, ...sans, fontSize: 12.5, color: C.muted }}>
        {parts.map(p => <span key={p.k} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span style={{ width: 10, height: 10, borderRadius: 3, background: p.c }} />{p.k}: <b className="tabular" style={{ color: C.text }}>{fmt(p.n)}</b> ({pct(Math.round((p.n / tot) * 1000) / 10)})</span>)}
      </div>
    </div>
  );
}

function SupplierTable({ rows, onOpen }: { rows: SpendSupplier[]; onOpen: (s: SpendSupplier) => void }) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, 25);
  if (!rows.length) return <div style={{ ...sans, fontSize: 13, color: C.subtle }}>Nessun fornitore.</div>;
  return (
    <>
      <div className="table-wrap">
        <table className="data-table">
          <thead><tr><th>Fornitore</th><th style={th}>Spesa</th><th style={th}>Quota</th><th style={th}>PO</th><th style={th}>Senza contratto</th></tr></thead>
          <tbody>{shown.map(s => (
            <tr key={s.code || s.name} onClick={() => onOpen(s)} tabIndex={0} onKeyDown={e => { if (e.key === "Enter") onOpen(s); }}>
              <td style={{ minWidth: 220 }}><div style={{ fontWeight: 650, color: C.text }}>{s.name}</div><div style={{ fontSize: 12, color: C.muted }} className="tabular">{s.code || "senza codice"}{s.supplierId ? " · in anagrafica" : ""}</div></td>
              <td className="num tabular" style={{ fontWeight: 650 }}>{fmt(s.value)}</td>
              <td className="num tabular">{pct(s.share)}</td>
              <td className="num tabular">{s.pos}</td>
              <td className="num tabular" style={{ color: s.none > 0 ? C.red : C.subtle }}>{s.none > 0 ? fmt(s.none) : "—"}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {rows.length > 25 && <button onClick={() => setAll(x => !x)} style={{ ...btnGhost, marginTop: 10, padding: "7px 12px", fontSize: 12.5 }}>{all ? "Mostra i primi 25" : `Mostra tutti (${rows.length})`}</button>}
    </>
  );
}

function PoTable({ rows, showPr = false, showSupplier = true }: { rows: SpendPo[]; showPr?: boolean; showSupplier?: boolean }) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead><tr><th>PO</th><th>Data</th>{showSupplier && <th>Fornitore</th>}<th>Descrizione</th><th>Categoria</th><th style={th}>Valore</th>{showPr && <th style={th}>RDA</th>}</tr></thead>
        <tbody>{rows.map(p => (
          <tr key={`${p.po}-${p.item}`} style={{ cursor: "default" }}>
            <td className="tabular" style={{ whiteSpace: "nowrap" }}><b>{p.po}</b><span style={{ color: C.subtle }}> / {p.item}</span>{p.pr && <div style={{ fontSize: 11.5, color: C.subtle }}>RDA {p.pr}</div>}</td>
            <td style={{ whiteSpace: "nowrap", color: C.muted }}>{p.docDate ? fmtDate(p.docDate) : "—"}</td>
            {showSupplier && <td style={{ maxWidth: 200 }}>{p.supplierName || p.supplierCode}</td>}
            <td style={{ maxWidth: 260, color: C.muted }}>{p.shortText || "—"}</td>
            <td style={{ color: C.muted }}>{p.category}</td>
            <td className="num tabular" title={SOURCE[p.valueSource]}>{p.valueSource === "none" ? "—" : fmt(p.value)}</td>
            {showPr && <td className="num tabular" style={{ color: C.red }}>{fmt(p.prValue)}</td>}
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function SupplierSheet({ s, year, fail, onClose }: { s: SpendSupplier; year: number; fail: (e: unknown) => string; onClose: () => void }) {
  const [rows, setRows] = useState<SpendPo[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { let off = false; portalApi.spendLines(year, s.code || s.name).then(x => { if (!off) setRows(x); }).catch(e => { if (!off) setErr(fail(e)); }); return () => { off = true; }; }, [s, year, fail]);
  return (
    <div className="sheet-overlay" role="dialog" aria-modal="true" aria-label={s.name} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet" style={{ maxWidth: 820 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 14 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ ...font, fontSize: 18, fontWeight: 700 }}>{s.name}</div>
            <div style={{ ...sans, fontSize: 13, color: C.muted }}>{s.code ? `Codice SAP ${s.code}` : "Senza codice SAP"} · {year} · {fmt(s.value)} in {s.pos} PO ({pct(s.share)} della spesa)</div>
          </div>
          <CloseButton onClick={onClose} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 14 }}>
          {([["Su accordo quadro SAP", s.agreement], ["Con contratto in registro", s.contract], ["Senza contratto", s.none]] as [string, number][]).map(([k, x]) => (
            <div key={k} style={{ background: C.bg, borderRadius: 12, padding: "10px 12px" }}><div style={{ ...sans, fontSize: 11.5, color: C.muted }}>{k}</div><div className="tabular" style={{ ...sans, fontSize: 15, fontWeight: 650, color: k === "Senza contratto" && x > 0 ? C.red : C.text }}>{fmt(x)}</div></div>
          ))}
        </div>
        {err && <Notice kind="error">{err}</Notice>}
        {!rows && !err && <div style={{ display: "flex", justifyContent: "center", padding: 30 }}><Loader2 className="spin" size={22} color={C.subtle} /></div>}
        {rows && <PoTable rows={rows} showSupplier={false} />}
      </div>
    </div>
  );
}
