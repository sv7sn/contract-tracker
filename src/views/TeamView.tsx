import { useMemo, useState } from "react";
import type { Contract, Plans } from "../types.ts";
import { btnGhost, C, CHART, font, radius, sans, shadow } from "../theme.ts";
import { fmtDate } from "../lib/format.ts";
import { calcWorkload, getSuggestions, stepLabel, teamMatrix, WORKLOAD_THRESHOLD } from "../lib/plan.ts";
import { Avatar, Card, Grid } from "../components/ui.tsx";
import { ChartCard } from "../components/charts.tsx";
import { Lightbulb } from "../components/icons.tsx";
import { t } from "../i18n/index.ts";

const OVERLOAD = "#d03b3b";

export function TeamView({
  contracts,
  plans,
  onApplySuggestion,
  onOpenContract,
}: {
  contracts: Contract[];
  plans: Plans;
  onApplySuggestion: (id: number, offset: number) => void;
  onOpenContract: (c: Contract) => void;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const workload = useMemo(() => calcWorkload(contracts, plans), [contracts, plans]);
  const suggestions = useMemo(() => getSuggestions(contracts, plans), [contracts, plans]);
  const months = Object.entries(workload).slice(0, 12);
  const maxVal = Math.max(4, ...months.map(([, m]) => m.total));
  const max = Math.ceil(maxVal / 4) * 4;
  const H = 150;
  const overloaded = (m: (typeof months)[number][1]) => Math.max(0, ...Object.values(m.byBuyer)) >= WORKLOAD_THRESHOLD;

  return (
    <div style={{ display: "grid", gap: 18, gridTemplateColumns: "minmax(0,1fr)" }}>
      <ChartCard
        title={t("Carico di lavoro del team")}
        subtitle={t("Attività di rinnovo ancora da fare, mese per mese. In rosso i mesi in cui almeno un buyer ha {n} o più attività.", {
          n: WORKLOAD_THRESHOLD,
        })}
        table={{
          head: [t("Mese"), t("Attività"), t("Buyer più carico")],
          rows: months.map(([, m]) => {
            const top = Object.entries(m.byBuyer).sort((a, b) => b[1] - a[1])[0];
            return [m.label, m.total, top ? `${top[0]} (${top[1]})` : "—"];
          }),
        }}
        legend={
          <div style={{ display: "flex", gap: 18, marginTop: 14, ...sans, fontSize: 12.5, color: C.muted }}>
            <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <span aria-hidden style={{ width: 10, height: 10, borderRadius: 3, background: CHART.blue }} />
              {t("Carico regolare")}
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <span aria-hidden style={{ width: 10, height: 10, borderRadius: 3, background: OVERLOAD }} />
              {t("Almeno un buyer sovraccarico")}
            </span>
          </div>
        }
      >
        <div style={{ display: "flex", gap: 8 }}>
          <div
            aria-hidden
            style={{
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              height: H,
              ...sans,
              fontSize: 11,
              color: CHART.label,
              textAlign: "right",
              width: 18,
            }}
          >
            <span>{max}</span>
            <span>{max / 2}</span>
            <span>0</span>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ position: "relative", height: H }}>
              {[0, 0.5, 1].map(f => (
                <div
                  key={f}
                  aria-hidden
                  style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    top: `${f * 100}%`,
                    height: 1,
                    background: f === 1 ? CHART.axis : CHART.grid,
                  }}
                />
              ))}
              <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "flex-end" }}>
                {months.map(([key, m], i) => {
                  const h = m.total ? Math.max(6, (m.total / max) * H) : 0;
                  const over = overloaded(m);
                  const people = Object.entries(m.byBuyer).sort((a, b) => b[1] - a[1]);
                  return (
                    <div
                      key={key}
                      tabIndex={0}
                      role="img"
                      aria-label={
                        over
                          ? t("{month}: {n} attività, un buyer è sovraccarico", { month: m.label, n: m.total })
                          : t("{month}: {n} attività", { month: m.label, n: m.total })
                      }
                      onMouseEnter={() => setHover(i)}
                      onMouseLeave={() => setHover(null)}
                      onFocus={() => setHover(i)}
                      onBlur={() => setHover(null)}
                      style={{
                        flex: 1,
                        height: "100%",
                        display: "flex",
                        flexDirection: "column",
                        justifyContent: "flex-end",
                        alignItems: "center",
                        position: "relative",
                        outline: "none",
                      }}
                    >
                      {hover === i && (
                        <div
                          role="tooltip"
                          style={{
                            position: "absolute",
                            bottom: "calc(100% + 8px)",
                            ...(i < 2 ? { left: 0 } : i > 9 ? { right: 0 } : { left: "50%", transform: "translateX(-50%)" }),
                            zIndex: 5,
                            background: C.navy,
                            color: "#fff",
                            borderRadius: 10,
                            padding: "8px 11px",
                            fontSize: 12,
                            lineHeight: 1.45,
                            minWidth: 140,
                            boxShadow: shadow.md,
                            pointerEvents: "none",
                            ...sans,
                          }}
                        >
                          <div style={{ fontWeight: 650, textTransform: "capitalize" }}>{m.label}</div>
                          <div style={{ opacity: 0.8 }}>{t("{n} attività", { n: m.total })}</div>
                          {people.slice(0, 5).map(([n, c]) => (
                            <div key={n} style={{ opacity: 0.9 }}>
                              • {n}: {c}
                            </div>
                          ))}
                        </div>
                      )}
                      {m.total > 0 && (
                        <div
                          className="tabular"
                          style={{ ...sans, fontSize: 11, fontWeight: 650, color: over ? OVERLOAD : C.muted, marginBottom: 3 }}
                        >
                          {m.total}
                        </div>
                      )}
                      {m.total > 0 && (
                        <div
                          style={{
                            width: "min(100%, 24px)",
                            height: h,
                            background: over ? OVERLOAD : CHART.blue,
                            borderRadius: "4px 4px 0 0",
                            opacity: hover !== null && hover !== i ? 0.45 : 1,
                            transition: "opacity .12s ease",
                          }}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            <div style={{ display: "flex", marginTop: 6 }}>
              {months.map(([k, m]) => (
                <div
                  key={k}
                  style={{ flex: 1, textAlign: "center", ...sans, fontSize: 11, color: CHART.label, textTransform: "capitalize" }}
                >
                  {m.label.split(" ")[0]}
                </div>
              ))}
            </div>
          </div>
        </div>
      </ChartCard>

      {suggestions.length > 0 && (
        <div style={{ background: C.yellowBg, border: "1px solid #f3dca0", borderRadius: radius.lg, padding: 16 }}>
          <div
            style={{
              ...font,
              fontSize: 15,
              fontWeight: 650,
              color: C.text,
              marginBottom: 12,
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <Lightbulb size={18} color={C.yellow} />
            {suggestions.length === 1
              ? t("1 suggerimento per bilanciare il carico")
              : t("{n} suggerimenti per bilanciare il carico", { n: suggestions.length })}
          </div>
          <Grid min={290} gap={10}>
            {suggestions.map(s => (
              <div key={s.contractId} style={{ background: "#fff", borderRadius: 12, padding: 14, border: `1px solid ${C.border}` }}>
                <div style={{ ...sans, fontSize: 13.5, fontWeight: 650, marginBottom: 3 }}>{s.supplier}</div>
                <div style={{ ...sans, fontSize: 12.5, color: C.muted, marginBottom: 12 }}>{s.reason}</div>
                <button
                  onClick={() => onApplySuggestion(s.contractId, s.recommendedOffset)}
                  style={{
                    ...sans,
                    padding: "7px 14px",
                    background: C.navy,
                    border: "none",
                    borderRadius: 9,
                    color: "#fff",
                    cursor: "pointer",
                    fontSize: 12.5,
                    fontWeight: 650,
                  }}
                >
                  {t("Anticipa di {n} giorni", { n: s.recommendedOffset })}
                </button>
              </div>
            ))}
          </Grid>
        </div>
      )}

      <TeamPlan contracts={contracts} plans={plans} onOpenContract={onOpenContract} />
    </div>
  );
}

/** Piano del team: buyer per riga, mesi per colonna. Ogni casella conta i passaggi di rinnovo da fare (in rosso oltre la soglia) e i contratti in scadenza; toccandola si vede il dettaglio. */
function TeamPlan({ contracts, plans, onOpenContract }: { contracts: Contract[]; plans: Plans; onOpenContract: (c: Contract) => void }) {
  const { months, buyers } = useMemo(() => teamMatrix(contracts, plans), [contracts, plans]);
  const [sel, setSel] = useState<{ buyer: string; month: string } | null>(null);
  const cur = sel ? buyers.find(b => b.name === sel.buyer)?.cells[sel.month] : undefined;
  const monthLabel = (k: string) => months.find(m => m.key === k)?.label ?? k;
  const total = (k: string) => buyers.reduce((a, b) => a + (b.cells[k]?.steps.length ?? 0), 0);
  if (!buyers.length)
    return (
      <Card>
        <div style={{ ...sans, fontSize: 13, color: C.muted }}>{t("Nessun passaggio di rinnovo nei prossimi 12 mesi.")}</div>
      </Card>
    );
  const th = {
    ...sans,
    fontSize: 11,
    fontWeight: 650,
    color: C.subtle,
    textTransform: "capitalize",
    padding: "8px 6px",
    textAlign: "center",
    whiteSpace: "nowrap",
  } as const;
  return (
    <Card>
      <div style={{ ...font, fontSize: 15, fontWeight: 650, color: C.text }}>{t("Piano del team per mese")}</div>
      <div style={{ ...sans, fontSize: 12.5, color: C.muted, margin: "2px 0 12px", lineHeight: 1.5 }}>
        {t(
          "Passaggi di rinnovo da fare per buyer e per mese; sotto il numero, i contratti in scadenza (o con termine di disdetta) quel mese. In rosso da {n} attività in su. Tocca una casella per il dettaglio.",
          { n: WORKLOAD_THRESHOLD },
        )}
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "separate", borderSpacing: 3, minWidth: 720, width: "100%" }}>
          <thead>
            <tr>
              <th style={{ ...th, textAlign: "left" }}>{t("Buyer")}</th>
              {months.map(m => (
                <th key={m.key} style={th}>
                  {m.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {buyers.map(b => (
              <tr key={b.name}>
                <td style={{ ...sans, fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", paddingRight: 8 }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                    <Avatar name={b.name} size={22} />
                    {b.name}
                  </span>
                </td>
                {months.map(m => {
                  const c = b.cells[m.key];
                  const n = c?.steps.length ?? 0,
                    e = c?.expiring.length ?? 0;
                  const over = n >= WORKLOAD_THRESHOLD,
                    on = sel?.buyer === b.name && sel.month === m.key;
                  return (
                    <td key={m.key} style={{ padding: 0 }}>
                      <button
                        type="button"
                        disabled={!n && !e}
                        onClick={() => setSel(on ? null : { buyer: b.name, month: m.key })}
                        aria-pressed={on}
                        aria-label={t("{buyer}, {month}: {n} attività, {e} scadenze", { buyer: b.name, month: m.label, n, e })}
                        style={{
                          all: "unset",
                          boxSizing: "border-box",
                          width: "100%",
                          minWidth: 44,
                          height: 44,
                          borderRadius: 8,
                          cursor: n || e ? "pointer" : "default",
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          justifyContent: "center",
                          background: over ? C.redBg : n ? C.blueBg : C.bg,
                          outline: on ? `2px solid ${C.accent}` : undefined,
                          ...sans,
                        }}
                      >
                        <span className="tabular" style={{ fontSize: 14, fontWeight: 700, color: over ? C.red : n ? C.blue : C.subtle }}>
                          {n || "–"}
                        </span>
                        {e > 0 && <span style={{ fontSize: 10, color: C.muted }}>{t("{n} scad.", { n: e })}</span>}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
            <tr>
              <td style={{ ...sans, fontSize: 12, fontWeight: 650, color: C.muted, paddingTop: 4 }}>{t("Totale")}</td>
              {months.map(m => (
                <td
                  key={m.key}
                  className="tabular"
                  style={{ ...sans, fontSize: 12, fontWeight: 650, color: C.muted, textAlign: "center", paddingTop: 4 }}
                >
                  {total(m.key) || ""}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      {sel && cur && (
        <div style={{ marginTop: 14, borderTop: `1px solid ${C.borderLight}`, paddingTop: 12 }}>
          <div style={{ ...sans, fontSize: 13.5, fontWeight: 650, marginBottom: 8, textTransform: "capitalize" }}>
            {sel.buyer} · {monthLabel(sel.month)}
          </div>
          {[...cur.steps]
            .sort((a, b) => a.date.localeCompare(b.date))
            .map((x, i) => (
              <div
                key={`s${i}`}
                style={{
                  ...sans,
                  display: "flex",
                  gap: 10,
                  alignItems: "center",
                  flexWrap: "wrap",
                  padding: "6px 0",
                  borderTop: `1px solid ${C.borderLight}`,
                  fontSize: 13,
                }}
              >
                <span className="tabular" style={{ minWidth: 84, color: C.muted }}>
                  {fmtDate(x.date)}
                </span>
                <span style={{ flex: "1 1 180px", fontWeight: 600 }}>{stepLabel(x.stepId, x.contract)}</span>
                <span style={{ flex: "1 1 200px", color: C.muted }}>
                  {x.contract.supplier} — {x.contract.object}
                </span>
                <button onClick={() => onOpenContract(x.contract)} style={{ ...btnGhost, padding: "4px 10px", fontSize: 12 }}>
                  {t("Apri contratto")}
                </button>
              </div>
            ))}
          {cur.expiring.map(c => (
            <div
              key={`e${c.id}`}
              style={{
                ...sans,
                display: "flex",
                gap: 10,
                alignItems: "center",
                flexWrap: "wrap",
                padding: "6px 0",
                borderTop: `1px solid ${C.borderLight}`,
                fontSize: 13,
              }}
            >
              <span className="tabular" style={{ minWidth: 84, color: C.red }}>
                {fmtDate(c.noticeDate || c.end)}
              </span>
              <span style={{ flex: "1 1 180px", fontWeight: 600, color: C.red }}>
                {c.noticeDate ? t("Termine disdetta") : t("Scadenza")}
              </span>
              <span style={{ flex: "1 1 200px", color: C.muted }}>
                {c.supplier} — {c.object}
              </span>
              <button onClick={() => onOpenContract(c)} style={{ ...btnGhost, padding: "4px 10px", fontSize: 12 }}>
                {t("Apri contratto")}
              </button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
