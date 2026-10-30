import { useCallback, useEffect, useState } from "react";
import type { ClmKpis, Kpis } from "../types.ts";
import { FUNC_LABEL } from "../clmRules.ts";
import { ApiError, portalApi } from "../api.ts";
import { btnGhost, C, font, sans } from "../theme.ts";
import { fmt } from "../lib/format.ts";
import { EmptyState, Grid, StatCard } from "../components/ui.tsx";
import { HBars, MonthColumns } from "../components/charts.tsx";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  Clock,
  FileText,
  Hourglass,
  Inbox,
  Loader2,
  RotateCcw,
  Scale,
  ShieldCheck,
  ChevronDown,
  Users,
} from "../components/icons.tsx";
import { locale, t } from "../i18n/index.ts";

const days = (n: number | null) => (n === null ? "—" : t("{n} gg", { n }));
const pct = (n: number | null) => (n === null ? "—" : `${n}%`);

/** Sezione apribile: da chiusa mostra i numeri chiave; ricorda quali sezioni l'utente tiene aperte. */
function Section({
  id,
  icon,
  title,
  text,
  summary,
  alert,
  children,
}: {
  id: string;
  icon: React.ReactNode;
  title: string;
  text: string;
  summary: string;
  alert?: boolean;
  children: React.ReactNode;
}) {
  const key = `pl-kpi-open-${id}`;
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
    <section
      style={{
        background: "#fff",
        border: `1px solid ${alert ? "#f0c9c9" : C.border}`,
        borderRadius: 16,
        overflow: "hidden",
        marginBottom: 12,
      }}
    >
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
            color: alert ? C.red : C.accent,
            background: alert ? C.redBg : C.accentLight,
            borderRadius: 10,
            padding: 8,
          }}
        >
          {icon}
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ ...font, display: "block", fontSize: 15, fontWeight: 700, color: C.text }}>{title}</span>
          <span style={{ ...sans, display: "block", fontSize: 12.5, color: alert ? C.red : C.muted, marginTop: 2 }}>{summary}</span>
        </span>
        <ChevronDown
          size={18}
          color={C.subtle}
          style={{ transform: open ? "rotate(180deg)" : undefined, transition: "transform .15s", flexShrink: 0 }}
        />
      </button>
      {open && (
        <div style={{ borderTop: `1px solid ${C.borderLight}`, background: C.bg, padding: 14 }}>
          <p style={{ ...sans, fontSize: 12.5, color: C.muted, margin: "0 0 12px", lineHeight: 1.5 }}>{text}</p>
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "minmax(0, 1fr)" }}>{children}</div>
        </div>
      )}
    </section>
  );
}

/** Indicatori di processo per il Manager: tempi, rispetto delle regole e colli di bottiglia. */
export function KpiView({
  onSessionExpired,
  team,
  teamSummary,
}: {
  onSessionExpired: () => void;
  team?: React.ReactNode;
  teamSummary?: string;
}) {
  const [k, setK] = useState<Kpis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clm, setClm] = useState<ClmKpis | null>(null);
  useEffect(() => {
    portalApi.clm
      .kpis()
      .then(setClm)
      .catch(() => setClm(null));
  }, []);
  const fail = useCallback(
    (err: unknown) => {
      if (err instanceof ApiError && err.status === 401) {
        onSessionExpired();
        return t("Sessione scaduta");
      }
      return err instanceof Error ? err.message : t("Caricamento non riuscito");
    },
    [onSessionExpired],
  );
  const load = useCallback(
    () =>
      portalApi
        .kpis()
        .then(x => {
          setK(x);
          setError(null);
        })
        .catch(err => setError(fail(err))),
    [fail],
  );
  useEffect(() => {
    let off = false;
    portalApi
      .kpis()
      .then(x => {
        if (!off) setK(x);
      })
      .catch(err => {
        if (!off) setError(fail(err));
      });
    return () => {
      off = true;
    };
  }, [fail]);

  if (error)
    return (
      <EmptyState
        icon={<AlertTriangle size={26} />}
        title={t("Impossibile calcolare gli indicatori")}
        text={error}
        action={
          <button onClick={load} style={{ ...btnGhost, padding: "9px 16px" }}>
            {t("Riprova")}
          </button>
        }
      />
    );
  if (!k)
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: 60 }}>
        <Loader2 className="spin" size={26} color={C.subtle} />
      </div>
    );
  const r = k.rda,
    s = k.sourcing,
    o = k.onboarding,
    q = k.qualification,
    c = k.contracts;
  const srcPct = s.required90 ? Math.round((s.compliant90 / s.required90) * 100) : null;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ ...sans, fontSize: 12.5, color: C.muted }}>
          {t("Calcolati il {when} · periodo: ultimi 90 giorni dove non indicato", {
            when: new Date(k.generatedAt).toLocaleString(locale(), { dateStyle: "medium", timeStyle: "short" }),
          })}
        </div>
        <button
          onClick={load}
          style={{ ...btnGhost, display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 12px", fontSize: 12.5 }}
        >
          <RotateCcw size={14} />
          {t("Aggiorna")}
        </button>
      </div>

      <Section
        id="rda"
        icon={<Inbox size={18} />}
        summary={t("{open} aperte · {late} in ritardo · RDA → PO {d}", { open: r.open, late: r.overdue, d: days(r.medianCycleDays) })}
        alert={r.overdue > 0}
        title={t("RDA e ordini")}
        text={t("Dal rilascio della RDA in SAP alla creazione del PO. Tempo previsto per lavorare una RDA: {n} giorni.", { n: r.slaDays })}
      >
        <Grid min={180} gap={12} fill>
          <StatCard
            label={t("RDA aperte")}
            value={r.open}
            sub={t("{n} oltre i {d} giorni previsti", { n: r.overdue, d: r.slaDays })}
            color={C.blue}
            icon={<Inbox size={18} />}
          />
          <StatCard
            label={t("Chiuse nei tempi")}
            value={pct(r.withinSla90)}
            sub={t("su {n} chiuse negli ultimi 90 giorni", { n: r.closed90 })}
            color={C.green}
            icon={<CheckCircle2 size={18} />}
          />
          <StatCard
            label={t("Tempo RDA → PO")}
            value={days(r.medianCycleDays)}
            sub={t("Mediana, ultimi 90 giorni")}
            color={C.accent}
            icon={<Clock size={18} />}
          />
        </Grid>
        <Grid min={340} gap={14}>
          <HBars
            title={t("Età delle RDA aperte")}
            subtitle={t("Giorni dal rilascio in SAP")}
            data={r.aging.map(a => ({ ...a, label: t(a.label) }))}
            empty={t("Nessuna RDA aperta")}
          />
          <MonthColumns
            title={t("Tempo RDA → PO per mese")}
            subtitle={t("Mediana in giorni delle RDA diventate ordine")}
            unit={t("giorni")}
            valueHead={t("Mediana (giorni)")}
            data={r.monthly.map(m => ({
              month: m.month,
              value: m.medianDays,
              note: m.closed === 1 ? t("1 RDA chiusa con PO") : t("{n} RDA chiuse con PO", { n: m.closed }),
            }))}
          />
        </Grid>
        {r.byBuyer.length > 0 && (
          <HBars
            title={t("RDA aperte per buyer")}
            subtitle={t("In ritardo: {list}", {
              list:
                r.byBuyer
                  .filter(b => b.overdue)
                  .map(b => `${b.name} ${b.overdue}`)
                  .join(", ") || t("nessuna"),
            })}
            data={r.byBuyer.map(b => ({ label: b.name, n: b.open }))}
          />
        )}
      </Section>

      <Section
        id="sourcing"
        icon={<Scale size={18} />}
        summary={t("{p} documentate · {n} aperte senza confronto · {e} eccezioni da approvare", {
          p: pct(srcPct),
          n: s.openMissing,
          e: s.exceptionsPending,
        })}
        alert={s.openMissing > 0 || s.exceptionsPending > 0}
        title={t("Scelta del fornitore")}
        text={t(
          "RDA e nuovi contratti sopra {amount}: confronto con almeno un altro fornitore, oppure fornitura strategica, single source o eccezione approvata. Il saving si calcola sul prezzo di riferimento, sulla media delle offerte o sulla negoziazione.",
          { amount: fmt(s.threshold) },
        )}
      >
        <Grid min={180} gap={12} fill>
          <StatCard
            label={t("RDA documentate")}
            value={pct(srcPct)}
            sub={t("{n} su {m} chiuse sopra soglia", { n: s.compliant90, m: s.required90 })}
            color={srcPct === null || srcPct >= 90 ? C.green : C.red}
            icon={<Scale size={18} />}
          />
          <StatCard
            label={t("Aperte senza confronto")}
            value={s.openMissing}
            sub={t("Da documentare prima della chiusura")}
            color={C.yellow}
            icon={<AlertTriangle size={18} />}
          />
          <StatCard
            label={t("Saving ultimi 12 mesi")}
            value={fmt(s.saving12m)}
            sub={
              s.savingCount12m
                ? t("{n} pratiche", { n: s.savingCount12m }) +
                  (s.savingPct12m !== null ? " · " + t("{p}% in media", { p: s.savingPct12m }) : "")
                : t("Nessun saving registrato")
            }
            color={C.green}
            icon={<CheckCircle2 size={18} />}
          />
          <StatCard
            label={t("Eccezioni da approvare")}
            value={s.exceptionsPending}
            sub={t("In attesa del Manager")}
            color={C.purple}
            icon={<Hourglass size={18} />}
          />
        </Grid>
        <HBars
          title={t("Come è stato scelto il fornitore")}
          subtitle={t("RDA sopra soglia documentate negli ultimi 90 giorni")}
          data={s.byMode.map(m => ({ ...m, label: t(m.label) }))}
          empty={t("Nessuna scelta documentata nel periodo")}
        />
      </Section>

      <Section
        id="suppliers"
        icon={<Building2 size={18} />}
        summary={t("{l} con qualifica scaduta · {s} onboarding fermi", { l: q.lapsed, s: o.stuckAtBuyer + o.stuckAtFinance })}
        alert={q.lapsed > 0}
        title={t("Fornitori")}
        text={t("Onboarding (dall'invito alla registrazione in SAP) e stato della qualifica dei fornitori registrati.")}
      >
        <Grid min={180} gap={12} fill>
          <StatCard
            label={t("Invito → registrazione")}
            value={days(o.medianDaysToRegister)}
            sub={t("Mediana su {n} registrati in 12 mesi", { n: o.registered12m })}
            color={C.accent}
            icon={<Clock size={18} />}
          />
          <StatCard
            label={t("Fermi dal Buyer")}
            value={o.stuckAtBuyer}
            sub={t("In verifica da oltre 7 giorni")}
            color={o.stuckAtBuyer ? C.red : C.green}
            icon={<Hourglass size={18} />}
          />
          <StatCard
            label={t("Fermi dal Finance")}
            value={o.stuckAtFinance}
            sub={t("Da registrare da oltre 5 giorni")}
            color={o.stuckAtFinance ? C.red : C.green}
            icon={<Hourglass size={18} />}
          />
        </Grid>
        <Grid min={180} gap={12} fill>
          <StatCard
            label={t("Qualifica valida")}
            value={q.valid}
            sub={t("Documenti obbligatori in regola")}
            color={C.green}
            icon={<ShieldCheck size={18} />}
          />
          <StatCard
            label={t("In scadenza")}
            value={q.expiring}
            sub={t("Documenti che scadono a breve")}
            color={C.yellow}
            icon={<Clock size={18} />}
          />
          <StatCard
            label={t("Qualifica scaduta")}
            value={q.lapsed}
            sub={t("Da sollecitare o bloccare")}
            color={C.red}
            icon={<AlertTriangle size={18} />}
          />
          <StatCard
            label={t("Bloccati")}
            value={q.blocked}
            sub={t("Fornitori registrati e bloccati")}
            color={C.gray}
            icon={<Building2 size={18} />}
          />
        </Grid>
        <HBars
          title={t("Onboarding in corso")}
          subtitle={t("Fornitori per fase")}
          data={o.inProgress.map(p => ({ ...p, label: t(p.label) }))}
          empty={t("Nessun onboarding in corso")}
        />
      </Section>

      <Section
        id="contracts"
        icon={<FileText size={18} />}
        summary={t("{a} attivi · {n} in scadenza entro 90 giorni · {m} scaduti senza esito", {
          a: c.active,
          n: c.keyNext90,
          m: c.missedDeadline,
        })}
        alert={c.missedDeadline > 0}
        title={t("Contratti")}
        text={t("Le scadenze si contano dalla data limite di disdetta quando il contratto prevede un preavviso.")}
      >
        <Grid min={180} gap={12} fill>
          <StatCard
            label={t("Contratti attivi")}
            value={c.active}
            sub={t("{n} con preavviso di disdetta", { n: c.withNotice })}
            color={C.blue}
            icon={<FileText size={18} />}
          />
          <StatCard
            label={t("Scadenze entro 90 giorni")}
            value={c.keyNext90}
            sub={t("Compresi quelli entro 30 giorni · scadenza o disdetta")}
            color={C.yellow}
            icon={<Clock size={18} />}
          />
          <StatCard
            label={t("Senza decisione del BO")}
            value={c.withoutDecision}
            sub={t("Entro 60 giorni dal termine")}
            color={c.withoutDecision ? C.red : C.green}
            icon={<AlertTriangle size={18} />}
          />
          <StatCard
            label={t("Scaduti senza esito")}
            value={c.missedDeadline}
            sub={t("Contratti scaduti senza rinnovo, proroga o cessazione")}
            color={c.missedDeadline ? C.red : C.green}
            icon={<AlertTriangle size={18} />}
          />
        </Grid>
      </Section>

      {clm && clm.drafts > 0 && (
        <Section
          id="clm"
          icon={<Scale size={18} />}
          summary={t(clm.inReview === 1 ? "1 bozza in revisione · ciclo medio {d}" : "{n} bozze in revisione · ciclo medio {d}", {
            n: clm.inReview,
            d: days(clm.cycleDays === null ? null : Math.round(clm.cycleDays)),
          })}
          alert={clm.funcs.some(f => f.overdue > 0)}
          title={t("Revisione dei contratti")}
          text={t(
            "Tempi delle funzioni (Richiedente, Legal, Compliance, IT Security) sulle bozze: dall'invito al parere, e rispetto della scadenza data.",
          )}
        >
          <Grid min={180} gap={12} fill>
            <StatCard
              label={t("Bozze in revisione")}
              value={clm.inReview}
              sub={t("{n} task con una bozza", { n: clm.drafts })}
              color={C.blue}
              icon={<FileText size={18} />}
            />
            <StatCard
              label={t("Ciclo completo")}
              value={days(clm.cycleDays === null ? null : Math.round(clm.cycleDays))}
              sub={t("Dalla prima bozza all'ultimo parere positivo")}
              color={C.accent}
              icon={<Clock size={18} />}
            />
            <StatCard
              label={t("Versioni per contratto")}
              value={clm.avgVersions ?? "—"}
              sub={t("Media di versioni caricate")}
              color={C.purple}
              icon={<Scale size={18} />}
            />
          </Grid>
          <div style={{ ...sans, display: "grid", gap: 6, fontSize: 13, color: C.text }}>
            {clm.funcs.map(f => (
              <div
                key={f.func}
                style={{ display: "flex", gap: 14, flexWrap: "wrap", borderBottom: `1px solid ${C.borderLight}`, paddingBottom: 6 }}
              >
                <b style={{ minWidth: 110 }}>{t(FUNC_LABEL[f.func])}</b>
                <span>{t("{n} pareri", { n: f.decided })}</span>
                <span>{t("tempo medio {d}", { d: f.avgDays === null ? "—" : t("{n} gg", { n: f.avgDays }) })}</span>
                <span>{t("nei tempi {p}", { p: pct(f.onTimePct) })}</span>
                <span style={{ color: f.overdue ? C.red : C.muted }}>
                  {t("{n} in attesa", { n: f.pending })}
                  {f.overdue ? " " + t("({n} in ritardo)", { n: f.overdue }) : ""}
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {team && (
        <Section
          id="team"
          icon={<Users size={18} />}
          summary={teamSummary ?? ""}
          title={t("Carico del team")}
          text={t("Passaggi dei piani di rinnovo per mese e per buyer, con i suggerimenti per anticipare quando un mese è troppo carico.")}
        >
          {team}
        </Section>
      )}
    </div>
  );
}
