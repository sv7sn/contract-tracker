import { useCallback, useEffect, useState } from "react";
import type { ConfigAuditEntry, DocRule, DocTypeDef, PortalConfig, ReminderPolicy, SapSettings } from "../types.ts";
import { COUNTRIES, countryName } from "../supplierRules.ts";
import { ApiError, portalApi } from "../api.ts";
import { btnGhost, btnPrimary, C, font, iStyle, sans } from "../theme.ts";
import { Card, CardTitle, EmptyState, Field } from "../components/ui.tsx";
import { AlertTriangle, Bell, Building2, History, Lock, Inbox, FileCheck2, Loader2, Pencil, Plus, Save, Settings, Sparkles, Trash2, Wallet, FileText, X } from "../components/icons.tsx";
import { Notice, Portal } from "../components/vendorUi.tsx";

type Entity = "company" | "industry" | "payment_term";
type Draft = { entity: Entity; item: Record<string, unknown>; isNew: boolean };
const GROUPS: [string, string][] = [["ITD1", "Italia, senza ritenuta"], ["ITW1", "Italia, con ritenuta"], ["ITF3", "Estero"], ["BRD6", "Brasile"]];

/** Configurazione del portale fornitori (solo Manager). */
export function ConfigView({ notify, onSessionExpired }: { notify: (m: string) => void; onSessionExpired: () => void }) {
  const [cfg, setCfg] = useState<PortalConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [sap, setSap] = useState<SapSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [docDraft, setDocDraft] = useState<{ type: DocTypeDef; rules: DocRule[]; isNew: boolean } | null>(null);
  const [pol, setPol] = useState<{ enabled: boolean; days: string; repeatDays: string; escalateAfter: string } | null>(null);
  const [polBusy, setPolBusy] = useState(false);
  const [sla, setSla] = useState("7");
  const [threshold, setThreshold] = useState("10000");

  const fail = useCallback((err: unknown) => {
    if (err instanceof ApiError && err.status === 401) { onSessionExpired(); return "Sessione scaduta"; }
    return err instanceof Error ? err.message : "Operazione non riuscita";
  }, [onSessionExpired]);
  const adopt = (c: PortalConfig) => { setCfg(c); setSap(c.sap); setPol(policyToForm(c.reminders)); setSla(String(c.rda.slaDays)); setThreshold(String(c.rda.sourcingThreshold)); };
  useEffect(() => { portalApi.config().then(adopt).catch(err => setError(fail(err))); }, [fail]);

  if (error) return <EmptyState icon={<AlertTriangle size={26} />} title="Impossibile caricare la configurazione" text={error} />;
  if (!cfg || !sap) return <div style={{ display: "flex", justifyContent: "center", padding: 60 }}><Loader2 className="spin" size={26} color={C.subtle} /></div>;

  const remove = async (entity: Entity, code: string, label: string) => {
    if (!window.confirm(`Eliminare "${label}"?`)) return;
    try { adopt(await portalApi.saveConfig(entity, "delete", { code })); notify("Elemento eliminato"); } catch (err) { notify(`⚠️ ${fail(err)}`); }
  };
  const saveSap = async () => {
    setBusy(true);
    try { adopt(await portalApi.saveConfig("sap", "save", sap)); notify("Parametri SAP salvati"); } catch (err) { notify(`⚠️ ${fail(err)}`); }
    setBusy(false);
  };
  const savePolicy = async () => {
    if (!pol) return;
    setPolBusy(true);
    try { adopt(await portalApi.saveConfig("reminders", "save", { enabled: pol.enabled, days: pol.days.split(/[,\s;]+/).filter(Boolean).map(Number), repeatDays: Number(pol.repeatDays), escalateAfter: Number(pol.escalateAfter) })); notify("Reminder salvati"); } catch (err) { notify(`⚠️ ${fail(err)}`); }
    setPolBusy(false);
  };
  const saveThreshold = async () => { try { adopt(await portalApi.saveConfig("rda", "save", { sourcingThreshold: Number(threshold) })); notify("Soglia salvata"); } catch (err) { notify(`⚠️ ${fail(err)}`); } };
  const saveSla = async () => { try { adopt(await portalApi.saveConfig("rda", "save", { slaDays: Number(sla) })); notify("Giorni di lavorazione salvati"); } catch (err) { notify(`⚠️ ${fail(err)}`); } };
  const saveGroup = async (pgr: string, userId: string) => { try { adopt(await portalApi.saveConfig("pgr", "save", { pgr, userId: userId ? Number(userId) : null })); notify("Assegnazione salvata"); } catch (err) { notify(`⚠️ ${fail(err)}`); } };
  const removeDocType = async (t: DocTypeDef) => {
    if (!window.confirm(`Eliminare il documento "${t.label}"?`)) return;
    try { adopt(await portalApi.saveConfig("doc_type", "delete", { key: t.key })); notify("Documento eliminato"); } catch (err) { notify(`⚠️ ${fail(err)}`); }
  };
  const ruleText = (r: DocRule) => `${r.scope === "all" ? "Tutti" : r.scope === "country" ? countryName(r.value) : `Codice ${r.value}`}: ${r.level === "required" ? "obbligatorio" : "facoltativo"}`;
  const noRec = GROUPS.filter(([g]) => !sap.reconciliationAccounts[g]?.trim());

  const iconBtn = { background: "none", border: "none", cursor: "pointer", padding: 6, color: C.subtle, display: "flex" } as const;
  const addBtn = (entity: Entity, item: Record<string, unknown>, label: string) => <button onClick={() => setDraft({ entity, item, isNew: true })} style={{ ...btnGhost, padding: "6px 12px", display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5 }}><Plus size={14} />{label}</button>;
  const row = (key: string, main: string, sub: string, onEdit: () => void, onDelete: () => void) => (
    <div key={key} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderTop: `1px solid ${C.borderLight}` }}>
      <div style={{ minWidth: 0, flex: 1 }}><div style={{ ...sans, fontSize: 13.5, fontWeight: 650, color: C.text }}>{main}</div>{sub && <div style={{ ...sans, fontSize: 12, color: C.muted, overflowWrap: "anywhere" }}>{sub}</div>}</div>
      <button onClick={onEdit} aria-label={`Modifica ${main}`} style={iconBtn}><Pencil size={16} /></button>
      <button onClick={onDelete} aria-label={`Elimina ${main}`} style={iconBtn}><Trash2 size={16} /></button>
    </div>
  );

  return (
    <div style={{ display: "grid", gap: 14, maxWidth: 920 }}>
      <div><div style={{ ...font, fontSize: 18, fontWeight: 700, color: C.text }}>Configurazione portale fornitori</div><div style={{ ...sans, fontSize: 12, color: C.muted }}>Anagrafiche di supporto e parametri usati per creare i fornitori in SAP.</div></div>
      {noRec.length > 0 && <Notice kind="warn"><b>Parametri SAP incompleti.</b> Indica il conto di riconciliazione per: {noRec.map(([g, l]) => `${g} (${l})`).join(", ")}. Senza, il Finance non potrà registrare quei fornitori.</Notice>}

      <Card>
        <CardTitle icon={<Building2 size={16} />} action={addBtn("company", { code: "", name: "", sapCompanyCode: "", purchOrg: "" }, "Aggiungi")}>Società del gruppo</CardTitle>
        {cfg.companies.length === 0 && <div style={{ ...sans, fontSize: 13, color: C.muted }}>Nessuna società: aggiungine almeno una per poter invitare fornitori.</div>}
        {cfg.companies.map(c => row(c.code, `${c.name} (${c.code})`, `Società SAP ${c.sapCompanyCode || "—"} · Organizzazione acquisti ${c.purchOrg || "—"}`, () => setDraft({ entity: "company", item: { ...c }, isNew: false }), () => remove("company", c.code, c.name)))}
      </Card>

      <Card>
        <CardTitle icon={<FileText size={16} />} action={addBtn("industry", { code: "", name: "", buyerIds: [] }, "Aggiungi")}>Codici merceologici</CardTitle>
        <p style={{ ...sans, fontSize: 12.5, color: C.muted, margin: "-6px 0 6px", lineHeight: 1.5 }}>I Buyer assegnati a un codice vedono i fornitori di quella categoria. Il codice CT00 richiede il codice cliente.</p>
        {cfg.industryCodes.map(i => row(i.code, `${i.code} · ${i.name}`, i.buyerIds.length ? `Buyer: ${i.buyerIds.map(id => cfg.buyers.find(b => b.id === id)?.name ?? "—").join(", ")}` : "Nessun buyer assegnato", () => setDraft({ entity: "industry", item: { ...i }, isNew: false }), () => remove("industry", i.code, i.name)))}
      </Card>

      <Card>
        <CardTitle icon={<Wallet size={16} />} action={addBtn("payment_term", { code: "", label: "" }, "Aggiungi")}>Condizioni di pagamento</CardTitle>
        {cfg.paymentTerms.map(p => row(p.code, p.code, p.label, () => setDraft({ entity: "payment_term", item: { ...p }, isNew: false }), () => remove("payment_term", p.code, p.code)))}
      </Card>

      <Card>
        <CardTitle icon={<FileCheck2 size={16} />} action={<button onClick={() => setDocDraft({ type: { key: "", label: "", help: "", expires: false, multiple: false }, rules: [{ docType: "", scope: "all", value: "", level: "optional" }], isNew: true })} style={{ ...btnGhost, padding: "6px 12px", display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5 }}><Plus size={14} />Aggiungi</button>}>Documenti di qualifica</CardTitle>
        <p style={{ ...sans, fontSize: 12.5, color: C.muted, margin: "-6px 0 6px", lineHeight: 1.5 }}>Per ogni documento decidi a chi viene chiesto: a tutti i fornitori, a quelli di un paese o a quelli di un codice merceologico, come obbligatorio o facoltativo. Un documento senza regole non viene chiesto a nessuno.</p>
        {cfg.docTypes.map(t => row(t.key, t.label, `${t.expires ? "Con scadenza" : "Senza scadenza"}${t.multiple ? " · più file" : ""} — ${cfg.docRules.filter(r => r.docType === t.key).map(ruleText).join(" · ") || "non richiesto a nessuno"}`, () => setDocDraft({ type: { ...t }, rules: cfg.docRules.filter(r => r.docType === t.key), isNew: false }), () => removeDocType(t)))}
      </Card>

      <Card>
        <CardTitle icon={<Bell size={16} />}>Reminder di scadenza ai fornitori</CardTitle>
        {!cfg.emailConfigured && <Notice kind="warn"><b>Le email non partono ancora.</b> Per inviare i reminder serve un provider email: imposta <code>RESEND_API_KEY</code> e <code>MAIL_FROM</code> su Vercel. Intanto i messaggi vengono solo registrati.</Notice>}
        <p style={{ ...sans, fontSize: 12.5, color: C.muted, margin: "-6px 0 12px", lineHeight: 1.55 }}>Ogni mattina il sistema controlla le scadenze e scrive ai fornitori una sola email con i documenti da aggiornare. Se un fornitore non risponde, il Buyer riceve un avviso e lo vede in evidenza nella pagina Scadenze.</p>
        {pol && (<>
          <label style={{ ...sans, display: "flex", gap: 9, alignItems: "center", fontSize: 13.5, marginBottom: 12, cursor: "pointer" }}><input type="checkbox" checked={pol.enabled} onChange={e => setPol({ ...pol, enabled: e.target.checked })} style={{ accentColor: C.accent, width: 16, height: 16 }} />Invia i reminder automaticamente</label>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))", columnGap: 14 }}>
            <Field label="Giorni prima della scadenza" htmlFor="p-days"><input id="p-days" value={pol.days} onChange={e => setPol({ ...pol, days: e.target.value })} style={iStyle} placeholder="60, 30, 15" /><div style={{ ...sans, fontSize: 11.5, color: C.subtle, marginTop: 4 }}>Separati da virgola, fino a 6 valori</div></Field>
            <Field label="Ripeti se scaduto o mancante, ogni (giorni)" htmlFor="p-rep"><input id="p-rep" type="number" min={1} max={60} value={pol.repeatDays} onChange={e => setPol({ ...pol, repeatDays: e.target.value })} style={iStyle} /></Field>
            <Field label="“Non risponde” dopo (solleciti)" htmlFor="p-esc"><input id="p-esc" type="number" min={1} max={10} value={pol.escalateAfter} onChange={e => setPol({ ...pol, escalateAfter: e.target.value })} style={iStyle} /></Field>
          </div>
          <button onClick={savePolicy} disabled={polBusy} style={{ ...btnPrimary, padding: "10px 18px", display: "inline-flex", alignItems: "center", gap: 8 }}>{polBusy ? <Loader2 className="spin" size={16} /> : <Save size={16} />}Salva reminder</button>
        </>)}
      </Card>

      <Card>
        <CardTitle icon={<Sparkles size={16} />}>Controllo automatico dei documenti (AI)</CardTitle>
        {cfg.ai.configured
          ? <Notice kind="ok">Attivo (motore: <b>{cfg.ai.provider}</b>). Ogni documento caricato riceve un primo controllo: tipo, intestatario, partita IVA e scadenza. È un filtro: non approva e non rifiuta nulla.</Notice>
          : <Notice kind="info">Non attivo. Il controllo è predisposto: si attiva scegliendo il motore AI con le variabili <code>DOC_AI_PROVIDER</code> (es. <code>anthropic</code>) e la relativa chiave (<code>ANTHROPIC_API_KEY</code>) su Vercel. Prima di attivarlo verifica con l'azienda che i documenti possano essere inviati al servizio scelto.</Notice>}
      </Card>

      <Card>
        <CardTitle icon={<Inbox size={16} />}>RDA da SAP e task</CardTitle>
        <p style={{ ...sans, fontSize: 12.5, color: C.muted, margin: "-6px 0 12px", lineHeight: 1.55 }}>Ogni RDA aperta in SAP diventa un task, assegnato al buyer del suo gruppo di acquisto. Il task si chiude da solo quando la RDA diventa un ordine (PO). I gruppi compaiono qui dopo il primo import dei file di SAP, dalla pagina Task.</p>
        <Field label="Giorni per lavorare una RDA (scadenza = data di rilascio + giorni)" htmlFor="r-sla">
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <input id="r-sla" type="number" min={1} max={90} value={sla} onChange={e => setSla(e.target.value)} style={{ ...iStyle, width: 110 }} />
            <button onClick={saveSla} style={{ ...btnGhost, padding: "9px 14px", fontSize: 13 }}>Salva</button>
          </div>
        </Field>
        <Field label="Soglia per il confronto con un altro fornitore (importo della RDA)" htmlFor="r-th">
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <input id="r-th" type="number" min={0} step={500} value={threshold} onChange={e => setThreshold(e.target.value)} style={{ ...iStyle, width: 140 }} />
            <button onClick={saveThreshold} style={{ ...btnGhost, padding: "9px 14px", fontSize: 13 }}>Salva</button>
          </div>
          <div style={{ ...sans, fontSize: 12, color: C.subtle, marginTop: 6, lineHeight: 1.5 }}>Sopra soglia la RDA si chiude solo con almeno un'offerta alternativa, oppure se la fornitura è strategica o single source, o con un'eccezione approvata dal Manager.</div>
        </Field>
        <div style={{ ...sans, fontSize: 12, fontWeight: 650, color: C.muted, margin: "4px 0 8px" }}>Buyer per gruppo di acquisto</div>
        {cfg.rda.groups.length === 0 ? <div style={{ ...sans, fontSize: 13, color: C.subtle, marginBottom: 12 }}>Nessun gruppo ancora: importa l'elenco delle RDA dalla pagina Task.</div> : cfg.rda.groups.map(g => (
          <div key={g.pgr} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderTop: `1px solid ${C.borderLight}`, flexWrap: "wrap" }}>
            <div style={{ ...sans, flex: "0 0 70px", fontWeight: 700, color: C.text }}>{g.pgr}</div>
            <select aria-label={`Buyer del gruppo ${g.pgr}`} value={g.userId ?? ""} onChange={e => saveGroup(g.pgr, e.target.value)} style={{ ...iStyle, width: "auto", flex: "1 1 200px", maxWidth: 320 }}>
              <option value="">Nessun buyer (da assegnare)</option>{cfg.buyers.filter(b => b.active).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <div style={{ ...sans, fontSize: 12.5, color: C.muted }}>{g.openTasks} RDA aperte</div>
          </div>
        ))}
        <div style={{ ...sans, fontSize: 12.5, color: C.muted, margin: "14px 0 0", lineHeight: 1.6 }}>
          <b>Importazione automatica:</b> {cfg.rda.ingestConfigured
            ? <>attiva. Una regola sulla casella che riceve le mail di SAP può inviare ogni allegato a <code>/api/portal?op=rda-ingest</code> (POST, corpo = file, intestazione <code>Authorization: Bearer …</code> e <code>x-file-name</code>).</>
            : <>non attiva. Per collegarla alle mail di SAP imposta la variabile <code>RDA_INGEST_SECRET</code> su Vercel; nel frattempo i file si caricano a mano dalla pagina Task.</>}
        </div>
        {cfg.rda.lastImports.length > 0 && <div style={{ ...sans, fontSize: 12, color: C.subtle, marginTop: 10 }}>Ultimi import: {cfg.rda.lastImports.map(i => `${i.kind === "pr" ? "RDA" : "Ordini"} ${new Date(i.at).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" })} (${i.by})`).join(" · ")}</div>}
      </Card>

      <Card>
        <CardTitle icon={<Settings size={16} />}>Parametri SAP</CardTitle>
        <p style={{ ...sans, fontSize: 12.5, color: C.muted, margin: "-6px 0 12px", lineHeight: 1.55 }}>Valori fissi inviati a SAP in fase di creazione. I conti di riconciliazione dipendono dal gruppo conti e vanno confermati con il Finance.</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 200px), 1fr))", columnGap: 14 }}>
          {([["tradingPartner", "Trading partner"], ["sortKey", "Chiave di ordinamento"], ["cashManagementGroup", "Gruppo cash management"], ["releaseGroup", "Gruppo di rilascio"]] as const).map(([k, l]) => (
            <Field key={k} label={l} htmlFor={`s-${k}`}><input id={`s-${k}`} value={sap[k]} onChange={e => setSap({ ...sap, [k]: e.target.value })} style={iStyle} /></Field>
          ))}
        </div>
        <div style={{ ...sans, fontSize: 12, fontWeight: 650, color: C.muted, margin: "4px 0 8px" }}>Conto di riconciliazione per gruppo conti</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 200px), 1fr))", columnGap: 14 }}>
          {GROUPS.map(([g, l]) => (
            <Field key={g} label={`${g} · ${l}`} htmlFor={`rec-${g}`}><input id={`rec-${g}`} value={sap.reconciliationAccounts[g] ?? ""} onChange={e => setSap({ ...sap, reconciliationAccounts: { ...sap.reconciliationAccounts, [g]: e.target.value } })} style={iStyle} placeholder="es. 2010000" /></Field>
          ))}
        </div>
        <button onClick={saveSap} disabled={busy} style={{ ...btnPrimary, padding: "10px 18px", display: "inline-flex", alignItems: "center", gap: 8 }}>{busy ? <Loader2 className="spin" size={16} /> : <Save size={16} />}Salva parametri SAP</button>
      </Card>

      <PrivacyCard cfg={cfg} fail={fail} notify={notify} onSaved={adopt} />
      <AuditCard cfg={cfg} fail={fail} />

      {docDraft && <Portal><DocTypeDialog draft={docDraft} cfg={cfg} fail={fail} onClose={() => setDocDraft(null)} onSaved={c => { adopt(c); setDocDraft(null); notify("Salvato"); }} /></Portal>}
      {draft && <Portal><ItemDialog draft={draft} cfg={cfg} fail={fail} onClose={() => setDraft(null)} onSaved={c => { adopt(c); setDraft(null); notify("Salvato"); }} /></Portal>}
    </div>
  );
}

function ItemDialog({ draft, cfg, fail, onClose, onSaved }: { draft: Draft; cfg: PortalConfig; fail: (e: unknown) => string; onClose: () => void; onSaved: (c: PortalConfig) => void }) {
  const [item, setItem] = useState(draft.item); const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const set = (k: string, v: unknown) => setItem(x => ({ ...x, [k]: v }));
  const str = (k: string) => String(item[k] ?? "");
  const submit = async (e: React.FormEvent) => { e.preventDefault(); setBusy(true); setError(null); try { onSaved(await portalApi.saveConfig(draft.entity, "save", item)); } catch (err) { setError(fail(err)); setBusy(false); } };
  const buyerIds = (item.buyerIds as number[] | undefined) ?? [];
  const title = { company: "Società", industry: "Codice merceologico", payment_term: "Condizione di pagamento" }[draft.entity];
  return (
    <div className="dialog-overlay" role="dialog" aria-modal="true">
      <form className="dialog" onSubmit={submit}>
        <h3 style={{ ...font, margin: "0 0 14px", fontSize: 17 }}>{draft.isNew ? "Nuovo" : "Modifica"}: {title}</h3>
        <Field label="Codice" req htmlFor="c-code"><input id="c-code" required disabled={!draft.isNew} value={str("code")} onChange={e => set("code", e.target.value)} style={{ ...iStyle, ...(draft.isNew ? {} : { background: C.bg }) }} maxLength={20} /></Field>
        {draft.entity === "payment_term" ? (
          <Field label="Descrizione" req htmlFor="c-label"><input id="c-label" required value={str("label")} onChange={e => set("label", e.target.value)} style={iStyle} /></Field>
        ) : (
          <Field label="Nome" req htmlFor="c-name"><input id="c-name" required value={str("name")} onChange={e => set("name", e.target.value)} style={iStyle} /></Field>
        )}
        {draft.entity === "company" && (<>
          <Field label="Codice società SAP" htmlFor="c-sap"><input id="c-sap" value={str("sapCompanyCode")} onChange={e => set("sapCompanyCode", e.target.value)} style={iStyle} /></Field>
          <Field label="Organizzazione acquisti" htmlFor="c-po"><input id="c-po" value={str("purchOrg")} onChange={e => set("purchOrg", e.target.value)} style={iStyle} /></Field>
        </>)}
        {draft.entity === "industry" && (
          <Field label="Buyer assegnati">
            <div style={{ display: "grid", gap: 6 }}>
              {cfg.buyers.filter(b => b.active).map(b => <label key={b.id} style={{ ...sans, display: "flex", gap: 8, alignItems: "center", fontSize: 13.5, cursor: "pointer" }}><input type="checkbox" checked={buyerIds.includes(b.id)} onChange={() => set("buyerIds", buyerIds.includes(b.id) ? buyerIds.filter(x => x !== b.id) : [...buyerIds, b.id])} style={{ accentColor: C.accent, width: 16, height: 16 }} />{b.name}</label>)}
            </div>
          </Field>
        )}
        {error && <Notice kind="error">{error}</Notice>}
        <div style={{ display: "flex", gap: 10 }}>
          <button type="button" onClick={onClose} style={{ ...btnGhost, flex: 1 }}>Annulla</button>
          <button type="submit" disabled={busy} style={{ ...btnPrimary, flex: 2, opacity: busy ? 0.7 : 1 }}>Salva</button>
        </div>
      </form>
    </div>
  );
}

const policyToForm = (p: ReminderPolicy) => ({ enabled: p.enabled, days: p.days.join(", "), repeatDays: String(p.repeatDays), escalateAfter: String(p.escalateAfter) });
const slug = (t: string) => t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);

function DocTypeDialog({ draft, cfg, fail, onClose, onSaved }: { draft: { type: DocTypeDef; rules: DocRule[]; isNew: boolean }; cfg: PortalConfig; fail: (e: unknown) => string; onClose: () => void; onSaved: (c: PortalConfig) => void }) {
  const [t, setT] = useState(draft.type); const [rules, setRules] = useState(draft.rules); const [keyTouched, setKeyTouched] = useState(false);
  const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const setRule = (i: number, patch: Partial<DocRule>) => setRules(rs => rs.map((r, k) => k === i ? { ...r, ...patch, ...(patch.scope && patch.scope !== r.scope ? { value: "" } : {}) } : r));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    try { onSaved(await portalApi.saveConfig("doc_type", "save", { ...t, rules })); } catch (err) { setError(fail(err)); setBusy(false); }
  };
  return (
    <div className="dialog-overlay" role="dialog" aria-modal="true">
      <form className="dialog" onSubmit={submit} style={{ maxWidth: 560 }}>
        <h3 style={{ ...font, margin: "0 0 14px", fontSize: 17 }}>{draft.isNew ? "Nuovo documento" : "Modifica documento"}</h3>
        <Field label="Nome" req htmlFor="d-label"><input id="d-label" required value={t.label} onChange={e => setT({ ...t, label: e.target.value, key: draft.isNew && !keyTouched ? slug(e.target.value) : t.key })} style={iStyle} /></Field>
        <Field label="Codice interno" req htmlFor="d-key"><input id="d-key" required disabled={!draft.isNew} value={t.key} onChange={e => { setKeyTouched(true); setT({ ...t, key: e.target.value }); }} style={{ ...iStyle, ...(draft.isNew ? {} : { background: C.bg }) }} maxLength={40} /></Field>
        <Field label="Istruzioni per il fornitore" htmlFor="d-help"><textarea id="d-help" value={t.help} onChange={e => setT({ ...t, help: e.target.value })} style={{ ...iStyle, height: 64, resize: "vertical" }} /></Field>
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap", marginBottom: 14 }}>
          <label style={{ ...sans, display: "flex", gap: 8, alignItems: "center", fontSize: 13.5, cursor: "pointer" }}><input type="checkbox" checked={t.expires} onChange={e => setT({ ...t, expires: e.target.checked })} style={{ accentColor: C.accent, width: 16, height: 16 }} />Ha una scadenza</label>
          <label style={{ ...sans, display: "flex", gap: 8, alignItems: "center", fontSize: 13.5, cursor: "pointer" }}><input type="checkbox" checked={t.multiple} onChange={e => setT({ ...t, multiple: e.target.checked })} style={{ accentColor: C.accent, width: 16, height: 16 }} />Si possono caricare più file</label>
        </div>
        <div style={{ ...sans, fontSize: 12, fontWeight: 650, color: C.muted, marginBottom: 6 }}>A chi viene chiesto</div>
        {rules.length === 0 && <div style={{ ...sans, fontSize: 12.5, color: C.subtle, marginBottom: 8 }}>Nessuna regola: il documento non viene chiesto a nessuno.</div>}
        {rules.map((r, i) => (
          <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap", alignItems: "center" }}>
            <select aria-label="Chi" value={r.scope} onChange={e => setRule(i, { scope: e.target.value as DocRule["scope"] })} style={{ ...iStyle, width: "auto", flex: "1 1 150px" }}>
              <option value="all">Tutti i fornitori</option><option value="country">Fornitori di un paese</option><option value="industry">Codice merceologico</option>
            </select>
            {r.scope === "country" && <select aria-label="Paese" required value={r.value} onChange={e => setRule(i, { value: e.target.value })} style={{ ...iStyle, width: "auto", flex: "1 1 150px" }}><option value="">Paese…</option>{COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}</select>}
            {r.scope === "industry" && <select aria-label="Codice merceologico" required value={r.value} onChange={e => setRule(i, { value: e.target.value })} style={{ ...iStyle, width: "auto", flex: "1 1 150px" }}><option value="">Codice…</option>{cfg.industryCodes.map(c => <option key={c.code} value={c.code}>{c.code} · {c.name}</option>)}</select>}
            <select aria-label="Livello" value={r.level} onChange={e => setRule(i, { level: e.target.value as DocRule["level"] })} style={{ ...iStyle, width: "auto", flex: "0 1 140px" }}><option value="required">Obbligatorio</option><option value="optional">Facoltativo</option></select>
            <button type="button" onClick={() => setRules(rs => rs.filter((_, k) => k !== i))} aria-label="Rimuovi regola" style={{ background: "none", border: "none", cursor: "pointer", color: C.subtle, padding: 6, display: "flex" }}><X size={16} /></button>
          </div>
        ))}
        <button type="button" onClick={() => setRules(rs => [...rs, { docType: t.key, scope: "industry", value: "", level: "required" }])} style={{ ...btnGhost, padding: "6px 12px", fontSize: 12.5, display: "inline-flex", alignItems: "center", gap: 6, marginBottom: 14 }}><Plus size={14} />Aggiungi regola</button>
        <div style={{ ...sans, fontSize: 11.5, color: C.subtle, marginBottom: 14, lineHeight: 1.5 }}>Se un fornitore rientra in più regole, il documento è obbligatorio quando almeno una lo è.</div>
        {error && <Notice kind="error">{error}</Notice>}
        <div style={{ display: "flex", gap: 10 }}>
          <button type="button" onClick={onClose} style={{ ...btnGhost, flex: 1 }}>Annulla</button>
          <button type="submit" disabled={busy} style={{ ...btnPrimary, flex: 2, opacity: busy ? 0.7 : 1 }}>Salva</button>
        </div>
      </form>
    </div>
  );
}

/** Informativa privacy mostrata ai fornitori e tempi di conservazione dei dati. */
function PrivacyCard({ cfg, fail, notify, onSaved }: { cfg: PortalConfig; fail: (e: unknown) => string; notify: (m: string) => void; onSaved: (c: PortalConfig) => void }) {
  const [form, setForm] = useState({ notice: cfg.privacy.notice, inviteDays: String(cfg.privacy.inviteDays), retentionMonths: String(cfg.privacy.retentionMonths) });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { onSaved(await portalApi.saveConfig("privacy", "save", { notice: form.notice, inviteDays: Number(form.inviteDays), retentionMonths: Number(form.retentionMonths) })); notify("Impostazioni privacy salvate"); }
    catch (err) { notify(`⚠️ ${fail(err)}`); }
    setBusy(false);
  };
  return (
    <Card>
      <CardTitle icon={<Lock size={16} />}>Privacy</CardTitle>
      <p style={{ ...sans, fontSize: 12.5, color: C.muted, margin: "-6px 0 12px", lineHeight: 1.55 }}>Il fornitore vede l'informativa all'invito e la accetta prima di inviare la registrazione. Ogni notte gli inviti mai attivati vengono eliminati e i fornitori non più attivi (disattivati, esclusi, rifiutati o mai completati) vengono anonimizzati dopo il periodo di conservazione.</p>
      <Field label="Testo dell'informativa privacy" htmlFor="p-notice"><textarea id="p-notice" rows={4} value={form.notice} onChange={e => setForm({ ...form, notice: e.target.value })} style={{ ...iStyle, resize: "vertical" }} /></Field>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))", columnGap: 14 }}>
        <Field label="Elimina gli inviti non attivati dopo (giorni)" htmlFor="p-inv"><input id="p-inv" type="number" min={7} max={730} value={form.inviteDays} onChange={e => setForm({ ...form, inviteDays: e.target.value })} style={iStyle} /></Field>
        <Field label="Anonimizza i fornitori non attivi dopo (mesi)" htmlFor="p-ret"><input id="p-ret" type="number" min={1} max={240} value={form.retentionMonths} onChange={e => setForm({ ...form, retentionMonths: e.target.value })} style={iStyle} /></Field>
      </div>
      <button onClick={save} disabled={busy} style={{ ...btnPrimary, padding: "10px 18px", display: "inline-flex", alignItems: "center", gap: 8 }}>{busy ? <Loader2 className="spin" size={16} /> : <Save size={16} />}Salva</button>
    </Card>
  );
}

/** Registro delle modifiche alle regole: chi ha cambiato cosa e quando. */
function AuditCard({ cfg, fail }: { cfg: PortalConfig; fail: (e: unknown) => string }) {
  const [entries, setEntries] = useState<ConfigAuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  // Si ricarica a ogni salvataggio della configurazione (nuovo oggetto cfg).
  useEffect(() => { let off = false; portalApi.configAudit().then(e => { if (!off) { setEntries(e); setError(null); } }).catch(err => { if (!off) setError(fail(err)); }); return () => { off = true; }; }, [cfg, fail]);
  const shown = (entries ?? []).slice(0, all ? 200 : 12);
  return (
    <Card>
      <CardTitle icon={<History size={16} />}>Registro modifiche alle regole</CardTitle>
      {error && <Notice kind="error">{error}</Notice>}
      {entries && entries.length === 0 && <div style={{ ...sans, fontSize: 13, color: C.subtle }}>Nessuna modifica registrata.</div>}
      {shown.map(e => (
        <div key={e.id} style={{ ...sans, display: "flex", gap: 12, padding: "8px 0", borderTop: `1px solid ${C.borderLight}`, fontSize: 13, flexWrap: "wrap" }}>
          <div style={{ width: 120, flexShrink: 0, color: C.subtle, fontSize: 12 }} className="tabular">{new Date(e.at).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" })}</div>
          <div style={{ flex: "1 1 260px", minWidth: 0 }}>
            <div><b>{e.areaLabel}</b>{e.subject ? ` · ${e.subject}` : ""} <span style={{ color: C.subtle }}>— {e.actor}</span></div>
            <div style={{ color: C.muted, fontSize: 12.5, overflowWrap: "anywhere" }}>{e.detail}</div>
          </div>
        </div>
      ))}
      {entries && entries.length > 12 && <button onClick={() => setAll(v => !v)} style={{ ...btnGhost, marginTop: 8, padding: "7px 12px", fontSize: 12.5 }}>{all ? "Mostra meno" : `Mostra tutte (${entries.length})`}</button>}
    </Card>
  );
}
