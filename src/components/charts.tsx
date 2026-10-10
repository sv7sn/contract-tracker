import { useState, type ReactNode } from "react";
import type { Contract } from "../types.ts";
import { C, CHART, font, radius, sans, shadow } from "../theme.ts";
import { daysToDeadline, keyDate, NOW } from "../lib/format.ts";
import { BarChart3, Table2 } from "./icons.tsx";

// Grafici disegnati a mano (nessuna libreria): segni sottili (max 24 px, 4 px arrotondati sul lato dei dati),
// 2 px di spazio tra segmenti, griglia appena visibile, etichette solo dove servono e tooltip al passaggio del mouse.
// Ogni grafico ha una "vista tabella" con gli stessi numeri, per chi non distingue i colori o usa uno screen reader.

interface TableData { head: string[]; rows: (string | number)[][] }

export function ChartCard({ title, subtitle, children, table, legend, aside }: { title: string; subtitle?: string; children: ReactNode; table: TableData; legend?: ReactNode; aside?: ReactNode }) {
  const [asTable, setAsTable] = useState(false);
  const tab = (on: boolean): React.CSSProperties => ({ ...sans, display: "flex", alignItems: "center", justifyContent: "center", width: 28, height: 26, border: "none", borderRadius: 7, background: on ? "#fff" : "transparent", color: on ? C.text : C.subtle, cursor: "pointer", boxShadow: on ? shadow.sm : "none" });
  return (
    <section style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: radius.lg, padding: 18, boxShadow: shadow.sm }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 14 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={{ ...font, margin: 0, fontSize: 15, fontWeight: 650, color: C.text }}>{title}</h3>
          {subtitle && <div style={{ ...sans, fontSize: 12, color: C.muted, marginTop: 2 }}>{subtitle}</div>}
        </div>
        {aside}
        <div role="group" aria-label="Vista" style={{ display: "flex", gap: 2, background: "#eef0f5", borderRadius: 9, padding: 2 }}>
          <button onClick={() => setAsTable(false)} aria-pressed={!asTable} title="Grafico" aria-label="Mostra il grafico" style={tab(!asTable)}><BarChart3 size={15} /></button>
          <button onClick={() => setAsTable(true)} aria-pressed={asTable} title="Tabella" aria-label="Mostra la tabella" style={tab(asTable)}><Table2 size={15} /></button>
        </div>
      </div>
      {asTable ? (
        <div style={{ overflowX: "auto" }}>
          <table className="data-table" style={{ fontSize: 12.5 }}>
            <thead><tr>{table.head.map((h, i) => <th key={h} className={i > 0 ? "num" : undefined} style={{ padding: "8px 10px" }}>{h}</th>)}</tr></thead>
            <tbody>{table.rows.map((r, i) => <tr key={i} style={{ cursor: "default" }}>{r.map((c, j) => <td key={j} className={j > 0 ? "num" : undefined} style={{ padding: "8px 10px" }}>{c}</td>)}</tr>)}</tbody>
          </table>
        </div>
      ) : (<>{children}{legend}</>)}
    </section>
  );
}

function Tip({ children, align = "center" }: { children: ReactNode; align?: "left" | "center" | "right" }) {
  const pos = align === "left" ? { left: 0 } : align === "right" ? { right: 0 } : { left: "50%", transform: "translateX(-50%)" };
  return <div role="tooltip" style={{ position: "absolute", bottom: "calc(100% + 8px)", ...pos, zIndex: 5, background: C.navy, color: "#fff", borderRadius: 10, padding: "8px 11px", fontSize: 12, lineHeight: 1.45, minWidth: 130, maxWidth: 240, boxShadow: shadow.md, pointerEvents: "none", ...sans }}>{children}</div>;
}

const monthShort = (d: Date) => d.toLocaleDateString("it-IT", { month: "short" }).replace(".", "");
const monthLong = (d: Date) => d.toLocaleDateString("it-IT", { month: "long", year: "numeric" });
const niceMax = (n: number) => (n <= 4 ? 4 : n <= 8 ? 8 : Math.ceil(n / 4) * 4);

// ─── Scadenze nei prossimi 12 mesi (colonne, una sola serie) ─────────────
export function ExpiryColumns({ contracts }: { contracts: Contract[] }) {
  const active = contracts.filter(c => !c.ceased);
  const months = Array.from({ length: 12 }, (_, i) => new Date(NOW.getFullYear(), NOW.getMonth() + i, 1));
  const data = months.map(m => ({ m, items: active.filter(c => { const e = new Date(keyDate(c)); return e.getFullYear() === m.getFullYear() && e.getMonth() === m.getMonth() && daysToDeadline(c) >= 0; }) }));
  const overdue = active.filter(c => daysToDeadline(c) < 0).length;
  const max = niceMax(Math.max(...data.map(d => d.items.length), 1));
  const peak = Math.max(...data.map(d => d.items.length));
  const [hover, setHover] = useState<number | null>(null);
  const H = 250;
  const total = data.reduce((a, d) => a + d.items.length, 0);

  return (
    <ChartCard
      title="Scadenze dei prossimi 12 mesi" subtitle={`${total} ${total === 1 ? "contratto in scadenza" : "contratti in scadenza"}${overdue ? ` · ${overdue} ${overdue === 1 ? "già scaduto" : "già scaduti"}` : ""}`}
      table={{ head: ["Mese", "Scadenze", "Contratti"], rows: data.map(d => [monthLong(d.m), d.items.length, d.items.map(x => x.supplier).join(", ") || "—"]) }}
    >
      <div style={{ display: "flex", gap: 8 }}>
        <div aria-hidden style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", height: H, paddingBottom: 0, ...sans, fontSize: 11, color: CHART.label, textAlign: "right", width: 18 }}>
          <span>{max}</span><span>{max / 2}</span><span>0</span>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ position: "relative", height: H }}>
            {[0, 0.5, 1].map(f => <div key={f} aria-hidden style={{ position: "absolute", left: 0, right: 0, top: `${f * 100}%`, height: 1, background: f === 1 ? CHART.axis : CHART.grid }} />)}
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "flex-end" }}>
              {data.map((d, i) => {
                const n = d.items.length;
                const h = n ? Math.max(6, (n / max) * H) : 0;
                const dim = hover !== null && hover !== i;
                return (
                  <div key={i} tabIndex={0} role="img" aria-label={`${monthLong(d.m)}: ${n} scadenze`}
                    onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}
                    style={{ flex: 1, height: "100%", display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center", position: "relative", cursor: "default", outline: "none" }}>
                    {hover === i && (
                      <Tip align={i < 2 ? "left" : i > 9 ? "right" : "center"}>
                        <div style={{ fontWeight: 650, textTransform: "capitalize" }}>{monthLong(d.m)}</div>
                        <div style={{ opacity: .8 }}>{n === 0 ? "Nessuna scadenza" : `${n} ${n === 1 ? "scadenza" : "scadenze"}`}</div>
                        {d.items.slice(0, 4).map(x => <div key={x.id} style={{ opacity: .9, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>• {x.supplier}</div>)}
                        {d.items.length > 4 && <div style={{ opacity: .7 }}>+ altri {d.items.length - 4}</div>}
                      </Tip>
                    )}
                    {n === peak && n > 0 && <div className="tabular" style={{ ...sans, fontSize: 11, fontWeight: 650, color: C.text, marginBottom: 3 }}>{n}</div>}
                    {n > 0 && <div style={{ width: "min(100%, 24px)", height: h, background: CHART.blue, borderRadius: "4px 4px 0 0", opacity: dim ? 0.45 : 1, transition: "opacity .12s ease" }} />}
                  </div>
                );
              })}
            </div>
          </div>
          <div style={{ display: "flex", marginTop: 6 }}>
            {data.map((d, i) => <div key={i} style={{ flex: 1, textAlign: "center", ...sans, fontSize: 11, color: CHART.label, textTransform: "capitalize" }}>{monthShort(d.m)}</div>)}
          </div>
        </div>
      </div>
    </ChartCard>
  );
}

// ─── Stato di rinnovo (una barra a segmenti: parte sul totale) ───────────
const RENEWAL_SERIES: { key: string; color: string; ink: string }[] = [
  { key: "In negoziazione", color: CHART.blue, ink: "#fff" },
  { key: "Da rilanciare a gara", color: CHART.orange, ink: "#1a1a1a" },
  { key: "Rinnovo automatico", color: CHART.aqua, ink: "#0b0b0b" },
  { key: "Da rescindere", color: CHART.violet, ink: "#fff" },
  { key: "Non definito", color: CHART.neutral, ink: "#0b0b0b" },
];

export function RenewalStack({ contracts }: { contracts: Contract[] }) {
  const active = contracts.filter(c => !c.ceased);
  const counts = RENEWAL_SERIES.map(s => ({ ...s, n: active.filter(c => (c.renewal || "Non definito") === s.key).length }));
  const total = active.length;
  const [hover, setHover] = useState<number | null>(null);
  const visible = counts.filter(s => s.n > 0);

  return (
    <ChartCard
      title="A che punto sono i rinnovi" subtitle={`${total} contratti attivi, per decisione presa`}
      table={{ head: ["Stato", "Contratti", "Quota"], rows: counts.map(s => [s.key, s.n, total ? `${Math.round((s.n / total) * 100)}%` : "0%"]) }}
      legend={
        <ul style={{ listStyle: "none", margin: "18px 0 0", padding: 0, display: "grid", gap: 9 }}>
          {counts.map(s => (
            <li key={s.key} style={{ display: "flex", alignItems: "center", gap: 10, ...sans, fontSize: 13, color: C.text, opacity: s.n === 0 ? 0.45 : 1 }}>
              <span aria-hidden style={{ width: 10, height: 10, borderRadius: 3, background: s.color, flexShrink: 0 }} />
              <span style={{ flex: 1 }}>{s.key}</span>
              <span className="tabular" style={{ fontWeight: 650 }}>{s.n}</span>
              <span className="tabular" style={{ color: C.subtle, width: 38, textAlign: "right", fontSize: 12 }}>{total ? Math.round((s.n / total) * 100) : 0}%</span>
            </li>
          ))}
        </ul>
      }
    >
      {total === 0 ? <div style={{ ...sans, fontSize: 13, color: C.muted, padding: "24px 0" }}>Nessun contratto attivo da mostrare.</div> : (
        <div style={{ display: "flex", gap: 2, height: 24, position: "relative" }}>
          {visible.map((s, idx) => {
            const i = counts.indexOf(s);
            const w = (s.n / total) * 100;
            const first = idx === 0, last = idx === visible.length - 1;
            return (
              <div key={s.key} tabIndex={0} role="img" aria-label={`${s.key}: ${s.n} contratti`}
                onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}
                style={{ flex: `${w} 0 0`, minWidth: 6, background: s.color, color: s.ink, display: "flex", alignItems: "center", justifyContent: "center", ...sans, fontSize: 12, fontWeight: 650, position: "relative", outline: "none", opacity: hover !== null && hover !== i ? 0.5 : 1, transition: "opacity .12s ease",
                  borderRadius: `${first ? 4 : 0}px ${last ? 4 : 0}px ${last ? 4 : 0}px ${first ? 4 : 0}px` }}>
                {w >= 9 && <span className="tabular">{s.n}</span>}
                {hover === i && <Tip align={idx === 0 ? "left" : last ? "right" : "center"}><div style={{ fontWeight: 650 }}>{s.key}</div><div style={{ opacity: .85 }}>{s.n} contratti · {Math.round(w)}%</div></Tip>}
              </div>
            );
          })}
        </div>
      )}
    </ChartCard>
  );
}

// ─── Valore per categoria (barre orizzontali, una sola serie) ────────────
const compactEUR = (n: number) => new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", notation: "compact", maximumFractionDigits: 1 }).format(n);

export function ValueBars({ contracts }: { contracts: Contract[] }) {
  const eur = contracts.filter(c => !c.ceased && c.currency === "EUR");
  const byCat = new Map<string, { value: number; n: number }>();
  for (const c of eur) { const k = c.category || "Altro"; const cur = byCat.get(k) ?? { value: 0, n: 0 }; byCat.set(k, { value: cur.value + c.value, n: cur.n + 1 }); }
  const rows = [...byCat.entries()].map(([k, v]) => ({ k, ...v })).sort((a, b) => b.value - a.value);
  const top = rows.slice(0, 6), rest = rows.slice(6);
  if (rest.length) top.push({ k: "Altre categorie", value: rest.reduce((a, r) => a + r.value, 0), n: rest.reduce((a, r) => a + r.n, 0) });
  const max = Math.max(...top.map(r => r.value), 1);
  const [hover, setHover] = useState<string | null>(null);
  const totalEUR = rows.reduce((a, r) => a + r.value, 0);

  return (
    <ChartCard
      title="Dove si concentra la spesa" subtitle={`Valore dei contratti attivi in euro · ${compactEUR(totalEUR)} in totale`}
      table={{ head: ["Categoria", "Valore (EUR)", "Contratti"], rows: top.map(r => [r.k, new Intl.NumberFormat("it-IT").format(r.value), r.n]) }}
    >
      {top.length === 0 ? <div style={{ ...sans, fontSize: 13, color: C.muted, padding: "24px 0" }}>Nessun contratto in euro da mostrare.</div> : (
        <div style={{ display: "grid", gap: 12 }}>
          {top.map(r => (
            <div key={r.k} tabIndex={0} role="img" aria-label={`${r.k}: ${compactEUR(r.value)}, ${r.n} contratti`}
              onMouseEnter={() => setHover(r.k)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(r.k)} onBlur={() => setHover(null)}
              style={{ display: "grid", gridTemplateColumns: "minmax(80px, 150px) 1fr", alignItems: "center", gap: 12, outline: "none", position: "relative", padding: "2px 0", opacity: hover && hover !== r.k ? 0.55 : 1, transition: "opacity .12s ease" }}>
              <div style={{ ...sans, fontSize: 12.5, color: C.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.k}>{r.k}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                <div style={{ height: 16, width: `${Math.max(2, (r.value / max) * 100)}%`, maxWidth: "calc(100% - 64px)", background: CHART.blue, borderRadius: "0 4px 4px 0" }} />
                <span className="tabular" style={{ ...sans, fontSize: 12, fontWeight: 650, color: C.text, whiteSpace: "nowrap" }}>{compactEUR(r.value)}</span>
              </div>
              {hover === r.k && <div role="tooltip" style={{ position: "absolute", top: -6, right: 0, transform: "translateY(-100%)", zIndex: 5, background: C.navy, color: "#fff", borderRadius: 10, padding: "7px 11px", fontSize: 12, boxShadow: shadow.md, pointerEvents: "none", ...sans }}><b>{r.k}</b><br />{new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(r.value)} · {r.n} {r.n === 1 ? "contratto" : "contratti"}</div>}
            </div>
          ))}
        </div>
      )}
    </ChartCard>
  );
}

// ─── Barre orizzontali generiche (una sola serie: quantità per categoria) ───
export function HBars({ title, subtitle, data, unit = "", empty = "Nessun dato", format }: { title: string; subtitle?: string; data: { label: string; n: number }[]; unit?: string; empty?: string; format?: (n: number) => string }) {
  const f = format ?? ((n: number) => String(n));
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...data.map(d => d.n), 1);
  const total = data.reduce((a, d) => a + d.n, 0);
  return (
    <ChartCard title={title} subtitle={subtitle} table={{ head: ["Voce", unit ? `Valore (${unit})` : "Numero"], rows: data.map(d => [d.label, f(d.n)]) }}>
      {total === 0 ? <div style={{ ...sans, fontSize: 13, color: C.subtle, padding: "8px 0" }}>{empty}</div> : (
        <div style={{ display: "grid", gap: 10 }}>
          {data.map((d, i) => (
            <div key={d.label} tabIndex={0} role="img" aria-label={`${d.label}: ${f(d.n)}${unit ? ` ${unit}` : ""}`} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}
              style={{ display: "grid", gridTemplateColumns: "minmax(110px, 38%) 1fr auto", gap: 10, alignItems: "center", outline: "none", position: "relative" }}>
              <div style={{ ...sans, fontSize: 12.5, color: C.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.label}</div>
              <div style={{ height: 18, display: "flex", alignItems: "center", borderLeft: `1px solid ${CHART.axis}` }}>
                {d.n > 0 && <div style={{ height: 14, width: `${Math.max(2, (d.n / max) * 100)}%`, background: CHART.blue, borderRadius: "0 4px 4px 0", opacity: hover !== null && hover !== i ? 0.45 : 1, transition: "opacity .12s ease" }} />}
              </div>
              <div className="tabular" style={{ ...sans, fontSize: 12.5, fontWeight: 650, color: C.text, minWidth: 28, textAlign: "right" }}>{f(d.n)}</div>
              {hover === i && <Tip align="left"><div style={{ fontWeight: 650 }}>{d.label}</div><div style={{ opacity: .85 }}>{f(d.n)}{unit ? ` ${unit}` : ""}{(!unit || format) && total ? ` · ${Math.round((d.n / total) * 100)}% del totale` : ""}</div></Tip>}
            </div>
          ))}
        </div>
      )}
    </ChartCard>
  );
}

// ─── Colonne mensili generiche (una sola serie) ─────────────────────────
export function MonthColumns({ title, subtitle, data, unit, valueHead, format }: { title: string; subtitle?: string; data: { month: string; value: number | null; note: string }[]; unit: string; valueHead: string; format?: (n: number) => string }) {
  const f = format ?? ((n: number) => String(n));
  const [hover, setHover] = useState<number | null>(null);
  const max = niceMax(Math.max(...data.map(d => d.value ?? 0), 1));
  const H = 200;
  const label = (m: string) => new Date(`${m}-01T00:00:00`);
  return (
    <ChartCard title={title} subtitle={subtitle} table={{ head: ["Mese", valueHead, "Dettaglio"], rows: data.map(d => [monthLong(label(d.month)), d.value === null ? "—" : f(d.value), d.note]) }}>
      <div style={{ display: "flex", gap: 8 }}>
        <div aria-hidden style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", height: H, ...sans, fontSize: 11, color: CHART.label, textAlign: "right", width: format ? 64 : 22 }}><span>{f(max)}</span><span>{f(max / 2)}</span><span>0</span></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ position: "relative", height: H }}>
            {[0, 0.5, 1].map(f => <div key={f} aria-hidden style={{ position: "absolute", left: 0, right: 0, top: `${f * 100}%`, height: 1, background: f === 1 ? CHART.axis : CHART.grid }} />)}
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "flex-end" }}>
              {data.map((d, i) => (
                <div key={d.month} tabIndex={0} role="img" aria-label={`${monthLong(label(d.month))}: ${d.value ?? "nessun dato"} ${unit}`}
                  onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}
                  style={{ flex: 1, height: "100%", display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center", position: "relative", outline: "none" }}>
                  {hover === i && <Tip align={i < 1 ? "left" : i > data.length - 2 ? "right" : "center"}><div style={{ fontWeight: 650, textTransform: "capitalize" }}>{monthLong(label(d.month))}</div><div style={{ opacity: .85 }}>{d.value === null ? "Nessun dato" : `${f(d.value)} ${unit}`}</div><div style={{ opacity: .75 }}>{d.note}</div></Tip>}
                  {d.value !== null && <div className="tabular" style={{ ...sans, fontSize: 11, fontWeight: 650, color: C.text, marginBottom: 3 }}>{f(d.value)}</div>}
                  {d.value !== null && d.value > 0 && <div style={{ width: "min(100%, 24px)", height: Math.max(4, (d.value / max) * H), background: CHART.blue, borderRadius: "4px 4px 0 0", opacity: hover !== null && hover !== i ? 0.45 : 1 }} />}
                </div>
              ))}
            </div>
          </div>
          <div style={{ display: "flex", marginTop: 6 }}>{data.map(d => <div key={d.month} style={{ flex: 1, textAlign: "center", ...sans, fontSize: 11, color: CHART.label, textTransform: "capitalize" }}>{monthShort(label(d.month))}</div>)}</div>
        </div>
      </div>
    </ChartCard>
  );
}
