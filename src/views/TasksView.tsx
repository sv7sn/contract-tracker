import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Contract, PlanStep, Task, TaskDetail, TaskList, User } from "../types.ts";
import { ApiError, importSapFile, portalApi } from "../api.ts";
import { btnGhost, btnPrimary, C, font, iStyle, radius, sans } from "../theme.ts";
import { fmt, fmtDate, isoDate, NOW } from "../lib/format.ts";
import { stepTemplate } from "../lib/plan.ts";
import { Avatar, Card, CardTitle, EmptyState, Field, Grid, StatCard } from "../components/ui.tsx";
import { AlertTriangle, Check, CheckCircle2, Clock, FileText, Inbox, Loader2, Paperclip, Plus, RotateCcw, Search, Send, Trash2, Upload } from "../components/icons.tsx";
import { CloseButton, KV, Notice, Portal } from "../components/vendorUi.tsx";

interface Props {
  currentUser: User; contracts: Contract[]; plans: Record<number, PlanStep[]>;
  onCompleteStep: (contractId: number, stepId: string) => void; onSendBO: (contractId: number) => void; onOpenContract: (c: Contract) => void;
  notify: (m: string) => void; onSessionExpired: () => void;
}

type Origin = "all" | "contract" | "rda" | "manual";
interface Item {
  key: string; origin: "contract" | "rda" | "manual"; title: string; sub: string; due: string | null; assignee: string; assigneeId: number | null;
  status: "open" | "done" | "waiting"; priority: "low" | "normal" | "high"; doneAt: string | null; task?: Task; contract?: Contract; step?: PlanStep;
}

const TODAY = isoDate(NOW);
const daysFrom = (d: string) => Math.round((new Date(d).getTime() - new Date(TODAY).getTime()) / 864e5);
const ORIGIN_LABEL = { contract: "Contratto", rda: "RDA", manual: "Manuale" } as const;
const ORIGIN_COLOR = { contract: [C.blue, C.blueBg], rda: [C.purple, C.purpleBg], manual: [C.gray, C.grayBg] } as const;
const DONE_TEXT: Record<string, string> = { po_created: "PO creato", removed_from_sap: "Non più aperta in SAP", manual: "Completato a mano" };
const PRIO: Record<string, string> = { high: "Alta", normal: "Normale", low: "Bassa" };

const chip = (label: string, color: string, bg: string) => <span style={{ ...sans, background: bg, color, borderRadius: 999, padding: "3px 10px", fontSize: 11.5, fontWeight: 650, whiteSpace: "nowrap" }}>{label}</span>;
const dueText = (it: Item) => {
  if (!it.due) return "—";
  if (it.status === "done") return fmtDate(it.due);
  const d = daysFrom(it.due);
  return `${fmtDate(it.due)} · ${d < 0 ? `in ritardo di ${-d} gg` : d === 0 ? "oggi" : `tra ${d} gg`}`;
};
const overdue = (it: Item) => it.status !== "done" && !!it.due && daysFrom(it.due) < 0;

/** Task del team: RDA da SAP, task creati a mano e attività dei piani di rinnovo dei contratti. */
export function TasksView({ currentUser, contracts, plans, onCompleteStep, onSendBO, onOpenContract, notify, onSessionExpired }: Props) {
  const [data, setData] = useState<TaskList | null>(null);
  const [buyers, setBuyers] = useState<{ id: number; name: string; active: boolean }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [origin, setOrigin] = useState<Origin>("all");
  const [status, setStatus] = useState<"open" | "done" | "all">("open");
  const [who, setWho] = useState("all");
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const isManager = currentUser.role === "manager";

  const fail = useCallback((err: unknown) => {
    if (err instanceof ApiError && err.status === 401) { onSessionExpired(); return "Sessione scaduta"; }
    return err instanceof Error ? err.message : "Operazione non riuscita";
  }, [onSessionExpired]);
  const reload = useCallback(() => portalApi.tasks().then(d => { setData(d); setError(null); }).catch(err => setError(fail(err))), [fail]);
  useEffect(() => {
    let off = false;
    Promise.all([portalApi.tasks(), portalApi.config()]).then(([d, c]) => { if (!off) { setData(d); setBuyers(c.buyers.filter(b => b.active)); } }).catch(err => { if (!off) setError(fail(err)); });
    return () => { off = true; };
  }, [fail]);

  // Attività dei piani di rinnovo: quelle scadute o in scadenza nei prossimi 30 giorni, a carico del Buyer.
  const contractItems = useMemo<Item[]>(() => {
    const out: Item[] = [];
    for (const c of contracts) {
      if (c.ceased) continue;
      for (const s of plans[c.id] ?? []) {
        const t = stepTemplate(s.stepId);
        if (!t || s.status === "done" || t.actor === "system" && s.stepId !== "bo_notify") continue;
        if (daysFrom(s.scheduledDate) > 30) continue;
        out.push({ key: `c:${c.id}:${s.stepId}`, origin: "contract", title: `${t.label} · ${c.supplier}`, sub: c.object, due: s.scheduledDate, assignee: c.owner || "—", assigneeId: null,
          status: t.actor === "bo" || s.status === "pending_bo" ? "waiting" : "open", priority: "normal", doneAt: null, contract: c, step: s });
      }
    }
    return out;
  }, [contracts, plans]);

  const items = useMemo<Item[]>(() => {
    const server = (data?.tasks ?? []).map((t): Item => ({
      key: `t:${t.id}`, origin: t.source, title: t.title, sub: t.source === "rda" ? [t.meta.requestedBy && `Richiedente ${t.meta.requestedBy}`, t.meta.value ? fmt(t.meta.value, t.meta.currency ?? "EUR") : ""].filter(Boolean).join(" · ") : t.detail,
      due: t.due, assignee: t.assigneeName || "Da assegnare", assigneeId: t.assigneeId, status: t.status, priority: t.priority, doneAt: t.doneAt, task: t,
    }));
    return [...server, ...contractItems];
  }, [data, contractItems]);

  const recentDone = (it: Item) => it.status === "done" && !!it.doneAt && Date.now() - new Date(it.doneAt).getTime() < 7 * 864e5;
  const counts = useMemo(() => ({
    open: items.filter(i => i.status !== "done").length, late: items.filter(overdue).length,
    soon: items.filter(i => i.status !== "done" && i.due && daysFrom(i.due) >= 0 && daysFrom(i.due) <= 7).length,
    done: items.filter(recentDone).length, unassigned: items.filter(i => i.origin !== "contract" && i.status !== "done" && i.assigneeId === null).length,
  }), [items]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter(i => (origin === "all" || i.origin === origin) && (status === "all" || (status === "open" ? i.status !== "done" : i.status === "done"))
      && (who === "all" || (who === "none" ? i.origin !== "contract" && i.assigneeId === null : String(i.assigneeId) === who)) && (!q || `${i.title} ${i.sub} ${i.assignee}`.toLowerCase().includes(q)))
      .sort((a, b) => Number(overdue(b)) - Number(overdue(a)) || (a.due ?? "9999").localeCompare(b.due ?? "9999"));
  }, [items, origin, status, who, search]);

  const open = (i: Item) => { if (i.task) setOpenId(i.task.id); else if (i.contract) onOpenContract(i.contract); };
  const doImport = async (files: FileList | null) => {
    if (!files?.length) return;
    setImporting(true);
    for (const f of Array.from(files)) {
      try {
        let r;
        try { r = await importSapFile(f); }
        catch (err) {
          if (err instanceof ApiError && err.status === 409 && err.data.needsForce && window.confirm(`${err.message}\n\nImportare comunque ${f.name}?`)) r = await importSapFile(f, true);
          else throw err;
        }
        notify(r.kind === "pr"
          ? `RDA importate: ${r.prs} (${r.created} nuove${r.reopened ? `, ${r.reopened} riaperte` : ""}${r.closedPo + r.closedGone ? `, ${r.closedPo} chiuse per PO e ${r.closedGone} non più aperte` : ""})`
          : `Ordini importati: ${r.linked} collegamenti con RDA${r.closedPo ? `, ${r.closedPo} task chiusi` : ""}`);
      } catch (err) { notify(`⚠️ ${f.name}: ${fail(err)}`); }
    }
    await reload(); setImporting(false);
    if (input.current) input.current.value = "";
  };

  if (error) return <EmptyState icon={<AlertTriangle size={26} />} title="Impossibile caricare i task" text={error} action={<button onClick={reload} style={{ ...btnGhost, padding: "9px 16px" }}>Riprova</button>} />;
  if (!data) return <div style={{ display: "flex", justifyContent: "center", padding: 60 }}><Loader2 className="spin" size={26} color={C.subtle} /></div>;

  const ageDays = (iso: string | null) => (iso ? Math.round((Date.now() - new Date(iso).getTime()) / 864e5) : null);
  const stale = ageDays(data.sapUpdatedAt.pr);
  const tiles = [
    { label: "Aperti", value: counts.open, sub: "Da fare", color: C.blue, icon: <Inbox size={18} /> },
    { label: "In ritardo", value: counts.late, sub: "Scadenza superata", color: C.red, icon: <AlertTriangle size={18} /> },
    { label: "Entro 7 giorni", value: counts.soon, sub: "In scadenza", color: C.yellow, icon: <Clock size={18} /> },
    ...(isManager ? [{ label: "Da assegnare", value: counts.unassigned, sub: "Senza buyer", color: C.purple, icon: <Send size={18} /> }] : []),
    { label: "Chiusi di recente", value: counts.done, sub: "Ultimi 7 giorni", color: C.green, icon: <CheckCircle2 size={18} /> },
  ];

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
        <div>
          <div style={{ ...font, fontSize: 18, fontWeight: 700, color: C.text }}>Task</div>
          <div style={{ ...sans, fontSize: 12, color: C.muted }}>{isManager ? "Tutto il team" : "I tuoi task"} · RDA da SAP, contratti e attività manuali</div>
        </div>
        <button onClick={() => setCreating(true)} style={{ ...btnPrimary, display: "inline-flex", alignItems: "center", gap: 7, padding: "9px 16px", fontSize: 13 }}><Plus size={16} />Nuovo task</button>
      </div>

      <Card style={{ marginBottom: 14, padding: "14px 16px" }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 280px", minWidth: 0 }}>
            <div style={{ ...sans, fontSize: 13, fontWeight: 650, color: C.text }}>Dati da SAP</div>
            <div style={{ ...sans, fontSize: 12, color: C.muted, lineHeight: 1.5 }}>
              RDA aggiornate: {data.sapUpdatedAt.pr ? new Date(data.sapUpdatedAt.pr).toLocaleString("it-IT", { dateStyle: "medium", timeStyle: "short" }) : "mai"} · Ordini: {data.sapUpdatedAt.po ? new Date(data.sapUpdatedAt.po).toLocaleString("it-IT", { dateStyle: "medium", timeStyle: "short" }) : "mai"}
            </div>
          </div>
          <input ref={input} type="file" multiple hidden accept=".xls,.xml,.xlsx" onChange={e => doImport(e.target.files)} />
          <button onClick={() => input.current?.click()} disabled={importing} style={{ ...btnGhost, display: "inline-flex", alignItems: "center", gap: 7, padding: "9px 14px", color: C.text, fontSize: 13 }}>{importing ? <Loader2 className="spin" size={15} /> : <Upload size={15} />}Importa i file di SAP</button>
        </div>
        {(stale === null || stale >= 2) && <div style={{ marginTop: 10 }}><Notice kind="warn">{stale === null ? "Non è ancora stato importato nessun elenco di RDA." : `L'elenco delle RDA non è aggiornato da ${stale} giorni.`} Carica i due file che SAP invia ogni mattina (RDA aperte e ordini degli ultimi 7 giorni): i task si creano e si chiudono da soli.</Notice></div>}
      </Card>

      <Grid min={170} gap={12} fill style={{ marginBottom: 16 }}>
        {tiles.map(t => <StatCard key={t.label} label={t.label} value={t.value} sub={t.sub} color={t.color} icon={t.icon} />)}
      </Grid>

      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        {([["all", "Tutti"], ["rda", "RDA"], ["contract", "Contratti"], ["manual", "Manuali"]] as [Origin, string][]).map(([k, l]) => (
          <button key={k} onClick={() => setOrigin(k)} aria-pressed={origin === k} style={{ ...sans, padding: "6px 14px", borderRadius: 999, border: `1px solid ${origin === k ? C.accent : C.border}`, background: origin === k ? C.accentLight : "#fff", color: origin === k ? C.accent : C.muted, fontWeight: 650, fontSize: 12.5, cursor: "pointer" }}>{l}</button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: "1 1 240px", maxWidth: 380 }}>
          <Search size={16} color={C.subtle} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Cerca task, RDA, fornitore…" aria-label="Cerca" style={{ ...iStyle, paddingLeft: 36 }} />
        </div>
        <select value={status} onChange={e => setStatus(e.target.value as typeof status)} aria-label="Stato" style={{ ...iStyle, width: "auto", minWidth: 140 }}><option value="open">Aperti</option><option value="done">Chiusi</option><option value="all">Tutti</option></select>
        {isManager && <select value={who} onChange={e => setWho(e.target.value)} aria-label="Assegnatario" style={{ ...iStyle, width: "auto", minWidth: 170 }}><option value="all">Tutto il team</option><option value="none">Da assegnare</option>{buyers.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select>}
      </div>

      {shown.length === 0 ? (
        <EmptyState icon={<CheckCircle2 size={26} />} title={items.length ? "Nessun task con questi filtri" : "Nessun task"} text={items.length ? undefined : "I task arrivano dalle RDA di SAP, dai piani di rinnovo dei contratti e da quelli che crei tu."} />
      ) : (<>
        <div className="table-wrap desktop-only">
          <table className="data-table">
            <thead><tr><th>Task</th><th>Origine</th><th>Scadenza</th><th>Assegnato a</th><th>Stato</th><th aria-label="Azioni" /></tr></thead>
            <tbody>
              {shown.map(i => (
                <tr key={i.key} onClick={() => open(i)} tabIndex={0} onKeyDown={e => { if (e.key === "Enter") open(i); }}>
                  <td style={{ minWidth: 260, boxShadow: overdue(i) ? `inset 3px 0 0 ${C.red}` : i.priority === "high" && i.status !== "done" ? `inset 3px 0 0 ${C.yellow}` : undefined }}><div style={{ fontWeight: 650, color: C.text }}>{i.title}</div><div style={{ fontSize: 12, color: C.muted, overflow: "hidden", textOverflow: "ellipsis", maxWidth: 420, whiteSpace: "nowrap" }}>{i.sub}</div></td>
                  <td>{chip(ORIGIN_LABEL[i.origin], ORIGIN_COLOR[i.origin][0], ORIGIN_COLOR[i.origin][1])}</td>
                  <td className="tabular" style={{ whiteSpace: "nowrap", color: overdue(i) ? C.red : C.text, fontWeight: overdue(i) ? 650 : 400 }}>{dueText(i)}</td>
                  <td><div style={{ display: "flex", alignItems: "center", gap: 8, whiteSpace: "nowrap" }}>{i.assignee !== "Da assegnare" && i.assignee !== "—" && <Avatar name={i.assignee} size={24} />}<span style={{ color: i.assignee === "Da assegnare" ? C.purple : C.muted, fontWeight: i.assignee === "Da assegnare" ? 650 : 400 }}>{i.assignee}</span></div></td>
                  <td>{statusChip(i)}</td>
                  <td onClick={e => e.stopPropagation()} style={{ whiteSpace: "nowrap" }}>{contractAction(i, onCompleteStep, onSendBO, onOpenContract)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mobile-only">
          <Grid min={320} gap={12}>
            {shown.map(i => (
              <Card key={i.key} className="lift" onClick={() => open(i)} role="button" tabIndex={0} style={{ padding: 14, cursor: "pointer", borderRadius: radius.md, borderLeft: overdue(i) ? `4px solid ${C.red}` : undefined }}>
                <div style={{ ...sans, fontSize: 14, fontWeight: 650, color: C.text }}>{i.title}</div>
                {i.sub && <div style={{ ...sans, fontSize: 12.5, color: C.muted, marginBottom: 8 }}>{i.sub}</div>}
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>{chip(ORIGIN_LABEL[i.origin], ORIGIN_COLOR[i.origin][0], ORIGIN_COLOR[i.origin][1])}{statusChip(i)}<span style={{ ...sans, fontSize: 12, color: overdue(i) ? C.red : C.muted }}>{dueText(i)}</span></div>
                <div style={{ ...sans, fontSize: 12, color: C.subtle, marginTop: 8 }}>{i.assignee}</div>
                <div onClick={e => e.stopPropagation()} style={{ marginTop: 8 }}>{contractAction(i, onCompleteStep, onSendBO, onOpenContract)}</div>
              </Card>
            ))}
          </Grid>
        </div>
      </>)}

      {creating && <Portal><NewTaskDialog isManager={isManager} buyers={buyers} currentUser={currentUser} fail={fail} onClose={() => setCreating(false)} onCreated={async () => { setCreating(false); notify("Task creato"); await reload(); }} /></Portal>}
      {openId !== null && <Portal><TaskSheet id={openId} isManager={isManager} buyers={buyers} fail={fail} notify={notify} onClose={() => setOpenId(null)} onChanged={reload} /></Portal>}
    </div>
  );
}

function statusChip(i: Item) {
  if (i.status === "done") return chip(i.task?.doneReason ? DONE_TEXT[i.task.doneReason] ?? "Chiuso" : "Chiuso", C.green, C.greenBg);
  if (i.status === "waiting") return chip("In attesa del BO", C.gray, C.grayBg);
  if (overdue(i)) return chip("In ritardo", C.red, C.redBg);
  if (i.origin !== "contract" && i.assigneeId === null) return chip("Da assegnare", C.purple, C.purpleBg);
  return chip("Aperto", C.blue, C.blueBg);
}

/** Azione rapida dei task che arrivano dal piano di un contratto. */
function contractAction(i: Item, done: (c: number, s: string) => void, sendBO: (c: number) => void, open: (c: Contract) => void) {
  if (i.origin !== "contract" || !i.contract || !i.step) return null;
  const small = { ...btnGhost, padding: "6px 10px", fontSize: 12, display: "inline-flex", alignItems: "center", gap: 5 } as const;
  if (i.step.stepId === "bo_notify") return <button onClick={() => sendBO(i.contract!.id)} style={small}><Send size={13} />Invia al BO</button>;
  if (i.status === "waiting") return <button onClick={() => open(i.contract!)} style={small}><FileText size={13} />Apri contratto</button>;
  return <button onClick={() => done(i.contract!.id, i.step!.stepId)} style={small}><Check size={13} />Segna fatto</button>;
}

function NewTaskDialog({ isManager, buyers, currentUser, fail, onClose, onCreated }: { isManager: boolean; buyers: { id: number; name: string }[]; currentUser: User; fail: (e: unknown) => string; onClose: () => void; onCreated: () => void }) {
  const [f, setF] = useState({ title: "", detail: "", due: "", priority: "normal", assigneeId: currentUser.id });
  const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    try { await portalApi.createTask({ title: f.title, detail: f.detail, due: f.due || null, priority: f.priority, ...(isManager ? { assigneeId: f.assigneeId } : {}) }); onCreated(); }
    catch (err) { setError(fail(err)); setBusy(false); }
  };
  return (
    <div className="dialog-overlay" role="dialog" aria-modal="true">
      <form className="dialog" onSubmit={submit}>
        <h3 style={{ ...font, margin: "0 0 14px", fontSize: 17 }}>Nuovo task</h3>
        <Field label="Titolo" req htmlFor="nt-title"><input id="nt-title" required autoFocus value={f.title} onChange={e => setF({ ...f, title: e.target.value })} style={iStyle} /></Field>
        <Field label="Note" htmlFor="nt-detail"><textarea id="nt-detail" value={f.detail} onChange={e => setF({ ...f, detail: e.target.value })} style={{ ...iStyle, height: 70, resize: "vertical" }} /></Field>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="Scadenza" htmlFor="nt-due"><input id="nt-due" type="date" value={f.due} onChange={e => setF({ ...f, due: e.target.value })} style={iStyle} /></Field>
          <Field label="Priorità" htmlFor="nt-prio"><select id="nt-prio" value={f.priority} onChange={e => setF({ ...f, priority: e.target.value })} style={iStyle}>{Object.entries(PRIO).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        </div>
        {isManager && <Field label="Assegna a" htmlFor="nt-who"><select id="nt-who" value={f.assigneeId} onChange={e => setF({ ...f, assigneeId: Number(e.target.value) })} style={iStyle}>{buyers.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>}
        {error && <Notice kind="error">{error}</Notice>}
        <div style={{ display: "flex", gap: 10 }}>
          <button type="button" onClick={onClose} style={{ ...btnGhost, flex: 1 }}>Annulla</button>
          <button type="submit" disabled={busy} style={{ ...btnPrimary, flex: 2, opacity: busy ? 0.7 : 1 }}>Crea task</button>
        </div>
      </form>
    </div>
  );
}

function TaskSheet({ id, isManager, buyers, fail, notify, onClose, onChanged }: { id: number; isManager: boolean; buyers: { id: number; name: string }[]; fail: (e: unknown) => string; notify: (m: string) => void; onClose: () => void; onChanged: () => void }) {
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
    try { setT(await portalApi.updateTask(id, p)); onChanged(); if (msg) notify(msg); } catch (err) { setError(fail(err)); }
    setBusy(false);
  };
  const remove = async () => {
    if (!window.confirm("Eliminare questo task?")) return;
    try { await portalApi.deleteTask(id); notify("Task eliminato"); onChanged(); onClose(); } catch (err) { setError(fail(err)); }
  };
  const rda = t?.source === "rda";
  const total = (t?.lines ?? []).reduce((a, l) => a + l.value, 0);
  const age = t?.meta.releaseDate ? Math.round((Date.now() - new Date(t.meta.releaseDate).getTime()) / 864e5) : null;

  return (
    <div className="sheet-overlay" role="dialog" aria-modal="true" aria-label="Dettaglio task" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet" style={{ maxWidth: 760 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 14 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ ...font, fontSize: 18, fontWeight: 700, color: C.text, overflowWrap: "anywhere" }}>{t?.title ?? "…"}</div>
            {t && <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>{chip(rda ? "RDA" : "Manuale", ORIGIN_COLOR[t.source][0], ORIGIN_COLOR[t.source][1])}{t.status === "done" ? chip(DONE_TEXT[t.doneReason] ?? "Chiuso", C.green, C.greenBg) : chip("Aperto", C.blue, C.blueBg)}</div>}
          </div>
          <CloseButton onClick={onClose} />
        </div>
        {!t && !error && <div style={{ display: "flex", justifyContent: "center", padding: 40 }}><Loader2 className="spin" size={24} color={C.subtle} /></div>}
        {error && <Notice kind="error">{error}</Notice>}
        {t && (
          <div style={{ display: "grid", gap: 14 }}>
            {t.status === "done" && rda && t.doneReason === "po_created" && <Notice kind="ok"><b>Chiusa automaticamente:</b> in SAP è stato creato l'ordine {t.pos.map(p => p.po).join(", ") || "collegato"}{t.pos[0]?.supplierName ? ` (${t.pos[0].supplierName})` : ""}{t.doneAt ? ` il ${fmtDate(t.doneAt)}` : ""}.</Notice>}
            {t.status === "done" && rda && t.doneReason === "removed_from_sap" && <Notice kind="info"><b>Chiusa automaticamente:</b> la RDA non risulta più aperta in SAP (ordinata, rifiutata o cancellata). Se in seguito arriva l'elenco degli ordini con il suo PO, lo vedrai qui.</Notice>}
            {t.status === "open" && t.pos.length > 0 && <Notice kind="info">Per questa RDA esiste già un ordine ({t.pos.map(p => p.po).join(", ")}): il task si chiude quando la RDA non è più aperta in SAP.</Notice>}
            <Card>
              <KV rows={[
                ...(rda ? [["Numero RDA", t.sourceKey ?? ""], ["Gruppo acquisti", t.meta.pgr ?? ""], ["Richiedente", t.meta.requestedBy ?? ""], ["Importo", t.meta.value ? fmt(t.meta.value, t.meta.currency ?? "EUR") : ""], ["Rilasciata il", t.meta.releaseDate ? `${fmtDate(t.meta.releaseDate)}${age !== null ? ` (da ${age} gg)` : ""}` : ""], ["Consegna richiesta", t.meta.delivDate ? fmtDate(t.meta.delivDate) : ""]] as [string, string][] : []),
                ["Scadenza", t.due ? fmtDate(t.due) : ""], ["Assegnato a", t.assigneeName || "Da assegnare"], ...(!rda ? [["Priorità", PRIO[t.priority]], ["Creato da", t.createdBy]] as [string, string][] : []),
              ]} />
              {!rda && t.detail && <div style={{ ...sans, fontSize: 13, color: C.muted, marginTop: 12, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{t.detail}</div>}
            </Card>

            {rda && t.lines.length > 0 && (
              <Card>
                <CardTitle icon={<Paperclip size={16} />}>Righe della RDA ({t.lines.length})</CardTitle>
                <div style={{ overflowX: "auto" }}>
                  <table className="data-table" style={{ minWidth: 520 }}>
                    <thead><tr><th>Pos.</th><th>Descrizione</th><th className="num">Importo</th><th>Consegna</th><th>Centro di costo</th></tr></thead>
                    <tbody>{t.lines.map((l, k) => <tr key={k} style={{ cursor: "default" }}><td>{l.item}</td><td>{l.shortText}</td><td className="num tabular">{fmt(l.value, l.currency)}</td><td className="tabular">{l.delivDate ? fmtDate(l.delivDate) : "—"}</td><td>{l.costCenter || "—"}</td></tr>)}</tbody>
                  </table>
                </div>
                {t.lines.length > 1 && <div style={{ ...sans, fontSize: 12.5, color: C.muted, marginTop: 8, textAlign: "right" }}>Totale {fmt(total, t.lines[0].currency)}</div>}
              </Card>
            )}

            {t.pos.length > 0 && (
              <Card>
                <CardTitle>Ordini collegati</CardTitle>
                {t.pos.map(p => <div key={p.po} style={{ ...sans, display: "flex", gap: 10, padding: "6px 0", fontSize: 13, flexWrap: "wrap" }}><b>{p.po}</b><span style={{ color: C.muted }}>{p.supplierName}</span><span style={{ color: C.subtle }}>{p.docDate ? fmtDate(p.docDate) : ""}</span></div>)}
              </Card>
            )}

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              {isManager && t.status === "open" && (
                <select aria-label="Assegna a" value={t.assigneeId ?? ""} onChange={e => patch({ assigneeId: e.target.value ? Number(e.target.value) : null }, "Assegnazione salvata")} disabled={busy} style={{ ...iStyle, width: "auto", minWidth: 200 }}>
                  <option value="">Da assegnare</option>{buyers.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              )}
              <div style={{ flex: 1 }} />
              {t.status === "open" && <button onClick={() => patch({ status: "done" }, "Task completato")} disabled={busy} style={{ ...btnPrimary, padding: "10px 16px", display: "inline-flex", alignItems: "center", gap: 7 }}>{busy ? <Loader2 className="spin" size={15} /> : <Check size={16} />}{rda ? "Segna come gestita" : "Completa"}</button>}
              {t.status === "done" && (t.source === "manual" || t.doneReason === "manual") && <button onClick={() => patch({ status: "open" }, "Task riaperto")} disabled={busy} style={{ ...btnGhost, padding: "10px 16px", display: "inline-flex", alignItems: "center", gap: 7 }}><RotateCcw size={15} />Riapri</button>}
              {t.source === "manual" && <button onClick={remove} style={{ ...btnGhost, padding: "10px 14px", color: C.red, borderColor: "#f0c9c9", display: "inline-flex", alignItems: "center", gap: 6 }}><Trash2 size={15} />Elimina</button>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
