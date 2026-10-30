import { useCallback, useEffect, useState } from "react";
import type { ConfigAuditEntry, DocRule, DocTypeDef, PortalConfig, ReminderPolicy, SapSettings } from "../types.ts";
import { COUNTRIES, countryName } from "../supplierRules.ts";
import { ApiError, portalApi } from "../api.ts";
import { btnGhost, btnPrimary, C, font, iStyle, sans } from "../theme.ts";
import { Card, CardTitle, EmptyState, Field } from "../components/ui.tsx";
import {
  AlertTriangle,
  Bell,
  Building2,
  History,
  Lock,
  RotateCcw,
  ShieldCheck,
  Inbox,
  FileCheck2,
  Loader2,
  Pencil,
  Plus,
  Save,
  Settings,
  Sparkles,
  Trash2,
  Wallet,
  FileText,
  X,
  ShieldAlert,
  ChevronDown,
} from "../components/icons.tsx";
import { Notice, Portal } from "../components/vendorUi.tsx";
import { CategoriesCard } from "./CategoriesCard.tsx";
import { ReviewRulesCard } from "./ReviewRulesCard.tsx";
import { SecurityCard } from "./SecurityCard.tsx";
import { ResetCard } from "./ResetCard.tsx";
import { TestAccessCard } from "./TestAccessCard.tsx";
import { BoSettingsCard } from "./BoSettingsCard.tsx";
import { locale, t } from "../i18n/index.ts";

type Entity = "company" | "industry" | "payment_term";
type Draft = { entity: Entity; item: Record<string, unknown>; isNew: boolean };
const GROUPS: [string, string][] = [
  ["ITD1", "Italia, senza ritenuta"],
  ["ITW1", "Italia, con ritenuta"],
  ["ITF3", "Estero"],
  ["BRD6", "Brasile"],
];

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
  const [lead, setLead] = useState("90");

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
  const adopt = (c: PortalConfig) => {
    setCfg(c);
    setSap(c.sap);
    setPol(policyToForm(c.reminders));
    setSla(String(c.rda.slaDays));
    setThreshold(String(c.rda.sourcingThreshold));
    setLead(String(c.rda.renewalLeadDays));
  };
  useEffect(() => {
    portalApi
      .config()
      .then(adopt)
      .catch(err => setError(fail(err)));
  }, [fail]);

  if (error) return <EmptyState icon={<AlertTriangle size={26} />} title={t("Impossibile caricare la configurazione")} text={error} />;
  if (!cfg || !sap)
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: 60 }}>
        <Loader2 className="spin" size={26} color={C.subtle} />
      </div>
    );

  const remove = async (entity: Entity, code: string, label: string) => {
    if (!window.confirm(t('Eliminare "{label}"?', { label }))) return;
    try {
      adopt(await portalApi.saveConfig(entity, "delete", { code }));
      notify(t("Elemento eliminato"));
    } catch (err) {
      notify(`⚠️ ${fail(err)}`);
    }
  };
  const saveSap = async () => {
    setBusy(true);
    try {
      adopt(await portalApi.saveConfig("sap", "save", sap));
      notify(t("Parametri SAP salvati"));
    } catch (err) {
      notify(`⚠️ ${fail(err)}`);
    }
    setBusy(false);
  };
  const savePolicy = async () => {
    if (!pol) return;
    setPolBusy(true);
    try {
      adopt(
        await portalApi.saveConfig("reminders", "save", {
          enabled: pol.enabled,
          days: pol.days
            .split(/[,\s;]+/)
            .filter(Boolean)
            .map(Number),
          repeatDays: Number(pol.repeatDays),
          escalateAfter: Number(pol.escalateAfter),
        }),
      );
      notify(t("Reminder salvati"));
    } catch (err) {
      notify(`⚠️ ${fail(err)}`);
    }
    setPolBusy(false);
  };
  const saveLead = async () => {
    try {
      adopt(await portalApi.saveConfig("rda", "save", { renewalLeadDays: Number(lead) }));
      notify(t("Anticipo dei rinnovi salvato"));
    } catch (err) {
      notify(`⚠️ ${fail(err)}`);
    }
  };
  const saveThreshold = async () => {
    try {
      adopt(await portalApi.saveConfig("rda", "save", { sourcingThreshold: Number(threshold) }));
      notify(t("Soglia salvata"));
    } catch (err) {
      notify(`⚠️ ${fail(err)}`);
    }
  };
  const saveSla = async () => {
    try {
      adopt(await portalApi.saveConfig("rda", "save", { slaDays: Number(sla) }));
      notify(t("Giorni di lavorazione salvati"));
    } catch (err) {
      notify(`⚠️ ${fail(err)}`);
    }
  };
  const saveGroup = async (pgr: string, userId: string) => {
    try {
      adopt(await portalApi.saveConfig("pgr", "save", { pgr, userId: userId ? Number(userId) : null }));
      notify(t("Assegnazione salvata"));
    } catch (err) {
      notify(`⚠️ ${fail(err)}`);
    }
  };
  const removeDocType = async (d: DocTypeDef) => {
    if (!window.confirm(t('Eliminare il documento "{name}"?', { name: d.label }))) return;
    try {
      adopt(await portalApi.saveConfig("doc_type", "delete", { key: d.key }));
      notify(t("Documento eliminato"));
    } catch (err) {
      notify(`⚠️ ${fail(err)}`);
    }
  };
  const ruleText = (r: DocRule) =>
    `${r.scope === "all" ? t("Tutti") : r.scope === "country" ? countryName(r.value) : t("Codice {code}", { code: r.value })}: ${r.level === "required" ? t("obbligatorio") : t("facoltativo")}`;
  const noRec = GROUPS.filter(([g]) => !sap.reconciliationAccounts[g]?.trim());

  const iconBtn = { background: "none", border: "none", cursor: "pointer", padding: 6, color: C.subtle, display: "flex" } as const;
  const addBtn = (entity: Entity, item: Record<string, unknown>, label: string) => (
    <button
      onClick={() => setDraft({ entity, item, isNew: true })}
      style={{ ...btnGhost, padding: "6px 12px", display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5 }}
    >
      <Plus size={14} />
      {label}
    </button>
  );
  const row = (key: string, main: string, sub: string, onEdit: () => void, onDelete: () => void) => (
    <div key={key} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderTop: `1px solid ${C.borderLight}` }}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ ...sans, fontSize: 13.5, fontWeight: 650, color: C.text }}>{main}</div>
        {sub && <div style={{ ...sans, fontSize: 12, color: C.muted, overflowWrap: "anywhere" }}>{sub}</div>}
      </div>
      <button onClick={onEdit} aria-label={t("Modifica {name}", { name: main })} style={iconBtn}>
        <Pencil size={16} />
      </button>
      <button onClick={onDelete} aria-label={t("Elimina {name}", { name: main })} style={iconBtn}>
        <Trash2 size={16} />
      </button>
    </div>
  );

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 14, maxWidth: 920 }}>
      <div>
        <div style={{ ...font, fontSize: 18, fontWeight: 700, color: C.text }}>{t("Configurazione portale fornitori")}</div>
        <div style={{ ...sans, fontSize: 12, color: C.muted }}>
          {t("Anagrafiche di supporto e parametri usati per creare i fornitori in SAP.")}
        </div>
      </div>
      {noRec.length > 0 && (
        <Notice kind="warn">
          <b>{t("Parametri SAP incompleti.")}</b>{" "}
          {t("Indica il conto di riconciliazione per: {groups}. Senza, il Finance non potrà registrare quei fornitori.", {
            groups: noRec.map(([g, l]) => `${g} (${t(l)})`).join(", "),
          })}
        </Notice>
      )}

      <ConfigGroup
        id="suppliers"
        icon={<Building2 size={18} />}
        title={t("Anagrafiche per i fornitori")}
        sub={t("Società del gruppo, codici merceologici, condizioni di pagamento, documenti di qualifica")}
      >
        <Card>
          <CardTitle
            icon={<Building2 size={16} />}
            action={addBtn("company", { code: "", name: "", sapCompanyCode: "", purchOrg: "" }, t("Aggiungi"))}
          >
            {t("Società del gruppo")}
          </CardTitle>
          {cfg.companies.length === 0 && (
            <div style={{ ...sans, fontSize: 13, color: C.muted }}>
              {t("Nessuna società: aggiungine almeno una per poter invitare fornitori.")}
            </div>
          )}
          {cfg.companies.map(c =>
            row(
              c.code,
              `${c.name} (${c.code})`,
              t("Società SAP {sap} · Organizzazione acquisti {org}", { sap: c.sapCompanyCode || "—", org: c.purchOrg || "—" }),
              () => setDraft({ entity: "company", item: { ...c }, isNew: false }),
              () => remove("company", c.code, c.name),
            ),
          )}
        </Card>

        <Card>
          <CardTitle icon={<FileText size={16} />} action={addBtn("industry", { code: "", name: "", buyerIds: [] }, t("Aggiungi"))}>
            {t("Codici merceologici")}
          </CardTitle>
          <p style={{ ...sans, fontSize: 12.5, color: C.muted, margin: "-6px 0 6px", lineHeight: 1.5 }}>
            {t("I Buyer assegnati a un codice vedono i fornitori di quella categoria. Il codice CT00 richiede il codice cliente.")}
          </p>
          {cfg.industryCodes.map(i =>
            row(
              i.code,
              `${i.code} · ${i.name}`,
              i.buyerIds.length
                ? t("Buyer: {names}", { names: i.buyerIds.map(id => cfg.buyers.find(b => b.id === id)?.name ?? "—").join(", ") })
                : t("Nessun buyer assegnato"),
              () => setDraft({ entity: "industry", item: { ...i }, isNew: false }),
              () => remove("industry", i.code, i.name),
            ),
          )}
        </Card>

        <Card>
          <CardTitle icon={<Wallet size={16} />} action={addBtn("payment_term", { code: "", label: "" }, t("Aggiungi"))}>
            {t("Condizioni di pagamento")}
          </CardTitle>
          {cfg.paymentTerms.map(p =>
            row(
              p.code,
              p.code,
              p.label,
              () => setDraft({ entity: "payment_term", item: { ...p }, isNew: false }),
              () => remove("payment_term", p.code, p.code),
            ),
          )}
        </Card>

        <Card>
          <CardTitle
            icon={<FileCheck2 size={16} />}
            action={
              <button
                onClick={() =>
                  setDocDraft({
                    type: { key: "", label: "", help: "", expires: false, multiple: false },
                    rules: [{ docType: "", scope: "all", value: "", level: "optional" }],
                    isNew: true,
                  })
                }
                style={{ ...btnGhost, padding: "6px 12px", display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5 }}
              >
                <Plus size={14} />
                {t("Aggiungi")}
              </button>
            }
          >
            {t("Documenti di qualifica")}
          </CardTitle>
          <p style={{ ...sans, fontSize: 12.5, color: C.muted, margin: "-6px 0 6px", lineHeight: 1.5 }}>
            {t(
              "Per ogni documento decidi a chi viene chiesto: a tutti i fornitori, a quelli di un paese o a quelli di un codice merceologico, come obbligatorio o facoltativo. Un documento senza regole non viene chiesto a nessuno.",
            )}
          </p>
          {cfg.docTypes.map(d =>
            row(
              d.key,
              d.label,
              `${d.expires ? t("Con scadenza") : t("Senza scadenza")}${d.multiple ? ` · ${t("più file")}` : ""} — ${
                cfg.docRules
                  .filter(r => r.docType === d.key)
                  .map(ruleText)
                  .join(" · ") || t("non richiesto a nessuno")
              }`,
              () => setDocDraft({ type: { ...d }, rules: cfg.docRules.filter(r => r.docType === d.key), isNew: false }),
              () => removeDocType(d),
            ),
          )}
        </Card>
      </ConfigGroup>

      <ConfigGroup
        id="checks"
        icon={<ShieldAlert size={18} />}
        title={t("Controlli e solleciti ai fornitori")}
        sub={t("Reminder dei documenti, controllo AI, liste sanzioni, verifica periodica del rischio")}
      >
        <Card>
          <CardTitle icon={<Bell size={16} />}>{t("Reminder di scadenza ai fornitori")}</CardTitle>
          {!cfg.emailConfigured && (
            <Notice kind="warn">
              <b>{t("Le email non partono ancora.")}</b> {t("Per inviare i reminder serve un provider email: imposta")}{" "}
              <code>RESEND_API_KEY</code> {t("e")} <code>MAIL_FROM</code> {t("su Vercel. Intanto i messaggi vengono solo registrati.")}
            </Notice>
          )}
          <p style={{ ...sans, fontSize: 12.5, color: C.muted, margin: "-6px 0 12px", lineHeight: 1.55 }}>
            {t(
              "Ogni mattina il sistema controlla le scadenze e scrive ai fornitori una sola email con i documenti da aggiornare. Se un fornitore non risponde, il Buyer riceve un avviso e lo vede in evidenza nella pagina Scadenze.",
            )}
          </p>
          {pol && (
            <>
              <label
                style={{ ...sans, display: "flex", gap: 9, alignItems: "center", fontSize: 13.5, marginBottom: 12, cursor: "pointer" }}
              >
                <input
                  type="checkbox"
                  checked={pol.enabled}
                  onChange={e => setPol({ ...pol, enabled: e.target.checked })}
                  style={{ accentColor: C.accent, width: 16, height: 16 }}
                />
                {t("Invia i reminder automaticamente")}
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))", columnGap: 14 }}>
                <Field label={t("Giorni prima della scadenza")} htmlFor="p-days">
                  <input
                    id="p-days"
                    value={pol.days}
                    onChange={e => setPol({ ...pol, days: e.target.value })}
                    style={iStyle}
                    placeholder="60, 30, 15"
                  />
                  <div style={{ ...sans, fontSize: 11.5, color: C.subtle, marginTop: 4 }}>{t("Separati da virgola, fino a 6 valori")}</div>
                </Field>
                <Field label={t("Ripeti se scaduto o mancante, ogni (giorni)")} htmlFor="p-rep">
                  <input
                    id="p-rep"
                    type="number"
                    min={1}
                    max={60}
                    value={pol.repeatDays}
                    onChange={e => setPol({ ...pol, repeatDays: e.target.value })}
                    style={iStyle}
                  />
                </Field>
                <Field label={t("“Non risponde” dopo (solleciti)")} htmlFor="p-esc">
                  <input
                    id="p-esc"
                    type="number"
                    min={1}
                    max={10}
                    value={pol.escalateAfter}
                    onChange={e => setPol({ ...pol, escalateAfter: e.target.value })}
                    style={iStyle}
                  />
                </Field>
              </div>
              <button
                onClick={savePolicy}
                disabled={polBusy}
                style={{ ...btnPrimary, padding: "10px 18px", display: "inline-flex", alignItems: "center", gap: 8 }}
              >
                {polBusy ? <Loader2 className="spin" size={16} /> : <Save size={16} />}
                {t("Salva reminder")}
              </button>
            </>
          )}
        </Card>

        <Card>
          <CardTitle icon={<Sparkles size={16} />}>{t("Controllo automatico dei documenti (AI)")}</CardTitle>
          {cfg.ai.configured ? (
            <Notice kind="ok">
              {t("Attivo")} ({t("motore")}: <b>{cfg.ai.provider}</b>).{" "}
              {t(
                "Ogni documento caricato riceve un primo controllo: tipo, intestatario, partita IVA e scadenza. È un filtro: non approva e non rifiuta nulla.",
              )}
            </Notice>
          ) : (
            <Notice kind="info">
              {t("Non attivo. Il controllo è predisposto: si attiva scegliendo il motore AI con le variabili")} <code>DOC_AI_PROVIDER</code>{" "}
              ({t("es.")} <code>anthropic</code>) {t("e la relativa chiave")} (<code>ANTHROPIC_API_KEY</code>){" "}
              {t("su Vercel. Prima di attivarlo verifica con l'azienda che i documenti possano essere inviati al servizio scelto.")}
            </Notice>
          )}
        </Card>

        <SanctionsCard cfg={cfg} fail={fail} notify={notify} onSaved={adopt} />
        <RiskCard cfg={cfg} fail={fail} notify={notify} onSaved={adopt} />
      </ConfigGroup>

      <ConfigGroup
        id="purchasing"
        icon={<Inbox size={18} />}
        title={t("Acquisti e task")}
        sub={t("RDA da SAP, soglie, buyer per gruppo, categorie, avvisi ai Business Owner")}
      >
        <Card>
          <CardTitle icon={<Inbox size={16} />}>{t("RDA da SAP e task")}</CardTitle>
          <p style={{ ...sans, fontSize: 12.5, color: C.muted, margin: "-6px 0 12px", lineHeight: 1.55 }}>
            {t(
              "Ogni RDA aperta in SAP diventa un task, assegnato al buyer del suo gruppo di acquisto. Il task si chiude da solo quando la RDA diventa un ordine (PO). I gruppi compaiono qui dopo il primo import dei file di SAP, dalla pagina Task.",
            )}
          </p>
          <Field label={t("Giorni per lavorare una RDA (scadenza = data di rilascio + giorni)")} htmlFor="r-sla">
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <input
                id="r-sla"
                type="number"
                min={1}
                max={90}
                value={sla}
                onChange={e => setSla(e.target.value)}
                style={{ ...iStyle, width: 110 }}
              />
              <button onClick={saveSla} style={{ ...btnGhost, padding: "9px 14px", fontSize: 13 }}>
                {t("Salva")}
              </button>
            </div>
          </Field>
          <Field label={t("Task di rinnovo: quanti giorni prima della disdetta (o della scadenza) crearlo")} htmlFor="r-lead">
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <input
                id="r-lead"
                type="number"
                min={15}
                max={365}
                value={lead}
                onChange={e => setLead(e.target.value)}
                style={{ ...iStyle, width: 110 }}
              />
              <button onClick={saveLead} style={{ ...btnGhost, padding: "9px 14px", fontSize: 13 }}>
                {t("Salva")}
              </button>
            </div>
            <div style={{ ...sans, fontSize: 12, color: C.subtle, marginTop: 6, lineHeight: 1.5 }}>
              {t("Il task nasce comunque al più tardi all'inizio del primo passaggio del piano di rinnovo (analisi spesa).")}
            </div>
          </Field>
          <Field label={t("Soglia per il confronto con un altro fornitore (importo della RDA o del nuovo contratto)")} htmlFor="r-th">
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <input
                id="r-th"
                type="number"
                min={0}
                step={500}
                value={threshold}
                onChange={e => setThreshold(e.target.value)}
                style={{ ...iStyle, width: 140 }}
              />
              <button onClick={saveThreshold} style={{ ...btnGhost, padding: "9px 14px", fontSize: 13 }}>
                {t("Salva")}
              </button>
            </div>
            <div style={{ ...sans, fontSize: 12, color: C.subtle, marginTop: 6, lineHeight: 1.5 }}>
              {t(
                "Sopra soglia la RDA si chiude solo con almeno un'offerta alternativa, oppure se la fornitura è strategica o single source, o con un'eccezione approvata dal Manager.",
              )}
            </div>
          </Field>
          <div style={{ ...sans, fontSize: 12, fontWeight: 650, color: C.muted, margin: "4px 0 8px" }}>
            {t("Buyer per gruppo di acquisto")}
          </div>
          {cfg.rda.groups.length === 0 ? (
            <div style={{ ...sans, fontSize: 13, color: C.subtle, marginBottom: 12 }}>
              {t("Nessun gruppo ancora: importa l'elenco delle RDA dalla pagina Task.")}
            </div>
          ) : (
            cfg.rda.groups.map(g => (
              <div
                key={g.pgr}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "8px 0",
                  borderTop: `1px solid ${C.borderLight}`,
                  flexWrap: "wrap",
                }}
              >
                <div style={{ ...sans, flex: "0 0 70px", fontWeight: 700, color: C.text }}>{g.pgr}</div>
                <select
                  aria-label={t("Buyer del gruppo {pgr}", { pgr: g.pgr })}
                  value={g.userId ?? ""}
                  onChange={e => saveGroup(g.pgr, e.target.value)}
                  style={{ ...iStyle, width: "auto", flex: "1 1 200px", maxWidth: 320 }}
                >
                  <option value="">{t("Nessun buyer (da assegnare)")}</option>
                  {cfg.buyers
                    .filter(b => b.active)
                    .map(b => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                </select>
                <div style={{ ...sans, fontSize: 12.5, color: C.muted }}>{t("{n} RDA aperte", { n: g.openTasks })}</div>
              </div>
            ))
          )}
          <div style={{ ...sans, fontSize: 12.5, color: C.muted, margin: "14px 0 0", lineHeight: 1.6 }}>
            <b>{t("Importazione automatica:")}</b>{" "}
            {cfg.rda.ingestConfigured ? (
              <>
                {t("attiva. Una regola sulla casella che riceve le mail di SAP può inviare ogni allegato a")}{" "}
                <code>/api/portal?op=rda-ingest</code> ({t("POST, corpo = file, intestazione")} <code>Authorization: Bearer …</code>{" "}
                {t("e")} <code>x-file-name</code>).
              </>
            ) : (
              <>
                {t("non attiva. Per collegarla alle mail di SAP imposta la variabile")} <code>RDA_INGEST_SECRET</code>{" "}
                {t("su Vercel; nel frattempo i file si caricano a mano dalla pagina Task.")}
              </>
            )}
          </div>
          {cfg.rda.lastImports.length > 0 && (
            <div style={{ ...sans, fontSize: 12, color: C.subtle, marginTop: 10 }}>
              {t("Ultimi import:")}{" "}
              {cfg.rda.lastImports
                .map(
                  i =>
                    `${i.kind === "pr" ? t("RDA") : t("Ordini")} ${new Date(i.at).toLocaleString(locale(), { dateStyle: "short", timeStyle: "short" })} (${i.by})`,
                )
                .join(" · ")}
            </div>
          )}
        </Card>

        <CategoriesCard fail={fail} notify={notify} />
        <BoSettingsCard fail={fail} notify={notify} />
      </ConfigGroup>

      <ConfigGroup
        id="contracts"
        icon={<FileText size={18} />}
        title={t("Contratti e revisioni")}
        sub={t("Chi deve rivedere le bozze e quando")}
      >
        <ReviewRulesCard fail={fail} notify={notify} />
      </ConfigGroup>

      <ConfigGroup
        id="sap"
        icon={<Settings size={18} />}
        title={t("Parametri SAP")}
        sub={t("Valori fissi e conti di riconciliazione per creare i fornitori")}
        warn={noRec.length > 0}
      >
        <Card>
          <CardTitle icon={<Settings size={16} />}>{t("Parametri SAP")}</CardTitle>
          <p style={{ ...sans, fontSize: 12.5, color: C.muted, margin: "-6px 0 12px", lineHeight: 1.55 }}>
            {t(
              "Valori fissi inviati a SAP in fase di creazione. I conti di riconciliazione dipendono dal gruppo conti e vanno confermati con il Finance.",
            )}
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 200px), 1fr))", columnGap: 14 }}>
            {(
              [
                ["tradingPartner", "Trading partner"],
                ["sortKey", "Chiave di ordinamento"],
                ["cashManagementGroup", "Gruppo cash management"],
                ["releaseGroup", "Gruppo di rilascio"],
              ] as const
            ).map(([k, l]) => (
              <Field key={k} label={t(l)} htmlFor={`s-${k}`}>
                <input id={`s-${k}`} value={sap[k]} onChange={e => setSap({ ...sap, [k]: e.target.value })} style={iStyle} />
              </Field>
            ))}
          </div>
          <div style={{ ...sans, fontSize: 12, fontWeight: 650, color: C.muted, margin: "4px 0 8px" }}>
            {t("Conto di riconciliazione per gruppo conti")}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 200px), 1fr))", columnGap: 14 }}>
            {GROUPS.map(([g, l]) => (
              <Field key={g} label={`${g} · ${t(l)}`} htmlFor={`rec-${g}`}>
                <input
                  id={`rec-${g}`}
                  value={sap.reconciliationAccounts[g] ?? ""}
                  onChange={e => setSap({ ...sap, reconciliationAccounts: { ...sap.reconciliationAccounts, [g]: e.target.value } })}
                  style={iStyle}
                  placeholder={t("es. 2010000")}
                />
              </Field>
            ))}
          </div>
          <button
            onClick={saveSap}
            disabled={busy}
            style={{ ...btnPrimary, padding: "10px 18px", display: "inline-flex", alignItems: "center", gap: 8 }}
          >
            {busy ? <Loader2 className="spin" size={16} /> : <Save size={16} />}
            {t("Salva parametri SAP")}
          </button>
        </Card>
      </ConfigGroup>

      <ConfigGroup
        id="security"
        icon={<Lock size={18} />}
        title={t("Privacy e sicurezza")}
        sub={t("Informativa e conservazione dei dati, accessi, stato dell'ambiente")}
      >
        <PrivacyCard cfg={cfg} fail={fail} notify={notify} onSaved={adopt} />
        <SecurityCard fail={fail} />
      </ConfigGroup>

      <ConfigGroup
        id="tools"
        icon={<RotateCcw size={18} />}
        title={t("Prove e manutenzione")}
        sub={t("Accessi di prova, pulizia dei dati")}
      >
        <TestAccessCard fail={fail} notify={notify} />
        <ResetCard fail={fail} notify={notify} />
      </ConfigGroup>

      <ConfigGroup id="audit" icon={<History size={18} />} title={t("Registro delle modifiche")} sub={t("Chi ha cambiato cosa e quando")}>
        <AuditCard cfg={cfg} fail={fail} />
      </ConfigGroup>

      {docDraft && (
        <Portal>
          <DocTypeDialog
            draft={docDraft}
            cfg={cfg}
            fail={fail}
            onClose={() => setDocDraft(null)}
            onSaved={c => {
              adopt(c);
              setDocDraft(null);
              notify(t("Salvato"));
            }}
          />
        </Portal>
      )}
      {draft && (
        <Portal>
          <ItemDialog
            draft={draft}
            cfg={cfg}
            fail={fail}
            onClose={() => setDraft(null)}
            onSaved={c => {
              adopt(c);
              setDraft(null);
              notify(t("Salvato"));
            }}
          />
        </Portal>
      )}
    </div>
  );
}

function ItemDialog({
  draft,
  cfg,
  fail,
  onClose,
  onSaved,
}: {
  draft: Draft;
  cfg: PortalConfig;
  fail: (e: unknown) => string;
  onClose: () => void;
  onSaved: (c: PortalConfig) => void;
}) {
  const [item, setItem] = useState(draft.item);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: unknown) => setItem(x => ({ ...x, [k]: v }));
  const str = (k: string) => String(item[k] ?? "");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onSaved(await portalApi.saveConfig(draft.entity, "save", item));
    } catch (err) {
      setError(fail(err));
      setBusy(false);
    }
  };
  const buyerIds = (item.buyerIds as number[] | undefined) ?? [];
  const title = { company: "Società", industry: "Codice merceologico", payment_term: "Condizione di pagamento" }[draft.entity];
  return (
    <div className="dialog-overlay" role="dialog" aria-modal="true">
      <form className="dialog" onSubmit={submit}>
        <h3 style={{ ...font, margin: "0 0 14px", fontSize: 17 }}>
          {draft.isNew ? t("Nuovo") : t("Modifica")}: {t(title)}
        </h3>
        <Field label={t("Codice")} req htmlFor="c-code">
          <input
            id="c-code"
            required
            disabled={!draft.isNew}
            value={str("code")}
            onChange={e => set("code", e.target.value)}
            style={{ ...iStyle, ...(draft.isNew ? {} : { background: C.bg }) }}
            maxLength={20}
          />
        </Field>
        {draft.entity === "payment_term" ? (
          <Field label={t("Descrizione")} req htmlFor="c-label">
            <input id="c-label" required value={str("label")} onChange={e => set("label", e.target.value)} style={iStyle} />
          </Field>
        ) : (
          <Field label={t("Nome")} req htmlFor="c-name">
            <input id="c-name" required value={str("name")} onChange={e => set("name", e.target.value)} style={iStyle} />
          </Field>
        )}
        {draft.entity === "company" && (
          <>
            <Field label={t("Codice società SAP")} htmlFor="c-sap">
              <input id="c-sap" value={str("sapCompanyCode")} onChange={e => set("sapCompanyCode", e.target.value)} style={iStyle} />
            </Field>
            <Field label={t("Organizzazione acquisti")} htmlFor="c-po">
              <input id="c-po" value={str("purchOrg")} onChange={e => set("purchOrg", e.target.value)} style={iStyle} />
            </Field>
          </>
        )}
        {draft.entity === "industry" && (
          <Field label={t("Buyer assegnati")}>
            <div style={{ display: "grid", gap: 6 }}>
              {cfg.buyers
                .filter(b => b.active)
                .map(b => (
                  <label key={b.id} style={{ ...sans, display: "flex", gap: 8, alignItems: "center", fontSize: 13.5, cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={buyerIds.includes(b.id)}
                      onChange={() => set("buyerIds", buyerIds.includes(b.id) ? buyerIds.filter(x => x !== b.id) : [...buyerIds, b.id])}
                      style={{ accentColor: C.accent, width: 16, height: 16 }}
                    />
                    {b.name}
                  </label>
                ))}
            </div>
          </Field>
        )}
        {error && <Notice kind="error">{error}</Notice>}
        <div style={{ display: "flex", gap: 10 }}>
          <button type="button" onClick={onClose} style={{ ...btnGhost, flex: 1 }}>
            {t("Annulla")}
          </button>
          <button type="submit" disabled={busy} style={{ ...btnPrimary, flex: 2, opacity: busy ? 0.7 : 1 }}>
            {t("Salva")}
          </button>
        </div>
      </form>
    </div>
  );
}

const policyToForm = (p: ReminderPolicy) => ({
  enabled: p.enabled,
  days: p.days.join(", "),
  repeatDays: String(p.repeatDays),
  escalateAfter: String(p.escalateAfter),
});
const slug = (t: string) =>
  t
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);

function DocTypeDialog({
  draft,
  cfg,
  fail,
  onClose,
  onSaved,
}: {
  draft: { type: DocTypeDef; rules: DocRule[]; isNew: boolean };
  cfg: PortalConfig;
  fail: (e: unknown) => string;
  onClose: () => void;
  onSaved: (c: PortalConfig) => void;
}) {
  const [doc, setDoc] = useState(draft.type);
  const [rules, setRules] = useState(draft.rules);
  const [keyTouched, setKeyTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const setRule = (i: number, patch: Partial<DocRule>) =>
    setRules(rs => rs.map((r, k) => (k === i ? { ...r, ...patch, ...(patch.scope && patch.scope !== r.scope ? { value: "" } : {}) } : r)));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onSaved(await portalApi.saveConfig("doc_type", "save", { ...doc, rules }));
    } catch (err) {
      setError(fail(err));
      setBusy(false);
    }
  };
  return (
    <div className="dialog-overlay" role="dialog" aria-modal="true">
      <form className="dialog" onSubmit={submit} style={{ maxWidth: 560 }}>
        <h3 style={{ ...font, margin: "0 0 14px", fontSize: 17 }}>{draft.isNew ? t("Nuovo documento") : t("Modifica documento")}</h3>
        <Field label={t("Nome")} req htmlFor="d-label">
          <input
            id="d-label"
            required
            value={doc.label}
            onChange={e => setDoc({ ...doc, label: e.target.value, key: draft.isNew && !keyTouched ? slug(e.target.value) : doc.key })}
            style={iStyle}
          />
        </Field>
        <Field label={t("Codice interno")} req htmlFor="d-key">
          <input
            id="d-key"
            required
            disabled={!draft.isNew}
            value={doc.key}
            onChange={e => {
              setKeyTouched(true);
              setDoc({ ...doc, key: e.target.value });
            }}
            style={{ ...iStyle, ...(draft.isNew ? {} : { background: C.bg }) }}
            maxLength={40}
          />
        </Field>
        <Field label={t("Istruzioni per il fornitore")} htmlFor="d-help">
          <textarea
            id="d-help"
            value={doc.help}
            onChange={e => setDoc({ ...doc, help: e.target.value })}
            style={{ ...iStyle, height: 64, resize: "vertical" }}
          />
        </Field>
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap", marginBottom: 14 }}>
          <label style={{ ...sans, display: "flex", gap: 8, alignItems: "center", fontSize: 13.5, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={doc.expires}
              onChange={e => setDoc({ ...doc, expires: e.target.checked })}
              style={{ accentColor: C.accent, width: 16, height: 16 }}
            />
            {t("Ha una scadenza")}
          </label>
          <label style={{ ...sans, display: "flex", gap: 8, alignItems: "center", fontSize: 13.5, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={doc.multiple}
              onChange={e => setDoc({ ...doc, multiple: e.target.checked })}
              style={{ accentColor: C.accent, width: 16, height: 16 }}
            />
            {t("Si possono caricare più file")}
          </label>
        </div>
        <div style={{ ...sans, fontSize: 12, fontWeight: 650, color: C.muted, marginBottom: 6 }}>{t("A chi viene chiesto")}</div>
        {rules.length === 0 && (
          <div style={{ ...sans, fontSize: 12.5, color: C.subtle, marginBottom: 8 }}>
            {t("Nessuna regola: il documento non viene chiesto a nessuno.")}
          </div>
        )}
        {rules.map((r, i) => (
          <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap", alignItems: "center" }}>
            <select
              aria-label={t("Chi")}
              value={r.scope}
              onChange={e => setRule(i, { scope: e.target.value as DocRule["scope"] })}
              style={{ ...iStyle, width: "auto", flex: "1 1 150px" }}
            >
              <option value="all">{t("Tutti i fornitori")}</option>
              <option value="country">{t("Fornitori di un paese")}</option>
              <option value="industry">{t("Codice merceologico")}</option>
            </select>
            {r.scope === "country" && (
              <select
                aria-label={t("Paese")}
                required
                value={r.value}
                onChange={e => setRule(i, { value: e.target.value })}
                style={{ ...iStyle, width: "auto", flex: "1 1 150px" }}
              >
                <option value="">{t("Paese…")}</option>
                {COUNTRIES.map(c => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
            {r.scope === "industry" && (
              <select
                aria-label={t("Codice merceologico")}
                required
                value={r.value}
                onChange={e => setRule(i, { value: e.target.value })}
                style={{ ...iStyle, width: "auto", flex: "1 1 150px" }}
              >
                <option value="">{t("Codice…")}</option>
                {cfg.industryCodes.map(c => (
                  <option key={c.code} value={c.code}>
                    {c.code} · {c.name}
                  </option>
                ))}
              </select>
            )}
            <select
              aria-label={t("Livello")}
              value={r.level}
              onChange={e => setRule(i, { level: e.target.value as DocRule["level"] })}
              style={{ ...iStyle, width: "auto", flex: "0 1 140px" }}
            >
              <option value="required">{t("Obbligatorio")}</option>
              <option value="optional">{t("Facoltativo")}</option>
            </select>
            <button
              type="button"
              onClick={() => setRules(rs => rs.filter((_, k) => k !== i))}
              aria-label={t("Rimuovi regola")}
              style={{ background: "none", border: "none", cursor: "pointer", color: C.subtle, padding: 6, display: "flex" }}
            >
              <X size={16} />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setRules(rs => [...rs, { docType: doc.key, scope: "industry", value: "", level: "required" }])}
          style={{
            ...btnGhost,
            padding: "6px 12px",
            fontSize: 12.5,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            marginBottom: 14,
          }}
        >
          <Plus size={14} />
          {t("Aggiungi regola")}
        </button>
        <div style={{ ...sans, fontSize: 11.5, color: C.subtle, marginBottom: 14, lineHeight: 1.5 }}>
          {t("Se un fornitore rientra in più regole, il documento è obbligatorio quando almeno una lo è.")}
        </div>
        {error && <Notice kind="error">{error}</Notice>}
        <div style={{ display: "flex", gap: 10 }}>
          <button type="button" onClick={onClose} style={{ ...btnGhost, flex: 1 }}>
            {t("Annulla")}
          </button>
          <button type="submit" disabled={busy} style={{ ...btnPrimary, flex: 2, opacity: busy ? 0.7 : 1 }}>
            {t("Salva")}
          </button>
        </div>
      </form>
    </div>
  );
}

/** Informativa privacy mostrata ai fornitori e tempi di conservazione dei dati. */
function PrivacyCard({
  cfg,
  fail,
  notify,
  onSaved,
}: {
  cfg: PortalConfig;
  fail: (e: unknown) => string;
  notify: (m: string) => void;
  onSaved: (c: PortalConfig) => void;
}) {
  const [form, setForm] = useState({
    notice: cfg.privacy.notice,
    inviteDays: String(cfg.privacy.inviteDays),
    retentionMonths: String(cfg.privacy.retentionMonths),
  });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      onSaved(
        await portalApi.saveConfig("privacy", "save", {
          notice: form.notice,
          inviteDays: Number(form.inviteDays),
          retentionMonths: Number(form.retentionMonths),
        }),
      );
      notify(t("Impostazioni privacy salvate"));
    } catch (err) {
      notify(`⚠️ ${fail(err)}`);
    }
    setBusy(false);
  };
  return (
    <Card>
      <CardTitle icon={<Lock size={16} />}>{t("Privacy")}</CardTitle>
      <p style={{ ...sans, fontSize: 12.5, color: C.muted, margin: "-6px 0 12px", lineHeight: 1.55 }}>
        {t(
          "Il fornitore vede l'informativa all'invito e la accetta prima di inviare la registrazione. Ogni notte gli inviti mai attivati vengono eliminati e i fornitori non più attivi (disattivati, esclusi, rifiutati o mai completati) vengono anonimizzati dopo il periodo di conservazione.",
        )}
      </p>
      <Field label={t("Testo dell'informativa privacy")} htmlFor="p-notice">
        <textarea
          id="p-notice"
          rows={4}
          value={form.notice}
          onChange={e => setForm({ ...form, notice: e.target.value })}
          style={{ ...iStyle, resize: "vertical" }}
        />
      </Field>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))", columnGap: 14 }}>
        <Field label={t("Elimina gli inviti non attivati dopo (giorni)")} htmlFor="p-inv">
          <input
            id="p-inv"
            type="number"
            min={7}
            max={730}
            value={form.inviteDays}
            onChange={e => setForm({ ...form, inviteDays: e.target.value })}
            style={iStyle}
          />
        </Field>
        <Field label={t("Anonimizza i fornitori non attivi dopo (mesi)")} htmlFor="p-ret">
          <input
            id="p-ret"
            type="number"
            min={1}
            max={240}
            value={form.retentionMonths}
            onChange={e => setForm({ ...form, retentionMonths: e.target.value })}
            style={iStyle}
          />
        </Field>
      </div>
      <button
        onClick={save}
        disabled={busy}
        style={{ ...btnPrimary, padding: "10px 18px", display: "inline-flex", alignItems: "center", gap: 8 }}
      >
        {busy ? <Loader2 className="spin" size={16} /> : <Save size={16} />}
        {t("Salva")}
      </button>
    </Card>
  );
}

/** Sezione della configurazione che si apre con un clic; ricorda quali sezioni l'utente tiene aperte. */
function ConfigGroup({
  id,
  icon,
  title,
  sub,
  warn,
  children,
}: {
  id: string;
  icon: React.ReactNode;
  title: string;
  sub: string;
  warn?: boolean;
  children: React.ReactNode;
}) {
  const key = `pl-config-open-${id}`;
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(key) === "1";
    } catch {
      return false;
    }
  });
  const toggle = () =>
    setOpen(o => {
      try {
        localStorage.setItem(key, o ? "0" : "1");
      } catch {
        /* preferenza solo locale */
      }
      return !o;
    });
  return (
    <section style={{ background: "#fff", border: `1px solid ${warn ? "#f3dca0" : C.border}`, borderRadius: 16, overflow: "hidden" }}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        style={{
          all: "unset",
          ...sans,
          boxSizing: "border-box",
          width: "100%",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "14px 16px",
        }}
      >
        <span
          style={{
            display: "flex",
            color: warn ? C.yellow : C.accent,
            background: warn ? C.yellowBg : C.accentLight,
            borderRadius: 10,
            padding: 8,
          }}
        >
          {icon}
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ ...font, display: "block", fontSize: 15, fontWeight: 700, color: C.text }}>
            {title}
            {warn && <span style={{ ...sans, marginLeft: 8, fontSize: 11.5, fontWeight: 650, color: C.yellow }}>{t("da completare")}</span>}
          </span>
          <span style={{ ...sans, display: "block", fontSize: 12.5, color: C.muted, marginTop: 2 }}>{sub}</span>
        </span>
        <ChevronDown
          size={18}
          color={C.subtle}
          style={{ transform: open ? "rotate(180deg)" : undefined, transition: "transform .15s", flexShrink: 0 }}
        />
      </button>
      {open && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr)",
            gap: 14,
            padding: "0 14px 14px",
            background: C.bg,
            borderTop: `1px solid ${C.borderLight}`,
            paddingTop: 14,
          }}
        >
          {children}
        </div>
      )}
    </section>
  );
}

/** Verifica periodica dei fornitori registrati: frequenza secondo il livello di rischio. */
function RiskCard({
  cfg,
  fail,
  notify,
  onSaved,
}: {
  cfg: PortalConfig;
  fail: (e: unknown) => string;
  notify: (m: string) => void;
  onSaved: (c: PortalConfig) => void;
}) {
  const r = cfg.risk;
  const [form, setForm] = useState({
    enabled: r.enabled,
    high: String(r.days.high),
    medium: String(r.days.medium),
    low: String(r.days.low),
    batch: String(r.batch),
  });
  const [busy, setBusy] = useState<"" | "save" | "run">("");
  const save = async () => {
    setBusy("save");
    try {
      onSaved(
        await portalApi.saveConfig("risk", "save", {
          enabled: form.enabled,
          days: { high: Number(form.high), medium: Number(form.medium), low: Number(form.low) },
          batch: Number(form.batch),
        }),
      );
      notify(t("Verifica periodica salvata"));
    } catch (err) {
      notify(`⚠️ ${fail(err)}`);
    }
    setBusy("");
  };
  const run = async () => {
    setBusy("run");
    try {
      const x = await portalApi.runRiskChecks();
      notify(
        x.worsened
          ? t("Verifica eseguita: {checked} fornitori controllati, {worsened} peggiorati (buyer avvisati)", x)
          : t("Verifica eseguita: {checked} fornitori controllati su {due} da ricontrollare, nessun peggioramento", x),
      );
    } catch (err) {
      notify(`⚠️ ${fail(err)}`);
    }
    setBusy("");
  };
  const num = (k: "high" | "medium" | "low" | "batch", label: string, max: number) => (
    <Field label={label} htmlFor={`rk-${k}`}>
      <input
        id={`rk-${k}`}
        type="number"
        min={k === "batch" ? 1 : 7}
        max={max}
        value={form[k]}
        onChange={e => setForm({ ...form, [k]: e.target.value })}
        style={iStyle}
      />
    </Field>
  );
  return (
    <Card>
      <CardTitle icon={<ShieldAlert size={16} />}>{t("Verifica periodica dei fornitori")}</CardTitle>
      <p style={{ ...sans, fontSize: 12.5, color: C.muted, margin: "-6px 0 12px", lineHeight: 1.55 }}>
        {t(
          "Ogni notte i fornitori registrati vengono ricontrollati (partita IVA, situazione dell'azienda, liste sanzioni) quando la verifica è scaduta: più spesso quelli a rischio più alto. Se qualcosa peggiora, il buyer di riferimento riceve un'email e la scheda lo segnala. La verifica dell'azienda presso il Registro Imprese costa circa 0,10 € a fornitore.",
        )}
      </p>
      <label style={{ ...sans, display: "flex", gap: 8, alignItems: "center", fontSize: 13, marginBottom: 12, cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={form.enabled}
          onChange={e => setForm({ ...form, enabled: e.target.checked })}
          style={{ accentColor: C.accent, width: 16, height: 16 }}
        />
        {t("Verifica periodica automatica attiva")}
      </label>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 170px), 1fr))", columnGap: 14 }}>
        {num("high", t("Rischio alto: ogni (giorni)"), 730)}
        {num("medium", t("Rischio medio: ogni (giorni)"), 730)}
        {num("low", t("Rischio basso: ogni (giorni)"), 730)}
        {num("batch", t("Massimo fornitori al giorno"), 200)}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          onClick={save}
          disabled={!!busy}
          style={{ ...btnPrimary, padding: "10px 18px", display: "inline-flex", alignItems: "center", gap: 8 }}
        >
          {busy === "save" ? <Loader2 className="spin" size={16} /> : <Save size={16} />}
          {t("Salva")}
        </button>
        <button
          onClick={run}
          disabled={!!busy}
          style={{ ...btnGhost, padding: "10px 16px", display: "inline-flex", alignItems: "center", gap: 8 }}
        >
          {busy === "run" ? <Loader2 className="spin" size={16} /> : <RotateCcw size={16} />}
          {t("Esegui ora")}
        </button>
      </div>
    </Card>
  );
}

/** Registro delle modifiche alle regole: chi ha cambiato cosa e quando. */
function AuditCard({ cfg, fail }: { cfg: PortalConfig; fail: (e: unknown) => string }) {
  const [entries, setEntries] = useState<ConfigAuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  // Si ricarica a ogni salvataggio della configurazione (nuovo oggetto cfg).
  useEffect(() => {
    let off = false;
    portalApi
      .configAudit()
      .then(e => {
        if (!off) {
          setEntries(e);
          setError(null);
        }
      })
      .catch(err => {
        if (!off) setError(fail(err));
      });
    return () => {
      off = true;
    };
  }, [cfg, fail]);
  const shown = (entries ?? []).slice(0, all ? 200 : 12);
  return (
    <Card>
      <CardTitle icon={<History size={16} />}>{t("Registro modifiche alle regole")}</CardTitle>
      {error && <Notice kind="error">{error}</Notice>}
      {entries && entries.length === 0 && <div style={{ ...sans, fontSize: 13, color: C.subtle }}>{t("Nessuna modifica registrata.")}</div>}
      {shown.map(e => (
        <div
          key={e.id}
          style={{
            ...sans,
            display: "flex",
            gap: 12,
            padding: "8px 0",
            borderTop: `1px solid ${C.borderLight}`,
            fontSize: 13,
            flexWrap: "wrap",
          }}
        >
          <div style={{ width: 120, flexShrink: 0, color: C.subtle, fontSize: 12 }} className="tabular">
            {new Date(e.at).toLocaleString(locale(), { dateStyle: "short", timeStyle: "short" })}
          </div>
          <div style={{ flex: "1 1 260px", minWidth: 0 }}>
            <div>
              <b>{e.areaLabel}</b>
              {e.subject ? ` · ${e.subject}` : ""} <span style={{ color: C.subtle }}>— {e.actor}</span>
            </div>
            <div style={{ color: C.muted, fontSize: 12.5, overflowWrap: "anywhere" }}>{e.detail}</div>
          </div>
        </div>
      ))}
      {entries && entries.length > 12 && (
        <button onClick={() => setAll(v => !v)} style={{ ...btnGhost, marginTop: 8, padding: "7px 12px", fontSize: 12.5 }}>
          {all ? t("Mostra meno") : t("Mostra tutte ({n})", { n: entries.length })}
        </button>
      )}
    </Card>
  );
}

/** Liste sanzioni ufficiali (UE, ONU, USA): scaricate ogni notte e usate per controllare tutti i fornitori. */
function SanctionsCard({
  cfg,
  fail,
  notify,
  onSaved,
}: {
  cfg: PortalConfig;
  fail: (e: unknown) => string;
  notify: (m: string) => void;
  onSaved: (c: PortalConfig) => void;
}) {
  const [busy, setBusy] = useState(false);
  const st = cfg.sanctions;
  const refresh = async () => {
    setBusy(true);
    try {
      const r = await portalApi.sanctionsRefresh();
      onSaved(r.config);
      notify(
        r.errors.length
          ? `⚠️ ${r.errors.join("; ")}`
          : t("Liste aggiornate: {n} fornitori ricontrollati", { n: r.rescreened }) +
              (r.newHits ? t(", {n} da verificare", { n: r.newHits }) : ""),
      );
    } catch (err) {
      notify(`⚠️ ${fail(err)}`);
    }
    setBusy(false);
  };
  return (
    <Card>
      <CardTitle icon={<ShieldCheck size={16} />}>{t("Verifiche esterne sui fornitori")}</CardTitle>
      <div style={{ display: "grid", gap: 6, marginBottom: 14 }}>
        {(
          [
            [
              t("Partita IVA (VIES, UE)"),
              cfg.externalChecks.vies,
              t("gratuito: verifica che la partita IVA europea sia attiva e a chi è intestata"),
            ],
            [t("Registro LEI (GLEIF)"), true, t("gratuito: stato dell'azienda per chi ha un codice LEI (in genere aziende medio-grandi)")],
            [
              t("Registro Imprese (Openapi)"),
              cfg.externalChecks.openapi,
              cfg.externalChecks.openapi
                ? t(
                    "collegato: stato di attività (attiva, in liquidazione, fallita, cessata), data di costituzione, capitale, fatturato e dipendenti",
                  )
                : t(
                    "non collegato: serve un account Openapi (30 verifiche gratis al mese, poi circa 0,10 € l'una) e la variabile OPENAPI_COMPANY_TOKEN su Vercel",
                  ),
            ],
          ] as [string, boolean, string][]
        ).map(([l, on, txt]) => (
          <div key={l} style={{ ...sans, display: "flex", gap: 10, fontSize: 13, alignItems: "baseline", flexWrap: "wrap" }}>
            <span
              style={{ width: 8, height: 8, borderRadius: 4, background: on ? C.green : C.subtle, flexShrink: 0, alignSelf: "center" }}
              aria-hidden
            />
            <b style={{ minWidth: 190 }}>{l}</b>
            <span style={{ color: C.muted, flex: "1 1 260px" }}>
              {on ? "" : "⚠ "}
              {txt}
            </span>
          </div>
        ))}
      </div>
      <div style={{ ...sans, fontSize: 12, fontWeight: 650, color: C.muted, margin: "4px 0 8px" }}>{t("Liste sanzioni")}</div>
      {st.provider === "lists" ? (
        <>
          <p style={{ ...sans, fontSize: 12.5, color: C.muted, margin: "-6px 0 12px", lineHeight: 1.55 }}>
            {t(
              "Ogni notte si scaricano le liste ufficiali e gratuite di Unione Europea, ONU, Regno Unito e Tesoro USA (OFAC). Ogni fornitore viene controllato all'invio della registrazione e ricontrollato dopo ogni aggiornamento: le corrispondenze compaiono nei controlli di conformità della scheda.",
            )}
          </p>
          <div style={{ display: "grid", gap: 6, marginBottom: 12 }}>
            {st.sources.map(x => (
              <div key={x.key} style={{ ...sans, display: "flex", gap: 10, fontSize: 13, flexWrap: "wrap", alignItems: "baseline" }}>
                <b style={{ minWidth: 130 }}>{x.label}</b>
                <span style={{ color: x.count ? C.text : C.subtle }} className="tabular">
                  {x.count ? t("{n} nomi", { n: x.count.toLocaleString(locale()) }) : t("non ancora scaricata")}
                </span>
                {x.at && (
                  <span style={{ color: C.subtle, fontSize: 12 }}>
                    {t("aggiornata il {date}", {
                      date: new Date(x.at).toLocaleString(locale(), { dateStyle: "short", timeStyle: "short" }),
                    })}
                  </span>
                )}
                {x.error && (
                  <span style={{ color: C.red, fontSize: 12 }}>{t("ultimo tentativo non riuscito: {error}", { error: x.error })}</span>
                )}
              </div>
            ))}
          </div>
          <button
            onClick={refresh}
            disabled={busy}
            style={{ ...btnGhost, padding: "9px 14px", fontSize: 13, display: "inline-flex", alignItems: "center", gap: 7 }}
          >
            {busy ? <Loader2 className="spin" size={15} /> : <RotateCcw size={15} />}
            {busy ? t("Scaricamento in corso…") : t("Aggiorna ora")}
          </button>
        </>
      ) : (
        <p style={{ ...sans, fontSize: 12.5, color: C.muted, margin: 0 }}>
          {t("Controllo tramite servizio esterno ({provider}).", { provider: st.provider })}
        </p>
      )}
    </Card>
  );
}
