import { useCallback, useEffect, useState } from "react";
import type { CategoriesView } from "../types.ts";
import { portalApi } from "../api.ts";
import { btnGhost, btnPrimary, C, iStyle, sans } from "../theme.ts";
import { fmt } from "../lib/format.ts";
import { Card, CardTitle } from "../components/ui.tsx";
import { Plus, Sparkles, Trash2, Wallet } from "../components/icons.tsx";
import { Notice } from "../components/vendorUi.tsx";

/** Categorie unificate: un solo elenco per i gruppi merci di SAP (spesa) e le categorie del Master Plan (budget). */
export function CategoriesCard({ fail, notify }: { fail: (e: unknown) => string; notify: (m: string) => void }) {
  const [v, setV] = useState<CategoriesView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const run = useCallback((p: Promise<CategoriesView>, done?: string) => p.then(x => { setV(x); setError(null); if (done) notify(done); }).catch(e => setError(fail(e))), [fail, notify]);
  useEffect(() => { let off = false; portalApi.categories().then(x => { if (!off) setV(x); }).catch(e => { if (!off) setError(fail(e)); }); return () => { off = true; }; }, [fail]);
  const unmapped = (v?.sources ?? []).filter(s => s.categoryId === null);

  return (
    <Card style={{ marginBottom: 14 }}>
      <CardTitle icon={<Wallet size={16} />}>Categorie merceologiche</CardTitle>
      <p style={{ ...sans, fontSize: 12.5, color: C.muted, margin: "0 0 12px", lineHeight: 1.55 }}>Un solo elenco per leggere insieme spesa e budget: ogni gruppo merci di SAP (che arriva dai file ordini) e ogni categoria del Master Plan si collega a una categoria. Nella pagina Spesa compare il confronto tra budget e spesa per categoria.</p>
      {error && <Notice kind="error">{error}</Notice>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Nuova categoria" aria-label="Nuova categoria" onKeyDown={e => { if (e.key === "Enter" && name.trim()) run(portalApi.saveCategory(name), "Categoria aggiunta").then(() => setName("")); }} style={{ ...iStyle, width: 240 }} />
        <button onClick={() => run(portalApi.saveCategory(name), "Categoria aggiunta").then(() => setName(""))} disabled={!name.trim()} style={{ ...btnPrimary, padding: "9px 14px", display: "inline-flex", alignItems: "center", gap: 6 }}><Plus size={15} />Aggiungi</button>
        {(v?.sources ?? []).some(s => s.kind === "mp" && s.categoryId === null) && <button onClick={() => run(portalApi.seedCategories(), "Categorie create dal Master Plan")} style={{ ...btnGhost, padding: "9px 14px", display: "inline-flex", alignItems: "center", gap: 6 }}><Sparkles size={15} />Crea dalle categorie del Master Plan</button>}
      </div>
      {v && v.categories.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
          {v.categories.map(c => <span key={c.id} style={{ ...sans, display: "inline-flex", alignItems: "center", gap: 6, background: C.bg, borderRadius: 999, padding: "4px 6px 4px 12px", fontSize: 13 }}>{c.name}
            <button onClick={() => { if (confirm(`Eliminare la categoria "${c.name}"? I collegamenti vengono tolti.`)) run(portalApi.deleteCategory(c.id)); }} aria-label={`Elimina ${c.name}`} style={{ background: "none", border: "none", cursor: "pointer", display: "flex", color: C.subtle, padding: 2 }}><Trash2 size={13} /></button></span>)}
        </div>
      )}
      {v && v.categories.length > 0 && v.buyers.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ ...sans, fontSize: 13, fontWeight: 650, marginBottom: 4 }}>Chi segue quale categoria</div>
          <div style={{ ...sans, fontSize: 12, color: C.muted, marginBottom: 8, lineHeight: 1.5 }}>Un buyer vede la spesa e il budget solo delle categorie che segue. Se non ne segue nessuna, vede tutto.</div>
          {v.unscoped.length > 0 && <Notice kind="warn">Vedono tutta la spesa perché non seguono nessuna categoria: {v.unscoped.join(", ")}.</Notice>}
          <div className="table-wrap"><table className="data-table"><thead><tr><th>Categoria</th><th>Buyer</th></tr></thead><tbody>
            {v.categories.map(c => (
              <tr key={c.id} style={{ cursor: "default" }}><td style={{ fontWeight: 650 }}>{c.name}</td><td><div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                {v.buyers.map(b => { const on = (v.assignments[c.id] ?? []).includes(b.id); return (
                  <label key={b.id} style={{ ...sans, display: "inline-flex", gap: 6, alignItems: "center", fontSize: 13, cursor: "pointer" }}>
                    <input type="checkbox" checked={on} onChange={() => run(portalApi.setCategoryBuyers(c.id, on ? (v.assignments[c.id] ?? []).filter(x => x !== b.id) : [...(v.assignments[c.id] ?? []), b.id]))} style={{ width: 16, height: 16, accentColor: C.accent }} />{b.name}</label>); })}
              </div></td></tr>
            ))}
          </tbody></table></div>
        </div>
      )}
      {v && v.sources.length > 0 && (
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>Origine</th><th>Voce</th><th className="num">Importo</th><th>Categoria</th></tr></thead>
            <tbody>{v.sources.map(s => (
              <tr key={`${s.kind}|${s.key}`} style={{ cursor: "default" }}>
                <td style={{ color: C.muted, whiteSpace: "nowrap" }}>{s.kind === "sap" ? "Gruppo merci SAP" : "Master Plan"}</td>
                <td><b className="tabular">{s.key}</b>{s.label && <span style={{ color: C.muted }}> · {s.label}</span>}</td>
                <td className="num tabular">{fmt(s.amount)}</td>
                <td><select value={s.categoryId ?? ""} onChange={e => run(portalApi.mapCategory(s.kind, s.key, e.target.value ? Number(e.target.value) : null))} aria-label={`Categoria di ${s.key}`} style={{ ...iStyle, width: "auto", minWidth: 180, padding: "6px 10px", fontSize: 13, borderColor: s.categoryId === null ? C.yellow : undefined }}>
                  <option value="">Non classificata</option>{v.categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {v && v.sources.length === 0 && <div style={{ ...sans, fontSize: 13, color: C.subtle }}>Le voci da classificare compaiono dopo il primo import del file ordini o del Master Plan.</div>}
      {unmapped.length > 0 && <div style={{ ...sans, fontSize: 12, color: C.muted, marginTop: 8 }}>{unmapped.length} voci non classificate.</div>}
    </Card>
  );
}
