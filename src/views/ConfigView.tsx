import { useCallback, useEffect, useState } from "react";
import type { PortalConfig, SapSettings } from "../types.ts";
import { ApiError, portalApi } from "../api.ts";
import { btnGhost, btnPrimary, C, font, iStyle, sans } from "../theme.ts";
import { Card, CardTitle, EmptyState, Field } from "../components/ui.tsx";
import { AlertTriangle, Building2, Loader2, Pencil, Plus, Save, Settings, Trash2, Wallet, FileText } from "../components/icons.tsx";
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

  const fail = useCallback((err: unknown) => {
    if (err instanceof ApiError && err.status === 401) { onSessionExpired(); return "Sessione scaduta"; }
    return err instanceof Error ? err.message : "Operazione non riuscita";
  }, [onSessionExpired]);
  const adopt = (c: PortalConfig) => { setCfg(c); setSap(c.sap); };
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
