import { useEffect, useState } from "react";
import type { CoverView, User } from "../types.ts";
import { portalApi } from "../api.ts";
import { btnPrimary, C, iStyle, sans } from "../theme.ts";
import { fmtDate } from "../lib/format.ts";
import { Card } from "../components/ui.tsx";
import { CalendarClock, Loader2, Trash2 } from "../components/icons.tsx";
import { Notice } from "../components/vendorUi.tsx";

const plus = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

/** Assenze e sostituti: nel periodo indicato il sostituto vede e gestisce le pratiche dell'assente. */
export function CoverCard({ user, defaultOpen = false }: { user: User; defaultOpen?: boolean }) {
  const [v, setV] = useState<CoverView | null>(null);
  const [absent, setAbsent] = useState<number>(user.id);
  const [sub, setSub] = useState<number | "">("");
  const [from, setFrom] = useState(plus(0));
  const [to, setTo] = useState(plus(7));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { let off = false; portalApi.cover().then(x => { if (!off) setV(x); }).catch(e => { if (!off) setErr(e instanceof Error ? e.message : "Caricamento non riuscito"); }); return () => { off = true; }; }, []);
  const manager = user.role === "manager";
  const run = async (f: () => Promise<CoverView>) => { setBusy(true); setErr(null); try { setV(await f()); } catch (e) { setErr(e instanceof Error ? e.message : "Operazione non riuscita"); } setBusy(false); };

  return (
    <Card style={{ marginBottom: 18, padding: 0 }}>
      <details open={defaultOpen || undefined}>
        <summary style={{ ...sans, cursor: "pointer", padding: "14px 20px", fontSize: 14, fontWeight: 650, display: "flex", alignItems: "center", gap: 8 }}><CalendarClock size={16} />Assenze e sostituzioni{v && v.entries.length > 0 ? <span style={{ fontWeight: 500, color: C.muted, fontSize: 12.5 }}>· {v.entries.length} {v.entries.length === 1 ? "registrata" : "registrate"}</span> : null}</summary>
        <div style={{ padding: "0 20px 16px" }}>
          <p style={{ ...sans, fontSize: 12.5, color: C.muted, margin: "0 0 10px", lineHeight: 1.55 }}>Se ti assenti, indica chi ti sostituisce: nel periodo vedrà e potrà gestire le tue pratiche (task, contratti, fornitori, richieste di offerta). L'accesso finisce da solo alla data indicata.</p>
          {err && <Notice kind="error">{err}</Notice>}
          {!v && !err && <Loader2 className="spin" size={18} color={C.subtle} />}
          {v && <>
            {v.entries.map(e => (
              <div key={e.id} style={{ ...sans, display: "flex", gap: 10, alignItems: "center", padding: "7px 0", borderTop: `1px solid ${C.borderLight}`, fontSize: 13, flexWrap: "wrap" }}>
                <span style={{ flex: "1 1 260px" }}><b>{e.userName}</b> → {e.substituteName} · dal {fmtDate(e.from)} al {fmtDate(e.to)}{e.active && <span style={{ color: C.green, fontWeight: 650 }}> · in corso</span>}</span>
                {(manager || e.userId === user.id) && <button onClick={() => run(() => portalApi.deleteCover(e.id))} disabled={busy} aria-label="Elimina assenza" style={{ background: "none", border: "none", cursor: "pointer", color: C.subtle, display: "flex" }}><Trash2 size={15} /></button>}
              </div>
            ))}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 10 }}>
              {manager && <select value={absent} onChange={e => setAbsent(Number(e.target.value))} aria-label="Assente" style={{ ...iStyle, width: "auto" }}>{v.buyers.map(b => <option key={b.id} value={b.id}>{b.name} è assente</option>)}</select>}
              <select value={sub} onChange={e => setSub(e.target.value ? Number(e.target.value) : "")} aria-label="Sostituto" style={{ ...iStyle, width: "auto", minWidth: 190 }}><option value="">Sostituto…</option>{v.buyers.filter(b => b.id !== (manager ? absent : user.id)).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
              <input type="date" value={from} onChange={e => setFrom(e.target.value)} aria-label="Dal" style={{ ...iStyle, width: 150 }} /><span style={{ ...sans, fontSize: 13 }}>al</span><input type="date" value={to} min={from} onChange={e => setTo(e.target.value)} aria-label="Al" style={{ ...iStyle, width: 150 }} />
              <button onClick={() => run(() => portalApi.addCover({ ...(manager ? { userId: absent } : {}), substituteId: Number(sub), from, to }))} disabled={busy || !sub} style={{ ...btnPrimary, padding: "9px 14px" }}>Registra</button>
            </div>
          </>}
        </div>
      </details>
    </Card>
  );
}
