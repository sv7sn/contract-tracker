import { useState } from "react";
import type { TestAccess } from "../types.ts";
import { portalApi } from "../api.ts";
import { btnGhost, btnPrimary, C, sans } from "../theme.ts";
import { Card, CardTitle } from "../components/ui.tsx";
import { Check, Loader2, Trash2 } from "../components/icons.tsx";
import { Notice } from "../components/vendorUi.tsx";

/** Istruzioni da incollare in un assistente (ChatGPT, ecc.) per fargli provare il sito ruolo per ruolo. */
function briefOf(list: TestAccess[]): string {
  const url = window.location.origin;
  return `Prova questo sito web come farebbe un utente vero e dimmi cosa ne pensi. Usa un browser: apri ${url} ed entra con ciascuno degli accessi qui sotto, uno alla volta (esci tra un accesso e l'altro). Prova sia da schermo di computer sia da telefono (finestra stretta, circa 390 px).

ACCESSI DI PROVA
${list.map(a => `- ${a.label}: email ${a.email} · password ${a.password}`).join("\n")}

COSA FARE PER OGNI RUOLO
- Buyer: guarda Home ("Da fare adesso"), Task (RDA, rinnovi, acquisti), Contratti, Fornitori, Spesa. Apri un task, leggi "Prossimo passo", prova a registrare il confronto tra fornitori, a creare un nuovo task e una richiesta di offerta.
- Business Owner / Richiedente: guarda le sue richieste, i suoi contratti e gli avvisi a cui rispondere.
- Controlling / CFO: deve vedere spesa, budget, indicatori e contratti ma non poter modificare nulla.
- Finance: guarda la parte fornitori (verifica Finance).
- Fornitore: guarda i suoi dati, i documenti e le richieste di offerta.

REGOLE
- Non cancellare dati e non importare file. Segnala soltanto, non risolvere.
- Se qualcosa non ti fa fare un passo, dimmelo: è già un'informazione utile.

COME RISPONDERE
Per ogni problema: ruolo, pagina, passi per ripeterlo, cosa ti aspettavi e cosa è successo. Poi un giudizio generale su chiarezza, semplicità e uso da telefono, e cosa cambieresti per primo.`;
}

/** Genera un accesso di prova per ogni ruolo e il testo pronto da dare a un assistente per fare un giro completo. */
export function TestAccessCard({ fail, notify }: { fail: (e: unknown) => string; notify: (m: string) => void }) {
  const [list, setList] = useState<TestAccess[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const create = async () => {
    setBusy(true); setErr(null);
    try { setList(await portalApi.testAccesses()); } catch (e) { setErr(fail(e)); }
    setBusy(false);
  };
  const remove = async () => {
    if (!window.confirm("Eliminare gli accessi di prova (buyer, Business Owner, Controlling, Finance)? Non si toccano i fornitori né i dati.")) return;
    setBusy(true); setErr(null);
    try { const n = await portalApi.removeTestAccesses(); setList(null); notify(n ? `Accessi di prova eliminati: ${n}` : "Nessun accesso di prova da eliminare"); } catch (e) { setErr(fail(e)); }
    setBusy(false);
  };
  const copy = async () => {
    if (!list) return;
    try { await navigator.clipboard.writeText(briefOf(list)); notify("Testo copiato: incollalo nell'assistente"); } catch { notify("Copia non riuscita: selezionala a mano dal riquadro"); }
  };

  return (
    <Card style={{ marginBottom: 14 }}>
      <CardTitle>Accessi di prova per ruolo</CardTitle>
      <div style={{ ...sans, fontSize: 13, color: C.muted, lineHeight: 1.5, marginBottom: 12 }}>
        Crea un utente per Buyer, Business Owner, Controlling/CFO e Finance, più l'accesso di un fornitore di prova, con password nuove. Ti dà anche il testo pronto da incollare in ChatGPT (o altro) per fargli fare un giro completo. Non sono mai Manager e si eliminano con un tocco. Le password si vedono solo qui, una volta.
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button onClick={create} disabled={busy} style={{ ...btnPrimary, padding: "9px 16px", display: "inline-flex", alignItems: "center", gap: 7 }}>{busy ? <Loader2 className="spin" size={15} /> : <Check size={15} />}{list ? "Rigenera password" : "Crea accessi di prova"}</button>
        <button onClick={remove} disabled={busy} style={{ ...btnGhost, padding: "9px 16px", color: C.red, borderColor: "#f0c9c9", display: "inline-flex", alignItems: "center", gap: 7 }}><Trash2 size={15} />Elimina accessi di prova</button>
      </div>
      {err && <Notice kind="error">{err}</Notice>}
      {list && (<>
        <div className="table-wrap" style={{ marginTop: 14 }}>
          <table className="data-table"><thead><tr><th>Ruolo</th><th>Email</th><th>Password</th></tr></thead>
            <tbody>{list.map(a => <tr key={a.role} style={{ cursor: "default" }}><td>{a.label}</td><td style={{ overflowWrap: "anywhere" }}>{a.email}</td><td><code>{a.password}</code></td></tr>)}</tbody></table>
        </div>
        <button onClick={copy} style={{ ...btnPrimary, marginTop: 12, padding: "9px 16px" }}>Copia il testo per ChatGPT</button>
        <textarea readOnly value={briefOf(list)} onFocus={e => e.currentTarget.select()} style={{ ...sans, width: "100%", boxSizing: "border-box", height: 180, marginTop: 10, fontSize: 12, padding: 10, border: `1px solid ${C.border}`, borderRadius: 10, color: C.muted }} />
      </>)}
    </Card>
  );
}
