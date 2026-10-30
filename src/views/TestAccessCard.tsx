import { useState } from "react";
import type { TestAccess } from "../types.ts";
import { portalApi } from "../api.ts";
import { btnGhost, btnPrimary, C, sans } from "../theme.ts";
import { Card, CardTitle } from "../components/ui.tsx";
import { Check, Loader2, Trash2 } from "../components/icons.tsx";
import { Notice } from "../components/vendorUi.tsx";
import { t } from "../i18n/index.ts";

/** Istruzioni da incollare in un assistente (ChatGPT, ecc.) per fargli provare il sito ruolo per ruolo. */
function briefOf(list: TestAccess[]): string {
  const url = window.location.origin;
  return [
    t(
      "Prova questo sito web come farebbe un utente vero e dimmi cosa ne pensi. Usa un browser: apri {url} ed entra con ciascuno degli accessi qui sotto, uno alla volta (esci tra un accesso e l'altro). Prova sia da schermo di computer sia da telefono (finestra stretta, circa 390 px).",
      { url },
    ),
    "",
    t("ACCESSI DI PROVA"),
    list.map(a => t("- {label}: email {email} · password {password}", { label: a.label, email: a.email, password: a.password })).join("\n"),
    "",
    t("COSA FARE PER OGNI RUOLO"),
    t(
      '- Buyer: guarda Home ("Da fare adesso"), Task (RDA, rinnovi, acquisti), Contratti, Fornitori, Spesa. Apri un task, leggi "Prossimo passo", prova a registrare il confronto tra fornitori, a creare un nuovo task e una richiesta di offerta.',
    ),
    t("- Business Owner / Richiedente: guarda le sue richieste, i suoi contratti e gli avvisi a cui rispondere."),
    t("- Controlling / CFO: deve vedere spesa, budget, indicatori e contratti ma non poter modificare nulla."),
    t("- Finance: guarda la parte fornitori (verifica Finance)."),
    t("- Fornitore: guarda i suoi dati, i documenti e le richieste di offerta."),
    "",
    t("REGOLE"),
    t("- Non cancellare dati e non importare file. Segnala soltanto, non risolvere."),
    t("- Se qualcosa non ti fa fare un passo, dimmelo: è già un'informazione utile."),
    "",
    t("COME RISPONDERE"),
    t(
      "Per ogni problema: ruolo, pagina, passi per ripeterlo, cosa ti aspettavi e cosa è successo. Poi un giudizio generale su chiarezza, semplicità e uso da telefono, e cosa cambieresti per primo.",
    ),
  ].join("\n");
}

/** Genera un accesso di prova per ogni ruolo e il testo pronto da dare a un assistente per fare un giro completo. */
export function TestAccessCard({ fail, notify }: { fail: (e: unknown) => string; notify: (m: string) => void }) {
  const [list, setList] = useState<TestAccess[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const create = async () => {
    setBusy(true);
    setErr(null);
    try {
      setList(await portalApi.testAccesses());
    } catch (e) {
      setErr(fail(e));
    }
    setBusy(false);
  };
  const remove = async () => {
    if (
      !window.confirm(
        t("Eliminare gli accessi di prova (buyer, Business Owner, Controlling, Finance)? Non si toccano i fornitori né i dati."),
      )
    )
      return;
    setBusy(true);
    setErr(null);
    try {
      const n = await portalApi.removeTestAccesses();
      setList(null);
      notify(n ? t("Accessi di prova eliminati: {n}", { n }) : t("Nessun accesso di prova da eliminare"));
    } catch (e) {
      setErr(fail(e));
    }
    setBusy(false);
  };
  const copy = async () => {
    if (!list) return;
    try {
      await navigator.clipboard.writeText(briefOf(list));
      notify(t("Testo copiato: incollalo nell'assistente"));
    } catch {
      notify(t("Copia non riuscita: selezionala a mano dal riquadro"));
    }
  };

  return (
    <Card style={{ marginBottom: 14 }}>
      <CardTitle>{t("Accessi di prova per ruolo")}</CardTitle>
      <div style={{ ...sans, fontSize: 13, color: C.muted, lineHeight: 1.5, marginBottom: 12 }}>
        {t(
          "Crea un utente per Buyer, Business Owner, Controlling/CFO e Finance, più l'accesso di un fornitore di prova, con password nuove. Ti dà anche il testo pronto da incollare in ChatGPT (o altro) per fargli fare un giro completo. Non sono mai Manager e si eliminano con un tocco. Le password si vedono solo qui, una volta.",
        )}
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button
          onClick={create}
          disabled={busy}
          style={{ ...btnPrimary, padding: "9px 16px", display: "inline-flex", alignItems: "center", gap: 7 }}
        >
          {busy ? <Loader2 className="spin" size={15} /> : <Check size={15} />}
          {list ? t("Rigenera password") : t("Crea accessi di prova")}
        </button>
        <button
          onClick={remove}
          disabled={busy}
          style={{
            ...btnGhost,
            padding: "9px 16px",
            color: C.red,
            borderColor: "#f0c9c9",
            display: "inline-flex",
            alignItems: "center",
            gap: 7,
          }}
        >
          <Trash2 size={15} />
          {t("Elimina accessi di prova")}
        </button>
      </div>
      {err && <Notice kind="error">{err}</Notice>}
      {list && (
        <>
          <div className="table-wrap" style={{ marginTop: 14 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t("Ruolo")}</th>
                  <th>{t("Email")}</th>
                  <th>{t("Password")}</th>
                </tr>
              </thead>
              <tbody>
                {list.map(a => (
                  <tr key={a.role} style={{ cursor: "default" }}>
                    <td>{a.label}</td>
                    <td style={{ overflowWrap: "anywhere" }}>{a.email}</td>
                    <td>
                      <code>{a.password}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button onClick={copy} style={{ ...btnPrimary, marginTop: 12, padding: "9px 16px" }}>
            {t("Copia il testo per ChatGPT")}
          </button>
          <textarea
            readOnly
            value={briefOf(list)}
            onFocus={e => e.currentTarget.select()}
            style={{
              ...sans,
              width: "100%",
              boxSizing: "border-box",
              height: 180,
              marginTop: 10,
              fontSize: 12,
              padding: 10,
              border: `1px solid ${C.border}`,
              borderRadius: 10,
              color: C.muted,
            }}
          />
        </>
      )}
    </Card>
  );
}
