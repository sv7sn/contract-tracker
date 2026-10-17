import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Contract, ContractOutcome, EligibleSupplier, PlanStep, RdaSuggestion, Saving, SourcingMode, SourcingQuote, SupplierSummary, Task, TaskDetail, TaskList, User } from "../types.ts";
import { computeSaving } from "../lib/saving.ts";
import { DeliveryField, IoBudget, IoField, OutcomeCard, PraticaPart, RenewalCard } from "./TaskPratica.tsx";
import { ApiError, importSapFile, portalApi } from "../api.ts";
import { btnGhost, btnPrimary, C, font, iStyle, radius, sans } from "../theme.ts";
import { fmt, fmtDate, isoDate, NOW } from "../lib/format.ts";
import { stepTemplate } from "../lib/plan.ts";
import { taskSteps } from "../taskSteps.ts";
import { Avatar, Card, CardTitle, EmptyState, Field, Fold } from "../components/ui.tsx";
import { AlertTriangle, Check, CheckCircle2, FileText, Loader2, Paperclip, Plus, RotateCcw, Scale, Search, Send, Trash2, Upload } from "../components/icons.tsx";
import { CloseButton, KV, Notice, Portal, SupplierPicker } from "../components/vendorUi.tsx";
import { RfqCard } from "./RfqCard.tsx";
import * as i18n from "../i18n/index.ts";

interface Props {
  initialOpenId?: number; onFocusUsed?: () => void;
  currentUser: User; contracts: Contract[]; plans: Record<number, PlanStep[]>;
  onCompleteStep: (contractId: number, stepId: string) => void; onSendBO: (contractId: number) => void; onOpenContract: (c: Contract) => void;
  onUpdateStepDate: (contractId: number, stepId: string, date: string, reason: string) => void;
  notify: (m: string) => void; onSessionExpired: () => void;
}

type Origin = "all" | "contract" | "rda" | "manual";
interface Item {
  key: string; origin: "contract" | "rda" | "manual"; title: string; sub: string; due: string | null; assignee: string; assigneeId: number | null;
  status: "open" | "done" | "waiting"; priority: "low" | "normal" | "high"; doneAt: string | null; task?: Task; contract?: Contract; step?: PlanStep;
}

const TODAY = isoDate(NOW);
const daysFrom = (d: string) => Math.round((new Date(d).getTime() - new Date(TODAY).getTime()) / 864e5);
const ORIGIN_LABEL = { contract: "Rinnovo", rda: "RDA", manual: "Manuale" } as const;
const OUTCOME_LABEL: Record<ContractOutcome | "new_contract", string> = { renewed: "Rinnovato", replaced: "Nuovo contratto", extended: "Prorogato", ceased: "Cessato", new_contract: "Contratto firmato" };
/** Etichetta dell'origine: i task manuali di acquisto sono pratiche come RDA e rinnovi. */
const originLabel = (t: Pick<Task, "source" | "kind">) => (t.source === "manual" && t.kind === "purchase" ? i18n.t("Acquisto") : i18n.t(ORIGIN_LABEL[t.source]));
const ORIGIN_COLOR = { contract: [C.blue, C.blueBg], rda: [C.purple, C.purpleBg], manual: [C.gray, C.grayBg] } as const;
const DONE_TEXT: Record<string, string> = { po_created: "PO creato", removed_from_sap: "Non più aperta in SAP", manual: "Completato a mano", outcome: "Pratica chiusa", merged: "Unita a una pratica" };
const PRIO: Record<string, string> = { high: "Alta", normal: "Normale", low: "Bassa" };
const SOURCING_LABEL: Record<SourcingMode, string> = { comparison: "Confronto tra offerte", strategic: "Fornitura strategica", single_source: "Single source", exception: "Eccezione" };
/** RDA sopra soglia senza scelta del fornitore documentata (o con eccezione non ancora approvata). */
const sourcingGap = (t?: Task) => !!t && t.sourcingRequired && t.sourcingStatus !== "ok";

const chip = (label: string, color: string, bg: string) => <span style={{ ...sans, background: bg, color, borderRadius: 999, padding: "3px 10px", fontSize: 11.5, fontWeight: 650, whiteSpace: "nowrap" }}>{label}</span>;
/** Prima le pratiche con RDA già approvata (e le attività a mano), poi i rinnovi che aspettano ancora la RDA. */
const waitsRda = (i: Item) => i.origin === "contract" && !!i.task && i.task.rdaNumbers.length === 0 && !i.task.outcome;
const rank = (i: Item) => (waitsRda(i) ? 1 : 0);
const overdue = (it: Item) => it.status !== "done" && !!it.due && daysFrom(it.due) < 0;

/** Task del team: RDA da SAP, task creati a mano e attività dei piani di rinnovo dei contratti. */
export function TasksView({ initialOpenId, onFocusUsed, currentUser, contracts, plans, onCompleteStep, onSendBO, onOpenContract, onUpdateStepDate, notify, onSessionExpired }: Props) {
  const [data, setData] = useState<TaskList | null>(null);
  const [buyers, setBuyers] = useState<{ id: number; name: string; active: boolean }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [origin, setOrigin] = useState<Origin>("all");
  const [status, setStatus] = useState<"open" | "done" | "all" | "sourcing" | "archive">("open");
  const [archive, setArchive] = useState<Task[] | null>(null);
  const [threshold, setThreshold] = useState(10000);
  const [who, setWho] = useState("all");
  const [quick, setQuick] = useState<Quick | null>(null);
  const [people, setPeople] = useState<Map<string, string>>(new Map());
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<number | null>(initialOpenId ?? null);
  useEffect(() => { if (initialOpenId) onFocusUsed?.(); }, [initialOpenId, onFocusUsed]);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const isManager = currentUser.role === "manager";

  const fail = useCallback((err: unknown) => {
    if (err instanceof ApiError && err.status === 401) { onSessionExpired(); return i18n.t("Sessione scaduta"); }
    return err instanceof Error ? err.message : i18n.t("Operazione non riuscita");
  }, [onSessionExpired]);
  const reload = useCallback(() => portalApi.tasks().then(d => { setData(d); setError(null); }).catch(err => setError(fail(err))), [fail]);
  useEffect(() => {
    let off = false;
    Promise.all([portalApi.tasks(), portalApi.config()]).then(([d, c]) => { if (!off) { setData(d); setBuyers(c.buyers.filter(b => b.active)); setThreshold(c.rda.sourcingThreshold); } }).catch(err => { if (!off) setError(fail(err)); });
    // Il richiedente si mostra con il nome quando il codice utente SAP corrisponde a un Business Owner.
    portalApi.boUsers().then(u => { if (!off) setPeople(new Map(u.filter(x => x.sapUser).map(x => [x.sapUser.toUpperCase(), x.name]))); }).catch(() => undefined);
    return () => { off = true; };
  }, [fail]);

  // Archivio: tutti i task chiusi, cercati sul server (la lista normale tiene solo gli ultimi 30 giorni).
  useEffect(() => {
    if (status !== "archive") return;
    let off = false;
    const h = setTimeout(() => { portalApi.tasksArchive(search).then(x => { if (!off) setArchive(x); }).catch(() => { if (!off) setArchive([]); }); }, 250);
    return () => { off = true; clearTimeout(h); };
  }, [status, search]);

  // Un task di rinnovo per contratto: la prossima attività del suo piano diventa l'azione rapida in elenco.
  const items = useMemo<Item[]>(() => (status === "archive" ? archive ?? [] : data?.tasks ?? []).map((t): Item => {
    const c = t.contractId ? contracts.find(x => x.id === t.contractId) : undefined;
    const step = c && !t.outcome && t.status === "open" ? (plans[c.id] ?? []).find(s => s.status !== "done" && s.stepId !== "expiry") : undefined;
    const sub = t.source === "rda" ? [t.meta.requestedBy && i18n.t("Richiedente {name}", { name: t.meta.requestedBy }), t.meta.value ? fmt(t.meta.value, t.meta.currency ?? "EUR") : ""].filter(Boolean).join(" · ")
      : t.source === "contract" ? [t.meta.object, t.meta.value ? fmt(t.meta.value, t.meta.currency ?? "EUR") : "", t.meta.noticeDate ? i18n.t("disdetta entro {date}", { date: fmtDate(t.meta.noticeDate) }) : t.meta.end ? i18n.t("scadenza {date}", { date: fmtDate(t.meta.end) }) : ""].filter(Boolean).join(" · ") : t.detail;
    return {
      key: `t:${t.id}`, origin: t.source, title: t.title, sub, due: t.due, assignee: t.assigneeName || i18n.t("Da assegnare"), assigneeId: t.assigneeId,
      status: t.status === "open" && step?.status === "pending_bo" ? "waiting" : t.status, priority: t.priority, doneAt: t.doneAt, task: t, contract: c, step,
    };
  }), [data, archive, status, contracts, plans]);

  const recentDone = (it: Item) => it.status === "done" && !!it.doneAt && Date.now() - new Date(it.doneAt).getTime() < 7 * 864e5;
  const counts = useMemo(() => ({
    open: items.filter(i => i.status !== "done").length, late: items.filter(overdue).length,
    soon: items.filter(i => i.status !== "done" && i.due && daysFrom(i.due) >= 0 && daysFrom(i.due) <= 7).length,
    done: items.filter(recentDone).length, sourcing: items.filter(i => i.status !== "done" && sourcingGap(i.task)).length, approvals: items.filter(i => i.task?.sourcing?.approval === "pending").length, unassigned: items.filter(i => i.status !== "done" && i.assigneeId === null).length,
  }), [items]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter(i => (origin === "all" || i.origin === origin) && (status === "all" || (status === "open" ? i.status !== "done" : i.status === "done"))
      && (!quick || (quick === "late" ? overdue(i) : quick === "sourcing" ? i.status !== "done" && sourcingGap(i.task) : quick === "approval" ? i.task?.sourcing?.approval === "pending" : quick === "unassigned" ? i.status !== "done" && i.assigneeId === null : i.status !== "done"))
      && (who === "all" || (who === "none" ? i.assigneeId === null : String(i.assigneeId) === who)) && (!q || `${i.title} ${i.sub} ${i.assignee}`.toLowerCase().includes(q)))
      .sort((a, b) => Number(a.status === "done") - Number(b.status === "done") || rank(a) - rank(b) || (a.due ?? "9999").localeCompare(b.due ?? "9999"));
  }, [items, origin, status, who, search, quick]);

  const open = (i: Item) => { if (i.task) setOpenId(i.task.id); else if (i.contract) onOpenContract(i.contract); };
  const doImport = async (files: FileList | null) => {
    if (!files?.length) return;
    setImporting(true);
    for (const f of Array.from(files)) {
      try {
        let r;
        try { r = await importSapFile(f); }
        catch (err) {
          if (err instanceof ApiError && err.status === 409 && err.data.needsForce && window.confirm(`${err.message}\n\n${i18n.t("Importare comunque {file}?", { file: f.name })}`)) r = await importSapFile(f, true);
          else throw err;
        }
        notify(r.kind === "pr"
          ? i18n.t("RDA importate: {prs} ({created} nuove", { prs: r.prs, created: r.created }) + (r.reopened ? i18n.t(", {n} riaperte", { n: r.reopened }) : "") + (r.closedPo + r.closedGone ? i18n.t(", {po} chiuse per PO e {gone} non più aperte", { po: r.closedPo, gone: r.closedGone }) : "") + ")"
          : i18n.t("Ordini importati: {rows} righe per l'analisi della spesa, {linked} collegamenti con RDA", { rows: r.poLines ?? r.rows, linked: r.linked }) + (r.closedPo ? i18n.t(", {n} task chiusi", { n: r.closedPo }) : ""));
      } catch (err) { notify(`⚠️ ${f.name}: ${fail(err)}`); }
    }
    await reload(); setImporting(false);
    if (input.current) input.current.value = "";
  };

  if (error) return <EmptyState icon={<AlertTriangle size={26} />} title={i18n.t("Impossibile caricare i task")} text={error} action={<button onClick={reload} style={{ ...btnGhost, padding: "9px 16px" }}>{i18n.t("Riprova")}</button>} />;
  if (!data) return <div style={{ display: "flex", justifyContent: "center", padding: 60 }}><Loader2 className="spin" size={26} color={C.subtle} /></div>;

  const ageDays = (iso: string | null) => (iso ? Math.round((Date.now() - new Date(iso).getTime()) / 864e5) : null);
  const stale = ageDays(data.sapUpdatedAt.pr);
  const fmtAt = (iso: string | null) => (iso ? new Date(iso).toLocaleString(i18n.locale(), { dateStyle: "short", timeStyle: "short" }) : i18n.t("mai"));
  // Contatori: ognuno è anche un filtro rapido (si ripreme per toglierlo).
  const pills: { key: Quick; label: string; value: number; color: string }[] = [
    { key: "open", label: i18n.t("Aperti"), value: counts.open, color: C.blue },
    { key: "late", label: i18n.t("In ritardo"), value: counts.late, color: C.red },
    { key: "sourcing", label: i18n.t("Da confrontare"), value: counts.sourcing, color: C.accent },
    ...(isManager && counts.approvals ? [{ key: "approval" as Quick, label: i18n.t("Da approvare"), value: counts.approvals, color: C.purple }] : []),
    ...(isManager && counts.unassigned ? [{ key: "unassigned" as Quick, label: i18n.t("Da assegnare"), value: counts.unassigned, color: C.purple }] : []),
  ];
  const showWho = isManager && who === "all";

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
        <div className="desktop-only">
          <div style={{ ...font, fontSize: 18, fontWeight: 700, color: C.text }}>{i18n.t("Task")}</div>
          <div style={{ ...sans, fontSize: 12, color: C.muted }}>{isManager ? i18n.t("Tutto il team") : i18n.t("I tuoi task")} · {i18n.t("RDA da SAP, contratti e attività manuali")}</div>
        </div>
        <button className="desktop-only-flex" onClick={() => setCreating(true)} style={{ ...btnPrimary, alignItems: "center", gap: 7, padding: "9px 16px", fontSize: 13 }}><Plus size={16} />{i18n.t("Nuovo task")}</button>
      </div>

      <div style={{ ...sans, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", fontSize: 12.5, color: C.muted, marginBottom: 10 }}>
        <span style={{ flex: "1 1 240px", minWidth: 0 }}>{i18n.t("SAP · RDA aggiornate {pr} · ordini {po}", { pr: fmtAt(data.sapUpdatedAt.pr), po: fmtAt(data.sapUpdatedAt.po) })}</span>
        <input ref={input} type="file" multiple hidden accept=".xls,.xml,.xlsx" onChange={e => doImport(e.target.files)} />
        <button onClick={() => input.current?.click()} disabled={importing} style={{ ...btnGhost, display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px", color: C.text, fontSize: 12.5 }}>{importing ? <Loader2 className="spin" size={14} /> : <Upload size={14} />}{i18n.t("Importa file SAP")}</button>
      </div>
      {stale !== null && stale >= 2 && <Notice kind="warn">{i18n.t("L'elenco delle RDA non è aggiornato da {n} giorni.", { n: stale })} {i18n.t("Carica i due file che SAP invia ogni mattina (RDA aperte e ordini degli ultimi 7 giorni): i task si creano e si chiudono da soli.")}</Notice>}

      <div style={{ display: "flex", gap: 8, marginBottom: 10, overflowX: "auto", paddingBottom: 2 }}>
        {pills.map(pl => { const on = quick === pl.key; return (
          <button key={pl.key} onClick={() => setQuick(on ? null : pl.key)} aria-pressed={on} style={{ ...sans, display: "inline-flex", alignItems: "center", gap: 8, flexShrink: 0, padding: "7px 14px", borderRadius: 12, border: `1px solid ${on ? pl.color : C.border}`, background: on ? `${pl.color}14` : "#fff", cursor: "pointer", fontSize: 13, color: C.text }}>
            <b className="tabular" style={{ ...font, fontSize: 17, color: pl.value ? pl.color : C.subtle }}>{pl.value}</b>{pl.label}</button>); })}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8, marginBottom: 6, maxWidth: 760 }}>
        <select value={status} onChange={e => setStatus(e.target.value as typeof status)} aria-label={i18n.t("Stato")} style={iStyle}><option value="open">{i18n.t("Aperti")}</option><option value="done">{i18n.t("Chiusi di recente")}</option><option value="archive">{i18n.t("Archivio (tutti i chiusi)")}</option><option value="all">{i18n.t("Tutti")}</option></select>
        {isManager && <select value={who} onChange={e => setWho(e.target.value)} aria-label={i18n.t("Assegnatario")} style={iStyle}><option value="all">{i18n.t("Tutto il team")}</option><option value="none">{i18n.t("Da assegnare")}</option>{buyers.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select>}
      </div>

      <div className="sticky-filters" style={{ marginBottom: 8 }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 8, overflowX: "auto", paddingBottom: 2 }}>
          {([["all", "Tutti"], ["rda", "RDA"], ["contract", "Rinnovi"], ["manual", "Manuali e acquisti"]] as [Origin, string][]).map(([k, l]) => (
            <button key={k} onClick={() => setOrigin(k)} aria-pressed={origin === k} style={{ ...sans, flexShrink: 0, padding: "5px 13px", borderRadius: 999, border: `1px solid ${origin === k ? C.accent : C.border}`, background: origin === k ? C.accentLight : "#fff", color: origin === k ? C.accent : C.muted, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>{i18n.t(l)}</button>
          ))}
        </div>
        <div style={{ position: "relative", maxWidth: 760 }}>
          <Search size={16} color={C.subtle} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder={i18n.t("Cerca task, RDA, fornitore…")} aria-label={i18n.t("Cerca")} style={{ ...iStyle, paddingLeft: 36 }} />
        </div>
      </div>

      {shown.length === 0 ? (
        <EmptyState icon={<CheckCircle2 size={26} />} title={items.length ? i18n.t("Nessun task con questi filtri") : i18n.t("Nessun task")} text={items.length ? undefined : i18n.t("I task arrivano dalle RDA di SAP, dai piani di rinnovo dei contratti e da quelli che crei tu.")} />
      ) : (<>
        <div className="table-wrap desktop-only">
          <table className="data-table" style={{ tableLayout: "fixed", width: "100%" }}>
            <colgroup><col /><col style={{ width: 170 }} />{showWho && <col style={{ width: 170 }} />}<col style={{ width: 170 }} /></colgroup>
            <tbody>
              {shown.map(i => (
                <tr key={i.key} className="task-row-d" onClick={() => open(i)} tabIndex={0} onKeyDown={e => { if (e.key === "Enter") open(i); }}>
                  <td style={{ boxShadow: overdue(i) ? `inset 3px 0 0 ${C.red}` : i.priority === "high" && i.status !== "done" ? `inset 3px 0 0 ${C.yellow}` : undefined }}>
                    <div style={{ fontWeight: 650, color: C.text }} className="one-line"><TitleOf i={i} /></div>
                    <div style={{ ...sans, display: "flex", gap: 8, alignItems: "center", marginTop: 3, fontSize: 12.5, color: C.muted, minWidth: 0 }} className="one-line">{chip(i.task ? originLabel(i.task) : i18n.t(ORIGIN_LABEL[i.origin]), ORIGIN_COLOR[i.origin][0], ORIGIN_COLOR[i.origin][1])}{metaOf(i, people)}{sourcingChip(i)}</div>
                  </td>
                  <td className="tabular" style={{ color: overdue(i) ? C.red : C.text }}><div style={{ fontWeight: overdue(i) ? 650 : 500 }}>{i.due ? fmtDate(i.due) : "—"}</div><div style={{ fontSize: 12, color: overdue(i) ? C.red : C.muted }}>{relDue(i) || (extraStatus(i) ? "" : "")}</div></td>
                  {showWho && <td><div style={{ display: "flex", alignItems: "center", gap: 8 }}>{i.assignee !== i18n.t("Da assegnare") && <Avatar name={i.assignee} size={24} />}<span className="one-line" style={{ color: i.assignee === i18n.t("Da assegnare") ? C.purple : C.text, fontWeight: i.assignee === i18n.t("Da assegnare") ? 650 : 400, fontSize: 13 }}>{i.assignee}</span></div></td>}
                  <td onClick={e => e.stopPropagation()} style={{ textAlign: "right" }}>{contractAction(i, onCompleteStep, onSendBO, onOpenContract) ?? extraStatus(i)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mobile-only" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 8 }}>
          {shown.map(i => (
            <Card key={i.key} className="task-row" onClick={() => open(i)} role="button" tabIndex={0} style={{ padding: "0 13px", cursor: "pointer", borderRadius: radius.md, borderLeft: overdue(i) ? `4px solid ${C.red}` : undefined, display: "flex", alignItems: "center", gap: 10, boxSizing: "border-box" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="one-line" style={{ ...sans, fontSize: 14, fontWeight: 650, color: C.text }}><TitleOf i={i} /></div>
                <div className="one-line" style={{ ...sans, display: "flex", gap: 6, alignItems: "center", marginTop: 5, fontSize: 12.5, color: C.muted }}>
                  {chip(i.task ? originLabel(i.task) : i18n.t(ORIGIN_LABEL[i.origin]), ORIGIN_COLOR[i.origin][0], ORIGIN_COLOR[i.origin][1])}
                  <span className="tabular" style={{ color: overdue(i) ? C.red : C.muted, fontWeight: overdue(i) ? 650 : 400, whiteSpace: "nowrap" }}>{i.due ? `${fmtDate(i.due)} · ${relDue(i)}`.replace(/ · $/, "") : i18n.t("Senza scadenza")}</span>
                </div>
              </div>
              {showWho && (i.assignee !== i18n.t("Da assegnare") ? <span title={i.assignee}><Avatar name={i.assignee} size={24} /></span> : chip(i18n.t("Da assegnare"), C.purple, C.purpleBg))}
            </Card>
          ))}
        </div>
      </>)}
      <button className="fab" onClick={() => setCreating(true)} aria-label={i18n.t("Nuovo task")}><Plus size={26} /></button>

      {creating && <Portal><NewTaskDialog isManager={isManager} buyers={buyers} currentUser={currentUser} fail={fail} onClose={() => setCreating(false)} onCreated={async id => { setCreating(false); notify(i18n.t("Task creato")); await reload(); if (id) setOpenId(id); }} /></Portal>}
      {openId !== null && <Portal><TaskSheet id={openId} currentUser={currentUser} people={people} threshold={threshold} isManager={isManager} buyers={buyers} fail={fail} notify={notify} onClose={() => setOpenId(null)} onChanged={reload}
        contracts={contracts} plans={plans} onCompleteStep={onCompleteStep} onSendBO={onSendBO} onUpdateStepDate={onUpdateStepDate} onOpenContract={c => { setOpenId(null); onOpenContract(c); }} /></Portal>}
    </div>
  );
}

type Quick = "open" | "late" | "sourcing" | "approval" | "unassigned";
const relDue = (it: Item) => {
  if (!it.due) return "";
  if (it.status === "done") return "";
  const d = daysFrom(it.due);
  return d < 0 ? i18n.t("in ritardo di {n} gg", { n: -d }) : d === 0 ? i18n.t("oggi") : d === 1 ? i18n.t("domani") : i18n.t("tra {n} gg", { n: d });
};
/** Titolo pulito: il numero della RDA diventa una nota piccola davanti al testo. */
function TitleOf({ i }: { i: Item }) {
  const m = /^(RDA\s+\S+)\s+·\s+(.*)$/.exec(i.title);
  if (!m) return <>{i.title}</>;
  return <><span className="tabular" style={{ ...sans, fontSize: 11.5, fontWeight: 600, color: C.subtle, marginRight: 6 }}>{m[1].replace(/^RDA\s+/, "")}</span>{m[2]}</>;
}
/** Riga di dettaglio: richiedente (con il nome se noto) e valore. Rinnovi: oggetto, valore e termini. */
function metaOf(i: Item, people: Map<string, string>) {
  if (i.task?.source !== "rda") return <>{waitsRda(i) && chip(i18n.t("Senza RDA"), C.gray, C.grayBg)}{i.sub ? <span className="one-line">{i.sub}</span> : null}</>;
  const code = i.task.meta.requestedBy ?? "";
  const who = code ? people.get(code.toUpperCase()) ?? code : "";
  const parts = [who && i18n.t("Richiedente {name}", { name: who }), i.task.meta.value ? fmt(i.task.meta.value, i.task.meta.currency ?? "EUR") : ""].filter(Boolean).join(" · ");
  return parts ? <span>{parts}</span> : null;
}
/** Lo stato si mostra solo quando dice qualcosa in più del gruppo in cui sta la riga. */
function extraStatus(i: Item) {
  if (i.status === "done" || i.task?.outcome || i.status === "waiting" || i.assigneeId === null) return statusChip(i);
  return null;
}

function sourcingChip(i: Item) {
  const t = i.task; if (!sourcingGap(t)) return null;
  const label = t!.sourcingStatus === "pending" ? i18n.t("Eccezione da approvare") : i.status === "done" ? i18n.t("Chiusa senza confronto") : i18n.t("Serve confronto");
  return <span style={{ marginLeft: 8, verticalAlign: "middle" }}>{chip(label, t!.sourcingStatus === "pending" ? C.purple : i.status === "done" ? C.red : C.yellow, t!.sourcingStatus === "pending" ? C.purpleBg : i.status === "done" ? C.redBg : C.yellowBg)}</span>;
}

function statusChip(i: Item) {
  if (i.status === "done") return chip(i.task?.outcome ? i18n.t(OUTCOME_LABEL[i.task.outcome]) : i.task?.doneReason ? i18n.t(DONE_TEXT[i.task.doneReason] ?? "Chiuso") : i18n.t("Chiuso"), C.green, C.greenBg);
  if (i.task?.outcome) return chip(i.task.poNumbers.length || i.task.noPoReason ? i18n.t("Da completare") : i18n.t("Firmato · attesa PO"), C.blue, C.blueBg);
  if (i.status === "waiting") return chip(i18n.t("In attesa del BO"), C.gray, C.grayBg);
  if (overdue(i)) return chip(i18n.t("In ritardo"), C.red, C.redBg);
  if (i.assigneeId === null) return chip(i18n.t("Da assegnare"), C.purple, C.purpleBg);
  return chip(i18n.t("Aperto"), C.blue, C.blueBg);
}

/** Azione rapida dei task che arrivano dal piano di un contratto. */
function contractAction(i: Item, done: (c: number, s: string) => void, sendBO: (c: number) => void, open: (c: Contract) => void) {
  if (i.origin !== "contract" || !i.contract || !i.step || i.status === "done") return null;
  const small = { ...btnGhost, padding: "6px 10px", fontSize: 12, display: "inline-flex", alignItems: "center", gap: 5 } as const;
  if (i.step.stepId === "bo_notify") return <button onClick={() => sendBO(i.contract!.id)} style={small}><Send size={13} />{i18n.t("Invia al BO")}</button>;
  if (i.status === "waiting") return <button onClick={() => open(i.contract!)} style={small}><FileText size={13} />{i18n.t("Apri contratto")}</button>;
  return <button onClick={() => done(i.contract!.id, i.step!.stepId)} style={small} title={i18n.t("Segna come fatta")}><Check size={13} />{i18n.t(stepTemplate(i.step.stepId).label)}</button>;
}

function NewTaskDialog({ isManager, buyers, currentUser, fail, onClose, onCreated }: { isManager: boolean; buyers: { id: number; name: string }[]; currentUser: User; fail: (e: unknown) => string; onClose: () => void; onCreated: (openId: number | null) => void }) {
  const [f, setF] = useState({ title: "", detail: "", due: "", priority: "normal", assigneeId: currentUser.id, kind: "activity" as "activity" | "purchase", value: "", supplier: "", supplierId: null as number | null, rda: "" });
  const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const [vendors, setVendors] = useState<SupplierSummary[] | null>(null);
  useEffect(() => { let off = false; portalApi.vendors().then(v => { if (!off) setVendors(v); }).catch(() => undefined); return () => { off = true; }; }, []);
  const purchase = f.kind === "purchase";
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      const made = await portalApi.createTask({ title: f.title, detail: f.detail, due: f.due || null, priority: f.priority, kind: f.kind, ...(isManager ? { assigneeId: f.assigneeId } : {}),
        ...(purchase ? { value: Number(f.value.replace(",", ".")), supplier: f.supplier, supplierId: f.supplierId, rdaNumbers: f.rda.split(/[\s,;]+/).filter(Boolean) } : {}) });
      onCreated(purchase ? made.id : null);
    }
    catch (err) { setError(fail(err)); setBusy(false); }
  };
  return (
    <div className="dialog-overlay" role="dialog" aria-modal="true">
      <form className="dialog" onSubmit={submit}>
        <h3 style={{ ...font, margin: "0 0 14px", fontSize: 17 }}>{i18n.t("Nuovo task")}</h3>
        <div role="radiogroup" aria-label={i18n.t("Tipo di task")} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
          {([["activity", "Attività", "Promemoria: telefonata, report, verifica…"], ["purchase", "Acquisto / nuovo contratto", "Pratica completa: confronto, offerta o contratto, fornitore, PO"]] as const).map(([k, l, d]) => (
            <button key={k} type="button" role="radio" aria-checked={f.kind === k} onClick={() => setF({ ...f, kind: k })} style={{ ...sans, textAlign: "left", padding: "9px 11px", borderRadius: 10, border: `2px solid ${f.kind === k ? C.accent : C.border}`, background: f.kind === k ? C.accentLight : "#fff", cursor: "pointer" }}>
              <div style={{ fontWeight: 650, fontSize: 13, color: f.kind === k ? C.accent : C.text }}>{i18n.t(l)}</div><div style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.35, marginTop: 2 }}>{i18n.t(d)}</div>
            </button>
          ))}
        </div>
        <Field label={purchase ? i18n.t("Cosa si acquista") : i18n.t("Titolo")} req htmlFor="nt-title"><input id="nt-title" required autoFocus value={f.title} onChange={e => setF({ ...f, title: e.target.value })} style={iStyle} /></Field>
        {purchase && (<>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label={i18n.t("Importo stimato (EUR)")} req htmlFor="nt-val"><input id="nt-val" required inputMode="decimal" value={f.value} onChange={e => setF({ ...f, value: e.target.value })} style={iStyle} /></Field>
            <Field label={i18n.t("RDA, se esiste già")} htmlFor="nt-rda"><input id="nt-rda" value={f.rda} onChange={e => setF({ ...f, rda: e.target.value })} placeholder={i18n.t("Numero RDA")} style={iStyle} /></Field>
          </div>
          <Field label={i18n.t("Fornitore previsto")} htmlFor="nt-sup"><SupplierPicker id="nt-sup" value={f.supplier} supplierId={f.supplierId} vendors={vendors} onChange={(name, sid) => setF(x => ({ ...x, supplier: name, supplierId: sid }))} /></Field>
        </>)}
        <Field label={i18n.t("Note")} htmlFor="nt-detail"><textarea id="nt-detail" value={f.detail} onChange={e => setF({ ...f, detail: e.target.value })} style={{ ...iStyle, height: 70, resize: "vertical" }} /></Field>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label={i18n.tc("task", "Scadenza")} htmlFor="nt-due"><input id="nt-due" type="date" value={f.due} onChange={e => setF({ ...f, due: e.target.value })} style={iStyle} /></Field>
          <Field label={i18n.t("Priorità")} htmlFor="nt-prio"><select id="nt-prio" value={f.priority} onChange={e => setF({ ...f, priority: e.target.value })} style={iStyle}>{Object.entries(PRIO).map(([k, l]) => <option key={k} value={k}>{i18n.t(l)}</option>)}</select></Field>
        </div>
        {isManager && <Field label={i18n.t("Assegna a")} htmlFor="nt-who"><select id="nt-who" value={f.assigneeId} onChange={e => setF({ ...f, assigneeId: Number(e.target.value) })} style={iStyle}>{buyers.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>}
        {error && <Notice kind="error">{error}</Notice>}
        <div style={{ display: "flex", gap: 10 }}>
          <button type="button" onClick={onClose} style={{ ...btnGhost, flex: 1 }}>{i18n.t("Annulla")}</button>
          <button type="submit" disabled={busy} style={{ ...btnPrimary, flex: 2, opacity: busy ? 0.7 : 1 }}>{purchase ? i18n.t("Apri la pratica") : i18n.t("Crea task")}</button>
        </div>
      </form>
    </div>
  );
}

/** Apre la sezione (se chiusa) e ci porta lo schermo. */
const goTo = (id: string) => { window.dispatchEvent(new CustomEvent("fold-open", { detail: id })); setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }), 60); };

/** Rinnovo senza RDA: propone le RDA aperte che sembrano la sua; con un tocco si uniscono in un'unica pratica. */
function RdaSuggest({ t, fail, onLinked }: { t: TaskDetail; fail: (e: unknown) => string; onLinked: (x: TaskDetail) => void }) {
  const [list, setList] = useState<RdaSuggestion[] | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { let off = false; portalApi.suggestRdas(t.id).then(x => { if (!off) setList(x); }).catch(() => { if (!off) setList([]); }); return () => { off = true; }; }, [t.id]);
  if (!list?.length) return null;
  const link = async (s: RdaSuggestion) => {
    setBusy(s.id); setError(null);
    try { onLinked(await portalApi.setTaskLinks(t.id, { rdaNumbers: [...t.rdaNumbers, s.rda] })); } catch (e) { setError(fail(e)); }
    setBusy(null);
  };
  return (
    <Card>
      <CardTitle icon={<Paperclip size={16} />}>{i18n.t("Questa RDA è il rinnovo?")}</CardTitle>
      <div style={{ ...sans, fontSize: 12.5, color: C.muted, marginBottom: 8 }}>{i18n.t("Il rinnovo aspetta ancora la sua RDA. Se una di queste è quella giusta, collegala: diventa un'unica pratica.")}</div>
      {list.map(s => (
        <div key={s.id} style={{ ...sans, display: "flex", gap: 10, alignItems: "center", padding: "8px 0", borderTop: `1px solid ${C.borderLight}` }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="one-line" style={{ fontSize: 13.5, fontWeight: 650, color: C.text }}>{s.rda} · {s.title.replace(/^RDA\s+\S+\s+·\s+/, "")}</div>
            <div style={{ fontSize: 12, color: C.muted }}>{fmt(s.value, s.currency)} · {s.why.join(" · ")}</div>
          </div>
          <button onClick={() => link(s)} disabled={busy !== null} style={{ ...btnGhost, padding: "6px 12px", fontSize: 12.5, flexShrink: 0 }}>{busy === s.id ? <Loader2 className="spin" size={13} /> : i18n.t("Collega")}</button>
        </div>
      ))}
      {error && <Notice kind="error">{error}</Notice>}
    </Card>
  );
}

const STEP_ACTION: Record<string, (t: TaskDetail) => { label: string; id: string } | null> = {
  supplier: t => ({ label: t.chosenSupplierId === null ? i18n.t("Scegli il fornitore") : i18n.t("Registra il confronto"), id: "sec-sourcing" }),
  received: () => ({ label: i18n.t("Indica l'internal order"), id: "sec-received" }),
  contract: t => ({ label: t.source === "contract" ? i18n.t("Carica il nuovo contratto") : i18n.t("Aggiorna il contratto"), id: t.source === "contract" ? "sec-outcome" : "sec-contract" }),
  po: t => (t.source === "rda" ? null : { label: i18n.t("Indica il PO"), id: "sec-po" }),
  outcome: () => ({ label: i18n.t("Registra l'esito"), id: "sec-outcome" }),
};

/** "Prossimo passo": cosa manca per portare avanti la pratica, con un pulsante che porta alla sezione giusta. */
function NextStep({ t, isManager, threshold }: { t: TaskDetail; isManager: boolean; threshold: number }) {
  type Step = { text: string; action?: { label: string; run: () => void } };
  const steps: Step[] = [];
  if (isManager && t.sourcing?.approval === "pending") steps.push({ text: i18n.t("Approva o respingi l'eccezione al confronto ({name})", { name: t.sourcing.recordedBy }), action: { label: i18n.t("Vai alla scelta del fornitore"), run: () => goTo("sec-sourcing") } });
  for (const st of t.steps) {
    if (st.info || st.key === "closed" || st.state === "done" || !st.blocker) continue;
    const act = STEP_ACTION[st.key]?.(t) ?? null;
    const text = st.key === "supplier" && t.chosenSupplierId !== null && t.sourcingStatus !== "pending" ? i18n.t("Sopra {amount}: serve il confronto tra fornitori (o strategico, single source, eccezione)", { amount: fmt(threshold) })
      : st.key === "po" && t.source === "rda" ? i18n.t("Emetti il PO in SAP: appena arriva l'ordine nell'estrazione, la RDA si chiude da sola") : i18n.t(st.blocker);
    if (st.key === "supplier" && t.sourcingStatus === "pending" && !isManager) { steps.push({ text }); continue; }
    steps.push({ text, action: act ? { label: act.label, run: () => goTo(act.id) } : undefined });
  }
  const orderIn = t.source === "rda" && t.pos.length > 0 && steps.length > 0;
  const done = steps.length === 0;
  const text = done ? (t.source === "rda" ? i18n.t("Nessuna azione richiesta: la RDA si chiude da sola quando in SAP arriva l'ordine.") : i18n.t("Tutto a posto: la pratica si chiude da sola."))
    : orderIn ? i18n.t("L'ordine è già in SAP, ma la pratica non è completa: {step}", { step: steps[0].text }) : steps[0].text;
  const tone = done ? [C.green, C.greenBg] : orderIn ? [C.red, C.redBg] : [C.accent, C.accentLight];
  return (
    <div style={{ ...sans, background: tone[1], border: `1px solid ${tone[0]}33`, borderRadius: 12, padding: "9px 14px" }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: tone[0], textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 3 }}>{done ? i18n.t("Situazione") : i18n.t("Prossimo passo")}</div>
      <div style={{ fontSize: 13.5, fontWeight: 650, color: C.text, lineHeight: 1.35 }}>{text}</div>
      {!done && steps[0].action && <button onClick={steps[0].action.run} style={{ ...btnPrimary, padding: "6px 12px", fontSize: 12.5, marginTop: 6 }}>{steps[0].action.label}</button>}
      {steps.length > 1 && <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 12, color: C.muted, lineHeight: 1.5 }}>{steps.slice(1).map((x, k) => <li key={k}>{x.text}</li>)}</ul>}
    </div>
  );
}

/** A che punto è la pratica: passaggi fatti, quello in corso e quelli che mancano. Un tocco porta alla sezione relativa. */
function TaskProgress({ t, plan }: { t: TaskDetail; plan: PlanStep[] }) {
  const steps = taskSteps(t, plan).filter(x => !x.hidden);
  return (
    <ol aria-label={i18n.t("Avanzamento della pratica")} style={{ listStyle: "none", margin: 0, padding: "0 0 2px", display: "flex", overflowX: "auto", gap: 0, WebkitOverflowScrolling: "touch" }}>
      {steps.map((st, k) => {
        const color = st.state === "done" ? C.green : st.state === "current" ? C.accent : C.subtle;
        const sub = st.detail != null ? i18n.t(st.detail) : st.date ? fmtDate(st.date) : st.state === "current" ? i18n.t("qui adesso") : "";
        return (
          <li key={st.key} style={{ flex: "1 0 58px", minWidth: 58, textAlign: "center", position: "relative" }}>
            {k > 0 && <span aria-hidden style={{ position: "absolute", top: 13, left: "-50%", width: "100%", height: 2, background: st.state === "done" || steps[k - 1].state === "done" ? "#bfe3cf" : C.borderLight }} />}
            <button onClick={() => st.section && goTo(st.section)} disabled={!st.section} aria-label={`${i18n.t(st.label)}: ${st.state === "done" ? i18n.t("fatto") : st.state === "current" ? i18n.t("in corso") : i18n.t("da fare")}`} style={{ position: "relative", background: "none", border: "none", padding: 0, cursor: st.section ? "pointer" : "default", width: "100%" }}>
              <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, borderRadius: "50%", background: st.state === "done" ? C.green : st.state === "current" ? C.accent : "#fff", border: `2px solid ${color}`, color: "#fff", boxSizing: "border-box" }}>
                {st.state === "done" ? <Check size={15} /> : st.state === "current" ? <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#fff" }} /> : null}
              </span>
              <span style={{ ...sans, display: "block", marginTop: 4, fontSize: 11.5, fontWeight: st.state === "current" ? 700 : 600, color: st.state === "todo" ? C.muted : C.text, lineHeight: 1.2 }}>{i18n.t(st.label)}</span>
              <span className="one-line" style={{ ...sans, display: "block", fontSize: 10.5, color: st.state === "current" ? C.accent : C.subtle, minHeight: 13, padding: "0 2px" }}>{sub}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/** Il fornitore si sceglie sempre tra quelli registrati, attivi e qualificati: così è garantito che sia a sistema. */
function ChosenSupplier({ t, fail, onSaved }: { t: TaskDetail; fail: (e: unknown) => string; onSaved: (t: TaskDetail, msg: string) => void }) {
  const [list, setList] = useState<EligibleSupplier[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { let off = false; portalApi.eligibleSuppliers().then(x => { if (!off) setList(x); }).catch(() => { if (!off) setList([]); }); return () => { off = true; }; }, []);
  const choose = async (v: string) => {
    setBusy(true); setErr(null);
    try { onSaved(await portalApi.setTaskSupplier(t.id, v ? Number(v) : null), v ? i18n.t("Fornitore scelto") : i18n.t("Scelta del fornitore rimossa")); } catch (e) { setErr(fail(e)); }
    setBusy(false);
  };
  const missing = t.chosenSupplierId !== null && list && !list.some(x => x.id === t.chosenSupplierId);
  // Se c'è un confronto, il fornitore dell'offerta scelta è il candidato naturale.
  const norm = (x: string) => x.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  const winner = t.sourcing?.mode === "comparison" ? t.sourcing.quotes.find(q => q.chosen)?.supplier ?? "" : "";
  const suggested = t.chosenSupplierId === null && winner && list ? list.find(x => norm(x.name) === norm(winner)) : undefined;
  return (
    <Card>
      {suggested && t.status === "open" && <button onClick={() => choose(String(suggested.id))} disabled={busy} style={{ ...btnGhost, padding: "6px 12px", fontSize: 12.5, marginBottom: 8 }}>{i18n.t("Usa il fornitore dell'offerta scelta: {name}", { name: suggested.name })}</button>}
      <Field label={i18n.tc("campo", "Fornitore scelto")} htmlFor="chosen-supplier">
        <select id="chosen-supplier" value={t.chosenSupplierId ?? ""} onChange={e => choose(e.target.value)} disabled={busy || t.status !== "open" || !list} style={iStyle}>
          <option value="">{list ? i18n.t("Scegli un fornitore registrato e qualificato…") : i18n.t("Carico i fornitori…")}</option>
          {missing && <option value={t.chosenSupplierId ?? ""}>{t.chosenSupplierName} {i18n.t("(non più qualificato)")}</option>}
          {(list ?? []).map(x => <option key={x.id} value={x.id}>{x.name}{x.sapCode ? ` · SAP ${x.sapCode}` : ""}{x.qualification === "expiring" ? ` · ${i18n.t("documenti in scadenza")}` : ""}</option>)}
        </select>
      </Field>
      {missing && <div style={{ ...sans, fontSize: 12, color: C.red, marginTop: 6 }}>{i18n.t("Il fornitore scelto non risulta più qualificato: sceglierne un altro o aggiornare i suoi documenti.")}</div>}
      {err && <Notice kind="error">{err}</Notice>}
    </Card>
  );
}

function TaskSheet({ id, currentUser, people, threshold, isManager, buyers, fail, notify, onClose, onChanged, contracts, plans, onCompleteStep, onSendBO, onUpdateStepDate, onOpenContract }: { id: number; currentUser: User; people: Map<string, string>; threshold: number; isManager: boolean; buyers: { id: number; name: string }[]; fail: (e: unknown) => string; notify: (m: string) => void; onClose: () => void; onChanged: () => void;
  contracts: Contract[]; plans: Record<number, PlanStep[]>; onCompleteStep: (contractId: number, stepId: string) => void; onSendBO: (contractId: number) => void; onUpdateStepDate: Props["onUpdateStepDate"]; onOpenContract: (c: Contract) => void }) {
  const [t, setT] = useState<TaskDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let off = false;
    portalApi.task(id).then(x => { if (!off) setT(x); }).catch(err => { if (!off) setError(fail(err)); });
    return () => { off = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const patch = async (p: Record<string, unknown>, msg?: string) => {
    setBusy(true); setError(null);
    try { setT(await portalApi.updateTask(id, p)); onChanged(); if (msg) notify(msg); }
    catch (err) {
      // Pratica incompleta: si può chiudere a mano solo su conferma (RDA annullata o respinta).
      if (err instanceof ApiError && err.data.needsConfirm && window.confirm(`${err.message}\n\n${i18n.t("Chiuderla comunque?")}`)) { try { setT(await portalApi.updateTask(id, { ...p, force: true })); onChanged(); if (msg) notify(msg); } catch (e2) { setError(fail(e2)); } }
      else setError(fail(err));
    }
    setBusy(false);
  };
  const remove = async () => {
    if (!window.confirm(i18n.t("Eliminare questo task?"))) return;
    try { await portalApi.deleteTask(id); notify(i18n.t("Task eliminato")); onChanged(); onClose(); } catch (err) { setError(fail(err)); }
  };
  const rda = t?.source === "rda";
  const renewal = t?.source === "contract";
  const purchase = t?.source === "manual" && t.kind === "purchase";
  const age = t?.meta.releaseDate ? Math.round((Date.now() - new Date(t.meta.releaseDate).getTime()) / 864e5) : null;

  return (
    <div className="sheet-overlay" role="dialog" aria-modal="true" aria-label={i18n.t("Dettaglio task")} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet" style={{ maxWidth: 760 }}>
        <div className="sheet-head">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ ...font, fontSize: 18, fontWeight: 700, color: C.text, overflowWrap: "anywhere" }}>{t?.title ?? "…"}</div>
            {t && <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>{chip(originLabel(t), ORIGIN_COLOR[t.source][0], ORIGIN_COLOR[t.source][1])}{t.status === "done" ? chip(i18n.t(t.outcome ? OUTCOME_LABEL[t.outcome] : DONE_TEXT[t.doneReason] ?? "Chiuso"), C.green, C.greenBg) : chip(t.outcome ? i18n.t("{outcome} · da completare", { outcome: i18n.t(OUTCOME_LABEL[t.outcome]) }) : i18n.t("Aperto"), C.blue, C.blueBg)}</div>}
          </div>
          <CloseButton onClick={onClose} />
        </div>
        {!t && !error && <div style={{ display: "flex", justifyContent: "center", padding: 40 }}><Loader2 className="spin" size={24} color={C.subtle} /></div>}
        {error && <Notice kind="error">{error}</Notice>}
        {t && (
          <div style={{ display: "grid", gap: 10, gridTemplateColumns: "minmax(0, 1fr)" }}>
            {t.status === "done" && rda && t.doneReason === "po_created" && <Notice kind="ok"><b>{i18n.t("Chiusa automaticamente:")}</b> {i18n.t("in SAP è stato creato l'ordine {po}", { po: t.pos.map(p => p.po).join(", ") || i18n.t("collegato") })}{t.pos[0]?.supplierName ? ` (${t.pos[0].supplierName})` : ""}{t.doneAt ? ` ${i18n.t("il {date}", { date: fmtDate(t.doneAt) })}` : ""}.</Notice>}
            {t.status === "done" && rda && t.doneReason === "removed_from_sap" && <Notice kind="info"><b>{i18n.t("Chiusa automaticamente:")}</b> {i18n.t("la RDA non risulta più aperta in SAP (ordinata, rifiutata o cancellata). Se in seguito arriva l'elenco degli ordini con il suo PO, lo vedrai qui.")}</Notice>}
            {t.status === "open" && t.pos.length > 0 && <Notice kind="info">{i18n.t("Per questa RDA esiste già un ordine ({po}): il task si chiude quando la RDA non è più aperta in SAP.", { po: t.pos.map(p => p.po).join(", ") })}</Notice>}
            {t.status === "open" && renewal && t.rdaNumbers.length === 0 && <RdaSuggest t={t} fail={fail} onLinked={x => { setT(x); onChanged(); notify(i18n.t("RDA collegata al rinnovo")); }} />}
            <TaskProgress t={t} plan={t.contractId ? plans[t.contractId] ?? [] : []} />
            {t.status === "open" && (rda || renewal || purchase) && <NextStep t={t} isManager={isManager} threshold={threshold} />}
            {(() => {
              const flow = taskSteps(t, t.contractId ? plans[t.contractId] ?? [] : []).filter(x => !x.hidden && x.key !== "closed");
              const rec = t.steps.find(x => x.key === "received");
              const ioMissing = !!rec && rec.state !== "done";
              const stateOf = (...keys: string[]): "done" | "current" | "todo" => {
                const ss = flow.filter(x => keys.includes(x.key)); if (!ss.length) return "todo";
                return ss.some(x => x.state === "current") ? "current" : ss.every(x => x.state === "done") ? "done" : "todo";
              };
              const detailOf = (k: string) => flow.find(x => x.key === k)?.detail;
              const saved = (x: TaskDetail, m: string) => { setT(x); onChanged(); notify(m); };
              const out: ReactNode[] = []; const shown = new Set<string>();
              for (const st of flow) {
                const id = st.section ?? st.key;
                if (shown.has(id)) continue; shown.add(id);
                if (st.key === "received") out.push(
                  <Fold key={id} id={id} title={rda ? i18n.t("Ricevuta da SAP") : purchase ? i18n.t("Pratica aperta") : i18n.t("Dettagli")} status={rda || purchase ? rec?.state : undefined} badge={ioMissing && t.status === "open" ? { label: i18n.t("Manca l'internal order"), color: C.red, bg: C.redBg } : null}
                    summary={rec?.detail && !ioMissing ? i18n.t("Internal order {io}", { io: rec.detail }) : ioMissing ? i18n.t("internal order mancante") : undefined} defaultOpen={(ioMissing || (!rda && !purchase)) && t.status === "open"}>
                    <Card>
                      <KV dense rows={[
                        // Il numero RDA e la descrizione sono già nel titolo della scheda: qui solo dati nuovi, in due righe (budget; persone e tempi).
                        ...(rda ? [
                          [i18n.t("Importo"), t.meta.value ? fmt(t.meta.value, t.meta.currency ?? "EUR") : ""],
                          [i18n.t("Internal order"), <IoField key="io" t={t} fail={fail} onSaved={saved} />],
                          [i18n.t("Centro di costo"), t.meta.costCenter ?? ""],
                          ...(rec && !ioMissing ? [[i18n.t("Budget residuo"), <IoBudget key="bd" t={t} />]] : []),
                          [i18n.t("Gruppo acquisti"), t.meta.pgr ?? ""],
                          [i18n.t("Richiedente"), t.meta.requestedBy ? people.get(t.meta.requestedBy.toUpperCase()) ?? t.meta.requestedBy : ""],
                          [i18n.t("Assegnato a"), t.assigneeName || i18n.t("Da assegnare")],
                          [i18n.t("Rilasciata il"), t.meta.releaseDate ? <span title={age !== null ? i18n.t("da {n} giorni", { n: age }) : undefined}>{fmtDate(t.meta.releaseDate)}</span> : ""],
                          [i18n.t("Consegna richiesta"), <DeliveryField key="dl" t={t} fail={fail} onSaved={saved} />],
                          [i18n.tc("task", "Scadenza"), t.due ? fmtDate(t.due) : ""],
                        ] as [string, ReactNode][] : []),
                        ...(purchase ? [
                          [i18n.t("Importo stimato"), t.meta.value ? fmt(t.meta.value, t.meta.currency ?? "EUR") : ""],
                          [i18n.t("Internal order"), <IoField key="io" t={t} fail={fail} onSaved={saved} />],
                          ...(rec && !ioMissing ? [[i18n.t("Budget residuo"), <IoBudget key="bd" t={t} />]] : []),
                          [i18n.t("Fornitore previsto"), t.meta.supplier || "—"],
                          [i18n.t("Priorità"), i18n.t(PRIO[t.priority])],
                          [i18n.t("Assegnato a"), t.assigneeName || i18n.t("Da assegnare")], [i18n.t("Creato da"), t.createdBy],
                          [i18n.tc("task", "Scadenza"), t.due ? fmtDate(t.due) : ""],
                        ] as [string, ReactNode][] : []),
                        ...(!rda && !purchase ? [[renewal ? i18n.t("Da gestire entro") : i18n.tc("task", "Scadenza"), t.due ? fmtDate(t.due) : ""], [i18n.t("Assegnato a"), t.assigneeName || i18n.t("Da assegnare")], [i18n.t("Priorità"), i18n.t(PRIO[t.priority])], [i18n.t("Creato da"), t.createdBy]] as [string, string][] : []),
                      ]} />
                      {rda && t.lines.length > 1 && <div style={{ marginTop: 8 }}>
                        <div style={{ ...sans, fontSize: 11, color: C.subtle, fontWeight: 600 }}>{i18n.t("Righe della RDA")}</div>
                        <div style={{ ...sans, fontSize: 13, color: C.text, marginTop: 1, display: "grid", gap: 1 }}>{t.lines.map((l, k) => <div key={k}>{l.shortText || "—"}</div>)}</div>
                      </div>}
                      {!rda && t.detail && <div style={{ ...sans, fontSize: 13, color: C.muted, marginTop: 12, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{t.detail}</div>}
                    </Card>
                  </Fold>);
                else if (st.key === "bo_notify" || st.key === "bo_response") out.push(
                  <Fold key={id} id={id} title={i18n.t("Avviso e risposta del Business Owner")} status={stateOf("bo_notify", "bo_response")} summary={flow.filter(x => x.key.startsWith("bo_")).map(x => `${i18n.t(x.label)}${x.date ? ` ${fmtDate(x.date)}` : ""}`).join(" · ")} defaultOpen={false}>
                    <RenewalCard t={t} contracts={contracts} plan={t.contractId ? plans[t.contractId] ?? [] : []} onCompleteStep={onCompleteStep} onSendBO={onSendBO} onUpdateStepDate={onUpdateStepDate} onOpenContract={onOpenContract} />
                  </Fold>);
                else if (st.key === "outcome") out.push(
                  <Fold key={id} id={id} title={i18n.t("Esito e contratto")} status={stateOf("outcome", "contract")} summary={[i18n.t(detailOf("outcome") ?? ""), detailOf("contract") && i18n.t("contratto {detail}", { detail: i18n.t(detailOf("contract") ?? "") })].filter(Boolean).join(" · ") || undefined} defaultOpen={stateOf("outcome", "contract") === "current"}>
                    <OutcomeCard t={t} contracts={contracts} fail={fail} onOpenContract={onOpenContract} onSaved={saved} currentUser={currentUser} />
                  </Fold>);
                else if (st.key === "supplier") out.push(
                  <Fold key={id} id={id} title={i18n.t("Fornitore")} status={st.state} badge={t.sourcing?.approval === "pending" ? { label: i18n.t("Eccezione da approvare"), color: C.purple, bg: C.purpleBg } : null}
                    summary={[t.chosenSupplierName, t.sourcing ? (t.sourcing.mode === "comparison" ? i18n.t("{n} offerte", { n: t.sourcing.quotes.length }) : t.sourcing.mode === "strategic" ? i18n.t("fornitura strategica") : t.sourcing.mode === "single_source" ? i18n.t("single source") : i18n.t("eccezione")) : t.sourcingRequired ? i18n.t("confronto da registrare") : ""].filter(Boolean).join(" · ") || i18n.t("da scegliere")} defaultOpen={st.state === "current"}>
                    {/* Prima come si sceglie (confronto, strategica, single source, eccezione), poi chi è stato scelto. */}
                    {(t.sourcingRequired || t.sourcing) && t.status === "open" && <RfqCard t={t} fail={fail} onSaved={saved} notify={notify} />}
                    {(t.sourcingRequired || t.sourcing) && <SourcingCard t={t} isManager={isManager} fail={fail} onSaved={saved} />}
                    {!renewal && <ChosenSupplier t={t} fail={fail} onSaved={(x, m) => { setT({ ...x }); onChanged(); notify(m); }} />}
                  </Fold>);
                else if (st.key === "contract" && !renewal) out.push(
                  <Fold key={id} id={id} title={i18n.t("Contratto")} status={st.state} summary={i18n.t(st.detail ?? "da indicare")} defaultOpen={st.state === "current"}>
                    <PraticaPart t={t} part="contract" fail={fail} onSaved={saved} ctx={{ currentUser, buyers, contracts, onOpenContract }} />
                  </Fold>);
                else if (st.key === "po") out.push(
                  <Fold key={id} id={id} title={i18n.t("PO")} status={st.state} summary={i18n.t(st.detail ?? (rda ? "da emettere in SAP" : "da indicare"))} defaultOpen={st.state === "current"}>
                    <PraticaPart t={t} part="po" fail={fail} onSaved={saved} />
                  </Fold>);
              }
              return out;
            })()}

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", padding: "14px 0 4px", borderTop: `1px solid ${C.borderLight}` }}>
              {isManager && t.status === "open" && (
                <select aria-label={i18n.t("Assegna a")} value={t.assigneeId ?? ""} onChange={e => patch({ assigneeId: e.target.value ? Number(e.target.value) : null }, i18n.t("Assegnazione salvata"))} disabled={busy} style={{ ...iStyle, width: "auto", minWidth: 0, flex: "1 1 120px", maxWidth: 260 }}>
                  <option value="">{i18n.t("Da assegnare")}</option>{buyers.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              )}
              <div style={{ flex: 1 }} />
              {renewal && t.status === "open" && <span style={{ ...sans, fontSize: 12.5, color: C.muted, flex: "1 1 260px" }}>{i18n.t("La pratica si chiude da sola quando sono completi esito, confronto (se serve) e PO.")}</span>}
              {t.status === "open" && !renewal && <button onClick={() => patch({ status: "done" }, i18n.t("Task completato"))} disabled={busy} style={{ ...btnPrimary, padding: "10px 16px", display: "inline-flex", alignItems: "center", gap: 7 }}>{busy ? <Loader2 className="spin" size={15} /> : <Check size={16} />}{rda ? i18n.t("Segna come gestita") : purchase ? i18n.t("Chiudi la pratica") : i18n.t("Completa")}</button>}
              {t.status === "done" && (t.source === "manual" || t.doneReason === "manual") && <button onClick={() => patch({ status: "open" }, i18n.t("Task riaperto"))} disabled={busy} style={{ ...btnGhost, padding: "10px 16px", display: "inline-flex", alignItems: "center", gap: 7 }}><RotateCcw size={15} />{i18n.t("Riapri")}</button>}
              {t.source === "manual" && <button onClick={remove} style={{ ...btnGhost, padding: "10px 14px", color: C.red, borderColor: "#f0c9c9", display: "inline-flex", alignItems: "center", gap: 6 }}><Trash2 size={15} />{i18n.t("Elimina")}</button>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const EMPTY_QUOTES: SourcingQuote[] = [{ supplier: "", amount: 0, chosen: true }, { supplier: "", amount: 0, chosen: false }];

/** Come è stato scelto il fornitore di una RDA sopra soglia: confronto offerte, strategica, single source o eccezione. */
function SourcingCard({ t, isManager, fail, onSaved }: { t: TaskDetail; isManager: boolean; fail: (e: unknown) => string; onSaved: (t: TaskDetail, msg: string) => void }) {
  const s = t.sourcing;
  const [editing, setEditing] = useState(!s);
  const [mode, setMode] = useState<SourcingMode>(s?.mode ?? "comparison");
  const [quotes, setQuotes] = useState<{ supplier: string; amount: string; chosen: boolean }[]>((s?.quotes.length ? s.quotes : EMPTY_QUOTES).map(q => ({ supplier: q.supplier, amount: q.amount ? String(q.amount) : "", chosen: q.chosen })));
  const [justification, setJustification] = useState(s?.justification ?? "");
  // Saving: prezzo di riferimento (per i rinnovi, il valore del contratto in scadenza) e importo finale negoziato.
  const [baseline, setBaseline] = useState(s?.baseline ? String(s.baseline) : t.source === "contract" && (t.meta.previousValue ?? t.meta.value) ? String(t.meta.previousValue ?? t.meta.value) : "");
  const [finalAmount, setFinalAmount] = useState(s?.finalAmount ? String(s.finalAmount) : "");
  const num = (v: string) => (v.trim() ? Number(v.replace(",", ".")) : null);
  const preview = computeSaving({ quotes: mode === "comparison" ? quotes.map(q => ({ supplier: q.supplier, amount: Number(q.amount.replace(",", ".")) || 0, chosen: q.chosen })) : [], baseline: num(baseline), finalAmount: num(finalAmount) });
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const cur = t.meta.currency ?? "EUR";

  const save = async () => {
    setBusy(true); setErr(null);
    try {
      const x = await portalApi.saveSourcing(t.id, { mode, justification, baseline: num(baseline), finalAmount: num(finalAmount), quotes: mode === "comparison" ? quotes.map(q => ({ supplier: q.supplier, amount: Number(q.amount.replace(",", ".")), chosen: q.chosen })) : [] });
      setEditing(false); onSaved(x, mode === "exception" && x.sourcing?.approval === "pending" ? i18n.t("Eccezione inviata al Manager") : i18n.t("Scelta del fornitore registrata"));
    } catch (e) { setErr(fail(e)); }
    setBusy(false);
  };
  const decide = async (approve: boolean) => {
    setBusy(true); setErr(null);
    try { onSaved(await portalApi.decideSourcing(t.id, approve, note), approve ? i18n.t("Eccezione approvata") : i18n.t("Eccezione respinta")); setNote(""); } catch (e) { setErr(fail(e)); }
    setBusy(false);
  };
  const setQ = (k: number, patch: Partial<{ supplier: string; amount: string; chosen: boolean }>) => setQuotes(qs => qs.map((q, j) => j === k ? { ...q, ...patch } : patch.chosen ? { ...q, chosen: false } : q));

  return (
    <Card>
      <CardTitle icon={<Scale size={16} />} action={s && !editing ? <button onClick={() => setEditing(true)} style={{ ...btnGhost, padding: "6px 12px", fontSize: 12.5 }}>{i18n.t("Modifica")}</button> : undefined}>{i18n.t("Scelta del fornitore")}</CardTitle>
      {s && !editing && (
        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {chip(i18n.t(SOURCING_LABEL[s.mode]), C.blue, C.blueBg)}
            {s.approval === "pending" && chip(i18n.t("In attesa del Manager"), C.purple, C.purpleBg)}
            {s.approval === "approved" && chip(i18n.t("Approvata da {name}", { name: s.approvedBy }), C.green, C.greenBg)}
            {s.approval === "rejected" && chip(i18n.t("Respinta da {name}", { name: s.approvedBy }), C.red, C.redBg)}
            <span style={{ ...sans, fontSize: 12, color: C.subtle }}>{i18n.t("Registrata da {name} il {date}", { name: s.recordedBy, date: fmtDate(s.recordedAt) })}</span>
          </div>
          {s.quotes.length > 0 && (
            <div style={{ display: "grid", gap: 4 }}>
              {s.quotes.map((q, k) => <div key={k} style={{ ...sans, display: "flex", gap: 10, fontSize: 13, alignItems: "center" }}>{q.chosen ? <CheckCircle2 size={15} color={C.green} /> : <span style={{ width: 15 }} />}<b style={{ fontWeight: q.chosen ? 650 : 500 }}>{q.supplier}</b><span className="tabular" style={{ marginLeft: "auto", color: C.muted }}>{fmt(q.amount, cur)}</span></div>)}
            </div>
          )}
          {s.justification && <div style={{ ...sans, fontSize: 13, color: C.muted, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{s.justification}</div>}
          {t.saving && <SavingBox saving={t.saving} cur={cur} />}
          {s.approval === "rejected" && s.approvalNote && <Notice kind="error"><b>{i18n.t("Motivo del rifiuto:")}</b> {s.approvalNote}. {i18n.t("Registra un confronto tra offerte o un'altra motivazione.")}</Notice>}
          {isManager && s.approval === "pending" && (
            <div style={{ display: "grid", gap: 8, marginTop: 4 }}>
              <input value={note} onChange={e => setNote(e.target.value)} placeholder={i18n.t("Nota (obbligatoria se respingi)")} aria-label={i18n.t("Nota")} style={iStyle} />
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button onClick={() => decide(true)} disabled={busy} style={{ ...btnPrimary, padding: "9px 14px", fontSize: 13 }}>{i18n.t("Approva l'eccezione")}</button>
                <button onClick={() => decide(false)} disabled={busy} style={{ ...btnGhost, padding: "9px 14px", fontSize: 13, color: C.red }}>{i18n.t("Respingi")}</button>
              </div>
            </div>
          )}
        </div>
      )}
      {editing && (
        <div style={{ display: "grid", gap: 12, marginTop: 4 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }} role="radiogroup" aria-label={i18n.t("Come è stato scelto il fornitore")}>
            {(Object.keys(SOURCING_LABEL) as SourcingMode[]).map(m => (
              <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => setMode(m)} style={{ ...sans, padding: "7px 14px", borderRadius: 999, border: `1px solid ${mode === m ? C.accent : C.border}`, background: mode === m ? C.accentLight : "#fff", color: mode === m ? C.accent : C.muted, fontWeight: 650, fontSize: 12.5, cursor: "pointer" }}>{i18n.t(SOURCING_LABEL[m])}</button>
            ))}
          </div>
          {mode === "comparison" && (
            <div style={{ display: "grid", gap: 8 }}>
              <div style={{ ...sans, fontSize: 12, color: C.muted }}>{i18n.t("Offerte ricevute: segna quella scelta. Ne servono almeno due di fornitori diversi.")}</div>
              {quotes.map((q, k) => (
                <div key={k} style={{ display: "grid", gridTemplateColumns: "auto minmax(0,1fr) 130px auto", gap: 8, alignItems: "center" }}>
                  <input type="radio" name={`chosen-${t.id}`} checked={q.chosen} onChange={() => setQ(k, { chosen: true })} aria-label={i18n.t("Offerta scelta")} style={{ width: 17, height: 17, accentColor: C.accent }} />
                  <input value={q.supplier} onChange={e => setQ(k, { supplier: e.target.value })} placeholder={k === 0 ? i18n.tc("campo", "Fornitore scelto") : i18n.t("Fornitore alternativo")} aria-label={i18n.t("Fornitore")} style={iStyle} />
                  <input value={q.amount} onChange={e => setQ(k, { amount: e.target.value })} inputMode="decimal" placeholder={i18n.t("Importo {cur}", { cur })} aria-label={i18n.t("Importo")} style={iStyle} />
                  <button type="button" onClick={() => setQuotes(qs => qs.length > 2 ? qs.filter((_, j) => j !== k) : qs)} disabled={quotes.length <= 2} aria-label={i18n.t("Rimuovi offerta")} style={{ background: "none", border: "none", cursor: quotes.length > 2 ? "pointer" : "default", color: quotes.length > 2 ? C.subtle : "transparent", padding: 4 }}><Trash2 size={15} /></button>
                </div>
              ))}
              {quotes.length < 10 && <button type="button" onClick={() => setQuotes(qs => [...qs, { supplier: "", amount: "", chosen: false }])} style={{ ...btnGhost, justifySelf: "start", padding: "6px 12px", fontSize: 12.5, display: "inline-flex", alignItems: "center", gap: 6 }}><Plus size={14} />{i18n.t("Aggiungi offerta")}</button>}
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 200px), 1fr))", columnGap: 12 }}>
            <Field label={t.source === "contract" ? i18n.t("Prezzo attuale (contratto in scadenza)") : i18n.t("Prezzo di riferimento (opzionale)")} htmlFor={`sb-${t.id}`}><input id={`sb-${t.id}`} value={baseline} onChange={e => setBaseline(e.target.value)} inputMode="decimal" placeholder={i18n.t("Es. prezzo storico o budget")} style={iStyle} /></Field>
            <Field label={i18n.t("Importo finale negoziato (opzionale)")} htmlFor={`sf-${t.id}`}><input id={`sf-${t.id}`} value={finalAmount} onChange={e => setFinalAmount(e.target.value)} inputMode="decimal" placeholder={mode === "comparison" ? i18n.t("Se diverso dall'offerta scelta") : i18n.t("Importo concordato")} style={iStyle} /></Field>
          </div>
          {preview && <SavingBox saving={preview} cur={cur} />}
          <Field label={mode === "comparison" ? i18n.t("Note (obbligatorie se non scegli l'offerta più bassa)") : mode === "exception" ? i18n.t("Motivo dell'eccezione") : mode === "strategic" ? i18n.t("Perché la fornitura è strategica") : i18n.t("Perché c'è un solo fornitore possibile")} req={mode !== "comparison"} htmlFor={`sj-${t.id}`}>
            <textarea id={`sj-${t.id}`} value={justification} onChange={e => setJustification(e.target.value)} rows={3} style={{ ...iStyle, resize: "vertical" }} />
          </Field>
          {mode === "exception" && !isManager && <div style={{ ...sans, fontSize: 12, color: C.muted, marginTop: -6 }}>{i18n.t("L'eccezione va approvata dal Manager: fino ad allora la RDA non si può chiudere.")}</div>}
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={save} disabled={busy} style={{ ...btnPrimary, padding: "9px 16px", fontSize: 13, display: "inline-flex", alignItems: "center", gap: 7 }}>{busy && <Loader2 className="spin" size={15} />}{i18n.t("Registra")}</button>
            {s && <button onClick={() => setEditing(false)} style={{ ...btnGhost, padding: "9px 14px", fontSize: 13 }}>{i18n.t("Annulla")}</button>}
          </div>
        </div>
      )}
      {err && <div style={{ marginTop: 10 }}><Notice kind="error">{err}</Notice></div>}
    </Card>
  );
}

/** Riepilogo del saving: base di calcolo principale e dettaglio delle altre basi disponibili. */
function SavingBox({ saving, cur }: { saving: Saving; cur: string }) {
  const basis = { baseline: i18n.t("rispetto al prezzo di riferimento"), average: i18n.t("rispetto alla media delle altre offerte"), negotiation: i18n.t("dalla negoziazione") }[saving.basis];
  const pos = saving.amount >= 0;
  return (
    <div style={{ ...sans, background: pos ? C.greenBg : C.redBg, borderRadius: 10, padding: "10px 12px", fontSize: 13, lineHeight: 1.6, marginBottom: 12 }}>
      <div><b style={{ color: pos ? C.green : C.red }}>{pos ? i18n.t("Saving") : i18n.t("Maggior costo")} {fmt(Math.abs(saving.amount), cur)} ({Math.abs(saving.pct)}%)</b> <span style={{ color: C.muted }}>{basis} · {i18n.t("importo finale {amount}", { amount: fmt(saving.finalAmount, cur) })}</span></div>
      <div style={{ color: C.muted, fontSize: 12 }}>
        {[saving.vsBaseline !== null && i18n.t("vs riferimento {amount}", { amount: fmt(saving.vsBaseline, cur) }), saving.vsAverage !== null && i18n.t("vs media offerte {amount}", { amount: fmt(saving.vsAverage, cur) }), saving.negotiation !== null && i18n.t("negoziazione {amount}", { amount: fmt(saving.negotiation, cur) })].filter(Boolean).join(" · ")}
      </div>
    </div>
  );
}
