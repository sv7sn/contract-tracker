import { useEffect, useState } from "react";
import type { Contract, RdaStage, Requests, User } from "../types.ts";
import { portalApi } from "../api.ts";
import { btnGhost, btnPrimary, C, font, radius, sans } from "../theme.ts";
import { fmt, fmtDate } from "../lib/format.ts";
import { Card, EmptyState, Grid, StatCard } from "../components/ui.tsx";
import { AlertTriangle, CheckCircle2, ClipboardCheck, FileText, Inbox, Loader2 } from "../components/icons.tsx";

const STAGE_COLOR: Record<RdaStage, [string, string]> = { received: [C.muted, C.bg], working: [C.blue, C.blueBg], rfq: [C.purple, C.purpleBg], chosen: [C.accent, C.accentLight], ordered: [C.green, C.greenBg], closed: [C.muted, C.bg] };

/** Area del Business Owner / Richiedente: le sue RDA (sola lettura) e i suoi contratti con lo stato del lavoro del buyer. */
export function RequestsView({ currentUser, contracts, onOpenBOForm, onOpenContract, onSessionExpired }: { currentUser: User; contracts: Contract[]; onOpenBOForm: (c: Contract) => void; onOpenContract: (c: Contract) => void; onSessionExpired: () => void }) {
  const [data, setData] = useState<Requests | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { let off = false; portalApi.myRequests().then(x => { if (!off) setData(x); }).catch(e => { if (!off) { if (e?.status === 401) onSessionExpired(); setError(e instanceof Error ? e.message : "Caricamento non riuscito"); } }); return () => { off = true; }; }, [onSessionExpired]);

  if (error) return <EmptyState icon={<AlertTriangle size={26} />} title="Impossibile caricare le tue pratiche" text={error} />;
  if (!data) return <div style={{ display: "flex", justifyContent: "center", padding: 60 }}><Loader2 className="spin" size={26} color={C.subtle} /></div>;
  const toAnswer = data.contracts.filter(c => c.state === "to_answer");
  const find = (id: number) => contracts.find(c => c.id === id);
  const open = data.rdas.filter(r => r.stage !== "ordered" && r.stage !== "closed");

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <div>
        <h2 style={{ ...font, margin: 0, fontSize: 22, fontWeight: 700, color: C.text }}>Le tue pratiche, {currentUser.name.split(" ")[0]}</h2>
        <p style={{ ...sans, margin: "4px 0 0", fontSize: 13.5, color: C.muted }}>Le RDA che hai aperto in SAP e i contratti di cui sei responsabile, con lo stato del lavoro dell'ufficio acquisti.</p>
      </div>
      <Grid min={200} fill>
        <StatCard label="Da rispondere" value={toAnswer.length} color={toAnswer.length ? C.yellow : C.green} icon={<ClipboardCheck size={18} />} sub={toAnswer.length ? "serve la tua decisione" : "nessuna richiesta"} />
        <StatCard label="RDA in corso" value={open.length} color={C.blue} icon={<Inbox size={18} />} sub={`${data.rdas.length - open.length} concluse di recente`} />
        <StatCard label="Contratti" value={data.contracts.length} color={C.accent} icon={<FileText size={18} />} sub="attivi, a te assegnati" />
      </Grid>

      {toAnswer.length > 0 && (
        <section>
          <h3 style={{ ...font, fontSize: 15, margin: "0 0 10px", color: C.text }}>Serve la tua risposta</h3>
          <div style={{ display: "grid", gap: 10 }}>
            {toAnswer.map(c => (
              <Card key={c.contractId} style={{ borderLeft: `4px solid ${C.yellow}`, borderRadius: radius.md, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                <div style={{ flex: "1 1 260px", minWidth: 0 }}>
                  <div style={{ ...sans, fontSize: 14, fontWeight: 650 }}>{c.title}</div>
                  <div style={{ ...sans, fontSize: 12.5, color: C.muted }}>Scadenza o termine di disdetta: {fmtDate(c.keyDate)}{c.task ? ` · ${c.task.buyerName || "buyer"} aspetta la tua decisione per procedere` : ""}</div>
                </div>
                {find(c.contractId) && <button onClick={() => onOpenBOForm(find(c.contractId)!)} style={{ ...btnPrimary, padding: "9px 16px" }}>Rispondi</button>}
              </Card>
            ))}
          </div>
        </section>
      )}

      <section>
        <h3 style={{ ...font, fontSize: 15, margin: "0 0 10px", color: C.text }}>Le tue RDA</h3>
        {!data.sapUser && <Card style={{ background: C.yellowBg, borderColor: "#f3dca0", ...sans, fontSize: 13, color: C.yellow }}>Il tuo codice utente SAP non è impostato: chiedi al Manager di inserirlo nel tuo profilo, così potrai vedere le RDA che apri.</Card>}
        {data.sapUser && data.rdas.length === 0 && <div style={{ ...sans, fontSize: 13, color: C.subtle }}>Nessuna RDA aperta a nome di {data.sapUser} negli ultimi 60 giorni.</div>}
        <div style={{ display: "grid", gap: 8 }}>
          {data.rdas.map(r => (
            <Card key={r.pr} style={{ padding: "12px 16px", borderRadius: radius.md }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <div style={{ flex: "1 1 260px", minWidth: 0 }}>
                  <div style={{ ...sans, fontSize: 13.5, fontWeight: 650 }}>RDA {r.pr} · {r.title}</div>
                  <div style={{ ...sans, fontSize: 12.5, color: C.muted }}>{fmt(r.value, r.currency)}{r.releaseDate ? ` · approvata il ${fmtDate(r.releaseDate)}` : ""}{r.buyerName ? ` · segue ${r.buyerName}` : ""}</div>
                </div>
                <span style={{ ...sans, fontSize: 12, fontWeight: 650, color: STAGE_COLOR[r.stage][0], background: STAGE_COLOR[r.stage][1], borderRadius: 999, padding: "4px 11px" }}>{r.stageLabel}</span>
              </div>
              {r.io && <div style={{ ...sans, fontSize: 12, color: C.subtle, marginTop: 6 }}>Budget {r.io}{r.budget && r.budget.residual !== null ? <> · residuo <b style={{ color: r.budget.residual < 0 ? C.red : C.text }}>{fmt(r.budget.residual)}</b> su {fmt(r.budget.current ?? 0)}</> : ""}</div>}
            </Card>
          ))}
        </div>
      </section>

      <section>
        <h3 style={{ ...font, fontSize: 15, margin: "0 0 10px", color: C.text }}>I tuoi contratti</h3>
        {data.contracts.length === 0 && <div style={{ ...sans, fontSize: 13, color: C.subtle }}>Nessun contratto attivo a tuo nome.</div>}
        <div style={{ display: "grid", gap: 8 }}>
          {data.contracts.map(c => (
            <Card key={c.contractId} style={{ padding: "12px 16px", borderRadius: radius.md, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 260px", minWidth: 0 }}>
                <div style={{ ...sans, fontSize: 13.5, fontWeight: 650 }}>{c.title}</div>
                <div style={{ ...sans, fontSize: 12.5, color: C.muted }}>
                  {c.state === "answered" ? <><CheckCircle2 size={13} color={C.green} style={{ verticalAlign: "-2px" }} /> Hai risposto: {c.decision || "decisione registrata"}</> : c.state === "to_answer" ? "Serve la tua risposta" : `Avviso previsto il ${c.noticeDate ? fmtDate(c.noticeDate) : "—"}`}
                  {c.task && ` · rinnovo ${c.task.status === "open" ? `in lavorazione${c.task.buyerName ? ` con ${c.task.buyerName}` : ""}` : "concluso"}`} · scadenza {fmtDate(c.keyDate)}
                </div>
              </div>
              {c.unreadMessages > 0 && <span style={{ ...sans, fontSize: 12, fontWeight: 650, color: C.blue, background: C.blueBg, borderRadius: 999, padding: "4px 10px" }}>{c.unreadMessages} {c.unreadMessages === 1 ? "messaggio nuovo" : "messaggi nuovi"}</span>}
              {find(c.contractId) && <button onClick={() => onOpenContract(find(c.contractId)!)} style={{ ...btnGhost, padding: "7px 14px", fontSize: 12.5 }}>Apri</button>}
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
