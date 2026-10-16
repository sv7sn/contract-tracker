import { useCallback, useEffect, useMemo, useState } from "react";
import type { MonitorData, MonitorItem, MonitorState, PortalConfig, User } from "../types.ts";
import { ApiError, portalApi } from "../api.ts";
import { btnGhost, C, font, iStyle, radius, sans } from "../theme.ts";
import { fmtDate } from "../lib/format.ts";
import { Card, EmptyState, Grid, StatCard } from "../components/ui.tsx";
import { AlertTriangle, Bell, CheckCircle2, Clock, FileCheck2, Loader2, Mail, Phone, Search, Send, Sparkles } from "../components/icons.tsx";
import { Notice, Portal, ReasonDialog } from "../components/vendorUi.tsx";
import { VendorSheet } from "./VendorsView.tsx";
import { locale, t } from "../i18n/index.ts";

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
const daysText = (i: MonitorItem) => i.daysLeft === null ? "" : i.daysLeft < 0 ? t("scaduto da {n} gg", { n: -i.daysLeft }) : i.daysLeft === 0 ? t("scade oggi") : t("tra {n} gg", { n: i.daysLeft });
const channelText = (c: string | null) => (c === "phone" ? t("telefono") : t("email"));
const remText = (i: MonitorItem) => i.reminders ? (i.reminders === 1 ? t("1 sollecito") : t("{n} solleciti", { n: i.reminders })) + " · " + t("ultimo {date} ({channel})", { date: fmtDate(i.lastReminderAt!), channel: channelText(i.lastChannel) }) : t("Nessun sollecito");

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
    if (err instanceof ApiError && err.status === 401) { onSessionExpired(); return t("Sessione scaduta"); }
    return err instanceof Error ? err.message : t("Operazione non riuscita");
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
    try { const r = await portalApi.remind(supplierId, channel, note); await reload(); notify(channel === "email" ? t("Sollecito inviato ({n} documenti)", { n: r.sent }) : t("Contatto registrato")); setBusy(null); return null; }
    catch (err) { const m = fail(err); notify(`⚠️ ${m}`); setBusy(null); return m; }
  };
  const runNow = async () => {
    setBusy("run");
    try { const r = await portalApi.runReminders(); await reload(); notify(r.emails ? t("{n} email inviate a {s} fornitori", { n: r.emails, s: r.suppliers }) : t("Nessun reminder da inviare oggi")); } catch (err) { notify(`⚠️ ${fail(err)}`); }
    setBusy(null);
  };

  if (error) return <EmptyState icon={<AlertTriangle size={26} />} title={t("Impossibile caricare le scadenze")} text={error} action={<button onClick={reload} style={{ ...btnGhost, padding: "9px 16px" }}>{t("Riprova")}</button>} />;
  if (!data) return <div style={{ display: "flex", justifyContent: "center", padding: 60 }}><Loader2 className="spin" size={26} color={C.subtle} /></div>;

  const tiles: { key: Filter; label: string; value: number; sub: string; color: string; icon: React.ReactNode }[] = [
    { key: "unresponsive", label: t("Non rispondono"), value: stuckBySupplier.length, sub: t("Fornitori: serve il tuo intervento"), color: C.red, icon: <Bell size={18} /> },
    { key: "expired", label: t("Scaduti"), value: counts.expired, sub: t("Da rinnovare subito"), color: C.red, icon: <AlertTriangle size={18} /> },
    { key: "missing", label: t("Mancanti"), value: counts.missing, sub: t("Obbligatori non caricati"), color: C.yellow, icon: <FileCheck2 size={18} /> },
    { key: "expiring", label: t("In scadenza"), value: counts.expiring, sub: t("Entro {n} giorni", { n: Math.max(...data.policy.days, 30) }), color: C.yellow, icon: <Clock size={18} /> },
    { key: "valid", label: t("Validi"), value: counts.valid, sub: t("Documenti in regola"), color: C.green, icon: <CheckCircle2 size={18} /> },
  ];

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
        <div>
          <div style={{ ...font, fontSize: 18, fontWeight: 700, color: C.text }}>{t("Scadenze documenti")}</div>
          <div style={{ ...sans, fontSize: 12, color: C.muted }}>{t("{n} documenti · ultimo controllo automatico: {when}", { n: data.items.length, when: data.lastRunAt ? new Date(data.lastRunAt).toLocaleString(locale(), { dateStyle: "medium", timeStyle: "short" }) : t("mai eseguito") })}</div>
        </div>
        {currentUser.role === "manager" && <button onClick={runNow} disabled={!!busy} style={{ ...btnGhost, display: "inline-flex", alignItems: "center", gap: 7, padding: "9px 14px", color: C.text }}>{busy === "run" ? <Loader2 className="spin" size={15} /> : <Send size={15} />}{t("Controlla e invia i reminder ora")}</button>}
      </div>

      {!data.emailConfigured && <Notice kind="warn"><b>{t("Le email ai fornitori non partono ancora:")}</b> {t("manca il provider email")} (<code>RESEND_API_KEY</code> {t("e")} <code>MAIL_FROM</code> {t("su Vercel")}). {t("I solleciti vengono registrati ma il fornitore non riceve nulla.")}</Notice>}
      {!data.policy.enabled && <Notice kind="warn">{t("I reminder automatici sono disattivati (si riattivano in Configurazione).")}</Notice>}

      <Grid min={180} gap={12} fill style={{ marginBottom: 16 }}>
        {tiles.map(tile => (
          <button key={tile.key} onClick={() => setFilter(f => f === tile.key ? "todo" : tile.key)} aria-pressed={filter === tile.key} style={{ all: "unset", cursor: "pointer", display: "block", borderRadius: radius.lg, outline: filter === tile.key ? `2px solid ${C.accent}` : undefined, outlineOffset: 1 }}>
            <StatCard label={tile.label} value={tile.value} sub={tile.sub} color={tile.color} icon={tile.icon} />
          </button>
        ))}
      </Grid>

      {stuckBySupplier.length > 0 && (
        <Card style={{ borderColor: "#f0c9c9", background: "#fffafa", marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 4 }}>
            <span style={{ width: 30, height: 30, borderRadius: 9, background: C.redBg, color: C.red, display: "inline-flex", alignItems: "center", justifyContent: "center" }}><Bell size={17} /></span>
            <h3 style={{ ...font, margin: 0, fontSize: 15.5, color: C.red }}>{t("Fornitori che non rispondono ({n})", { n: stuckBySupplier.length })}</h3>
          </div>
          <p style={{ ...sans, fontSize: 12.5, color: C.muted, margin: "0 0 12px", lineHeight: 1.5 }}>{t("Sono stati sollecitati almeno {n} volte e i documenti non sono ancora stati aggiornati. Contattali direttamente o sollecitali di nuovo.", { n: data.policy.escalateAfter })}</p>
          <div style={{ display: "grid", gap: 10 }}>
            {stuckBySupplier.map(g => (
              <div key={g.id} style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: radius.md, padding: 12, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                <div style={{ flex: "1 1 260px", minWidth: 0 }}>
                  <button onClick={() => setOpenId(g.id)} style={{ ...sans, background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 14, fontWeight: 700, color: C.text, textAlign: "left" }}>{g.name}</button>
                  <div style={{ ...sans, fontSize: 12, color: C.muted }}>{g.buyer ? t("Buyer: {name}", { name: g.buyer }) + " · " : ""}{remText(g.items.sort((a, b) => (b.lastReminderAt ?? "").localeCompare(a.lastReminderAt ?? ""))[0])}</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 7 }}>{g.items.map(i => <span key={i.key} style={{ ...sans, fontSize: 11.5, color: STATE[i.state].color, background: STATE[i.state].bg, borderRadius: 8, padding: "3px 8px", fontWeight: 600 }}>{i.docLabel}: {i.state === "missing" ? t("mancante") : daysText(i)}</span>)}</div>
                </div>
                {canAct && (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button onClick={() => remind(g.id, "email")} disabled={!!busy} style={{ ...btnGhost, padding: "8px 12px", fontSize: 12.5, display: "inline-flex", alignItems: "center", gap: 6 }}>{busy === `email${g.id}` ? <Loader2 className="spin" size={14} /> : <Mail size={14} />}{t("Sollecita di nuovo")}</button>
                    <button onClick={() => setPhoneFor({ id: g.id, name: g.name })} disabled={!!busy} style={{ ...btnGhost, padding: "8px 12px", fontSize: 12.5, display: "inline-flex", alignItems: "center", gap: 6 }}><Phone size={14} />{t("Registra telefonata")}</button>
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
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder={t("Cerca fornitore o documento…")} aria-label={t("Cerca")} style={{ ...iStyle, paddingLeft: 36 }} />
        </div>
        <select value={filter} onChange={e => setFilter(e.target.value as Filter)} aria-label={t("Stato")} style={{ ...iStyle, width: "auto", minWidth: 170 }}>
          <option value="todo">{t("Da gestire")}</option><option value="all">{t("Tutti i documenti")}</option><option value="unresponsive">{t("Non rispondono")}</option><option value="expired">{t("Scaduti")}</option><option value="missing">{t("Mancanti")}</option><option value="expiring">{t("In scadenza")}</option><option value="valid">{t("Validi")}</option>
        </select>
        <select value={docFilter} onChange={e => setDocFilter(e.target.value)} aria-label={t("Documento")} style={{ ...iStyle, width: "auto", minWidth: 190 }}>
          <option value="all">{t("Tutti i documenti")}</option>{docTypes.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </div>

      {shown.length === 0 ? (
        <EmptyState icon={<CheckCircle2 size={26} />} title={data.items.length ? t("Nessun documento corrisponde ai filtri") : t("Ancora nessun documento da monitorare")} text={data.items.length ? undefined : t("Qui compariranno i documenti dei fornitori registrati in SAP, con scadenze e solleciti.")} />
      ) : (<>
        <div className="table-wrap desktop-only">
          <table className="data-table">
            <thead><tr><th>{t("Fornitore")}</th><th>{t("Documento")}</th><th>{t("Stato")}</th><th>{t("Scadenza")}</th><th>{t("Solleciti")}</th><th aria-label={t("Azioni")} /></tr></thead>
            <tbody>
              {shown.map(i => (
                <tr key={i.key} onClick={() => setOpenId(i.supplierId)} tabIndex={0} onKeyDown={e => { if (e.key === "Enter") setOpenId(i.supplierId); }}>
                  <td style={{ minWidth: 200, boxShadow: i.unresponsive ? `inset 3px 0 0 ${C.red}` : undefined }}><div style={{ fontWeight: 650, color: C.text }}>{i.supplierName}</div><div style={{ fontSize: 12, color: C.muted }}>{i.buyerName}</div></td>
                  <td style={{ minWidth: 190 }}><div>{i.docLabel}</div>{i.ai && i.ai !== "ok" && i.ai !== "skipped" && <div style={{ fontSize: 11.5, color: i.ai === "problem" ? C.red : C.yellow, display: "flex", alignItems: "center", gap: 4 }}><Sparkles size={12} />{t("Controllo AI: {result}", { result: i.ai === "problem" ? t("sospetto") : t("da verificare") })}</div>}</td>
                  <td><div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{chip(t(STATE[i.state].label), STATE[i.state].color, STATE[i.state].bg)}{i.unresponsive && chip(t("Non risponde"), "#fff", C.red)}</div></td>
                  <td className="tabular" style={{ whiteSpace: "nowrap" }}>{i.validUntil ? <><div>{fmtDate(i.validUntil)}</div><div style={{ fontSize: 12, color: C.muted }}>{daysText(i)}</div></> : "—"}</td>
                  <td style={{ fontSize: 12.5, color: C.muted, minWidth: 170 }}>{remText(i)}</td>
                  <td onClick={e => e.stopPropagation()} style={{ whiteSpace: "nowrap" }}>{canAct && i.state !== "valid" && <button onClick={() => remind(i.supplierId, "email")} disabled={!!busy} aria-label={t("Sollecita {name}", { name: i.supplierName })} style={{ ...btnGhost, padding: "6px 10px", fontSize: 12, display: "inline-flex", alignItems: "center", gap: 5 }}>{busy === `email${i.supplierId}` ? <Loader2 className="spin" size={13} /> : <Mail size={13} />}{t("Sollecita")}</button>}</td>
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
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>{chip(t(STATE[i.state].label), STATE[i.state].color, STATE[i.state].bg)}{i.unresponsive && chip(t("Non risponde"), "#fff", C.red)}<span style={{ ...sans, fontSize: 12, color: C.muted }}>{i.validUntil ? `${fmtDate(i.validUntil)} · ${daysText(i)}` : ""}</span></div>
                <div style={{ ...sans, fontSize: 12, color: C.subtle, marginTop: 8 }}>{remText(i)}</div>
              </Card>
            ))}
          </Grid>
        </div>
      </>)}

      {phoneFor && (
        <Portal><ReasonDialog title={t("Contatto telefonico: {name}", { name: phoneFor.name })} text={t("Annota con chi hai parlato e cosa è stato concordato. Resta nello storico del fornitore.")} confirmLabel={t("Salva contatto")}
          onConfirm={async note => { const e = await remind(phoneFor.id, "phone", note); if (!e) setPhoneFor(null); return e; }} onClose={() => setPhoneFor(null)} /></Portal>
      )}
      {openId !== null && config && <Portal><VendorSheet id={openId} config={config} currentUser={currentUser} onClose={() => setOpenId(null)} onChanged={reload} notify={notify} fail={fail} /></Portal>}
    </div>
  );
}
