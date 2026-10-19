import { RatingCard, ScoreBadge } from "./RatingCard.tsx";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { DuplicateMatch, Lifecycle, InviteInput, PortalConfig, Supplier, SupplierStatus, SupplierSummary, User, VendorAction } from "../types.ts";
import { ApiError, portalApi, vendorExportUrl } from "../api.ts";
import { btnGhost, btnPrimary, C, font, iStyle, radius, sans } from "../theme.ts";
import { fmt, fmtDate } from "../lib/format.ts";
import { countryName } from "../supplierRules.ts";
import { Avatar, AuditTrail, Card, CardTitle, EmptyState, Field } from "../components/ui.tsx";
import { ListHeader } from "../components/ListHeader.tsx";
import { filterButton, filterSelect } from "../components/listHeaderStyles.ts";
import { CheckCircle2, Clock, Copy, FileCheck2, Hourglass, Loader2, Mail, Paperclip, Plus, RotateCcw, Search, Send, Trash2, Users, Ban, AlertTriangle, FileText, ShieldAlert, CalendarClock } from "../components/icons.tsx";
import { AiResult, VendorFlags, CloseButton, DocLink, KV, Notice, ReasonDialog, StatusBadge, ValidityChip, Portal, RiskBadge, RiskPanel } from "../components/vendorUi.tsx";
import { CHECK_STYLE, fmtSize, STATUS_STYLE, supplierTimeline } from "../lib/vendors.ts";
import { Summary } from "./SupplierPortal.tsx";
import { locale, t } from "../i18n/index.ts";

interface Props { initialOpenId?: number; onFocusUsed?: () => void; currentUser: User; notify: (m: string) => void; onSessionExpired: () => void; onOpenExpiries?: () => void }

const copyText = async (t: string) => { try { await navigator.clipboard.writeText(t); return true; } catch { return false; } };

export function VendorsView({ initialOpenId, onFocusUsed, currentUser, notify, onSessionExpired, onOpenExpiries }: Props) {
  const [vendors, setVendors] = useState<SupplierSummary[] | null>(null);
  const [config, setConfig] = useState<PortalConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<SupplierStatus | "all" | "lapsed" | "flags" | "dups" | "risk_high" | "risk_medium">("all");
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<number | null>(initialOpenId ?? null);
  useEffect(() => { if (initialOpenId) onFocusUsed?.(); }, [initialOpenId, onFocusUsed]);
  const [inviting, setInviting] = useState(false);
  const [demo, setDemo] = useState<{ name: string; email: string; password: string } | null>(null);
  const [demoBusy, setDemoBusy] = useState(false);
  const [ratings, setRatings] = useState<Record<number, { overall: number; count: number }>>({});

  const fail = useCallback((err: unknown) => {
    if (err instanceof ApiError && err.status === 401) { onSessionExpired(); return t("Sessione scaduta"); }
    return err instanceof Error ? err.message : t("Operazione non riuscita");
  }, [onSessionExpired]);
  const reload = useCallback(async () => {
    try { const [v, c] = await Promise.all([portalApi.vendors(), portalApi.config()]); setVendors(v); setConfig(c); setError(null); portalApi.ratings().then(setRatings).catch(() => undefined); }
    catch (err) { setError(fail(err)); }
  }, [fail]);
  useEffect(() => {
    let off = false;
    Promise.all([portalApi.vendors(), portalApi.config()]).then(([v, c]) => { if (!off) { setVendors(v); setConfig(c); } }).catch(err => { if (!off) setError(fail(err)); });
    portalApi.ratings().then(r => { if (!off) setRatings(r); }).catch(() => undefined);
    return () => { off = true; };
  }, [fail]);

  const makeDemo = async () => {
    setDemoBusy(true);
    try { const d = await portalApi.demoSupplier(); setDemo(d); notify(t("{name} creato", { name: d.name })); await reload(); } catch (err) { notify(`⚠️ ${fail(err)}`); }
    setDemoBusy(false);
  };
  const canInvite = currentUser.role === "manager" || currentUser.role === "buyer";
  const mine: SupplierStatus = currentUser.role === "finance" ? "approved" : "pending";

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const v of vendors ?? []) { c[v.status] = (c[v.status] ?? 0) + 1; if (v.qualification === "lapsed") c.lapsed = (c.lapsed ?? 0) + 1; if (v.risk?.level === "high") c.risk_high = (c.risk_high ?? 0) + 1; }
    return c;
  }, [vendors]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const match = (v: SupplierSummary) => filter === "all" || (filter === "lapsed" ? v.qualification === "lapsed" : filter === "flags" ? v.lifecycle !== "active" : filter === "dups" ? v.duplicate : filter === "risk_high" ? v.risk?.level === "high" : filter === "risk_medium" ? v.risk?.level === "medium" : v.status === filter);
    return (vendors ?? []).filter(v => match(v) && (!q || [v.name, v.legalName, v.email, v.sapCode ?? "", v.referenceBuyerName].some(x => x.toLowerCase().includes(q))))
      .sort((a, b) => (a.status === mine ? -1 : 0) - (b.status === mine ? -1 : 0) || b.updatedAt.localeCompare(a.updatedAt));
  }, [vendors, filter, search, mine]);

  if (error) return <EmptyState icon={<AlertTriangle size={26} />} title={t("Impossibile caricare i fornitori")} text={error} action={<button onClick={reload} style={{ ...btnGhost, padding: "9px 16px" }}>{t("Riprova")}</button>} />;
  if (!vendors || !config) return <div style={{ display: "flex", justifyContent: "center", padding: 60 }}><Loader2 className="spin" size={26} color={C.subtle} /></div>;

  const tiles: { key: SupplierStatus | "lapsed" | "risk_high"; label: string; icon: React.ReactNode; color: string; sub: string }[] = [
    { key: "pending", label: t("Da verificare"), icon: <Hourglass size={18} />, color: C.yellow, sub: t("Passaggio del Buyer") },
    { key: "approved", label: t("In attesa del Finance"), icon: <FileCheck2 size={18} />, color: C.purple, sub: t("Da registrare in SAP") },
    { key: "pending_revision", label: t("Modifiche richieste"), icon: <RotateCcw size={18} />, color: C.red, sub: t("Attesa del fornitore") },
    { key: "registered", label: t("Registrati in SAP"), icon: <CheckCircle2 size={18} />, color: C.green, sub: t("Codice assegnato") },
    { key: "invited", label: t("Inviti aperti"), icon: <Mail size={18} />, color: C.gray, sub: t("Non ancora attivati") },
    { key: "lapsed", label: t("Qualifica scaduta"), icon: <AlertTriangle size={18} />, color: C.red, sub: t("Documenti obbligatori scaduti") },
    { key: "risk_high", label: t("Rischio alto"), icon: <ShieldAlert size={18} />, color: C.red, sub: t("Fornitori registrati da ricontrollare") },
  ];

  return (
    <div>
      {demo && <Notice kind="ok"><b>{t("{name} creato", { name: demo.name })}</b>: {t("registrato, documenti validi e controlli superati. Per provare anche l'area del fornitore accedi con")} <b>{demo.email}</b> {t("e password")} <b style={{ userSelect: "all" }}>{demo.password}</b> {t("(mostrata solo ora).")}</Notice>}

      <ListHeader search={search} onSearch={setSearch} placeholder={t("Cerca per nome, email, codice SAP…")} filtered={filter !== "all"}
        counts={tiles.filter(x => (currentUser.role !== "finance" || x.key !== "invited") && ((counts[x.key] ?? 0) > 0 || x.key === mine)).map(x => ({ key: x.key, label: x.label, value: counts[x.key] ?? 0, color: x.color, title: x.sub, active: filter === x.key, onClick: () => setFilter(f => f === x.key ? "all" : x.key) }))}
        add={canInvite ? { label: t("Invita fornitore"), onClick: () => setInviting(true) } : undefined}
        filters={<>
          <select value={filter} onChange={e => setFilter(e.target.value as typeof filter)} aria-label={t("Filtra per stato")} style={filterSelect}>
            <option value="all">{t("Tutti gli stati")}</option>
            {(Object.keys(STATUS_STYLE) as SupplierStatus[]).map(k => <option key={k} value={k}>{t(STATUS_STYLE[k].label)}</option>)}
            <option value="lapsed">{t("Qualifica scaduta")}</option><option value="risk_high">{t("Rischio alto")}</option><option value="risk_medium">{t("Rischio medio")}</option><option value="flags">{t("Bloccati, disattivati o esclusi")}</option><option value="dups">{t("Possibili doppioni")}</option>
          </select>
          {onOpenExpiries && <button onClick={onOpenExpiries} style={filterButton}><CalendarClock size={15} />{t("Scadenze documenti")}</button>}
          {currentUser.role === "manager" && <button onClick={makeDemo} disabled={demoBusy} title={t("Crea un fornitore già registrato e in regola, per provare contratti e acquisti")} style={filterButton}>{demoBusy ? <Loader2 className="spin" size={15} /> : <Plus size={15} />}{t("Fornitore di prova")}</button>}
        </>} />

      {shown.length === 0 ? (
        vendors.length === 0
          ? <EmptyState icon={<Users size={26} />} title={t("Nessun fornitore ancora")} text={t("Invita il primo fornitore: riceverà un link personale per registrarsi e caricare i documenti di qualifica.")} action={canInvite && <button onClick={() => setInviting(true)} style={{ ...btnPrimary, padding: "10px 18px", display: "inline-flex", alignItems: "center", gap: 8 }}><Plus size={17} />{t("Invita fornitore")}</button>} />
          : <EmptyState icon={<Search size={26} />} title={t("Nessun risultato")} text={t("Nessun fornitore corrisponde a ricerca e filtri.")} action={<button onClick={() => { setSearch(""); setFilter("all"); }} style={{ ...btnGhost, padding: "9px 16px" }}>{t("Azzera filtri")}</button>} />
      ) : (<>
        <div className="table-wrap desktop-only">
          <table className="data-table">
            <thead><tr><th>{t("Fornitore")}</th><th>{t("Paese")}</th><th>{t("Società")}</th><th>{t("Stato")}</th><th>{t("Rischio")}</th><th>{t("Buyer")}</th><th>{t("Voto")}</th><th>{t("Aggiornato")}</th><th aria-label={t("Documenti")} /></tr></thead>
            <tbody>
              {shown.map(v => (
                <tr key={v.id} onClick={() => setOpenId(v.id)} tabIndex={0} onKeyDown={e => { if (e.key === "Enter") setOpenId(v.id); }}>
                  <td style={{ minWidth: 220, boxShadow: v.status === mine ? `inset 3px 0 0 ${C.accent}` : undefined }}><div style={{ fontWeight: 650, color: C.text }}>{v.legalName || v.name}</div><div style={{ fontSize: 12, color: C.muted }}>{v.email}</div></td>
                  <td>{v.country ? t(countryName(v.country)) : "—"}</td>
                  <td style={{ color: C.muted }}>{v.companyCodes.join(", ")}</td>
                  <td><div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}><StatusBadge status={v.status} update={v.isUpdate} /><VendorFlags lifecycle={v.lifecycle} qualification={v.qualification} duplicate={v.duplicate} /></div></td>
                  <td><RiskBadge risk={v.risk} /></td>
                  <td><div style={{ display: "flex", alignItems: "center", gap: 8, whiteSpace: "nowrap" }}><Avatar name={v.referenceBuyerName || "?"} size={24} /><span style={{ color: C.muted }}>{v.referenceBuyerName || "—"}</span></div></td>
                  <td>{ratings[v.id] ? <ScoreBadge value={ratings[v.id].overall} count={ratings[v.id].count} /> : <span style={{ color: C.subtle }}>—</span>}</td>
                  <td className="tabular" style={{ whiteSpace: "nowrap", color: C.muted }}>{fmtDate(v.updatedAt)}</td>
                  <td style={{ color: C.subtle, whiteSpace: "nowrap" }}>{v.documentCount > 0 && <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}><Paperclip size={14} />{v.documentCount}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* Telefono: righe compatte di due righe, come i task */}
        <div className="mobile-only" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 8 }}>
          {shown.map(v => (
            <Card key={v.id} className="task-row" onClick={() => setOpenId(v.id)} role="button" tabIndex={0} onKeyDown={e => { if (e.key === "Enter") setOpenId(v.id); }}
              style={{ padding: "0 13px", cursor: "pointer", borderRadius: radius.md, borderLeft: v.status === mine ? `4px solid ${C.accent}` : undefined, display: "flex", alignItems: "center", gap: 10, boxSizing: "border-box" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="one-line" style={{ ...sans, fontSize: 14, fontWeight: 650, color: C.text }}>{v.legalName || v.name}</div>
                <div className="one-line" style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 5 }}><StatusBadge status={v.status} update={v.isUpdate} />{v.risk && v.risk.level !== "na" && v.risk.level !== "low" && <RiskBadge risk={v.risk} />}<VendorFlags lifecycle={v.lifecycle} qualification={v.qualification} duplicate={v.duplicate} /></div>
              </div>
              {v.referenceBuyerName && <span title={v.referenceBuyerName}><Avatar name={v.referenceBuyerName} size={24} /></span>}
            </Card>
          ))}
        </div>
      </>)}

      {inviting && <Portal><InviteModal config={config} currentUser={currentUser} onClose={() => setInviting(false)} onDone={() => { reload(); }} fail={fail} /></Portal>}
      {openId !== null && <Portal><VendorSheet id={openId} config={config} currentUser={currentUser} onClose={() => setOpenId(null)} onChanged={reload} notify={notify} fail={fail} /></Portal>}
    </div>
  );
}

// ─── Invito ──────────────────────────────────────────────────
function InviteModal({ config, currentUser, onClose, onDone, fail }: { config: PortalConfig; currentUser: User; onClose: () => void; onDone: () => void; fail: (e: unknown) => string }) {
  const myBuyer = config.buyers.find(b => b.id === currentUser.id);
  const [f, setF] = useState<InviteInput>({ name: "", email: "", companyCodes: config.companies.length === 1 ? [config.companies[0].code] : [], industryCode: "", customerCode: "", referenceBuyerId: myBuyer?.id ?? 0 });
  const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<string | null>(null); const [copied, setCopied] = useState(false);
  const [dups, setDups] = useState<DuplicateMatch[] | null>(null);
  const toggle = (code: string) => setF(x => ({ ...x, companyCodes: x.companyCodes.includes(code) ? x.companyCodes.filter(c => c !== code) : [...x.companyCodes, code] }));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    try { const r = await portalApi.invite({ ...f, customerCode: f.industryCode === "CT00" ? f.customerCode : "", confirmDuplicates: !!dups }); setLink(r.link); onDone(); }
    catch (err) {
      // Possibile doppione: si mostra l'elenco e si chiede una conferma esplicita.
      if (err instanceof ApiError && err.status === 409 && Array.isArray(err.data.duplicates)) setDups(err.data.duplicates as DuplicateMatch[]);
      setError(fail(err)); setBusy(false);
    }
  };
  return (
    <div className="dialog-overlay" role="dialog" aria-modal="true">
      <form className="dialog" onSubmit={submit} style={{ maxWidth: 480 }}>
        {link ? (
          <>
            <div style={{ color: C.green, display: "flex", marginBottom: 8 }}><CheckCircle2 size={40} strokeWidth={1.6} /></div>
            <h3 style={{ ...font, margin: "0 0 6px", fontSize: 18 }}>{t("Invito creato")}</h3>
            <p style={{ ...sans, fontSize: 13, color: C.muted, lineHeight: 1.55, margin: "0 0 12px" }}>{t("Il fornitore riceve il link per email. Se l'invio email non è ancora configurato, copia il link qui sotto e mandaglielo tu: vale una sola volta e scade tra pochi giorni.")}</p>
            <div style={{ ...sans, fontSize: 12.5, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: 10, overflowWrap: "anywhere", marginBottom: 12 }}>{link}</div>
            <div style={{ display: "flex", gap: 10 }}>
              <button type="button" onClick={async () => setCopied(await copyText(link))} style={{ ...btnGhost, flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 7 }}><Copy size={15} />{copied ? t("Copiato") : t("Copia link")}</button>
              <button type="button" onClick={onClose} style={{ ...btnPrimary, flex: 1 }}>{t("Chiudi")}</button>
            </div>
          </>
        ) : (
          <>
            <h3 style={{ ...font, margin: "0 0 14px", fontSize: 18 }}>{t("Invita un fornitore")}</h3>
            <Field label={t("Ragione sociale")} req htmlFor="i-name"><input id="i-name" required value={f.name} onChange={e => setF({ ...f, name: e.target.value })} style={iStyle} /></Field>
            <Field label={t("Email del referente")} req htmlFor="i-mail"><input id="i-mail" type="email" required value={f.email} onChange={e => setF({ ...f, email: e.target.value })} style={iStyle} /></Field>
            <Field label={t("Società che lo ingaggiano")} req>
              <div style={{ display: "grid", gap: 6 }}>
                {config.companies.map(c => <label key={c.code} style={{ ...sans, display: "flex", gap: 8, alignItems: "center", fontSize: 13.5, cursor: "pointer" }}><input type="checkbox" checked={f.companyCodes.includes(c.code)} onChange={() => toggle(c.code)} style={{ accentColor: C.accent, width: 16, height: 16 }} />{c.name} <span style={{ color: C.subtle }}>({c.code})</span></label>)}
                {config.companies.length === 0 && <div style={{ ...sans, fontSize: 12.5, color: C.red }}>{t("Nessuna società configurata: chiedi a un Manager di aggiungerla in Configurazione.")}</div>}
              </div>
            </Field>
            <Field label={t("Codice merceologico")} req htmlFor="i-ind">
              <select id="i-ind" required value={f.industryCode} onChange={e => setF({ ...f, industryCode: e.target.value })} style={iStyle}><option value="">{t("Seleziona…")}</option>{config.industryCodes.map(i => <option key={i.code} value={i.code}>{i.code} · {i.name}</option>)}</select>
            </Field>
            {f.industryCode === "CT00" && <Field label={t("Codice cliente")} req htmlFor="i-cust"><input id="i-cust" required value={f.customerCode ?? ""} onChange={e => setF({ ...f, customerCode: e.target.value })} style={iStyle} /></Field>}
            <Field label={t("Buyer di riferimento")} req htmlFor="i-buy">
              <select id="i-buy" required value={f.referenceBuyerId || ""} onChange={e => setF({ ...f, referenceBuyerId: Number(e.target.value) })} style={iStyle}><option value="">{t("Seleziona…")}</option>{config.buyers.filter(b => b.active).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
            </Field>
            {error && <Notice kind="error">{error}</Notice>}
            {dups && <DuplicateList dups={dups} />}
            <div style={{ display: "flex", gap: 10 }}>
              <button type="button" onClick={onClose} style={{ ...btnGhost, flex: 1 }}>{t("Annulla")}</button>
              <button type="submit" disabled={busy || f.companyCodes.length === 0} style={{ ...btnPrimary, flex: 2, opacity: busy || f.companyCodes.length === 0 ? 0.6 : 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>{busy ? <Loader2 className="spin" size={16} /> : <Send size={16} />}{dups ? t("Non è un doppione: invita") : t("Invia invito")}</button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}

// ─── Scheda del fornitore ────────────────────────────────────
export function VendorSheet({ id, config, currentUser, onClose, onChanged, notify, fail }: { id: number; config: PortalConfig; currentUser: User; onClose: () => void; onChanged: () => void; notify: (m: string) => void; fail: (e: unknown) => string }) {
  const [s, setS] = useState<Supplier | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [terms, setTerms] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"reject" | "revision" | "block" | "deactivate" | "exclude" | "reactivate" | "sanctions" | "anonymize" | null>(null);
  const [copied, setCopied] = useState(false);
  const [access, setAccess] = useState<{ email: string; password: string } | null>(null);
  // Conferme richieste dai controlli: doppioni (Buyer), verifica del conto e valutazione dei controlli (Finance).
  const [dupOk, setDupOk] = useState(false); const [dupReason, setDupReason] = useState("");
  const [bankContact, setBankContact] = useState(""); const [bankNote, setBankNote] = useState("");
  const [ack, setAck] = useState(false); const [ackNote, setAckNote] = useState("");

  useEffect(() => {
    let off = false;
    portalApi.vendor(id).then(v => { if (!off) { setS(v); setTerms(v.paymentTerms ?? ""); } }).catch(err => { if (!off) setLoadError(fail(err)); });
    return () => { off = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const isBuyerStep = currentUser.role === "manager" || currentUser.role === "buyer";
  const isFinanceStep = currentUser.role === "manager" || currentUser.role === "finance";

  const run = async (label: string, action: VendorAction, extra: Record<string, unknown> = {}): Promise<string | null> => {
    setBusy(label); setError(null);
    try { const v = await portalApi.action(id, action, extra); setS(v); setTerms(v.paymentTerms ?? ""); onChanged(); setBusy(null); return null; }
    catch (err) { const m = fail(err); setError(m); setBusy(null); return m; }
  };
  const rerunChecks = async () => {
    setBusy("checks"); setError(null);
    try { setS(await portalApi.vendorChecks(id)); notify(t("Controlli eseguiti")); } catch (err) { setError(fail(err)); }
    setBusy(null);
  };
  const recheck = async (docId: number) => {
    setBusy(`ai${docId}`); setError(null);
    try { setS(await portalApi.recheckDocument(docId)); } catch (err) { setError(fail(err)); }
    setBusy(null);
  };
  const invite = async (what: "resend" | "delete") => {
    setBusy(what); setError(null);
    try {
      // Il link si vede solo qui: il server ne conserva solo l'impronta. Senza email configurate è l'unico modo di farlo arrivare al fornitore.
      if (what === "resend") { const r = await portalApi.reinvite(id); setS({ ...r.supplier, inviteLink: r.link }); setCopied(false); notify(t("Nuovo link creato: copialo e mandalo al fornitore")); }
      else { if (!window.confirm(t("Eliminare questo invito?"))) { setBusy(null); return; } await portalApi.deleteInvite(id); notify(t("Invito eliminato")); onClose(); }
      onChanged();
    } catch (err) { setError(fail(err)); }
    setBusy(null);
  };

  const spin = (label: string) => busy === label && <Loader2 className="spin" size={16} />;
  const btn = (primary: boolean, danger = false) => ({ ...(primary ? btnPrimary : btnGhost), padding: "10px 16px", display: "inline-flex", alignItems: "center", gap: 8, ...(danger ? { color: C.red, borderColor: "#f0c9c9" } : {}) }) as const;

  return (
    <div className="sheet-overlay" role="dialog" aria-modal="true" aria-label={t("Scheda fornitore")} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet" style={{ maxWidth: 820 }}>
        <div className="sheet-head">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ ...font, fontSize: 20, fontWeight: 700, color: C.text, overflowWrap: "anywhere" }}>{s?.data.company?.legalName || s?.name || "…"}</div>
            {s && <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6, flexWrap: "wrap" }}><StatusBadge status={s.status} update={s.isUpdate} /><VendorFlags lifecycle={s.lifecycle} qualification={s.qualification} duplicate={s.duplicates.some(d => !d.confirmed)} /><span style={{ ...sans, fontSize: 12.5, color: C.muted }}>{s.email}</span></div>}
          </div>
          <CloseButton onClick={onClose} />
        </div>

        {loadError && <Notice kind="error">{loadError}</Notice>}
        {!s && !loadError && <div style={{ display: "flex", justifyContent: "center", padding: 40 }}><Loader2 className="spin" size={24} color={C.subtle} /></div>}

        {s && (
          <div style={{ display: "grid", gap: 14 }}>
            {s.status === "invited" && (
              <Card style={{ background: C.bg, boxShadow: "none" }}>
                <div style={{ ...sans, fontSize: 13, color: C.muted, lineHeight: 1.55, marginBottom: 10 }}>{s.expiresAt ? t("Il fornitore non ha ancora attivato l'invito (scade il {date}).", { date: fmtDate(s.expiresAt) }) : t("Il fornitore non ha ancora attivato l'invito.")}</div>
                {s.inviteLink && <div style={{ ...sans, fontSize: 12, background: "#fff", border: `1px solid ${C.border}`, borderRadius: 8, padding: 8, overflowWrap: "anywhere", marginBottom: 10 }}>{s.inviteLink}</div>}
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {s.inviteLink && <button onClick={async () => setCopied(await copyText(s.inviteLink!))} style={btn(false)}><Copy size={15} />{copied ? t("Copiato") : t("Copia link")}</button>}
                  {isBuyerStep && <button onClick={() => invite("resend")} disabled={!!busy} style={btn(false)}>{spin("resend")}<Mail size={15} />{s.inviteLink ? t("Rinvia invito") : t("Crea un nuovo link")}</button>}
                  {isBuyerStep && <button onClick={() => invite("delete")} disabled={!!busy} style={btn(false, true)}>{spin("delete")}<Trash2 size={15} />{t("Elimina")}</button>}
                </div>
              </Card>
            )}

            {s.rejectionReason && (s.status === "pending_revision" || s.status === "rejected") && <Notice kind={s.status === "rejected" ? "error" : "warn"}><b>{s.status === "rejected" ? t("Motivo del rifiuto") : t("Modifiche richieste")}:</b> {s.rejectionReason}</Notice>}
            {s.anonymizedAt && <Notice kind="info"><b>{t("Dati personali anonimizzati il {date}.", { date: fmtDate(s.anonymizedAt) })}</b> {t("Restano solo ragione sociale, partita IVA e IBAN.")}</Notice>}
            {s.lifecycle !== "active" && <Notice kind="error"><b>{s.lifecycle === "blocked" ? t("Fornitore bloccato") : s.lifecycle === "inactive" ? t("Fornitore disattivato") : t("Fornitore escluso")}.</b> {s.lifecycleReason} {s.sapCode ? t("Ricorda di bloccarlo anche in SAP.") : ""}</Notice>}
            {s.qualification === "lapsed" && <Notice kind="error"><b>{t("Qualifica scaduta:")}</b> {t("almeno un documento obbligatorio è scaduto o mancante. Il fornitore riceve i reminder; puoi sollecitarlo dalla pagina Scadenze.")}</Notice>}
            {s.isUpdate && s.status === "pending" && <Notice kind="info">{s.sapCode ? t("Il fornitore, già registrato in SAP ({code}), ha modificato dati o documenti: serve una nuova verifica.", { code: s.sapCode }) : t("Il fornitore, già registrato in SAP, ha modificato dati o documenti: serve una nuova verifica.")}</Notice>}

            {s.status !== "invited" && (<>
              {/* Azioni del flusso */}
              {s.status === "pending" && isBuyerStep && (
                <Card style={{ borderColor: "#f1d9a6", background: "#fffdf6" }}>
                  <CardTitle icon={<Hourglass size={16} />}>{t("Verifica del Buyer")}</CardTitle>
                  <p style={{ ...sans, fontSize: 13, color: C.muted, margin: "0 0 12px", lineHeight: 1.55 }}>{t("Controlla dati e documenti, scegli le condizioni di pagamento e approva: la scheda passa al Finance. Per tornare dal fornitore usa “Chiedi modifiche”.")}</p>
                  <Field label={t("Condizioni di pagamento")} req htmlFor="v-terms">
                    <select id="v-terms" value={terms} onChange={e => setTerms(e.target.value)} style={iStyle}><option value="">{t("Seleziona…")}</option>{config.paymentTerms.map(p => <option key={p.code} value={p.code}>{p.code} · {p.label}</option>)}</select>
                  </Field>
                  {s.bankChanged && !s.bankLetterAfterChange && <Notice kind="error">{t("Le coordinate bancarie sono cambiate ma il fornitore non ha caricato la nuova lettera della banca: chiedi modifiche.")}</Notice>}
                  {s.duplicates.some(d => !d.confirmed) && (
                    <div style={{ marginBottom: 12 }}>
                      <DuplicateList dups={s.duplicates.filter(d => !d.confirmed)} />
                      <label style={{ ...sans, display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, margin: "4px 0 8px", cursor: "pointer" }}><input type="checkbox" checked={dupOk} onChange={e => setDupOk(e.target.checked)} style={{ accentColor: C.accent, width: 16, height: 16, marginTop: 2 }} />{t("Ho verificato: è un fornitore diverso (o una sede distinta) e va registrato comunque")}</label>
                      {dupOk && <textarea value={dupReason} onChange={e => setDupReason(e.target.value)} placeholder={t("Perché non è un doppione?")} aria-label={t("Motivo")} style={{ ...iStyle, height: 60, resize: "vertical" }} />}
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button onClick={() => run("approve", "approve", { paymentTerms: terms, confirmDuplicates: dupOk, duplicateReason: dupReason })} disabled={!!busy || !terms} style={{ ...btn(true), opacity: busy || !terms ? 0.6 : 1 }}>{spin("approve")}<CheckCircle2 size={16} />{t("Approva e passa al Finance")}</button>
                    <button onClick={() => setDialog("revision")} disabled={!!busy} style={btn(false)}><RotateCcw size={15} />{t("Chiedi modifiche")}</button>
                    <button onClick={() => setDialog("reject")} disabled={!!busy} style={btn(false, true)}><Ban size={15} />{t("Rifiuta")}</button>
                  </div>
                </Card>
              )}
              {s.status === "approved" && isFinanceStep && (
                <Card style={{ borderColor: "#d9d2f5", background: "#fbfaff" }}>
                  <CardTitle icon={<FileCheck2 size={16} />}>{t("Registrazione in SAP")}</CardTitle>
                  <p style={{ ...sans, fontSize: 13, color: C.muted, margin: "0 0 12px", lineHeight: 1.55 }}>{t("Il Buyer ha approvato (condizioni di pagamento {terms}). Il portale invia l'anagrafica a SAP e salva il codice fornitore, che viene comunicato a fornitore e Buyer.", { terms: s.paymentTerms ?? "—" })}</p>
                  {s.bankChanged && (
                    <div style={{ background: C.redBg, borderRadius: 12, padding: 12, marginBottom: 12 }}>
                      <div style={{ ...sans, fontSize: 13, color: C.red, fontWeight: 650, marginBottom: 6 }}>{t("Coordinate bancarie cambiate: verifica obbligatoria")}</div>
                      <div style={{ ...sans, fontSize: 12.5, color: C.text, lineHeight: 1.5, marginBottom: 8 }}>{t("Chiama il fornitore a un numero già noto (non quello indicato nella richiesta) e fatti confermare il nuovo conto. Nuova lettera della banca:")} <b>{s.bankLetterAfterChange ? t("caricata") : t("mancante")}</b>.</div>
                      <input value={bankContact} onChange={e => setBankContact(e.target.value)} placeholder={t("Chi hai chiamato e a quale numero")} aria-label={t("Contatto chiamato")} style={{ ...iStyle, marginBottom: 8 }} />
                      <input value={bankNote} onChange={e => setBankNote(e.target.value)} placeholder={t("Esito della verifica")} aria-label={t("Esito della verifica")} style={iStyle} />
                    </div>
                  )}
                  {s.compliance.some(c => c.status === "fail" || c.status === "warn" || c.status === "todo") && (
                    <div style={{ marginBottom: 12 }}>
                      <label style={{ ...sans, display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, marginBottom: 8, cursor: "pointer" }}><input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} style={{ accentColor: C.accent, width: 16, height: 16, marginTop: 2 }} />{t("Ho valutato i controlli di conformità non superati (vedi sotto) e confermo la registrazione")}</label>
                      {ack && <textarea value={ackNote} onChange={e => setAckNote(e.target.value)} placeholder={t("Nota sulla valutazione")} aria-label={t("Nota sui controlli")} style={{ ...iStyle, height: 60, resize: "vertical" }} />}
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button onClick={() => { if (window.confirm(t("Creare il fornitore in SAP?"))) run("sap", "approve", { bankVerification: { contact: bankContact, note: bankNote }, complianceAck: ack, complianceNote: ackNote }); }} disabled={!!busy} style={btn(true)}>{spin("sap")}<Send size={16} />{t("Registra in SAP")}</button>
                    <button onClick={() => setDialog("revision")} disabled={!!busy} style={btn(false)}><RotateCcw size={15} />{t("Chiedi modifiche")}</button>
                    <button onClick={() => setDialog("reject")} disabled={!!busy} style={btn(false, true)}><Ban size={15} />{t("Rifiuta")}</button>
                  </div>
                </Card>
              )}
              {s.status === "pending" && !isBuyerStep && <Notice kind="info">{s.referenceBuyerName ? t("In attesa della verifica del Buyer di riferimento ({name}).", { name: s.referenceBuyerName }) : t("In attesa della verifica del Buyer di riferimento.")}</Notice>}
              {s.status === "approved" && !isFinanceStep && <Notice kind="info">{t("Approvato dal Buyer: ora tocca al Finance registrarlo in SAP.")}</Notice>}
              {s.status === "registered" && <Notice kind="ok"><b>{t("Registrato in SAP")}</b>{s.sapCode ? <> · {t("codice fornitore")} <b>{s.sapCode}</b></> : null}{s.sapAccountGroup ? " · " + t("gruppo conti {group}", { group: s.sapAccountGroup }) : ""}</Notice>}
              {error && <Notice kind="error">{error}</Notice>}

              {s.changes.length > 0 && (
                <Card style={{ borderColor: s.bankChanged ? "#f0c9c9" : undefined }}>
                  <CardTitle icon={<RotateCcw size={16} />}>{s.approvedAt ? t("Modifiche rispetto ai dati approvati il {date}", { date: fmtDate(s.approvedAt) }) : t("Modifiche rispetto ai dati approvati")}</CardTitle>
                  <div style={{ overflowX: "auto" }}>
                    <table className="data-table" style={{ minWidth: 480 }}>
                      <thead><tr><th>{t("Campo")}</th><th>{t("Prima")}</th><th>{t("Ora")}</th></tr></thead>
                      <tbody>{s.changes.map(c => <tr key={c.field} style={{ cursor: "default", background: c.bank ? C.redBg : undefined }}><td style={{ fontWeight: 650, color: c.bank ? C.red : C.text }}>{t(c.label)}</td><td style={{ color: C.muted, overflowWrap: "anywhere" }}>{c.before || "—"}</td><td style={{ overflowWrap: "anywhere" }}>{c.after || "—"}</td></tr>)}</tbody>
                    </table>
                  </div>
                </Card>
              )}

              {s.risk && s.risk.level !== "na" && (
                <Card style={{ borderColor: s.risk.level === "high" ? "#f0c9c9" : undefined }}>
                  <CardTitle icon={<ShieldAlert size={16} />}>{t("Livello di rischio")}</CardTitle>
                  <RiskPanel risk={s.risk} history={s.riskHistory ?? []} />
                </Card>
              )}

              {s.status !== "draft" && (
                <Card>
                  <CardTitle icon={<FileCheck2 size={16} />} action={<button onClick={rerunChecks} disabled={!!busy} style={{ ...btnGhost, padding: "5px 11px", fontSize: 12, display: "inline-flex", alignItems: "center", gap: 6 }}>{spin("checks")}<RotateCcw size={13} />{t("Ripeti")}</button>}>{t("Controlli di conformità")}</CardTitle>
                  {s.compliance.map(c => (
                    <div key={c.key} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "8px 0", borderTop: `1px solid ${C.borderLight}`, flexWrap: "wrap" }}>
                      <span style={{ ...sans, flex: "0 0 auto", background: CHECK_STYLE[c.status].bg, color: CHECK_STYLE[c.status].color, borderRadius: 999, padding: "3px 10px", fontSize: 11.5, fontWeight: 650, minWidth: 96, textAlign: "center" }}>{t(CHECK_STYLE[c.status].label)}</span>
                      <div style={{ flex: "1 1 260px", minWidth: 0 }}><div style={{ ...sans, fontSize: 13, fontWeight: 650 }}>{t(c.label)}</div><div style={{ ...sans, fontSize: 12.5, color: C.muted, overflowWrap: "anywhere" }}>{c.detail}</div></div>
                      {c.key === "sanctions" && c.status === "todo" && <button onClick={() => setDialog("sanctions")} style={{ ...btnGhost, padding: "5px 11px", fontSize: 12 }}>{t("Registra verifica manuale")}</button>}
                    </div>
                  ))}
                  {s.complianceCheckedAt && <div style={{ ...sans, fontSize: 11.5, color: C.subtle, marginTop: 6 }}>{t("Controlli esterni eseguiti il {date}", { date: new Date(s.complianceCheckedAt).toLocaleString(locale(), { dateStyle: "medium", timeStyle: "short" }) })}</div>}
                </Card>
              )}

              {s.duplicates.length > 0 && <Card><CardTitle>{t("Possibili doppioni")}</CardTitle><DuplicateList dups={s.duplicates} /></Card>}

              <Card>
                <CardTitle>{t("Anagrafica")}</CardTitle>
                <Summary s={s} data={s.data} />
              </Card>
            </>)}

            {currentUser.role === "manager" && (/^Fornitore di Prova/i.test(s.name) || /^(PROVA|SIMV)/.test(s.sapCode ?? "")) && (
              <Card>
                <CardTitle>{t("Accesso di prova")}</CardTitle>
                <div style={{ ...sans, fontSize: 13, color: C.muted, marginBottom: 10, lineHeight: 1.5 }}>{t("Fornitore di prova: genera una password per entrare come lui e vedere l'area fornitore (richieste di offerta, documenti). Apri l'accesso in una finestra anonima per non uscire dal tuo.")}</div>
                {access && <Notice kind="ok">{t("Email")} <b style={{ userSelect: "all" }}>{access.email}</b> · {t("password")} <b style={{ userSelect: "all" }}>{access.password}</b> {t("(mostrata solo ora).")}</Notice>}
                <button onClick={async () => { setError(null); try { setAccess(await portalApi.testAccess(s.id)); } catch (err) { setError(fail(err)); } }} style={{ ...btnGhost, padding: "8px 14px", fontSize: 13 }}>{access ? t("Genera una nuova password") : t("Genera accesso di prova")}</button>
              </Card>
            )}

            {s.status === "registered" && (currentUser.role === "manager" || currentUser.role === "buyer") && <RatingCard supplierId={s.id} fail={fail} notify={notify} />}

            <Card>
              <CardTitle>{t("Dati interni")}</CardTitle>
              <KV rows={[
                [t("Società"), s.companyCodes.map(c => config.companies.find(x => x.code === c)?.name ?? c).join(", ")],
                [t("Codice merceologico"), `${s.industryCode} · ${config.industryCodes.find(i => i.code === s.industryCode)?.name ?? ""}`],
                [t("Codice cliente"), s.customerCode], [t("Buyer di riferimento"), s.referenceBuyerName],
                [t("Condizioni di pagamento"), s.paymentTerms ? `${s.paymentTerms} · ${config.paymentTerms.find(p => p.code === s.paymentTerms)?.label ?? ""}` : ""],
                [t("Codice SAP"), s.sapCode], [t("Invitato il"), fmtDate(s.invitedAt)], [t("Inviata il"), s.submittedAt ? fmtDate(s.submittedAt) : ""],
              ]} />
            </Card>

            {s.status !== "invited" && (
              <Card>
                <CardTitle icon={<Paperclip size={16} />}>{t("Documenti ({n})", { n: s.documents.length })}</CardTitle>
                {s.documents.length === 0 ? <div style={{ ...sans, fontSize: 13, color: C.muted }}>{t("Nessun documento caricato.")}</div> : s.documents.map((d, i) => (
                  <div key={d.id} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "9px 0", borderTop: i ? `1px solid ${C.borderLight}` : "none" }}>
                    <div style={{ minWidth: 0, flex: "1 1 220px" }}>
                      <div style={{ ...sans, fontSize: 13, fontWeight: 650, color: C.text }}>{d.typeLabel}</div>
                      <div style={{ ...sans, fontSize: 12, color: C.muted, overflowWrap: "anywhere" }}>{d.fileName} · {fmtSize(d.size)}</div>
                    </div>
                    <ValidityChip validUntil={d.validUntil} /><DocLink id={d.id} name={d.fileName} />
                    {isBuyerStep && config.ai.configured && <button onClick={() => recheck(d.id)} disabled={!!busy} style={{ ...btnGhost, padding: "4px 10px", fontSize: 12, display: "inline-flex", alignItems: "center", gap: 5 }}>{busy === `ai${d.id}` ? <Loader2 className="spin" size={13} /> : <RotateCcw size={13} />}{d.ai ? t("Ripeti controllo") : t("Controlla")}</button>}
                    <AiResult check={d.ai} audience="staff" />
                  </div>
                ))}
              </Card>
            )}

            {(isBuyerStep && s.status !== "invited") && (
              <Card>
                <CardTitle icon={<Ban size={16} />}>{t("Stato del fornitore")}</CardTitle>
                <p style={{ ...sans, fontSize: 12.5, color: C.muted, margin: "-6px 0 10px", lineHeight: 1.5 }}>{t("Bloccato: resta nel portale ma non può essere approvato. Disattivato: non accede più. Escluso: non accede e non può essere reinvitato senza un Manager. Il blocco in SAP, per ora, va fatto a mano.")}</p>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {s.lifecycle === "active" && <button onClick={() => setDialog("block")} style={btn(false)}>{t("Blocca")}</button>}
                  {currentUser.role === "manager" && s.lifecycle !== "inactive" && <button onClick={() => setDialog("deactivate")} style={btn(false)}>{t("Disattiva")}</button>}
                  {currentUser.role === "manager" && s.lifecycle !== "excluded" && <button onClick={() => setDialog("exclude")} style={btn(false, true)}>{t("Escludi")}</button>}
                  {currentUser.role === "manager" && s.lifecycle !== "active" && !s.anonymizedAt && <button onClick={() => setDialog("reactivate")} style={btn(true)}>{t("Riattiva")}</button>}
                </div>
                {currentUser.role === "manager" && (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.borderLight}`, alignItems: "center" }}>
                    <span style={{ ...sans, fontSize: 12, color: C.muted, flex: "1 1 200px" }}>{t("Privacy: esporta tutti i dati del fornitore o, se non è più attivo, cancellane i dati personali.")}</span>
                    <a href={vendorExportUrl(s.id)} style={{ ...btn(false), textDecoration: "none", display: "inline-flex", alignItems: "center" }}>{t("Esporta dati")}</a>
                    {!s.anonymizedAt && (s.lifecycle !== "active" || s.status !== "registered") && <button onClick={() => setDialog("anonymize")} style={btn(false, true)}>{t("Anonimizza")}</button>}
                  </div>
                )}
              </Card>
            )}
            {s.contracts && (
              <Card>
                <CardTitle icon={<FileText size={16} />}>{t("Contratti")}</CardTitle>
                {s.contracts.length === 0 ? <div style={{ ...sans, fontSize: 13, color: C.subtle }}>{t("Nessun contratto collegato a questo fornitore.")}</div> : s.contracts.map((c, i) => (
                  <div key={c.id} style={{ ...sans, display: "flex", gap: 10, padding: "8px 0", borderTop: i ? `1px solid ${C.borderLight}` : "none", fontSize: 13, flexWrap: "wrap", alignItems: "baseline" }}>
                    <span style={{ flex: "1 1 200px", fontWeight: 600, color: c.status === "active" ? C.text : C.muted }}>{c.object}</span>
                    <span className="tabular" style={{ color: C.muted }}>{fmt(c.value, c.currency)}</span>
                    <span className="tabular" style={{ color: C.muted }}>{t("scad. {date}", { date: fmtDate(c.end) })}</span>
                    <span style={{ fontSize: 11.5, fontWeight: 650, borderRadius: 999, padding: "2px 9px", background: c.status === "active" ? C.greenBg : C.grayBg, color: c.status === "active" ? C.green : C.gray }}>{c.status === "active" ? t("Attivo") : ({ renewed: t("Rinnovato"), replaced: t("Sostituito"), ceased: t("Cessato"), extended: t("Prorogato") } as Record<string, string>)[c.outcome] ?? t("Chiuso")}</span>
                  </div>
                ))}
              </Card>
            )}
            <AuditTrail entries={supplierTimeline(s)} />
            <div style={{ ...sans, fontSize: 11.5, color: C.subtle, display: "flex", alignItems: "center", gap: 6 }}><Clock size={13} />{t("Aggiornato il {date}", { date: fmtDate(s.updatedAt) })}</div>
          </div>
        )}
      </div>

      {dialog && s && (() => {
        const cfg = {
          reject: [t("Rifiuta la registrazione"), t("Il fornitore riceverà questo motivo via email e potrà correggere e reinviare."), t("Rifiuta"), true, "reject"],
          revision: [t("Chiedi modifiche al fornitore"), t("Spiega cosa deve correggere: il fornitore riceverà il testo via email e potrà modificare dati e documenti."), t("Invia richiesta"), false, "request_revision"],
          block: [t("Blocca il fornitore"), t("Il fornitore non potrà essere approvato finché non viene riattivato. Il motivo resta nello storico."), t("Blocca"), true, "block"],
          deactivate: [t("Disattiva il fornitore"), t("Il fornitore non potrà più accedere all'area personale né ricevere reminder."), t("Disattiva"), true, "deactivate"],
          exclude: [t("Escludi il fornitore"), t("Esclusione definitiva: non accede, non riceve reminder e non può essere reinvitato senza un Manager."), t("Escludi"), true, "exclude"],
          reactivate: [t("Riattiva il fornitore"), t("Il fornitore torna operativo."), t("Riattiva"), false, "reactivate"],
          sanctions: [t("Verifica manuale delle sanzioni"), t("Indica la fonte consultata (es. lista consolidata UE, OFAC) e l'esito."), t("Registra verifica"), false, "sanctions_manual"],
          anonymize: [t("Anonimizza i dati personali"), t("Vengono cancellati contatti, indirizzo, documenti e account del fornitore. Restano ragione sociale, partita IVA e IBAN per il controllo dei doppioni. L'operazione non si può annullare."), t("Anonimizza"), true, "reject"],
        }[dialog] as [string, string, string, boolean, VendorAction];
        const confirm = dialog === "anonymize"
          ? async (reason: string) => { try { setS(await portalApi.anonymize(s.id, reason)); onChanged(); notify(t("Dati personali anonimizzati")); setDialog(null); return null; } catch (err) { return fail(err); } }
          : async (reason: string) => { const e = await run(dialog, cfg[4], { reason }); if (!e) setDialog(null); return e; };
        return <ReasonDialog title={cfg[0]} text={cfg[1]} confirmLabel={cfg[2]} danger={cfg[3]} onConfirm={confirm} onClose={() => setDialog(null)} />;
      })()}
    </div>
  );
}

/** Elenco dei possibili doppioni con i dati in comune. */
function DuplicateList({ dups }: { dups: DuplicateMatch[] }) {
  return (
    <div style={{ display: "grid", gap: 8, marginBottom: 10 }}>
      {dups.map(d => (
        <div key={d.supplierId} style={{ ...sans, background: d.severe ? C.redBg : C.purpleBg, color: d.severe ? C.red : C.purple, borderRadius: 10, padding: "9px 12px", fontSize: 12.5, lineHeight: 1.5 }}>
          <b>{d.name}</b>{d.sapCode ? ` · SAP ${d.sapCode}` : ""} · {t(STATUS_STYLE[d.status].label)}{d.lifecycle !== "active" ? " · " + t(LIFECYCLE_LABEL[d.lifecycle]) : ""}
          <div>{t("Stessi dati:")} {d.fields.map(f => t(f)).join(", ")}{d.severe ? " — " + t("attenzione: possibile frode o fornitore escluso") : ""}{d.confirmed ? " — " + t("già verificato come fornitore distinto") : ""}</div>
        </div>
      ))}
    </div>
  );
}
const LIFECYCLE_LABEL: Record<Lifecycle, string> = { active: "Attivo", blocked: "Bloccato", inactive: "Disattivato", excluded: "Escluso" };
