import { useCallback, useEffect, useState } from "react";
import type { Kpis } from "../types.ts";
import { ApiError, portalApi } from "../api.ts";
import { btnGhost, C, font, sans } from "../theme.ts";
import { fmt } from "../lib/format.ts";
import { EmptyState, Grid, StatCard } from "../components/ui.tsx";
import { HBars, MonthColumns } from "../components/charts.tsx";
import { AlertTriangle, Building2, CheckCircle2, Clock, FileText, Hourglass, Inbox, Loader2, RotateCcw, Scale, ShieldCheck } from "../components/icons.tsx";

const days = (n: number | null) => (n === null ? "—" : `${n} gg`);
const pct = (n: number | null) => (n === null ? "—" : `${n}%`);

function Section({ title, text, children }: { title: string; text: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 26 }}>
      <h2 style={{ ...font, fontSize: 16, fontWeight: 700, color: C.text, margin: "0 0 2px" }}>{title}</h2>
      <p style={{ ...sans, fontSize: 12.5, color: C.muted, margin: "0 0 12px", lineHeight: 1.5 }}>{text}</p>
      <div style={{ display: "grid", gap: 14 }}>{children}</div>
    </section>
  );
}

/** Indicatori di processo per il Manager: tempi, rispetto delle regole e colli di bottiglia. */
export function KpiView({ onSessionExpired }: { onSessionExpired: () => void }) {
  const [k, setK] = useState<Kpis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fail = useCallback((err: unknown) => {
    if (err instanceof ApiError && err.status === 401) { onSessionExpired(); return "Sessione scaduta"; }
    return err instanceof Error ? err.message : "Caricamento non riuscito";
  }, [onSessionExpired]);
  const load = useCallback(() => portalApi.kpis().then(x => { setK(x); setError(null); }).catch(err => setError(fail(err))), [fail]);
  useEffect(() => { let off = false; portalApi.kpis().then(x => { if (!off) setK(x); }).catch(err => { if (!off) setError(fail(err)); }); return () => { off = true; }; }, [fail]);

  if (error) return <EmptyState icon={<AlertTriangle size={26} />} title="Impossibile calcolare gli indicatori" text={error} action={<button onClick={load} style={{ ...btnGhost, padding: "9px 16px" }}>Riprova</button>} />;
  if (!k) return <div style={{ display: "flex", justifyContent: "center", padding: 60 }}><Loader2 className="spin" size={26} color={C.subtle} /></div>;
  const r = k.rda, s = k.sourcing, o = k.onboarding, q = k.qualification, c = k.contracts;
  const srcPct = s.required90 ? Math.round((s.compliant90 / s.required90) * 100) : null;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ ...sans, fontSize: 12.5, color: C.muted }}>Calcolati il {new Date(k.generatedAt).toLocaleString("it-IT", { dateStyle: "medium", timeStyle: "short" })} · periodo: ultimi 90 giorni dove non indicato</div>
        <button onClick={load} style={{ ...btnGhost, display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 12px", fontSize: 12.5 }}><RotateCcw size={14} />Aggiorna</button>
      </div>

      <Section title="RDA e ordini" text={`Dal rilascio della RDA in SAP alla creazione del PO. Tempo previsto per lavorare una RDA: ${r.slaDays} giorni.`}>
        <Grid min={180} gap={12} fill>
          <StatCard label="RDA aperte" value={r.open} sub={`${r.overdue} oltre i ${r.slaDays} giorni previsti`} color={C.blue} icon={<Inbox size={18} />} />
          <StatCard label="Chiuse nei tempi" value={pct(r.withinSla90)} sub={`su ${r.closed90} chiuse negli ultimi 90 giorni`} color={C.green} icon={<CheckCircle2 size={18} />} />
          <StatCard label="Tempo RDA → PO" value={days(r.medianCycleDays)} sub="Mediana, ultimi 90 giorni" color={C.accent} icon={<Clock size={18} />} />
        </Grid>
        <Grid min={340} gap={14}>
          <HBars title="Età delle RDA aperte" subtitle="Giorni dal rilascio in SAP" data={r.aging} empty="Nessuna RDA aperta" />
          <MonthColumns title="Tempo RDA → PO per mese" subtitle="Mediana in giorni delle RDA diventate ordine" unit="giorni" valueHead="Mediana (giorni)"
            data={r.monthly.map(m => ({ month: m.month, value: m.medianDays, note: `${m.closed} ${m.closed === 1 ? "RDA chiusa" : "RDA chiuse"} con PO` }))} />
        </Grid>
        {r.byBuyer.length > 0 && <HBars title="RDA aperte per buyer" subtitle={`In ritardo: ${r.byBuyer.filter(b => b.overdue).map(b => `${b.name} ${b.overdue}`).join(", ") || "nessuna"}`} data={r.byBuyer.map(b => ({ label: b.name, n: b.open }))} />}
      </Section>

      <Section title="Scelta del fornitore" text={`RDA e nuovi contratti sopra ${fmt(s.threshold)}: confronto con almeno un altro fornitore, oppure fornitura strategica, single source o eccezione approvata. Il saving si calcola sul prezzo di riferimento, sulla media delle offerte o sulla negoziazione.`}>
        <Grid min={180} gap={12} fill>
          <StatCard label="RDA documentate" value={pct(srcPct)} sub={`${s.compliant90} su ${s.required90} chiuse sopra soglia`} color={srcPct === null || srcPct >= 90 ? C.green : C.red} icon={<Scale size={18} />} />
          <StatCard label="Aperte senza confronto" value={s.openMissing} sub="Da documentare prima della chiusura" color={C.yellow} icon={<AlertTriangle size={18} />} />
          <StatCard label="Saving ultimi 12 mesi" value={fmt(s.saving12m)} sub={s.savingCount12m ? `${s.savingCount12m} pratiche${s.savingPct12m !== null ? ` · ${s.savingPct12m}% in media` : ""}` : "Nessun saving registrato"} color={C.green} icon={<CheckCircle2 size={18} />} />
          <StatCard label="Eccezioni da approvare" value={s.exceptionsPending} sub="In attesa del Manager" color={C.purple} icon={<Hourglass size={18} />} />
        </Grid>
        <HBars title="Come è stato scelto il fornitore" subtitle="RDA sopra soglia documentate negli ultimi 90 giorni" data={s.byMode} empty="Nessuna scelta documentata nel periodo" />
      </Section>

      <Section title="Fornitori" text="Onboarding (dall'invito alla registrazione in SAP) e stato della qualifica dei fornitori registrati.">
        <Grid min={180} gap={12} fill>
          <StatCard label="Invito → registrazione" value={days(o.medianDaysToRegister)} sub={`Mediana su ${o.registered12m} registrati in 12 mesi`} color={C.accent} icon={<Clock size={18} />} />
          <StatCard label="Fermi dal Buyer" value={o.stuckAtBuyer} sub="In verifica da oltre 7 giorni" color={o.stuckAtBuyer ? C.red : C.green} icon={<Hourglass size={18} />} />
          <StatCard label="Fermi dal Finance" value={o.stuckAtFinance} sub="Da registrare da oltre 5 giorni" color={o.stuckAtFinance ? C.red : C.green} icon={<Hourglass size={18} />} />
        </Grid>
        <Grid min={180} gap={12} fill>
          <StatCard label="Qualifica valida" value={q.valid} sub="Documenti obbligatori in regola" color={C.green} icon={<ShieldCheck size={18} />} />
          <StatCard label="In scadenza" value={q.expiring} sub="Documenti che scadono a breve" color={C.yellow} icon={<Clock size={18} />} />
          <StatCard label="Qualifica scaduta" value={q.lapsed} sub="Da sollecitare o bloccare" color={C.red} icon={<AlertTriangle size={18} />} />
          <StatCard label="Bloccati" value={q.blocked} sub="Fornitori registrati e bloccati" color={C.gray} icon={<Building2 size={18} />} />
        </Grid>
        <HBars title="Onboarding in corso" subtitle="Fornitori per fase" data={o.inProgress} empty="Nessun onboarding in corso" />
      </Section>

      <Section title="Contratti" text="Le scadenze si contano dalla data limite di disdetta quando il contratto prevede un preavviso.">
        <Grid min={180} gap={12} fill>
          <StatCard label="Contratti attivi" value={c.active} sub={`${c.withNotice} con preavviso di disdetta`} color={C.blue} icon={<FileText size={18} />} />
          <StatCard label="Scadenze entro 90 giorni" value={c.keyNext90} sub="Scadenza o termine di disdetta" color={C.yellow} icon={<Clock size={18} />} />
          <StatCard label="Senza decisione del BO" value={c.withoutDecision} sub="Entro 60 giorni dal termine" color={c.withoutDecision ? C.red : C.green} icon={<AlertTriangle size={18} />} />
          <StatCard label="Scaduti senza esito" value={c.missedDeadline} sub="Contratti scaduti senza rinnovo, proroga o cessazione" color={c.missedDeadline ? C.red : C.green} icon={<AlertTriangle size={18} />} />
        </Grid>
      </Section>
    </div>
  );
}
