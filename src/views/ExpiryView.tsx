import { useCallback, useEffect, useMemo, useState } from "react";
import type { MonitorData, MonitorItem, MonitorState, PortalConfig, User } from "../types.ts";
import { ApiError, portalApi } from "../api.ts";
import { btnGhost, C, font, iStyle, radius, sans } from "../theme.ts";
import { fmtDate } from "../lib/format.ts";
import { Card, EmptyState, Grid, StatCard } from "../components/ui.tsx";
import { AlertTriangle, Bell, CheckCircle2, Clock, FileCheck2, Loader2, Mail, Phone, Search, Send, Sparkles } from "../components/icons.tsx";
import { Notice, Portal, ReasonDialog } from "../components/vendorUi.tsx";
import { VendorSheet } from "./VendorsView.tsx";

interface Props { currentUser: User; notify: (m: string) => void; onSessionExpired: () => void }
type Filter = "todo" | "all" | "unresponsive" | MonitorState;

const STATE: Record<MonitorState, { label: string; color: string; bg: string }> = {
  expired: { label: "Scaduto", color: C.red, bg: C.redBg },
  expiring: { label: "In scadenza", color: C.yellow, bg: C.yellowBg },
  missing: { label: "Mancante", color: C.red, bg: C.redBg },
  valid: { label: "Valido", color: C.green, bg: C.greenBg },
};
const ORDER: Record<MonitorState, number> = { expired: 0, missing: 1, expiring: 2, valid: 3 };

const chip = (label: string, color: string, bg: string) => <span style={{ ...sans, background: bg, color, borderRadius: 999, padding: "3px 10px", fontSize: 11.5, fontWeight: 650, whiteSpace: "nowrap" }}>{label}</span>;
const daysText = (i: MonitorItem) => i.daysLeft === null ? "" : i.daysLeft < 0 ? `scaduto da ${-i.daysLeft} gg` : i.daysLeft === 0 ? "scade oggi" : `tra ${i.daysLeft} gg`;
const channelText = (c: string | null) => (c === "phone" ? "telefono" : "email");
const remText = (i: MonitorItem) => i.reminders ? `${i.reminders} ${i.reminders === 1 ? "sollecito" : "solleciti"} · ultimo ${fmtDate(i.lastReminderAt!)} (${channelText(i.lastChannel)})` : "Nessun sollecito";

/** Monitoraggio delle scadenze documentali di tutti i fornitori registrati. */
export function ExpiryView({ currentUser, notify, onSessionExpired }: Props) {
  const [data, setData] = useState<MonitorData | null>(null);
  const [config, setConfig] = useState<PortalConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("todo");
  const [search, setSearch] = useState(""); const [docFilter, setDocFilter] = useState("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [phoneFor, setPhoneFor] = useState<{ id: number; name: string } | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);

  const canAct = currentUser.role === "manager" || currentUser.role === "buyer";
  const fail = useCallback((err: unknown) => {
    if (err instanceof ApiError && err.status === 401) { onSessionExpired(); return "Sessione scaduta"; }
    return err instanceof Error ? err.message : "Operazione non riuscita";
  }, [onSessionExpired]);
  const reload = useCallback(() => portalApi.monitor().then(d => { setData(d); setError(null); }).catch(err => setError(fail(err))), [fail]);
  useEffect(() => {
    let off = false;
    Promise.all([portalApi.monitor(), portalApi.config()]).then(([d, c]) => { if (!off) { setData(d); setConfig(c); } }).catch(err => { if (!off) setError(fail(err)); });
    return () => { off = true; };
  }, [fail]);

  const counts = useMemo(() => {
    const c = { unresponsive: 0, expired: 0, expiring: 0, missing: 0, valid: 0 };
    for (const i of data?.items ?? []) { c[i.state]++; if (i.unresponsive) c.unresponsive++; }
    return c;
  }, [data]);

  const stuckBySupplier = useMemo(() => {
    const m = new Map<number, { id: number; name: string; buyer: string; items: MonitorItem[] }>();
    for (const i of data?.items ?? []) if (i.unresponsive) { const g = m.get(i.supplierId) ?? { id: i.supplierId, name: i.supplierName, buyer: i.buyerName, items: [] }; g.items.push(i); m.set(i.supplierId, g); }
    return [...m.values()];
  }, [data]);

  const docTypes = useMemo(() => [...new Map((data?.items ?? []).map(i => [i.docType, i.docLabel])).entries()], [data]);
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.items ?? []).filter(i => (filter === "all" || (filter === "todo" ? i.state !== "valid" : filter === "unresponsive" ? i.unresponsive : i.state === filter)) && (docFilter === "all" || i.docType === docFilter) && (!q || `${i.supplierName} ${i.docLabel} ${i.buyerName}`.toLowerCase().includes(q)))
      .sort((a, b) => Number(b.unresponsive) - Number(a.unresponsive) || ORDER[a.state] - ORDER[b.state] || (a.daysLeft ?? -9999) - (b.daysLeft ?? -9999));
  }, [data, filter, search, docFilter]);

  const remind = async (supplierId: number, channel: "email" | "phone", note = ""): Promise<string | null> => {
    setBusy(`${channel}${supplierId}`);
    try { const r = await portalApi.remind(supplierId, channel, note); await reload(); notify(channel === "email" ? `Sollecito inviato (${r.sent} documenti)` : "Contatto registrato"); setBusy(null); return null; }
    catch (err) { const m = fail(err); notify(`⚠️ ${m}`); setBusy(null); return m; }
  };
  const runNow = async () => {
    setBusy("run");
    try { const r = await portalApi.runReminders(); await reload(); notify(r.emails ? `${r.emails} email inviate a ${r.suppliers} fornitori` : "Nessun reminder da inviare oggi"); } catch (err) { notify(`⚠️ ${fail(err)}`); }
    setBusy(null);
  };

  if (error) return <EmptyState icon={<AlertTriangle size={26} />} title="Impossibile caricare le scadenze" text={error} action={<button onClick={reload} style={{ ...btnGhost, padding: "9px 16px" }}>Riprova</button>} />;
  if (!data) return <div style={{ display: "flex", justifyContent: "center", padding: 60 }}><Loader2 className="spin" size={26} color={C.subtle} /></div>;

  const tiles: { key: Filter; label: string; value: number; sub: string; color: string; icon: React.ReactNode }[] = [
    { key: "unresponsive", label: "Non rispondono", value: stuckBySupplier.length, sub: "Fornitori: serve il tuo intervento", color: C.red, icon: <Bell size={18} /> },
    { key: "expired", label: "Scaduti", value: counts.expired, sub: "Da rinnovare subito", color: C.red, icon: <AlertTriangle size={18} /> },
    { key: "missing", label: "Mancanti", value: counts.missing, sub: "Obbligatori non caricati", color: C.yellow, icon: <FileCheck2 size={18} /> },
    { key: "expiring", label: "In scadenza", value: counts.expiring, sub: `Entro ${Math.max(...data.policy.days, 30)} giorni`, color: C.yellow, icon: <Clock size={18} /> },
    { key: "valid", label: "Validi", value: counts.valid, sub: "Documenti in regola", color: C.green, icon: <CheckCircle2 size={18} /> },
  ];

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
        <div>
          <div style={{ ...font, fontSize: 18, fontWeight: 700, color: C.text }}>Scadenze documenti</div>
          <div style={{ ...sans, fontSize: 12, color: C.muted }}>{data.items.length} documenti · ultimo controllo automatico: {data.lastRunAt ? new Date(data.lastRunAt).toLocaleString("it-IT", { dateStyle: "medium", timeStyle: "short" }) : "mai eseguito"}</div>
        </div>
        {currentUser.role === "manager" && <button onClick={runNow} disabled={!!busy} style={{ ...btnGhost, display: "inline-flex", alignItems: "center", gap: 7, padding: "9px 14px", color: C.text }}>{busy === "run" ? <Loader2 className="spin" size={15} /> : <Send size={15} />}Controlla e invia i reminder ora</button>}
      </div>

      {!data.emailConfigured && <Notice kind="warn"><b>Le email ai fornitori non partono ancora:</b> manca il provider email (<code>RESEND_API_KEY</code> e <code>MAIL_FROM</code> su Vercel). I solleciti vengono registrati ma il fornitore non riceve nulla.</Notice>}
      {!data.policy.enabled && <Notice kind="warn">I reminder automatici sono disattivati (si riattivano in Configurazione).</Notice>}

      <Grid min={180} gap={12} fill style={{ marginBottom: 16 }}>
        {tiles.map(t => (
          <button key={t.key} onClick={() => setFilter(f => f === t.key ? "todo" : t.key)} aria-pressed={filter === t.key} style={{ all: "unset", cursor: "pointer", display: "block", borderRadius: radius.lg, outline: filter === t.key ? `2px solid ${C.accent}` : undefined, outlineOffset: 1 }}>
            <StatCard label={t.label} value={t.value} sub={t.sub} color={t.color} icon={t.icon} />
          </button>
        ))}
      </Grid>

      {stuckBySupplier.length > 0 && (
        <Card style={{ borderColor: "#f0c9c9", background: "#fffafa", marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 4 }}>
            <span style={{ width: 30, height: 30, borderRadius: 9, background: C.redBg, color: C.red, display: "inline-flex", alignItems: "center", justifyContent: "center" }}><Bell size={17} /></span>
            <h3 style={{ ...font, margin: 0, fontSize: 15.5, color: C.red }}>Fornitori che non rispondono ({stuckBySupplier.length})</h3>
          </div>
          <p style={{ ...sans, fontSize: 12.5, color: C.muted, margin: "0 0 12px", lineHeight: 1.5 }}>Sono stati sollecitati almeno {data.policy.escalateAfter} volte e i documenti non sono ancora stati aggiornati. Contattali direttamente o sollecitali di nuovo.</p>
          <div style={{ display: "grid", gap: 10 }}>
            {stuckBySupplier.map(g => (
              <div key={g.id} style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: radius.md, padding: 12, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                <div style={{ flex: "1 1 260px", minWidth: 0 }}>
                  <button onClick={() => setOpenId(g.id)} style={{ ...sans, background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 14, fontWeight: 700, color: C.text, textAlign: "left" }}>{g.name}</button>
                  <div style={{ ...sans, fontSize: 12, color: C.muted }}>{g.buyer ? `Buyer: ${g.buyer} · ` : ""}{remText(g.items.sort((a, b) => (b.lastReminderAt ?? "").localeCompare(a.lastReminderAt ?? ""))[0])}</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 7 }}>{g.items.map(i => <span key={i.key} style={{ ...sans, fontSize: 11.5, color: STATE[i.state].color, background: STATE[i.state].bg, borderRadius: 8, padding: "3px 8px", fontWeight: 600 }}>{i.docLabel}: {i.state === "missing" ? "mancante" : daysText(i)}</span>)}</div>
                </div>
                {canAct && (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button onClick={() => remind(g.id, "email")} disabled={!!busy} style={{ ...btnGhost, padding: "8px 12px", fontSize: 12.5, display: "inline-flex", alignItems: "center", gap: 6 }}>{busy === `email${g.id}` ? <Loader2 className="spin" size={14} /> : <Mail size={14} />}Sollecita di nuovo</button>
                    <button onClick={() => setPhoneFor({ id: g.id, name: g.name })} disabled={!!busy} style={{ ...btnGhost, padding: "8px 12px", fontSize: 12.5, display: "inline-flex", alignItems: "center", gap: 6 }}><Phone size={14} />Registra telefonata</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: "1 1 240px", maxWidth: 380 }}>
          <Search size={16} color={C.subtle} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Cerca fornitore o documento…" aria-label="Cerca" style={{ ...iStyle, paddingLeft: 36 }} />
        </div>
        <select value={filter} onChange={e => setFilter(e.target.value as Filter)} aria-label="Stato" style={{ ...iStyle, width: "auto", minWidth: 170 }}>
          <option value="todo">Da gestire</option><option value="all">Tutti i documenti</option><option value="unresponsive">Non rispondono</option><option value="expired">Scaduti</option><option value="missing">Mancanti</option><option value="expiring">In scadenza</option><option value="valid">Validi</option>
        </select>
        <select value={docFilter} onChange={e => setDocFilter(e.target.value)} aria-label="Documento" style={{ ...iStyle, width: "auto", minWidth: 190 }}>
          <option value="all">Tutti i documenti</option>{docTypes.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </div>

      {shown.length === 0 ? (
        <EmptyState icon={<CheckCircle2 size={26} />} title={data.items.length ? "Nessun documento corrisponde ai filtri" : "Ancora nessun documento da monitorare"} text={data.items.length ? undefined : "Qui compariranno i documenti dei fornitori registrati in SAP, con scadenze e solleciti."} />
      ) : (<>
        <div className="table-wrap desktop-only">
          <table className="data-table">
            <thead><tr><th>Fornitore</th><th>Documento</th><th>Stato</th><th>Scadenza</th><th>Solleciti</th><th aria-label="Azioni" /></tr></thead>
            <tbody>
              {shown.map(i => (
                <tr key={i.key} onClick={() => setOpenId(i.supplierId)} tabIndex={0} onKeyDown={e => { if (e.key === "Enter") setOpenId(i.supplierId); }}>
                  <td style={{ minWidth: 200, boxShadow: i.unresponsive ? `inset 3px 0 0 ${C.red}` : undefined }}><div style={{ fontWeight: 650, color: C.text }}>{i.supplierName}</div><div style={{ fontSize: 12, color: C.muted }}>{i.buyerName}</div></td>
                  <td style={{ minWidth: 190 }}><div>{i.docLabel}</div>{i.ai && i.ai !== "ok" && i.ai !== "skipped" && <div style={{ fontSize: 11.5, color: i.ai === "problem" ? C.red : C.yellow, display: "flex", alignItems: "center", gap: 4 }}><Sparkles size={12} />Controllo AI: {i.ai === "problem" ? "sospetto" : "da verificare"}</div>}</td>
                  <td><div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{chip(STATE[i.state].label, STATE[i.state].color, STATE[i.state].bg)}{i.unresponsive && chip("Non risponde", "#fff", C.red)}</div></td>
                  <td className="tabular" style={{ whiteSpace: "nowrap" }}>{i.validUntil ? <><div>{fmtDate(i.validUntil)}</div><div style={{ fontSize: 12, color: C.muted }}>{daysText(i)}</div></> : "—"}</td>
                  <td style={{ fontSize: 12.5, color: C.muted, minWidth: 170 }}>{remText(i)}</td>
                  <td onClick={e => e.stopPropagation()} style={{ whiteSpace: "nowrap" }}>{canAct && i.state !== "valid" && <button onClick={() => remind(i.supplierId, "email")} disabled={!!busy} aria-label={`Sollecita ${i.supplierName}`} style={{ ...btnGhost, padding: "6px 10px", fontSize: 12, display: "inline-flex", alignItems: "center", gap: 5 }}>{busy === `email${i.supplierId}` ? <Loader2 className="spin" size={13} /> : <Mail size={13} />}Sollecita</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mobile-only">
          <Grid min={320} gap={12}>
            {shown.map(i => (
              <Card key={i.key} className="lift" onClick={() => setOpenId(i.supplierId)} role="button" tabIndex={0} style={{ padding: 14, cursor: "pointer", borderRadius: radius.md, borderLeft: i.unresponsive ? `4px solid ${C.red}` : undefined }}>
                <div style={{ ...sans, fontSize: 14, fontWeight: 650 }}>{i.supplierName}</div>
                <div style={{ ...sans, fontSize: 12.5, color: C.muted, marginBottom: 8 }}>{i.docLabel}</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>{chip(STATE[i.state].label, STATE[i.state].color, STATE[i.state].bg)}{i.unresponsive && chip("Non risponde", "#fff", C.red)}<span style={{ ...sans, fontSize: 12, color: C.muted }}>{i.validUntil ? `${fmtDate(i.validUntil)} · ${daysText(i)}` : ""}</span></div>
                <div style={{ ...sans, fontSize: 12, color: C.subtle, marginTop: 8 }}>{remText(i)}</div>
              </Card>
            ))}
          </Grid>
        </div>
      </>)}

      {phoneFor && (
        <Portal><ReasonDialog title={`Contatto telefonico: ${phoneFor.name}`} text="Annota con chi hai parlato e cosa è stato concordato. Resta nello storico del fornitore." confirmLabel="Salva contatto"
          onConfirm={async note => { const e = await remind(phoneFor.id, "phone", note); if (!e) setPhoneFor(null); return e; }} onClose={() => setPhoneFor(null)} /></Portal>
      )}
      {openId !== null && config && <Portal><VendorSheet id={openId} config={config} currentUser={currentUser} onClose={() => setOpenId(null)} onChanged={reload} notify={notify} fail={fail} /></Portal>}
    </div>
  );
}
