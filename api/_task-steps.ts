// Passaggi di una pratica e cosa manca per chiuderla. Stessa logica per il server (chiusura) e per l'interfaccia (linea di avanzamento).
import type { PlanStep, Task, TaskStep } from "../src/types.ts";

type Src = Pick<Task, "source" | "kind" | "status" | "meta" | "outcome" | "newContractId" | "sourcing" | "sourcingRequired" | "sourcingStatus" | "chosenSupplierId" | "contractStatus" | "contractNote" | "poNumbers" | "noPoReason" | "documents" | "pos" | "due">;

const hasIo = (t: Pick<Task, "meta">) => !!(Object.keys(t.meta.io ?? {}).length || t.meta.internalOrder);

/** Messaggio sul confronto, come lo si è sempre detto: cambia solo il nome della pratica. */
export function sourcingBlocker(t: Pick<Src, "source" | "sourcingStatus">): string {
  if (t.sourcingStatus === "pending") return "L'eccezione al confronto è in attesa del Manager";
  return t.source === "manual" ? "Acquisto sopra soglia: registra il confronto con un altro fornitore (o strategica, single source, eccezione)"
    : t.source === "contract" ? "Registra il confronto con un altro fornitore (o strategica, single source, eccezione)"
    : "RDA sopra soglia: registra il confronto con un altro fornitore (o strategica, single source, eccezione)";
}

/** Il contratto non serve a nulla da dire per rinnovi con proroga o cessazione; per RDA e acquisti si dichiara sempre. */
function contractStep(t: Src): TaskStep {
  const label = "Contratto";
  if (t.source === "contract") {
    if (!t.outcome) return { key: "contract", label, state: "todo", section: "sec-esito" };
    if (t.outcome === "renewed" || t.outcome === "replaced") return t.newContractId
      ? { key: "contract", label, state: "done", detail: "firmato", section: "sec-esito" }
      : { key: "contract", label, state: "todo", detail: "da caricare", section: "sec-esito", blocker: "Carica il nuovo contratto" };
    return { key: "contract", label, state: "done", detail: "non serve", section: "sec-esito" };
  }
  if (t.newContractId) return { key: "contract", label, state: "done", detail: "firmato", section: "sec-esito" };
  if (t.contractStatus === "signed") return { key: "contract", label, state: "done", detail: "firmato", section: "sec-pratica" };
  if (t.contractStatus === "not_needed") return { key: "contract", label, state: "done", detail: "non serve", section: "sec-pratica" };
  if (t.contractStatus === "negotiating") return { key: "contract", label, state: "todo", detail: "in negoziazione", section: "sec-pratica", blocker: "Il contratto è ancora in negoziazione" };
  return { key: "contract", label, state: "todo", section: "sec-pratica", blocker: "Indica se serve un contratto: non serve, in negoziazione o firmato" };
}

/** Passaggi in ordine di lavoro. Il primo non fatto è "qui adesso". `plan` (solo rinnovi) dà le date dell'avviso al BO e della sua risposta. */
export function taskSteps(t: Src, plan: PlanStep[] = []): TaskStep[] {
  const steps: TaskStep[] = [];
  const pdone = (id: string) => plan.find(s => s.stepId === id);
  const poKnown = t.pos.length > 0 || t.poNumbers.length > 0;
  if (t.source === "contract") {
    const n = pdone("bo_notify"), r = pdone("bo_response");
    if (n) steps.push({ key: "bo_notify", label: "Avviso BO", state: n.status === "done" || n.status === "pending_bo" ? "done" : "todo", info: true, date: n.scheduledDate, section: "sec-piano" });
    if (r) steps.push({ key: "bo_response", label: "Risposta BO", state: r.status === "done" ? "done" : "todo", info: true, date: r.scheduledDate, detail: r.boDecision ?? undefined, section: "sec-piano" });
    steps.push(t.outcome
      ? { key: "outcome", label: "Esito", state: "done", detail: t.outcome === "renewed" ? "rinnovato" : t.outcome === "replaced" ? "nuovo contratto" : t.outcome === "extended" ? "proroga" : "cessato", section: "sec-esito" }
      : { key: "outcome", label: "Esito", state: "todo", date: t.due, section: "sec-esito", blocker: "Registra prima l'esito del rinnovo: rinnovo, nuovo contratto, proroga o cessazione" });
    const needsMore = t.outcome === "renewed" || t.outcome === "replaced";
    if (t.sourcingRequired && needsMore) steps.push(t.sourcingStatus === "ok" ? { key: "supplier", label: "Fornitore", state: "done", section: "sec-sourcing" } : { key: "supplier", label: "Fornitore", state: "todo", section: "sec-sourcing", blocker: sourcingBlocker(t) });
    steps.push(contractStep(t));
    if (needsMore) steps.push(poKnown || t.noPoReason ? { key: "po", label: "PO", state: "done", detail: t.poNumbers.join(", ") || undefined, section: "sec-pratica" } : { key: "po", label: "PO", state: "todo", section: "sec-pratica", blocker: "Indica il numero di PO, oppure perché non serve" });
  } else {
    steps.push({ key: "received", label: t.source === "rda" ? "Ricevuta" : "Aperta", state: "done" });
    // Il fornitore si sceglie sempre tra quelli registrati e qualificati; sopra soglia serve anche come è stato scelto.
    const chosen = t.chosenSupplierId !== null;
    const how = !t.sourcingRequired || t.sourcingStatus === "ok";
    steps.push(chosen && how ? { key: "supplier", label: "Fornitore", state: "done", section: "sec-sourcing" }
      : { key: "supplier", label: "Fornitore", state: "todo", section: "sec-sourcing", blocker: !chosen ? "Scegli il fornitore tra quelli registrati e qualificati" : sourcingBlocker(t) });
    // Per le RDA l'internal order lo legge il sistema da SAP: il passaggio è solo un controllo. Per gli acquisti manuali lo indica il buyer.
    const ios = Object.keys(t.meta.io ?? {}); const io = ios.length ? ios.join(", ") : t.meta.internalOrder ?? "";
    steps.push(hasIo(t) ? { key: "io", label: "Internal order", state: "done", detail: io, section: "sec-pratica" }
      : { key: "io", label: "Internal order", state: "todo", detail: t.source === "rda" ? "manca in SAP" : undefined, section: "sec-pratica",
        blocker: t.source === "rda" ? "La RDA non ha l'internal order in SAP: chiedilo al richiedente (o indicalo nella pratica)" : "Manca l'internal order del Master Plan" });
    steps.push(contractStep(t));
    steps.push(t.source === "rda"
      ? (t.pos.length || t.poNumbers.length ? { key: "po", label: "PO", state: "done", detail: [...new Set([...t.pos.map(p => p.po), ...t.poNumbers])].join(", "), section: "sec-pratica" } : { key: "po", label: "PO", state: "todo", detail: "da emettere in SAP", section: "sec-pratica", blocker: "Emetti il PO in SAP: la RDA si chiude quando arriva l'ordine" })
      : (t.poNumbers.length || t.noPoReason ? { key: "po", label: "PO", state: "done", detail: t.poNumbers.join(", ") || undefined, section: "sec-pratica" } : { key: "po", label: "PO", state: "todo", section: "sec-pratica", blocker: "Indica il numero di PO, oppure perché non serve" }));
  }
  steps.push({ key: "closed", label: "Chiusa", state: t.status === "done" ? "done" : "todo" });
  // Il primo passaggio bloccante non fatto è "qui adesso".
  const cur = steps.findIndex(s => s.state !== "done" && !s.info);
  if (cur >= 0 && t.status === "open") steps[cur] = { ...steps[cur], state: "current" };
  return steps;
}

/** Primo ostacolo alla chiusura; null = tutti i passaggi sono fatti. */
export function blockerOf(steps: TaskStep[]): string | null {
  const b = steps.find(s => !s.info && s.key !== "closed" && s.state !== "done" && s.blocker);
  return b?.blocker ?? null;
}
