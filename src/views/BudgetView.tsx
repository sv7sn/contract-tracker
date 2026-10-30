import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BudgetItem, BudgetLine, BudgetView as View, User } from "../types.ts";
import { ApiError, budgetTemplateUrl, demoSapFileUrl, importBudgetFile, portalApi } from "../api.ts";
import { btnGhost, btnPrimary, C, font, iStyle, radius, sans } from "../theme.ts";
import { fmt } from "../lib/format.ts";
import { Card, CardTitle, EmptyState, Field, Grid, StatCard } from "../components/ui.tsx";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Download,
  FileText,
  Loader2,
  PiggyBank,
  Search,
  Trash2,
  Upload,
} from "../components/icons.tsx";
import { CloseButton, Notice, Portal } from "../components/vendorUi.tsx";
import { locale, t } from "../i18n/index.ts";

const eur = (n: number | null) => (n === null ? "—" : fmt(n));
const pct = (used: number, budget: number | null) => (budget && budget > 0 ? Math.round((used / budget) * 100) : null);

/** Master Plan: budget per internal order, impegnato, in previsione e impegni futuri dei contratti. */
export function BudgetView({
  currentUser,
  notify,
  onSessionExpired,
}: {
  currentUser: User;
  notify: (m: string) => void;
  onSessionExpired: () => void;
}) {
  const [year, setYear] = useState<number | undefined>(undefined);
  const [v, setV] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [fn, setFn] = useState("all");
  const [onlyOver, setOnlyOver] = useState(false);
  const [openIo, setOpenIo] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [demoBusy, setDemoBusy] = useState(false);
  const [label, setLabel] = useState("");
  const [upYear, setUpYear] = useState<number>(new Date().getFullYear());
  const fileRef = useRef<HTMLInputElement>(null);
  const fail = useCallback(
    (err: unknown) => {
      if (err instanceof ApiError && err.status === 401) {
        onSessionExpired();
        return t("Sessione scaduta");
      }
      return err instanceof Error ? err.message : t("Operazione non riuscita");
    },
    [onSessionExpired],
  );
  const [buyers, setBuyers] = useState<{ id: number; name: string }[]>([]);
  const isManager = currentUser.role === "manager";
  useEffect(() => {
    if (!isManager) return;
    let off = false;
    portalApi
      .config()
      .then(c => {
        if (!off) setBuyers(c.buyers.filter(b => b.active));
      })
      .catch(() => undefined);
    return () => {
      off = true;
    };
  }, [isManager]);
  const assign = async (io: string, userId: string) => {
    try {
      const r = await portalApi.setIoBuyer(io, userId ? Number(userId) : null);
      notify(
        userId
          ? r.moved
            ? t("Buyer assegnato · {n} RDA aperte passate a lui", { n: r.moved })
            : t("Buyer assegnato alla riga di budget")
          : t("Buyer tolto dalla riga"),
      );
      await load(year);
    } catch (e) {
      notify(fail(e));
    }
  };
  const load = useCallback(
    (y?: number) =>
      portalApi
        .budget(y)
        .then(x => {
          setV(x);
          setError(null);
        })
        .catch(err => setError(fail(err))),
    [fail],
  );
  useEffect(() => {
    let off = false;
    portalApi
      .budget(year)
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

  const fns = useMemo(() => [...new Set((v?.lines ?? []).map(l => l.function).filter(Boolean))].sort(), [v]);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (v?.lines ?? []).filter(
      l =>
        (fn === "all" || l.function === fn) &&
        (!onlyOver || (l.residual !== null && l.residual < 0) || (l.current === null && l.committed > 0)) &&
        (!s || `${l.io} ${l.description} ${l.function} ${l.costCenter}`.toLowerCase().includes(s)),
    );
  }, [v, q, fn, onlyOver]);

  if (error)
    return (
      <EmptyState
        icon={<AlertTriangle size={26} />}
        title={t("Impossibile caricare il Master Plan")}
        text={error}
        action={
          <button onClick={() => load(year)} style={{ ...btnGhost, padding: "9px 16px" }}>
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

  const future = v.year > v.currentYear;
  // I totali contano solo le righe a budget; gli impegni su internal order fuori Master Plan si vedono a parte.
  const inMp = shown.filter(l => l.current !== null),
    outMp = shown.filter(l => l.current === null);
  const sum = (ls: BudgetLine[], k: keyof BudgetLine) => ls.reduce((a, l) => a + (Number(l[k]) || 0), 0);
  const tot = {
    baseline: sum(inMp, "baseline"),
    current: sum(inMp, "current"),
    committed: sum(inMp, "committed"),
    pipeline: sum(inMp, "pipeline"),
    contracts: sum(inMp, "contracts"),
  };
  const outside = sum(outMp, "committed") + sum(outMp, "pipeline") + (future ? sum(outMp, "contracts") : 0);
  const residual = tot.current - tot.committed - tot.pipeline - (future ? tot.contracts : 0);
  const over = v.lines.filter(l => l.residual !== null && l.residual < 0).length;
  const noBudget = v.lines.filter(l => l.current === null && (l.committed > 0 || l.pipeline > 0)).length;

  const upload = async (f: File | undefined) => {
    if (!f) return;
    setUploading(true);
    try {
      const r = await importBudgetFile(f, upYear, label);
      const parts = [
        r.created.length ? t("nuove: {l}", { l: r.created.map(x => x.label).join(", ") }) : "",
        r.updated.length ? t("aggiornate: {l}", { l: r.updated.map(x => x.label).join(", ") }) : "",
      ]
        .filter(Boolean)
        .join(" · ");
      const by = r.buyersAssigned
        ? " · " +
          t("buyer assegnati a {n} righe", { n: r.buyersAssigned }) +
          (r.buyersMoved ? ", " + t("{n} RDA aperte passate a loro", { n: r.buyersMoved }) : "")
        : "";
      const miss = r.buyersUnmatched?.length ? " · " + t("buyer non riconosciuti: {l}", { l: r.buyersUnmatched.join(", ") }) : "";
      notify(t("Master Plan {y} caricato ({p})", { y: r.year, p: parts }) + by + miss);
      setLabel("");
      setYear(r.year);
      await load(r.year);
    } catch (err) {
      notify(`⚠️ ${fail(err)}`);
    }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
  };
  const loadDemo = async () => {
    setDemoBusy(true);
    try {
      const r = await portalApi.loadBudgetDemo();
      notify(
        t("Simulazione caricata: MP26 e MP27, {s} fornitori, {p} pratiche, {c} contratti", { s: r.suppliers, p: r.tasks, c: r.contracts }),
      );
      setYear(2026);
      await load(2026);
    } catch (err) {
      notify(`⚠️ ${fail(err)}`);
    }
    setDemoBusy(false);
  };
  const dropDemo = async () => {
    if (!window.confirm(t("Eliminare tutti i dati della simulazione (Master Plan, fornitori, RDA, PO, pratiche e contratti di prova)?")))
      return;
    setDemoBusy(true);
    try {
      await portalApi.deleteBudgetDemo();
      notify(t("Simulazione eliminata"));
      setYear(undefined);
      await load();
    } catch (err) {
      notify(`⚠️ ${fail(err)}`);
    }
    setDemoBusy(false);
  };
  const removeLast = async () => {
    const last = v.versions[v.versions.length - 1];
    if (!last) return;
    if (
      !window.confirm(
        t("Eliminare {l}?", { l: last.label }) + (last.version === 1 ? " " + t("È la versione di riferimento per il saving.") : ""),
      )
    )
      return;
    try {
      await portalApi.deleteBudgetVersion(last.id);
      notify(t("Versione eliminata"));
      await load(v.year);
    } catch (err) {
      notify(`⚠️ ${fail(err)}`);
    }
  };
  const th = { textAlign: "right" } as const;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
        <div>
          <div style={{ ...font, fontSize: 18, fontWeight: 700, color: C.text }}>Master Plan {v.year}</div>
          <div style={{ ...sans, fontSize: 12, color: C.muted }}>
            {v.versions.length
              ? t("Riferimento per il saving: {a} · in uso: {b}", { a: v.versions[0].label, b: v.versions[v.versions.length - 1].label })
              : t("Nessuna versione caricata per quest'anno")}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {currentUser.role === "manager" &&
            (v.demo ? (
              <button onClick={dropDemo} disabled={demoBusy} style={{ ...btnGhost, padding: "8px 12px", fontSize: 12.5, color: C.red }}>
                {t("Elimina simulazione")}
              </button>
            ) : (
              <button
                onClick={loadDemo}
                disabled={demoBusy}
                title={t(
                  "Carica dati di prova completi: MP26 (R3–R9) e MP27, fornitori, RDA aperte e ordinate con PO, acquisti, contratti",
                )}
                style={{ ...btnGhost, padding: "8px 12px", fontSize: 12.5, display: "inline-flex", alignItems: "center", gap: 6 }}
              >
                {demoBusy && <Loader2 className="spin" size={14} />}
                {t("Carica simulazione")}
              </button>
            ))}
          <select
            value={v.year}
            onChange={e => setYear(Number(e.target.value))}
            aria-label={t("Anno")}
            style={{ ...iStyle, width: "auto", minWidth: 120 }}
          >
            {[...new Set([...v.years, v.currentYear + 1])]
              .sort((a, b) => b - a)
              .map(y => (
                <option key={y} value={y}>
                  MP{String(y).slice(2)} · {y}
                </option>
              ))}
          </select>
        </div>
      </div>

      <Grid min={170} gap={12} fill style={{ marginBottom: 14 }}>
        <StatCard
          label={t("Budget in uso")}
          value={eur(tot.current)}
          sub={v.versions.length > 1 ? t("Prima versione: {v}", { v: eur(tot.baseline) }) : t("Ultima versione caricata")}
          color={C.blue}
          icon={<PiggyBank size={18} />}
        />
        <StatCard
          label={t("Impegnato")}
          value={eur(tot.committed)}
          sub={t("{p}% · RDA approvate e acquisti chiusi", { p: pct(tot.committed, tot.current) ?? "—" })}
          color={C.accent}
          icon={<CheckCircle2 size={18} />}
        />
        <StatCard
          label={t("In previsione")}
          value={eur(tot.pipeline)}
          sub={t("Pratiche aperte senza RDA")}
          color={C.yellow}
          icon={<Clock size={18} />}
        />
        <StatCard
          label={future ? t("Impegnato da contratti") : t("Quota contratti")}
          value={eur(tot.contracts)}
          sub={future ? t("Già impegnato per l'anno") : t("Diventa impegno con le RDA dell'anno")}
          color={C.purple}
          icon={<FileText size={18} />}
        />
        <StatCard
          label={t("Residuo")}
          value={eur(residual)}
          sub={over ? t("{n} internal order sforati", { n: over }) : t("Nessuno sforamento")}
          color={residual < 0 || over ? C.red : C.green}
          icon={<AlertTriangle size={18} />}
        />
        {outside > 0 && (
          <StatCard
            label={t("Fuori Master Plan")}
            value={eur(outside)}
            sub={t("{n} internal order non a budget", { n: outMp.length })}
            color={C.red}
            icon={<AlertTriangle size={18} />}
          />
        )}
      </Grid>

      {v.demo && (
        <Notice kind="info">
          <b>{t("Simulazione caricata")}</b>
          {t(
            ': internal order SIM…, fornitori con codice SAP SIMV…, RDA SIM-…, PO SIMPO…, contratti di categoria "Simulazione". La trovi anche in Task, Contratti, Fornitori e Indicatori. Per provare l\'importazione da SAP scarica i file di prova',
          )}{" "}
          <a href={demoSapFileUrl("pr")} style={{ color: "inherit", fontWeight: 650 }}>
            {t("RDA aperte")}
          </a>{" "}
          {t("e")}{" "}
          <a href={demoSapFileUrl("po")} style={{ color: "inherit", fontWeight: 650 }}>
            {t("ordini")}
          </a>{" "}
          {t(
            "e caricali dal modulo Task (attenzione: il file RDA sostituisce l'elenco delle RDA aperte). Elimina la simulazione dal pulsante in alto prima di caricare i dati veri.",
          )}
        </Notice>
      )}
      {(noBudget > 0 || v.unassigned.length > 0) && (
        <Notice kind="warn">
          {noBudget > 0 && <>{t("{n} internal order hanno impegni ma non sono nel Master Plan.", { n: noBudget })} </>}
          {v.unassigned.length > 0 && (
            <>{t("{n} RDA o pratiche non hanno un internal order: collegale qui sotto.", { n: v.unassigned.length })}</>
          )}
        </Notice>
      )}

      <Card style={{ marginBottom: 14, padding: "14px 16px" }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ position: "relative", flex: "1 1 240px", maxWidth: 360 }}>
            <Search size={16} color={C.subtle} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }} />
            <input
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder={t("Cerca internal order, descrizione…")}
              aria-label={t("Cerca")}
              style={{ ...iStyle, paddingLeft: 36 }}
            />
          </div>
          {fns.length > 0 && (
            <select
              value={fn}
              onChange={e => setFn(e.target.value)}
              aria-label={t("Funzione")}
              style={{ ...iStyle, width: "auto", minWidth: 160 }}
            >
              <option value="all">{t("Tutte le funzioni")}</option>
              {fns.map(f => (
                <option key={f}>{f}</option>
              ))}
            </select>
          )}
          <label style={{ ...sans, fontSize: 13, display: "flex", gap: 7, alignItems: "center", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={onlyOver}
              onChange={e => setOnlyOver(e.target.checked)}
              style={{ width: 16, height: 16, accentColor: C.accent }}
            />
            {t("Solo sforati o senza budget")}
          </label>
        </div>
      </Card>

      {v.lines.length === 0 ? (
        <EmptyState
          icon={<PiggyBank size={26} />}
          title={t("Nessun dato per quest'anno")}
          text={v.canUpload ? t("Carica il file del Master Plan qui sotto.") : t("Il Master Plan lo caricano Manager e Finance.")}
        />
      ) : (
        <div className="table-wrap" style={{ marginBottom: 14 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>{t("Internal order")}</th>
                <th>{t("Funzione")}</th>
                <th>{t("Buyer")}</th>
                <th style={th}>{v.versions[0]?.label ?? t("Prima versione")}</th>
                <th style={th}>{t("In uso")}</th>
                <th style={th}>{t("Impegnato")}</th>
                <th style={th}>{t("In previsione")}</th>
                <th style={th}>{future ? t("Contratti") : t("Quota contratti")}</th>
                <th style={th}>{t("Residuo")}</th>
                <th style={th}>{t("vs prima versione")}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(l => {
                const p = pct(l.committed + l.pipeline + (future ? l.contracts : 0), l.current);
                return (
                  <tr
                    key={l.io}
                    onClick={() => setOpenIo(l.io)}
                    tabIndex={0}
                    onKeyDown={e => {
                      if (e.key === "Enter") setOpenIo(l.io);
                    }}
                  >
                    <td style={{ minWidth: 220 }}>
                      <div style={{ fontWeight: 650, color: C.text }} className="tabular">
                        {l.io}
                      </div>
                      <div
                        style={{
                          fontSize: 12,
                          color: C.muted,
                          maxWidth: 320,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {l.description || (l.current === null ? t("Non presente nel Master Plan") : "")}
                      </div>
                    </td>
                    <td style={{ color: C.muted }}>{l.function || "—"}</td>
                    <td onClick={e => e.stopPropagation()} style={{ minWidth: 150 }}>
                      {isManager && l.current !== null ? (
                        <select
                          aria-label={t("Buyer di {io}", { io: l.io })}
                          value={l.buyerVia === "io" ? (l.buyerId ?? "") : ""}
                          onChange={e => assign(l.io, e.target.value)}
                          style={{ ...iStyle, padding: "6px 8px", fontSize: 12.5 }}
                        >
                          <option value="">
                            {l.buyerVia === "category" ? t("Auto · {n}", { n: l.buyerName ?? "" }) : t("Automatico")}
                          </option>
                          {buyers.map(b => (
                            <option key={b.id} value={b.id}>
                              {b.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span style={{ fontSize: 12.5, color: C.muted }}>
                          {l.buyerName ? `${l.buyerName}${l.buyerVia === "category" ? " (" + t("categoria") + ")" : ""}` : "—"}
                        </span>
                      )}
                    </td>
                    <td className="num tabular">{eur(l.baseline)}</td>
                    <td className="num tabular">{eur(l.current)}</td>
                    <td className="num tabular">{l.committed ? eur(l.committed) : "—"}</td>
                    <td className="num tabular">{l.pipeline ? eur(l.pipeline) : "—"}</td>
                    <td className="num tabular" style={{ color: future ? C.text : C.muted }}>
                      {l.contracts ? eur(l.contracts) : "—"}
                    </td>
                    <td className="num tabular" style={{ fontWeight: 650, color: l.residual !== null && l.residual < 0 ? C.red : C.text }}>
                      {eur(l.residual)}
                      {p !== null && (
                        <div style={{ fontSize: 11, fontWeight: 500, color: p > 100 ? C.red : p > 90 ? C.yellow : C.subtle }}>
                          {t("{p}% usato", { p })}
                        </div>
                      )}
                    </td>
                    <td className="num tabular" style={{ color: l.vsBaseline !== null && l.vsBaseline < 0 ? C.red : C.green }}>
                      {eur(l.vsBaseline)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p style={{ ...sans, fontSize: 12, color: C.subtle, margin: "0 0 18px", lineHeight: 1.55 }}>
        {t(
          "Impegnato: RDA approvate (aperte o già diventate ordine) e acquisti chiusi, nell'anno della RDA. In previsione: pratiche d'acquisto aperte senza RDA. Contratti: quota dell'anno dei contratti collegati all'internal order, in proporzione ai giorni; per gli anni futuri è già un impegno, per l'anno in corso diventa impegno con le RDA. \"vs prima versione\" è il riferimento del saving verso budget.",
        )}
      </p>

      {v.unassigned.length > 0 && (
        <UnassignedCard
          v={v}
          canEdit={currentUser.role === "manager" || currentUser.role === "buyer"}
          fail={fail}
          onSaved={() => load(v.year)}
          notify={notify}
        />
      )}

      {v.canUpload && (
        <Card>
          <CardTitle
            icon={<Upload size={16} />}
            action={
              <a
                href={budgetTemplateUrl}
                style={{
                  ...btnGhost,
                  padding: "6px 12px",
                  fontSize: 12.5,
                  textDecoration: "none",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <Download size={14} />
                {t("Modello")}
              </a>
            }
          >
            {t("Carica il Master Plan")}
          </CardTitle>
          <p style={{ ...sans, fontSize: 12.5, color: C.muted, margin: "-6px 0 12px", lineHeight: 1.55 }}>
            {t("Il file di Finance così com'è (Excel .xlsx o CSV):")} <b>Row Labels</b>{" "}
            {t("(internal order), CDC, CDC NAME, NAME, CATEGORIA,")} <b>BUYER</b>{" "}
            {t("(facoltativa: nome o email del buyer a cui assegnare la riga) e una colonna per versione —")} <b>MP26</b>
            {t(
              ", R3, R5, R7… Ogni colonna diventa una versione: MP26 resta il riferimento per il saving, l'ultima revisione è il budget in uso. Ricaricando il file con una revisione in più si aggiunge solo quella. L'anno si legge dalla colonna MP; anno e nome qui sotto servono solo per file con una sola colonna \"Budget\".",
            )}
          </p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
            <Field label={t("Anno")} htmlFor="b-year">
              <select id="b-year" value={upYear} onChange={e => setUpYear(Number(e.target.value))} style={{ ...iStyle, width: 120 }}>
                {[v.currentYear - 1, v.currentYear, v.currentYear + 1, v.currentYear + 2].map(y => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("Nome della versione (facoltativo)")} htmlFor="b-label">
              <input
                id="b-label"
                value={label}
                onChange={e => setLabel(e.target.value)}
                placeholder={t("Es. MP{yy} revisione giugno", { yy: String(upYear).slice(2) })}
                style={{ ...iStyle, width: 260 }}
              />
            </Field>
            <input ref={fileRef} type="file" hidden accept=".xlsx,.csv,.xml" onChange={e => upload(e.target.files?.[0])} />
            <div style={{ marginBottom: 14 }}>
              <button
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                style={{ ...btnPrimary, padding: "10px 16px", display: "inline-flex", alignItems: "center", gap: 7 }}
              >
                {uploading ? <Loader2 className="spin" size={15} /> : <Upload size={15} />}
                {t("Scegli il file")}
              </button>
            </div>
          </div>
          {v.versions.length > 0 && (
            <div style={{ display: "grid", gap: 2 }}>
              {v.versions.map((x, i) => (
                <div
                  key={x.id}
                  style={{
                    ...sans,
                    display: "flex",
                    gap: 10,
                    padding: "7px 0",
                    borderTop: `1px solid ${C.borderLight}`,
                    fontSize: 13,
                    flexWrap: "wrap",
                    alignItems: "center",
                  }}
                >
                  <b style={{ minWidth: 150 }}>{x.label}</b>
                  <span style={{ color: C.muted }}>
                    {x.lines} IO · {fmt(x.total)}
                  </span>
                  <span style={{ color: C.subtle, fontSize: 12 }}>
                    {new Date(x.uploadedAt).toLocaleDateString(locale())} · {x.uploadedBy} · {x.fileName}
                  </span>
                  {i === 0 && (
                    <span
                      style={{
                        fontSize: 11.5,
                        fontWeight: 650,
                        color: C.blue,
                        background: C.blueBg,
                        borderRadius: 999,
                        padding: "2px 9px",
                      }}
                    >
                      {t("Riferimento saving")}
                    </span>
                  )}
                  {i === v.versions.length - 1 && (
                    <button
                      onClick={removeLast}
                      aria-label={t("Elimina {l}", { l: x.label })}
                      style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: C.subtle }}
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {openIo && (
        <Portal>
          <IoSheet io={openIo} year={v.year} future={future} fail={fail} onClose={() => setOpenIo(null)} />
        </Portal>
      )}
    </div>
  );
}

function UnassignedCard({
  v,
  canEdit,
  fail,
  onSaved,
  notify,
}: {
  v: View;
  canEdit: boolean;
  fail: (e: unknown) => string;
  onSaved: () => void;
  notify: (m: string) => void;
}) {
  const [val, setVal] = useState<Record<number, string>>({});
  const ios = v.lines.filter(l => l.current !== null).map(l => l.io);
  const save = async (id: number) => {
    try {
      await portalApi.setTaskLinks(id, { internalOrder: val[id] ?? "" });
      notify(t("Internal order collegato"));
      onSaved();
    } catch (err) {
      notify(`⚠️ ${fail(err)}`);
    }
  };
  return (
    <Card style={{ marginBottom: 14 }}>
      <CardTitle icon={<AlertTriangle size={16} />}>{t("Senza internal order")}</CardTitle>
      <datalist id="mp-ios">
        {ios.map(x => (
          <option key={x} value={x} />
        ))}
      </datalist>
      {v.unassigned.slice(0, 50).map(u => (
        <div
          key={u.taskId}
          style={{
            ...sans,
            display: "flex",
            gap: 10,
            padding: "8px 0",
            borderTop: `1px solid ${C.borderLight}`,
            fontSize: 13,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <span style={{ flex: "1 1 260px", minWidth: 0 }}>
            <b>{u.title}</b>
            {u.costCenter && <span style={{ color: C.subtle }}> · {t("CdC {c}", { c: u.costCenter })}</span>}
          </span>
          <span className="tabular" style={{ color: C.muted }}>
            {fmt(u.value)}
          </span>
          {canEdit && (
            <>
              <input
                list="mp-ios"
                value={val[u.taskId] ?? ""}
                onChange={e => setVal(x => ({ ...x, [u.taskId]: e.target.value }))}
                placeholder={t("Internal order")}
                aria-label={t("Internal order")}
                style={{ ...iStyle, width: 190, padding: "6px 10px", fontSize: 13 }}
              />
              <button
                onClick={() => save(u.taskId)}
                disabled={!(val[u.taskId] ?? "").trim()}
                style={{ ...btnGhost, padding: "6px 12px", fontSize: 12.5 }}
              >
                {t("Collega")}
              </button>
            </>
          )}
        </div>
      ))}
    </Card>
  );
}

function IoSheet({
  io,
  year,
  future,
  fail,
  onClose,
}: {
  io: string;
  year: number;
  future: boolean;
  fail: (e: unknown) => string;
  onClose: () => void;
}) {
  const [d, setD] = useState<{ line: BudgetLine | null; items: BudgetItem[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let off = false;
    portalApi
      .budgetIo(io, year)
      .then(x => {
        if (!off) setD(x);
      })
      .catch(e => {
        if (!off) setErr(fail(e));
      });
    return () => {
      off = true;
    };
  }, [io, year, fail]);
  const l = d?.line;
  const KIND = { rda: t("RDA"), purchase: t("Acquisto"), contract: t("Contratto") };
  return (
    <div
      className="sheet-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={t("Internal order {io}", { io })}
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="sheet" style={{ maxWidth: 720 }}>
        <div className="sheet-head">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ ...font, fontSize: 18, fontWeight: 700 }} className="tabular">
              {io}
            </div>
            <div style={{ ...sans, fontSize: 13, color: C.muted }}>
              {l?.description}
              {l?.function ? ` · ${l.function}` : ""}
              {l?.costCenter ? " · " + t("CdC {c}", { c: l.costCenter }) : ""}
            </div>
          </div>
          <CloseButton onClick={onClose} />
        </div>
        {err && <Notice kind="error">{err}</Notice>}
        {!d && !err && (
          <div style={{ display: "flex", justifyContent: "center", padding: 30 }}>
            <Loader2 className="spin" size={22} color={C.subtle} />
          </div>
        )}
        {l && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10, marginBottom: 14 }}>
            {(
              [
                ["Prima versione", l.baseline],
                ["In uso", l.current],
                ["Impegnato", l.committed],
                ["In previsione", l.pipeline],
                [future ? "Contratti" : "Quota contratti", l.contracts],
                ["Residuo", l.residual],
              ] as [string, number | null][]
            ).map(([k, x]) => (
              <div key={k} style={{ background: C.bg, borderRadius: radius.md, padding: "10px 12px" }}>
                <div style={{ ...sans, fontSize: 11.5, color: C.muted }}>{t(k)}</div>
                <div
                  className="tabular"
                  style={{ ...sans, fontSize: 15, fontWeight: 650, color: k === "Residuo" && x !== null && x < 0 ? C.red : C.text }}
                >
                  {eur(x)}
                </div>
              </div>
            ))}
          </div>
        )}
        {d &&
          (d.items.length === 0 ? (
            <div style={{ ...sans, fontSize: 13, color: C.subtle }}>
              {t("Nessuna pratica o contratto su questo internal order nel {y}.", { y: year })}
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="data-table" style={{ minWidth: 520 }}>
                <thead>
                  <tr>
                    <th>{t("Tipo")}</th>
                    <th>{t("Pratica")}</th>
                    <th>{t("Stato")}</th>
                    <th className="num">{t("Importo")}</th>
                  </tr>
                </thead>
                <tbody>
                  {d.items.map(i => (
                    <tr key={`${i.kind}${i.id}`} style={{ cursor: "default" }}>
                      <td>{KIND[i.kind]}</td>
                      <td style={{ maxWidth: 300 }}>{i.title}</td>
                      <td style={{ color: C.muted, fontSize: 12.5 }}>{i.status}</td>
                      <td className="num tabular">{fmt(i.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
      </div>
    </div>
  );
}
