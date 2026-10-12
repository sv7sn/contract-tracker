import { useEffect, useState } from "react";
import type { FuncKey, ReviewRule } from "../types.ts";
import { portalApi } from "../api.ts";
import { btnPrimary, C, iStyle, sans } from "../theme.ts";
import { Card, CardTitle } from "../components/ui.tsx";
import { FUNC_LABEL } from "../clmRules.ts";
import { Scale, Trash2 } from "../components/icons.tsx";

/** Regole su chi deve rivedere una bozza: valore, dati personali, paese del fornitore. Le funzioni richieste vengono invitate da sole. */
export function ReviewRulesCard({ fail, notify }: { fail: (e: unknown) => string; notify: (m: string) => void }) {
  const [rules, setRules] = useState<ReviewRule[] | null>(null);
  const [f, setF] = useState({ func: "legal" as FuncKey, minValue: "", personalData: false, countries: "", label: "" });
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { portalApi.clm.rules().then(setRules).catch(e => setErr(fail(e))); }, [fail]);
  const cond = (r: ReviewRule) => [r.minValue ? `valore da ${r.minValue.toLocaleString("it-IT")}` : "", r.personalData ? "dati personali" : "", r.countries.length ? `fornitore in ${r.countries.join(", ")}` : ""].filter(Boolean).join(" · ") || "sempre";
  const add = async () => { try { setRules(await portalApi.clm.saveRule({ func: f.func, minValue: f.minValue === "" ? null : Number(f.minValue), personalData: f.personalData, countries: f.countries, label: f.label })); setF({ ...f, minValue: "", personalData: false, countries: "", label: "" }); setErr(null); notify("Regola aggiunta"); } catch (e) { setErr(fail(e)); } };
  const del = async (id: number) => { try { setRules(await portalApi.clm.deleteRule(id)); notify("Regola tolta"); } catch (e) { setErr(fail(e)); } };
  return (
    <Card>
      <CardTitle icon={<Scale size={16} />}>Chi rivede le bozze di contratto</CardTitle>
      <p style={{ ...sans, fontSize: 13, color: C.muted, margin: "0 0 12px", lineHeight: 1.5 }}>Quando il buyer carica o genera una bozza, le funzioni richieste da queste regole vengono invitate da sole e la firma resta bloccata finché non approvano. Il Richiedente lo sceglie il buyer.</p>
      {err && <div role="alert" style={{ ...sans, color: C.red, fontSize: 13, marginBottom: 8 }}>{err}</div>}
      <div style={{ display: "grid", gap: 6, marginBottom: 14 }}>
        {(rules ?? []).map(r => (
          <div key={r.id} style={{ ...sans, display: "flex", gap: 10, alignItems: "center", fontSize: 13, color: C.text, borderBottom: `1px solid ${C.borderLight}`, paddingBottom: 6 }}>
            <b style={{ minWidth: 100 }}>{FUNC_LABEL[r.func]}</b><span style={{ flex: 1, color: C.muted }}>{cond(r)}</span>
            <button onClick={() => del(r.id)} aria-label={`Togli la regola ${r.label}`} style={{ background: "none", border: "none", cursor: "pointer", color: C.subtle }}><Trash2 size={15} /></button>
          </div>))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8, alignItems: "end" }}>
        <label style={{ ...sans, fontSize: 12, color: C.muted, display: "grid", gap: 3 }}>Funzione<select value={f.func} onChange={e => setF({ ...f, func: e.target.value as FuncKey })} style={iStyle}>{(["legal", "compliance", "itsec"] as FuncKey[]).map(x => <option key={x} value={x}>{FUNC_LABEL[x]}</option>)}</select></label>
        <label style={{ ...sans, fontSize: 12, color: C.muted, display: "grid", gap: 3 }}>Valore minimo<input type="number" value={f.minValue} onChange={e => setF({ ...f, minValue: e.target.value })} placeholder="nessuno" style={iStyle} /></label>
        <label style={{ ...sans, fontSize: 12, color: C.muted, display: "grid", gap: 3 }}>Paesi del fornitore<input value={f.countries} onChange={e => setF({ ...f, countries: e.target.value })} placeholder="BR, CN" style={iStyle} /></label>
        <label style={{ ...sans, fontSize: 12.5, color: C.text, display: "flex", gap: 6, alignItems: "center", paddingBottom: 10 }}><input type="checkbox" checked={f.personalData} onChange={e => setF({ ...f, personalData: e.target.checked })} />Solo con dati personali</label>
        <button onClick={add} style={{ ...btnPrimary, padding: "10px 14px" }}>Aggiungi regola</button>
      </div>
    </Card>
  );
}
