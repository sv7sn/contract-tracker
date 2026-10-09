import { useCallback, useEffect, useMemo, useState } from "react";
import type { DuplicateMatch, Lifecycle, InviteInput, PortalConfig, Supplier, SupplierStatus, SupplierSummary, User, VendorAction } from "../types.ts";
import { ApiError, portalApi, vendorExportUrl } from "../api.ts";
import { btnGhost, btnPrimary, C, font, iStyle, radius, sans } from "../theme.ts";
import { fmt, fmtDate } from "../lib/format.ts";
import { countryName } from "../supplierRules.ts";
import { Avatar, AuditTrail, Card, CardTitle, EmptyState, Field, Grid, StatCard } from "../components/ui.tsx";
import { CheckCircle2, Clock, Copy, FileCheck2, Hourglass, Loader2, Mail, Paperclip, Plus, RotateCcw, Search, Send, Trash2, Users, Ban, AlertTriangle, FileText } from "../components/icons.tsx";
import { AiResult, VendorFlags, CloseButton, DocLink, KV, Notice, ReasonDialog, StatusBadge, ValidityChip , Portal } from "../components/vendorUi.tsx";
import { CHECK_STYLE, fmtSize, STATUS_STYLE, supplierTimeline } from "../lib/vendors.ts";
import { Summary } from "./SupplierPortal.tsx";

interface Props { currentUser: User; notify: (m: string) => void; onSessionExpired: () => void }

const copyText = async (t: string) => { try { await navigator.clipboard.writeText(t); return true; } catch { return false; } };

export function VendorsView({ currentUser, notify, onSessionExpired }: Props) {
  const [vendors, setVendors] = useState<SupplierSummary[] | null>(null);
  const [config, setConfig] = useState<PortalConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<SupplierStatus | "all" | "lapsed" | "flags" | "dups">("all");
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<number | null>(null);
  const [inviting, setInviting] = useState(false);

  const fail = useCallback((err: unknown) => {
    if (err instanceof ApiError && err.status === 401) { onSessionExpired(); return "Sessione scaduta"; }
    return err instanceof Error ? err.message : "Operazione non riuscita";
  }, [onSessionExpired]);
  const reload = useCallback(async () => {
    try { const [v, c] = await Promise.all([portalApi.vendors(), portalApi.config()]); setVendors(v); setConfig(c); setError(null); }
    catch (err) { setError(fail(err)); }
  }, [fail]);
  useEffect(() => {
    let off = false;
    Promise.all([portalApi.vendors(), portalApi.config()]).then(([v, c]) => { if (!off) { setVendors(v); setConfig(c); } }).catch(err => { if (!off) setError(fail(err)); });
    return () => { off = true; };
  }, [fail]);

  const canInvite = currentUser.role === "manager" || currentUser.role === "buyer";
  const mine: SupplierStatus = currentUser.role === "finance" ? "approved" : "pending";

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const v of vendors ?? []) { c[v.status] = (c[v.status] ?? 0) + 1; if (v.qualification === "lapsed") c.lapsed = (c.lapsed ?? 0) + 1; }
    return c;
  }, [vendors]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const match = (v: SupplierSummary) => filter === "all" || (filter === "lapsed" ? v.qualification === "lapsed" : filter === "flags" ? v.lifecycle !== "active" : filter === "dups" ? v.duplicate : v.status === filter);
    return (vendors ?? []).filter(v => match(v) && (!q || [v.name, v.legalName, v.email, v.sapCode ?? "", v.referenceBuyerName].some(x => x.toLowerCase().includes(q))))
      .sort((a, b) => (a.status === mine ? -1 : 0) - (b.status === mine ? -1 : 0) || b.updatedAt.localeCompare(a.updatedAt));
  }, [vendors, filter, search, mine]);

  if (error) return <EmptyState icon={<AlertTriangle size={26} />} title="Impossibile caricare i fornitori" text={error} action={<button onClick={reload} style={{ ...btnGhost, padding: "9px 16px" }}>Riprova</button>} />;
  if (!vendors || !config) return <div style={{ display: "flex", justifyContent: "center", padding: 60 }}><Loader2 className="spin" size={26} color={C.subtle} /></div>;

  const tiles: { key: SupplierStatus | "lapsed"; label: string; icon: React.ReactNode; color: string; sub: string }[] = [
    { key: "pending", label: "Da verificare", icon: <Hourglass size={18} />, color: C.yellow, sub: "Passaggio del Buyer" },
    { key: "approved", label: "In attesa del Finance", icon: <FileCheck2 size={18} />, color: C.purple, sub: "Da registrare in SAP" },
    { key: "pending_revision", label: "Modifiche richieste", icon: <RotateCcw size={18} />, color: C.red, sub: "Attesa del fornitore" },
    { key: "registered", label: "Registrati in SAP", icon: <CheckCircle2 size={18} />, color: C.green, sub: "Codice assegnato" },
    { key: "invited", label: "Inviti aperti", icon: <Mail size={18} />, color: C.gray, sub: "Non ancora attivati" },
    { key: "lapsed", label: "Qualifica scaduta", icon: <AlertTriangle size={18} />, color: C.red, sub: "Documenti obbligatori scaduti" },
  ];

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
        <div>
          <div style={{ ...font, fontSize: 18, fontWeight: 700, color: C.text }}>Fornitori</div>
          <div style={{ ...sans, fontSize: 12, color: C.muted }}>{vendors.length} schede · {counts[mine] ?? 0} {currentUser.role === "finance" ? "da registrare" : "da verificare"}</div>
        </div>
        {canInvite && <button onClick={() => setInviting(true)} style={{ ...sans, display: "flex", alignItems: "center", gap: 7, padding: "9px 16px", background: C.accent, border: "none", borderRadius: 10, color: "#fff", fontWeight: 650, cursor: "pointer", fontSize: 13, boxShadow: "0 1px 2px rgba(200,82,42,.35)" }}><Plus size={16} />Invita fornitore</button>}
      </div>

      <Grid min={190} gap={12} fill style={{ marginBottom: 16 }}>
        {tiles.filter(t => currentUser.role !== "finance" || t.key !== "invited").map(t => (
          <button key={t.key} onClick={() => setFilter(f => f === t.key ? "all" : t.key)} aria-pressed={filter === t.key} style={{ all: "unset", cursor: "pointer", display: "block", borderRadius: radius.lg, outline: filter === t.key ? `2px solid ${C.accent}` : undefined, outlineOffset: 1 }}>
            <StatCard label={t.label} value={counts[t.key] ?? 0} sub={t.sub} color={t.color} icon={t.icon} />
          </button>
        ))}
      </Grid>

      <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: "1 1 240px", maxWidth: 420 }}>
          <Search size={16} color={C.subtle} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Cerca per nome, email, codice SAP…" aria-label="Cerca fornitori" style={{ ...iStyle, paddingLeft: 36 }} />
        </div>
        <select value={filter} onChange={e => setFilter(e.target.value as typeof filter)} aria-label="Filtra per stato" style={{ ...iStyle, width: "auto", minWidth: 190 }}>
          <option value="all">Tutti gli stati</option>
          {(Object.keys(STATUS_STYLE) as SupplierStatus[]).map(k => <option key={k} value={k}>{STATUS_STYLE[k].label}</option>)}
          <option value="lapsed">Qualifica scaduta</option><option value="flags">Bloccati, disattivati o esclusi</option><option value="dups">Possibili doppioni</option>
        </select>
      </div>

      {shown.length === 0 ? (
        vendors.length === 0
          ? <EmptyState icon={<Users size={26} />} title="Nessun fornitore ancora" text="Invita il primo fornitore: riceverà un link personale per registrarsi e caricare i documenti di qualifica." action={canInvite && <button onClick={() => setInviting(true)} style={{ ...btnPrimary, padding: "10px 18px", display: "inline-flex", alignItems: "center", gap: 8 }}><Plus size={17} />Invita fornitore</button>} />
          : <EmptyState icon={<Search size={26} />} title="Nessun risultato" text="Nessun fornitore corrisponde a ricerca e filtri." action={<button onClick={() => { setSearch(""); setFilter("all"); }} style={{ ...btnGhost, padding: "9px 16px" }}>Azzera filtri</button>} />
      ) : (<>
        <div className="table-wrap desktop-only">
          <table className="data-table">
            <thead><tr><th>Fornitore</th><th>Paese</th><th>Società</th><th>Stato</th><th>Buyer</th><th>Aggiornato</th><th aria-label="Documenti" /></tr></thead>
            <tbody>
              {shown.map(v => (
                <tr key={v.id} onClick={() => setOpenId(v.id)} tabIndex={0} onKeyDown={e => { if (e.key === "Enter") setOpenId(v.id); }}>
                  <td style={{ minWidth: 220, boxShadow: v.status === mine ? `inset 3px 0 0 ${C.accent}` : undefined }}><div style={{ fontWeight: 650, color: C.text }}>{v.legalName || v.name}</div><div style={{ fontSize: 12, color: C.muted }}>{v.email}</div></td>
                  <td>{v.country ? countryName(v.country) : "—"}</td>
                  <td style={{ color: C.muted }}>{v.companyCodes.join(", ")}</td>
                  <td><div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}><StatusBadge status={v.status} update={v.isUpdate} /><VendorFlags lifecycle={v.lifecycle} qualification={v.qualification} duplicate={v.duplicate} /></div></td>
                  <td><div style={{ display: "flex", alignItems: "center", gap: 8, whiteSpace: "nowrap" }}><Avatar name={v.referenceBuyerName || "?"} size={24} /><span style={{ color: C.muted }}>{v.referenceBuyerName || "—"}</span></div></td>
                  <td className="tabular" style={{ whiteSpace: "nowrap", color: C.muted }}>{fmtDate(v.updatedAt)}</td>
                  <td style={{ color: C.subtle, whiteSpace: "nowrap" }}>{v.documentCount > 0 && <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}><Paperclip size={14} />{v.documentCount}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mobile-only">
          <Grid min={320} gap={12}>
            {shown.map(v => (
              <Card key={v.id} className="lift" onClick={() => setOpenId(v.id)} role="button" tabIndex={0} onKeyDown={e => { if (e.key === "Enter") setOpenId(v.id); }} style={{ padding: 16, cursor: "pointer", borderRadius: radius.md }}>
                <div style={{ ...sans, fontSize: 14, fontWeight: 650, color: C.text }}>{v.legalName || v.name}</div>
                <div style={{ ...sans, fontSize: 12.5, color: C.muted, marginBottom: 10, overflowWrap: "anywhere" }}>{v.email}</div>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}><StatusBadge status={v.status} update={v.isUpdate} /><VendorFlags lifecycle={v.lifecycle} qualification={v.qualification} duplicate={v.duplicate} /><span style={{ ...sans, fontSize: 12, color: C.subtle, marginLeft: "auto" }}>{fmtDate(v.updatedAt)}</span></div>
              </Card>
            ))}
          </Grid>
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
            <h3 style={{ ...font, margin: "0 0 6px", fontSize: 18 }}>Invito creato</h3>
            <p style={{ ...sans, fontSize: 13, color: C.muted, lineHeight: 1.55, margin: "0 0 12px" }}>Il fornitore riceve il link per email. Se l'invio email non è ancora configurato, copia il link qui sotto e mandaglielo tu: vale una sola volta e scade tra pochi giorni.</p>
            <div style={{ ...sans, fontSize: 12.5, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: 10, overflowWrap: "anywhere", marginBottom: 12 }}>{link}</div>
            <div style={{ display: "flex", gap: 10 }}>
              <button type="button" onClick={async () => setCopied(await copyText(link))} style={{ ...btnGhost, flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 7 }}><Copy size={15} />{copied ? "Copiato" : "Copia link"}</button>
              <button type="button" onClick={onClose} style={{ ...btnPrimary, flex: 1 }}>Chiudi</button>
            </div>
          </>
        ) : (
          <>
            <h3 style={{ ...font, margin: "0 0 14px", fontSize: 18 }}>Invita un fornitore</h3>
            <Field label="Ragione sociale" req htmlFor="i-name"><input id="i-name" required value={f.name} onChange={e => setF({ ...f, name: e.target.value })} style={iStyle} /></Field>
            <Field label="Email del referente" req htmlFor="i-mail"><input id="i-mail" type="email" required value={f.email} onChange={e => setF({ ...f, email: e.target.value })} style={iStyle} /></Field>
            <Field label="Società che lo ingaggiano" req>
              <div style={{ display: "grid", gap: 6 }}>
                {config.companies.map(c => <label key={c.code} style={{ ...sans, display: "flex", gap: 8, alignItems: "center", fontSize: 13.5, cursor: "pointer" }}><input type="checkbox" checked={f.companyCodes.includes(c.code)} onChange={() => toggle(c.code)} style={{ accentColor: C.accent, width: 16, height: 16 }} />{c.name} <span style={{ color: C.subtle }}>({c.code})</span></label>)}
                {config.companies.length === 0 && <div style={{ ...sans, fontSize: 12.5, color: C.red }}>Nessuna società configurata: chiedi a un Manager di aggiungerla in Configurazione.</div>}
              </div>
            </Field>
            <Field label="Codice merceologico" req htmlFor="i-ind">
              <select id="i-ind" required value={f.industryCode} onChange={e => setF({ ...f, industryCode: e.target.value })} style={iStyle}><option value="">Seleziona…</option>{config.industryCodes.map(i => <option key={i.code} value={i.code}>{i.code} · {i.name}</option>)}</select>
            </Field>
            {f.industryCode === "CT00" && <Field label="Codice cliente" req htmlFor="i-cust"><input id="i-cust" required value={f.customerCode ?? ""} onChange={e => setF({ ...f, customerCode: e.target.value })} style={iStyle} /></Field>}
            <Field label="Buyer di riferimento" req htmlFor="i-buy">
              <select id="i-buy" required value={f.referenceBuyerId || ""} onChange={e => setF({ ...f, referenceBuyerId: Number(e.target.value) })} style={iStyle}><option value="">Seleziona…</option>{config.buyers.filter(b => b.active).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
            </Field>
            {error && <Notice kind="error">{error}</Notice>}
            {dups && <DuplicateList dups={dups} />}
            <div style={{ display: "flex", gap: 10 }}>
              <button type="button" onClick={onClose} style={{ ...btnGhost, flex: 1 }}>Annulla</button>
              <button type="submit" disabled={busy || f.companyCodes.length === 0} style={{ ...btnPrimary, flex: 2, opacity: busy || f.companyCodes.length === 0 ? 0.6 : 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>{busy ? <Loader2 className="spin" size={16} /> : <Send size={16} />}{dups ? "Non è un doppione: invita" : "Invia invito"}</button>
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
    try { setS(await portalApi.vendorChecks(id)); notify("Controlli eseguiti"); } catch (err) { setError(fail(err)); }
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
      if (what === "resend") { const r = await portalApi.reinvite(id); setS(r.supplier); notify("Invito rinviato"); }
      else { if (!window.confirm("Eliminare questo invito?")) { setBusy(null); return; } await portalApi.deleteInvite(id); notify("Invito eliminato"); onClose(); }
      onChanged();
    } catch (err) { setError(fail(err)); }
    setBusy(null);
  };

  const spin = (label: string) => busy === label && <Loader2 className="spin" size={16} />;
  const btn = (primary: boolean, danger = false) => ({ ...(primary ? btnPrimary : btnGhost), padding: "10px 16px", display: "inline-flex", alignItems: "center", gap: 8, ...(danger ? { color: C.red, borderColor: "#f0c9c9" } : {}) }) as const;

  return (
    <div className="sheet-overlay" role="dialog" aria-modal="true" aria-label="Scheda fornitore" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet" style={{ maxWidth: 820 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 16 }}>
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
                <div style={{ ...sans, fontSize: 13, color: C.muted, lineHeight: 1.55, marginBottom: 10 }}>Il fornitore non ha ancora attivato l'invito{s.expiresAt ? ` (scade il ${fmtDate(s.expiresAt)})` : ""}.</div>
                {s.inviteLink && <div style={{ ...sans, fontSize: 12, background: "#fff", border: `1px solid ${C.border}`, borderRadius: 8, padding: 8, overflowWrap: "anywhere", marginBottom: 10 }}>{s.inviteLink}</div>}
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {s.inviteLink && <button onClick={async () => setCopied(await copyText(s.inviteLink!))} style={btn(false)}><Copy size={15} />{copied ? "Copiato" : "Copia link"}</button>}
                  {isBuyerStep && <button onClick={() => invite("resend")} disabled={!!busy} style={btn(false)}>{spin("resend")}<Mail size={15} />Rinvia invito</button>}
                  {isBuyerStep && <button onClick={() => invite("delete")} disabled={!!busy} style={btn(false, true)}>{spin("delete")}<Trash2 size={15} />Elimina</button>}
                </div>
              </Card>
            )}

            {s.rejectionReason && (s.status === "pending_revision" || s.status === "rejected") && <Notice kind={s.status === "rejected" ? "error" : "warn"}><b>{s.status === "rejected" ? "Motivo del rifiuto" : "Modifiche richieste"}:</b> {s.rejectionReason}</Notice>}
            {s.anonymizedAt && <Notice kind="info"><b>Dati personali anonimizzati il {fmtDate(s.anonymizedAt)}.</b> Restano solo ragione sociale, partita IVA e IBAN.</Notice>}
            {s.lifecycle !== "active" && <Notice kind="error"><b>{s.lifecycle === "blocked" ? "Fornitore bloccato" : s.lifecycle === "inactive" ? "Fornitore disattivato" : "Fornitore escluso"}.</b> {s.lifecycleReason} {s.sapCode ? "Ricorda di bloccarlo anche in SAP." : ""}</Notice>}
            {s.qualification === "lapsed" && <Notice kind="error"><b>Qualifica scaduta:</b> almeno un documento obbligatorio è scaduto o mancante. Il fornitore riceve i reminder; puoi sollecitarlo dalla pagina Scadenze.</Notice>}
            {s.isUpdate && s.status === "pending" && <Notice kind="info">Il fornitore, già registrato in SAP{s.sapCode ? ` (${s.sapCode})` : ""}, ha modificato dati o documenti: serve una nuova verifica.</Notice>}

            {s.status !== "invited" && (<>
              {/* Azioni del flusso */}
              {s.status === "pending" && isBuyerStep && (
                <Card style={{ borderColor: "#f1d9a6", background: "#fffdf6" }}>
                  <CardTitle icon={<Hourglass size={16} />}>Verifica del Buyer</CardTitle>
                  <p style={{ ...sans, fontSize: 13, color: C.muted, margin: "0 0 12px", lineHeight: 1.55 }}>Controlla dati e documenti, scegli le condizioni di pagamento e approva: la scheda passa al Finance. Per tornare dal fornitore usa “Chiedi modifiche”.</p>
                  <Field label="Condizioni di pagamento" req htmlFor="v-terms">
                    <select id="v-terms" value={terms} onChange={e => setTerms(e.target.value)} style={iStyle}><option value="">Seleziona…</option>{config.paymentTerms.map(p => <option key={p.code} value={p.code}>{p.code} · {p.label}</option>)}</select>
                  </Field>
                  {s.bankChanged && !s.bankLetterAfterChange && <Notice kind="error">Le coordinate bancarie sono cambiate ma il fornitore non ha caricato la nuova lettera della banca: chiedi modifiche.</Notice>}
                  {s.duplicates.some(d => !d.confirmed) && (
                    <div style={{ marginBottom: 12 }}>
                      <DuplicateList dups={s.duplicates.filter(d => !d.confirmed)} />
                      <label style={{ ...sans, display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, margin: "4px 0 8px", cursor: "pointer" }}><input type="checkbox" checked={dupOk} onChange={e => setDupOk(e.target.checked)} style={{ accentColor: C.accent, width: 16, height: 16, marginTop: 2 }} />Ho verificato: è un fornitore diverso (o una sede distinta) e va registrato comunque</label>
                      {dupOk && <textarea value={dupReason} onChange={e => setDupReason(e.target.value)} placeholder="Perché non è un doppione?" aria-label="Motivo" style={{ ...iStyle, height: 60, resize: "vertical" }} />}
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button onClick={() => run("approve", "approve", { paymentTerms: terms, confirmDuplicates: dupOk, duplicateReason: dupReason })} disabled={!!busy || !terms} style={{ ...btn(true), opacity: busy || !terms ? 0.6 : 1 }}>{spin("approve")}<CheckCircle2 size={16} />Approva e passa al Finance</button>
                    <button onClick={() => setDialog("revision")} disabled={!!busy} style={btn(false)}><RotateCcw size={15} />Chiedi modifiche</button>
                    <button onClick={() => setDialog("reject")} disabled={!!busy} style={btn(false, true)}><Ban size={15} />Rifiuta</button>
                  </div>
                </Card>
              )}
              {s.status === "approved" && isFinanceStep && (
                <Card style={{ borderColor: "#d9d2f5", background: "#fbfaff" }}>
                  <CardTitle icon={<FileCheck2 size={16} />}>Registrazione in SAP</CardTitle>
                  <p style={{ ...sans, fontSize: 13, color: C.muted, margin: "0 0 12px", lineHeight: 1.55 }}>Il Buyer ha approvato (condizioni di pagamento {s.paymentTerms ?? "—"}). Il portale invia l'anagrafica a SAP e salva il codice fornitore, che viene comunicato a fornitore e Buyer.</p>
                  {s.bankChanged && (
                    <div style={{ background: C.redBg, borderRadius: 12, padding: 12, marginBottom: 12 }}>
                      <div style={{ ...sans, fontSize: 13, color: C.red, fontWeight: 650, marginBottom: 6 }}>Coordinate bancarie cambiate: verifica obbligatoria</div>
                      <div style={{ ...sans, fontSize: 12.5, color: C.text, lineHeight: 1.5, marginBottom: 8 }}>Chiama il fornitore a un numero già noto (non quello indicato nella richiesta) e fatti confermare il nuovo conto. Nuova lettera della banca: <b>{s.bankLetterAfterChange ? "caricata" : "mancante"}</b>.</div>
                      <input value={bankContact} onChange={e => setBankContact(e.target.value)} placeholder="Chi hai chiamato e a quale numero" aria-label="Contatto chiamato" style={{ ...iStyle, marginBottom: 8 }} />
                      <input value={bankNote} onChange={e => setBankNote(e.target.value)} placeholder="Esito della verifica" aria-label="Esito della verifica" style={iStyle} />
                    </div>
                  )}
                  {s.compliance.some(c => c.status === "fail" || c.status === "warn" || c.status === "todo") && (
                    <div style={{ marginBottom: 12 }}>
                      <label style={{ ...sans, display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, marginBottom: 8, cursor: "pointer" }}><input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} style={{ accentColor: C.accent, width: 16, height: 16, marginTop: 2 }} />Ho valutato i controlli di conformità non superati (vedi sotto) e confermo la registrazione</label>
                      {ack && <textarea value={ackNote} onChange={e => setAckNote(e.target.value)} placeholder="Nota sulla valutazione" aria-label="Nota sui controlli" style={{ ...iStyle, height: 60, resize: "vertical" }} />}
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button onClick={() => { if (window.confirm("Creare il fornitore in SAP?")) run("sap", "approve", { bankVerification: { contact: bankContact, note: bankNote }, complianceAck: ack, complianceNote: ackNote }); }} disabled={!!busy} style={btn(true)}>{spin("sap")}<Send size={16} />Registra in SAP</button>
                    <button onClick={() => setDialog("revision")} disabled={!!busy} style={btn(false)}><RotateCcw size={15} />Chiedi modifiche</button>
                    <button onClick={() => setDialog("reject")} disabled={!!busy} style={btn(false, true)}><Ban size={15} />Rifiuta</button>
                  </div>
                </Card>
              )}
              {s.status === "pending" && !isBuyerStep && <Notice kind="info">In attesa della verifica del Buyer di riferimento{s.referenceBuyerName ? ` (${s.referenceBuyerName})` : ""}.</Notice>}
              {s.status === "approved" && !isFinanceStep && <Notice kind="info">Approvato dal Buyer: ora tocca al Finance registrarlo in SAP.</Notice>}
              {s.status === "registered" && <Notice kind="ok"><b>Registrato in SAP</b>{s.sapCode ? <> · codice fornitore <b>{s.sapCode}</b></> : null}{s.sapAccountGroup ? ` · gruppo conti ${s.sapAccountGroup}` : ""}</Notice>}
              {error && <Notice kind="error">{error}</Notice>}

              {s.changes.length > 0 && (
                <Card style={{ borderColor: s.bankChanged ? "#f0c9c9" : undefined }}>
                  <CardTitle icon={<RotateCcw size={16} />}>Modifiche rispetto ai dati approvati{s.approvedAt ? ` il ${fmtDate(s.approvedAt)}` : ""}</CardTitle>
                  <div style={{ overflowX: "auto" }}>
                    <table className="data-table" style={{ minWidth: 480 }}>
                      <thead><tr><th>Campo</th><th>Prima</th><th>Ora</th></tr></thead>
                      <tbody>{s.changes.map(c => <tr key={c.field} style={{ cursor: "default", background: c.bank ? C.redBg : undefined }}><td style={{ fontWeight: 650, color: c.bank ? C.red : C.text }}>{c.label}</td><td style={{ color: C.muted, overflowWrap: "anywhere" }}>{c.before || "—"}</td><td style={{ overflowWrap: "anywhere" }}>{c.after || "—"}</td></tr>)}</tbody>
                    </table>
                  </div>
                </Card>
              )}

              {s.status !== "draft" && (
                <Card>
                  <CardTitle icon={<FileCheck2 size={16} />} action={<button onClick={rerunChecks} disabled={!!busy} style={{ ...btnGhost, padding: "5px 11px", fontSize: 12, display: "inline-flex", alignItems: "center", gap: 6 }}>{spin("checks")}<RotateCcw size={13} />Ripeti</button>}>Controlli di conformità</CardTitle>
                  {s.compliance.map(c => (
                    <div key={c.key} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "8px 0", borderTop: `1px solid ${C.borderLight}`, flexWrap: "wrap" }}>
                      <span style={{ ...sans, flex: "0 0 auto", background: CHECK_STYLE[c.status].bg, color: CHECK_STYLE[c.status].color, borderRadius: 999, padding: "3px 10px", fontSize: 11.5, fontWeight: 650, minWidth: 96, textAlign: "center" }}>{CHECK_STYLE[c.status].label}</span>
                      <div style={{ flex: "1 1 260px", minWidth: 0 }}><div style={{ ...sans, fontSize: 13, fontWeight: 650 }}>{c.label}</div><div style={{ ...sans, fontSize: 12.5, color: C.muted, overflowWrap: "anywhere" }}>{c.detail}</div></div>
                      {c.key === "sanctions" && c.status === "todo" && <button onClick={() => setDialog("sanctions")} style={{ ...btnGhost, padding: "5px 11px", fontSize: 12 }}>Registra verifica manuale</button>}
                    </div>
                  ))}
                  {s.complianceCheckedAt && <div style={{ ...sans, fontSize: 11.5, color: C.subtle, marginTop: 6 }}>Controlli esterni eseguiti il {new Date(s.complianceCheckedAt).toLocaleString("it-IT", { dateStyle: "medium", timeStyle: "short" })}</div>}
                </Card>
              )}

              {s.duplicates.length > 0 && <Card><CardTitle>Possibili doppioni</CardTitle><DuplicateList dups={s.duplicates} /></Card>}

              <Card>
                <CardTitle>Anagrafica</CardTitle>
                <Summary s={s} data={s.data} />
              </Card>
            </>)}

            <Card>
              <CardTitle>Dati interni</CardTitle>
              <KV rows={[
                ["Società", s.companyCodes.map(c => config.companies.find(x => x.code === c)?.name ?? c).join(", ")],
                ["Codice merceologico", `${s.industryCode} · ${config.industryCodes.find(i => i.code === s.industryCode)?.name ?? ""}`],
                ["Codice cliente", s.customerCode], ["Buyer di riferimento", s.referenceBuyerName],
                ["Condizioni di pagamento", s.paymentTerms ? `${s.paymentTerms} · ${config.paymentTerms.find(p => p.code === s.paymentTerms)?.label ?? ""}` : ""],
                ["Codice SAP", s.sapCode], ["Invitato il", fmtDate(s.invitedAt)], ["Inviata il", s.submittedAt ? fmtDate(s.submittedAt) : ""],
              ]} />
            </Card>

            {s.status !== "invited" && (
              <Card>
                <CardTitle icon={<Paperclip size={16} />}>Documenti ({s.documents.length})</CardTitle>
                {s.documents.length === 0 ? <div style={{ ...sans, fontSize: 13, color: C.muted }}>Nessun documento caricato.</div> : s.documents.map((d, i) => (
                  <div key={d.id} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "9px 0", borderTop: i ? `1px solid ${C.borderLight}` : "none" }}>
                    <div style={{ minWidth: 0, flex: "1 1 220px" }}>
                      <div style={{ ...sans, fontSize: 13, fontWeight: 650, color: C.text }}>{d.typeLabel}</div>
                      <div style={{ ...sans, fontSize: 12, color: C.muted, overflowWrap: "anywhere" }}>{d.fileName} · {fmtSize(d.size)}</div>
                    </div>
                    <ValidityChip validUntil={d.validUntil} /><DocLink id={d.id} name={d.fileName} />
                    {isBuyerStep && config.ai.configured && <button onClick={() => recheck(d.id)} disabled={!!busy} style={{ ...btnGhost, padding: "4px 10px", fontSize: 12, display: "inline-flex", alignItems: "center", gap: 5 }}>{busy === `ai${d.id}` ? <Loader2 className="spin" size={13} /> : <RotateCcw size={13} />}{d.ai ? "Ripeti controllo" : "Controlla"}</button>}
                    <AiResult check={d.ai} audience="staff" />
                  </div>
                ))}
              </Card>
            )}

            {(isBuyerStep && s.status !== "invited") && (
              <Card>
                <CardTitle icon={<Ban size={16} />}>Stato del fornitore</CardTitle>
                <p style={{ ...sans, fontSize: 12.5, color: C.muted, margin: "-6px 0 10px", lineHeight: 1.5 }}>Bloccato: resta nel portale ma non può essere approvato. Disattivato: non accede più. Escluso: non accede e non può essere reinvitato senza un Manager. Il blocco in SAP, per ora, va fatto a mano.</p>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {s.lifecycle === "active" && <button onClick={() => setDialog("block")} style={btn(false)}>Blocca</button>}
                  {currentUser.role === "manager" && s.lifecycle !== "inactive" && <button onClick={() => setDialog("deactivate")} style={btn(false)}>Disattiva</button>}
                  {currentUser.role === "manager" && s.lifecycle !== "excluded" && <button onClick={() => setDialog("exclude")} style={btn(false, true)}>Escludi</button>}
                  {currentUser.role === "manager" && s.lifecycle !== "active" && !s.anonymizedAt && <button onClick={() => setDialog("reactivate")} style={btn(true)}>Riattiva</button>}
                </div>
                {currentUser.role === "manager" && (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.borderLight}`, alignItems: "center" }}>
                    <span style={{ ...sans, fontSize: 12, color: C.muted, flex: "1 1 200px" }}>Privacy: esporta tutti i dati del fornitore o, se non è più attivo, cancellane i dati personali.</span>
                    <a href={vendorExportUrl(s.id)} style={{ ...btn(false), textDecoration: "none", display: "inline-flex", alignItems: "center" }}>Esporta dati</a>
                    {!s.anonymizedAt && (s.lifecycle !== "active" || s.status !== "registered") && <button onClick={() => setDialog("anonymize")} style={btn(false, true)}>Anonimizza</button>}
                  </div>
                )}
              </Card>
            )}
            {s.contracts && (
              <Card>
                <CardTitle icon={<FileText size={16} />}>Contratti</CardTitle>
                {s.contracts.length === 0 ? <div style={{ ...sans, fontSize: 13, color: C.subtle }}>Nessun contratto collegato a questo fornitore.</div> : s.contracts.map((c, i) => (
                  <div key={c.id} style={{ ...sans, display: "flex", gap: 10, padding: "8px 0", borderTop: i ? `1px solid ${C.borderLight}` : "none", fontSize: 13, flexWrap: "wrap", alignItems: "baseline" }}>
                    <span style={{ flex: "1 1 200px", fontWeight: 600, color: c.status === "active" ? C.text : C.muted }}>{c.object}</span>
                    <span className="tabular" style={{ color: C.muted }}>{fmt(c.value, c.currency)}</span>
                    <span className="tabular" style={{ color: C.muted }}>scad. {fmtDate(c.end)}</span>
                    <span style={{ fontSize: 11.5, fontWeight: 650, borderRadius: 999, padding: "2px 9px", background: c.status === "active" ? C.greenBg : C.grayBg, color: c.status === "active" ? C.green : C.gray }}>{c.status === "active" ? "Attivo" : ({ renewed: "Rinnovato", replaced: "Sostituito", ceased: "Cessato", extended: "Prorogato" } as Record<string, string>)[c.outcome] ?? "Chiuso"}</span>
                  </div>
                ))}
              </Card>
            )}
            <AuditTrail entries={supplierTimeline(s)} />
            <div style={{ ...sans, fontSize: 11.5, color: C.subtle, display: "flex", alignItems: "center", gap: 6 }}><Clock size={13} />Aggiornato il {fmtDate(s.updatedAt)}</div>
          </div>
        )}
      </div>

      {dialog && s && (() => {
        const cfg = {
          reject: ["Rifiuta la registrazione", "Il fornitore riceverà questo motivo via email e potrà correggere e reinviare.", "Rifiuta", true, "reject"],
          revision: ["Chiedi modifiche al fornitore", "Spiega cosa deve correggere: il fornitore riceverà il testo via email e potrà modificare dati e documenti.", "Invia richiesta", false, "request_revision"],
          block: ["Blocca il fornitore", "Il fornitore non potrà essere approvato finché non viene riattivato. Il motivo resta nello storico.", "Blocca", true, "block"],
          deactivate: ["Disattiva il fornitore", "Il fornitore non potrà più accedere all'area personale né ricevere reminder.", "Disattiva", true, "deactivate"],
          exclude: ["Escludi il fornitore", "Esclusione definitiva: non accede, non riceve reminder e non può essere reinvitato senza un Manager.", "Escludi", true, "exclude"],
          reactivate: ["Riattiva il fornitore", "Il fornitore torna operativo.", "Riattiva", false, "reactivate"],
          sanctions: ["Verifica manuale delle sanzioni", "Indica la fonte consultata (es. lista consolidata UE, OFAC) e l'esito.", "Registra verifica", false, "sanctions_manual"],
          anonymize: ["Anonimizza i dati personali", "Vengono cancellati contatti, indirizzo, documenti e account del fornitore. Restano ragione sociale, partita IVA e IBAN per il controllo dei doppioni. L'operazione non si può annullare.", "Anonimizza", true, "reject"],
        }[dialog] as [string, string, string, boolean, VendorAction];
        const confirm = dialog === "anonymize"
          ? async (reason: string) => { try { setS(await portalApi.anonymize(s.id, reason)); onChanged(); notify("Dati personali anonimizzati"); setDialog(null); return null; } catch (err) { return fail(err); } }
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
          <b>{d.name}</b>{d.sapCode ? ` · SAP ${d.sapCode}` : ""} · {STATUS_STYLE[d.status].label}{d.lifecycle !== "active" ? ` · ${LIFECYCLE_LABEL[d.lifecycle]}` : ""}
          <div>Stessi dati: {d.fields.join(", ")}{d.severe ? " — attenzione: possibile frode o fornitore escluso" : ""}{d.confirmed ? " — già verificato come fornitore distinto" : ""}</div>
        </div>
      ))}
    </div>
  );
}
const LIFECYCLE_LABEL: Record<Lifecycle, string> = { active: "Attivo", blocked: "Bloccato", inactive: "Disattivato", excluded: "Escluso" };
