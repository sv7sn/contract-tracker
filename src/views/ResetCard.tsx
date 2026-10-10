import { useEffect, useState } from "react";
import type { ResetArea, ResetPreview } from "../types.ts";
import { portalApi } from "../api.ts";
import { btnGhost, C, iStyle, sans } from "../theme.ts";
import { Card, CardTitle } from "../components/ui.tsx";
import { Loader2, Trash2 } from "../components/icons.tsx";
import { Notice } from "../components/vendorUi.tsx";

const AREAS: { key: ResetArea; label: string; text: string; unit: string }[] = [
  { key: "tasks", label: "Task e pratiche", text: "RDA, rinnovi, acquisti, attività, richieste di offerta e relativi documenti. Le RDA riappaiono al prossimo import SAP finché non svuoti anche i dati SAP.", unit: "task" },
  { key: "contracts", label: "Contratti", text: "Contratti con piani, storico e documenti (i task di rinnovo collegati spariscono con loro).", unit: "contratti" },
  { key: "suppliers_test", label: "Fornitori di prova", text: "Solo quelli creati con il pulsante \"Fornitore di prova\" o dalla simulazione, con i loro accessi e documenti.", unit: "fornitori" },
  { key: "suppliers_all", label: "Tutti i fornitori", text: "Anagrafica, inviti, accessi, documenti e valutazioni di TUTTI i fornitori, anche quelli veri.", unit: "fornitori" },
  { key: "sap", label: "Dati importati da SAP", text: "RDA aperte, righe d'ordine, collegamenti RDA-PO e cronologia degli import: serve per ripartire con lo storico vero.", unit: "voci" },
  { key: "budget", label: "Master Plan", text: "Tutte le versioni del budget caricate (anche la simulazione).", unit: "versioni" },
  { key: "categories", label: "Categorie merceologiche", text: "L'elenco delle categorie e i collegamenti ai gruppi merci.", unit: "categorie" },
];

/** Svuota i dati di prova prima di passare ai dati veri. Configurazione e utenti del team non si toccano. */
export function ResetCard({ fail, notify }: { fail: (e: unknown) => string; notify: (m: string) => void }) {
  const [counts, setCounts] = useState<ResetPreview | null>(null);
  const [picked, setPicked] = useState<ResetArea[]>([]);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { let off = false; portalApi.resetPreview().then(c => { if (!off) setCounts(c); }).catch(e => { if (!off) setErr(fail(e)); }); return () => { off = true; }; }, [fail]);

  const toggle = (k: ResetArea) => setPicked(p => (p.includes(k) ? p.filter(x => x !== k) : [...p, k]));
  const run = async () => {
    setBusy(true); setErr(null);
    try {
      const done = await portalApi.resetRun(picked);
      const total = Object.values(done).reduce((a, b) => a + (b ?? 0), 0);
      setCounts(await portalApi.resetPreview()); setPicked([]); setConfirm(""); notify(`Dati eliminati: ${total}`);
    } catch (e) { setErr(fail(e)); }
    setBusy(false);
  };

  return (
    <Card style={{ marginBottom: 14, borderColor: "#f0c9c9" }}>
      <CardTitle icon={<Trash2 size={16} />}>Pulizia dei dati di prova</CardTitle>
      <p style={{ ...sans, fontSize: 12.5, color: C.muted, margin: "0 0 12px", lineHeight: 1.55 }}>Per passare dai test ai dati veri: scegli cosa svuotare. <b>L'eliminazione è definitiva.</b> Non si toccano mai la configurazione (società, codici, documenti richiesti, regole), gli utenti del team e le liste sanzioni. Ogni pulizia resta nel registro modifiche.</p>
      {err && <Notice kind="error">{err}</Notice>}
      {!counts && !err && <div style={{ display: "flex", justifyContent: "center", padding: 14 }}><Loader2 className="spin" size={20} color={C.subtle} /></div>}
      {counts && <div style={{ display: "grid", gap: 8, marginBottom: 12 }}>
        {AREAS.map(a => {
          const disabled = counts[a.key] === 0 || (a.key === "suppliers_test" && picked.includes("suppliers_all"));
          return (
            <label key={a.key} style={{ ...sans, display: "flex", gap: 12, alignItems: "flex-start", padding: "10px 12px", border: `1px solid ${picked.includes(a.key) ? C.red : C.borderLight}`, borderRadius: 12, cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.55 : 1 }}>
              <input type="checkbox" checked={picked.includes(a.key)} disabled={disabled} onChange={() => toggle(a.key)} style={{ width: 17, height: 17, marginTop: 2, accentColor: C.red }} />
              <span style={{ flex: 1, minWidth: 0 }}><b style={{ fontSize: 13.5 }}>{a.label}</b><span style={{ color: C.muted, fontSize: 12.5, display: "block", lineHeight: 1.5 }}>{a.text}</span></span>
              <span className="tabular" style={{ fontSize: 12.5, fontWeight: 650, color: counts[a.key] ? C.text : C.subtle, whiteSpace: "nowrap" }}>{counts[a.key]} {a.unit}</span>
            </label>
          );
        })}
      </div>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="Scrivi ELIMINA per confermare" aria-label="Conferma" style={{ ...iStyle, width: 250 }} />
        <button onClick={run} disabled={busy || confirm !== "ELIMINA" || picked.length === 0} style={{ ...btnGhost, padding: "9px 16px", color: C.red, borderColor: C.red, display: "inline-flex", alignItems: "center", gap: 6 }}>{busy ? <Loader2 className="spin" size={14} /> : <Trash2 size={14} />}Elimina i dati selezionati</button>
      </div>
    </Card>
  );
}
