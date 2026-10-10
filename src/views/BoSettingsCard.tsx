import { useEffect, useState } from "react";
import type { BoSettings } from "../types.ts";
import { portalApi } from "../api.ts";
import { btnPrimary, C, iStyle, sans } from "../theme.ts";
import { Card, CardTitle } from "../components/ui.tsx";
import { Loader2, Save, Send } from "../components/icons.tsx";
import { Notice } from "../components/vendorUi.tsx";

/** Invio automatico degli avvisi ai Business Owner: spento finché non lo si accende, così durante i test non partono email. */
export function BoSettingsCard({ fail, notify }: { fail: (e: unknown) => string; notify: (m: string) => void }) {
  const [s, setS] = useState<BoSettings | null>(null);
  const [days, setDays] = useState("7");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { let off = false; portalApi.boSettings().then(x => { if (!off) { setS(x); setDays(String(x.reminderDays)); } }).catch(e => { if (!off) setErr(fail(e)); }); return () => { off = true; }; }, [fail]);
  const save = async (patch: Partial<BoSettings>) => {
    setBusy(true); setErr(null);
    try { const x = await portalApi.saveBoSettings(patch); setS(x); setDays(String(x.reminderDays)); notify("Impostazioni salvate"); } catch (e) { setErr(fail(e)); }
    setBusy(false);
  };
  return (
    <Card style={{ marginBottom: 14 }}>
      <CardTitle icon={<Send size={16} />}>Avvisi ai Business Owner</CardTitle>
      <p style={{ ...sans, fontSize: 12.5, color: C.muted, margin: "0 0 12px", lineHeight: 1.55 }}>Il buyer può sempre inviare e reinviare gli avvisi dal contratto. Con l'invio automatico l'avviso parte da solo alla data prevista dal piano e, se il Business Owner non risponde, parte un sollecito ogni pochi giorni (al massimo 3). Tienilo <b>spento</b> mentre provi il sistema con dati veri: altrimenti le email partirebbero davvero.</p>
      {err && <Notice kind="error">{err}</Notice>}
      {!s && !err && <Loader2 className="spin" size={18} color={C.subtle} />}
      {s && <>
        <label style={{ ...sans, display: "flex", gap: 10, alignItems: "center", fontSize: 13.5, cursor: "pointer", marginBottom: 12 }}>
          <input type="checkbox" checked={s.auto} disabled={busy} onChange={e => save({ auto: e.target.checked })} style={{ width: 18, height: 18, accentColor: C.accent }} />
          Invio automatico degli avvisi e dei solleciti <b style={{ color: s.auto ? C.green : C.muted }}>{s.auto ? "ACCESO" : "spento"}</b>
        </label>
        <div style={{ ...sans, display: "flex", alignItems: "center", gap: 8, fontSize: 13, flexWrap: "wrap" }}>
          <span>Sollecito ogni</span><input value={days} onChange={e => setDays(e.target.value.replace(/[^0-9]/g, ""))} aria-label="Giorni tra i solleciti" inputMode="numeric" style={{ ...iStyle, width: 70, padding: "6px 10px" }} /><span>giorni senza risposta</span>
          <button onClick={() => save({ reminderDays: Number(days) })} disabled={busy || !days || Number(days) === s.reminderDays} style={{ ...btnPrimary, padding: "7px 14px", fontSize: 12.5, display: "inline-flex", alignItems: "center", gap: 6 }}><Save size={14} />Salva</button>
        </div>
      </>}
    </Card>
  );
}
