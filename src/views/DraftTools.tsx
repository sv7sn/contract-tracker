import { useEffect, useState } from "react";
import type { ClmAuditEntry, ClmBundle, ClmDiff, ClmFindings, ClmTemplateInfo } from "../types.ts";
import { draftAuditUrl, portalApi } from "../api.ts";
import { btnGhost, btnPrimary, C, iStyle, sans } from "../theme.ts";
import { Portal } from "../components/vendorUi.tsx";
import { AlertTriangle, CheckCircle2, Download, Loader2, X } from "../components/icons.tsx";
import { getLang, locale, t } from "../i18n/index.ts";

const errText = (e: unknown) => (e instanceof Error ? e.message : t("Operazione non riuscita"));
const LEVEL = {
  standard: { label: "Standard", fg: C.green, bg: C.greenBg }, fallback: { label: "Ripiego accettabile", fg: C.blue, bg: C.blueBg },
  deviates: { label: "Si discosta", fg: C.yellow, bg: C.yellowBg }, forbidden: { label: "Non ammessa", fg: C.red, bg: C.redBg },
} as const;

/** Creazione della bozza da un modello: scelta del modello e delle lingue, domande precompilate, poi si genera la versione. */
export function TemplateWizard({ taskId, onDone, onClose }: { taskId: number; onDone: (b: ClmBundle) => void; onClose: () => void }) {
  const [list, setList] = useState<ClmTemplateInfo[] | null>(null);
  const [code, setCode] = useState("");
  const [langs, setLangs] = useState<string[]>(["it"]);
  const [answers, setAnswers] = useState<Record<string, string | boolean>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { portalApi.clm.templates(taskId).then(setList).catch(e => setErr(errText(e))); }, [taskId]);
  const tpl = list?.find(x => x.code === code);
  const pick = (c: string) => {
    const tp = list?.find(x => x.code === c); setCode(c);
    setAnswers(Object.fromEntries((tp?.questions ?? []).map(q => [q.key, q.type === "bool" ? q.value === "true" : q.value])));
  };
  const L = (l: { it: string; en: string }) => (getLang() === "en" ? l.en : l.it);
  const two = langs.length === 2;
  const toggle = (l: string) => setLangs(cur => (cur.includes(l) ? (cur.length > 1 ? cur.filter(x => x !== l) : cur) : [...cur, l]));
  const go = async () => { setBusy(true); setErr(null); try { onDone(await portalApi.clm.fromTemplate(taskId, code, langs, answers)); } catch (e) { setErr(errText(e)); setBusy(false); } };
  return (
    <Portal>
      <div className="dialog-overlay" role="dialog" aria-modal="true" aria-label={t("Nuova bozza da modello")} style={{ zIndex: 260 }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
        <div className="dialog" style={{ maxWidth: 640 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", ...sans }}><h3 style={{ margin: 0, fontSize: 17, color: C.text }}>{t("Nuova bozza da modello")}</h3><button onClick={onClose} aria-label={t("Chiudi")} style={{ background: "none", border: "none", cursor: "pointer", color: C.muted }}><X size={20} /></button></div>
          {!list && !err && <div style={{ padding: 24, textAlign: "center" }}><Loader2 className="spin" size={22} color={C.subtle} /></div>}
          {err && <div role="alert" style={{ ...sans, color: C.red, fontSize: 13, margin: "10px 0" }}>{err}</div>}
          {list && (
            <div style={{ ...sans, display: "grid", gap: 12, marginTop: 12 }}>
              <div style={{ display: "grid", gap: 8 }}>
                {list.map(x => <button key={x.code} onClick={() => pick(x.code)} style={{ ...btnGhost, textAlign: "left", padding: "10px 12px", ...(x.code === code ? { borderColor: C.accent } : {}) }}><div style={{ fontWeight: 650, color: C.text, fontSize: 14 }}>{L(x.name)}</div><div style={{ fontSize: 12.5, color: C.muted }}>{L(x.description)}</div></button>)}
              </div>
              {tpl && <>
                <div style={{ display: "flex", gap: 14, alignItems: "center", fontSize: 13, color: C.text, flexWrap: "wrap" }}>
                  <strong>{t("Lingue")}</strong>
                  {([["it", t("Italiano")], ["en", t("Inglese")]] as const).map(([k, n]) => <label key={k} style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={langs.includes(k)} onChange={() => toggle(k)} />{n}</label>)}
                  <span style={{ color: C.subtle, fontSize: 12 }}>{two ? t("Con due lingue il testo va su due colonne affiancate.") : ""}</span>
                </div>
                <div style={{ display: "grid", gap: 10 }}>
                  {tpl.questions.map(q => (
                    <label key={q.key} style={{ display: "grid", gap: 4, fontSize: 12.5, color: C.muted }}>
                      <span>{L(q.label)}{q.required ? " *" : ""}</span>
                      {q.type === "bool" ? <input type="checkbox" checked={answers[q.key] === true} onChange={e => setAnswers({ ...answers, [q.key]: e.target.checked })} style={{ justifySelf: "start" }} />
                        : q.type === "select" ? <select value={String(answers[q.key] ?? "")} onChange={e => setAnswers({ ...answers, [q.key]: e.target.value })} style={iStyle}>{q.options?.map(o => <option key={o.value} value={o.value}>{L(o.label)}</option>)}</select>
                        : q.type === "longtext" ? <textarea rows={2} value={String(answers[q.key] ?? "")} onChange={e => setAnswers({ ...answers, [q.key]: e.target.value })} style={iStyle} />
                        : <input type={q.type === "date" ? "date" : q.type === "number" ? "number" : "text"} value={String(answers[q.key] ?? "")} onChange={e => setAnswers({ ...answers, [q.key]: e.target.value })} style={iStyle} />}
                    </label>))}
                </div>
                <button onClick={go} disabled={busy} style={{ ...btnPrimary, padding: "10px 16px", justifySelf: "end", display: "inline-flex", gap: 6, alignItems: "center" }}>{busy && <Loader2 className="spin" size={14} />}{t("Genera la bozza")}</button>
              </>}
            </div>)}
        </div>
      </div>
    </Portal>
  );
}

/** Confronto tra due versioni: paragrafi aggiunti, tolti e modificati (con le parole cambiate). */
export function DiffView({ taskId, versions }: { taskId: number; versions: { id: number; version: number }[] }) {
  const sorted = [...versions].sort((a, b) => a.version - b.version);
  const [from, setFrom] = useState(sorted.length > 1 ? sorted[sorted.length - 2].id : sorted[0]?.id);
  const [to, setTo] = useState(sorted[sorted.length - 1]?.id);
  const [d, setD] = useState<ClmDiff | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (from && to) portalApi.clm.diff(taskId, from, to).then(x => { setD(x); setErr(null); }).catch(e => setErr(errText(e))); }, [taskId, from, to]);
  if (sorted.length < 2) return <div style={{ ...sans, fontSize: 13, color: C.muted }}>{t("Serve almeno una seconda versione per fare il confronto.")}</div>;
  const sel = (v: number, set: (n: number) => void) => <select value={v} onChange={e => set(Number(e.target.value))} style={{ ...iStyle, width: "auto", padding: "4px 8px", fontSize: 12.5 }}>{sorted.map(x => <option key={x.id} value={x.id}>v{x.version}</option>)}</select>;
  const changed = d?.ops.filter(o => o.type !== "same") ?? [];
  return (
    <div style={{ ...sans, display: "grid", gap: 10 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, color: C.text, flexWrap: "wrap" }}>{t("Da")} {sel(from, setFrom)} {t("a")} {sel(to, setTo)}
        {d && <span style={{ color: C.muted, fontSize: 12.5 }}>{t("{m} modificati · {a} aggiunti · {r} tolti", { m: d.modified, a: d.added, r: d.removed })}</span>}</div>
      {err && <div role="alert" style={{ color: C.red, fontSize: 13 }}>{err}</div>}
      {d && !changed.length && <div style={{ fontSize: 13, color: C.green, display: "flex", gap: 6, alignItems: "center" }}><CheckCircle2 size={14} />{t("Le due versioni hanno lo stesso testo.")}</div>}
      <div style={{ display: "grid", gap: 8, maxHeight: 420, overflowY: "auto" }}>
        {changed.map((o, i) => (
          <div key={i} style={{ border: `1px solid ${C.borderLight}`, borderRadius: 10, padding: "8px 12px", fontSize: 13.5, lineHeight: 1.55, background: o.type === "add" ? C.greenBg : o.type === "del" ? C.redBg : "#fff" }}>
            {o.type === "add" && <><b style={{ color: C.green }}>{t("Aggiunto")} · </b>{o.text}</>}
            {o.type === "del" && <><b style={{ color: C.red }}>{t("Tolto")} · </b><span style={{ textDecoration: "line-through", color: C.muted }}>{o.text}</span></>}
            {o.type === "mod" && <><b style={{ color: C.yellow }}>{t("Modificato")} · </b>{o.words.map((w, k) => w.k === "same" ? <span key={k}>{w.t}</span> : w.k === "add" ? <ins key={k} style={{ background: C.greenBg, color: C.green, textDecoration: "none", fontWeight: 600 }}>{w.t}</ins> : <del key={k} style={{ background: C.redBg, color: C.red }}>{w.t}</del>)}</>}
          </div>))}
      </div>
    </div>
  );
}

/** Esito del confronto con la libreria: ogni paragrafo riconosciuto come clausola è conforme, di ripiego, si discosta o non è ammesso. */
export function FindingsView({ taskId, draftId, paras, canAccept, onChanged }: { taskId: number; draftId: number; paras: string[]; canAccept: boolean; onChanged: () => void }) {
  const [f, setF] = useState<ClmFindings | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<Record<string, string>>({});
  useEffect(() => { portalApi.clm.findings(taskId, draftId).then(x => { setF(x); setErr(null); }).catch(e => setErr(errText(e))); }, [taskId, draftId]);
  if (err) return <div role="alert" style={{ ...sans, color: C.red, fontSize: 13 }}>{err}</div>;
  if (!f) return <Loader2 className="spin" size={18} color={C.subtle} />;
  if (!f.findings.length) return <div style={{ ...sans, fontSize: 13, color: C.muted }}>{t("Nessun paragrafo corrisponde a una clausola della libreria.")}</div>;
  const accepted = (para: number, code: string) => f.accepted.find(a => a.para === para && a.code === code);
  const accept = async (para: number, code: string) => { try { setF(await portalApi.clm.acceptDeviation(taskId, para, code, note[`${para}${code}`] ?? "")); setErr(null); onChanged(); } catch (e) { setErr(errText(e)); } };
  return (
    <div style={{ ...sans, display: "grid", gap: 8, maxHeight: 420, overflowY: "auto" }}>
      {f.findings.map(x => {
        const lv = LEVEL[x.level], ok = accepted(x.para, x.code), k = `${x.para}${x.code}`;
        return (
          <div key={k} style={{ border: `1px solid ${C.borderLight}`, borderRadius: 10, padding: "8px 12px", fontSize: 13 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ background: lv.bg, color: lv.fg, borderRadius: 999, padding: "2px 9px", fontSize: 11.5, fontWeight: 650 }}>{t(lv.label)}</span>
              <b style={{ color: C.text }}>{x.title}</b><span style={{ color: C.subtle, fontSize: 12 }}>({x.code}) · {t("paragrafo {n}", { n: x.para + 1 })}{x.level === "deviates" ? " · " + t("somiglianza {p}%", { p: Math.round(x.similarity * 100) }) : ""}</span>
              {ok && <span style={{ color: C.green, fontSize: 12, display: "inline-flex", gap: 4, alignItems: "center" }}><CheckCircle2 size={13} />{t("accettata da {by}", { by: ok.by })}</span>}
            </div>
            <div style={{ color: C.muted, marginTop: 4, overflowWrap: "anywhere" }}>{(paras[x.para] ?? "").slice(0, 240)}{(paras[x.para] ?? "").length > 240 ? "…" : ""}</div>
            {x.phrase && <div style={{ color: C.red, fontSize: 12.5, marginTop: 3, display: "flex", gap: 5, alignItems: "center" }}><AlertTriangle size={13} />{t("contiene «{p}»", { p: x.phrase })}</div>}
            {ok?.note && <div style={{ color: C.subtle, fontSize: 12, marginTop: 3 }}>{t("Motivo: {n}", { n: ok.note })}</div>}
            {canAccept && !ok && (x.level === "forbidden" || x.level === "deviates") && (
              <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
                <input value={note[k] ?? ""} onChange={e => setNote({ ...note, [k]: e.target.value })} placeholder={t("Motivo dell'accettazione")} style={{ ...iStyle, flex: 1, minWidth: 160, padding: "6px 10px", fontSize: 12.5 }} />
                <button onClick={() => accept(x.para, x.code)} style={{ ...btnGhost, padding: "6px 12px", fontSize: 12.5 }}>{t("Accetta la deviazione")}</button>
              </div>)}
          </div>);
      })}
    </div>
  );
}

/** Registro delle azioni sulla bozza (chi, quando, che cosa), con esportazione in CSV. */
export function AuditView({ taskId }: { taskId: number }) {
  const [list, setList] = useState<ClmAuditEntry[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { portalApi.clm.audit(taskId).then(setList).catch(e => setErr(errText(e))); }, [taskId]);
  if (err) return <div role="alert" style={{ ...sans, color: C.red, fontSize: 13 }}>{err}</div>;
  if (!list) return <Loader2 className="spin" size={18} color={C.subtle} />;
  return (
    <div style={{ ...sans, display: "grid", gap: 8 }}>
      <a href={draftAuditUrl(taskId)} style={{ fontSize: 12.5, color: C.blue, display: "inline-flex", gap: 5, alignItems: "center", textDecoration: "none" }}><Download size={14} />{t("Esporta il registro (CSV)")}</a>
      <div style={{ display: "grid", gap: 4, maxHeight: 380, overflowY: "auto" }}>
        {list.map(e => <div key={e.id} style={{ fontSize: 13, color: C.text, borderBottom: `1px solid ${C.borderLight}`, paddingBottom: 4 }}>
          <span style={{ color: C.subtle, fontSize: 11.5 }}>{new Date(e.at).toLocaleString(locale())}</span> · <b>{e.actor}</b> <span style={{ color: C.subtle, fontSize: 11.5 }}>({e.role})</span> · {e.action}{e.detail && <span style={{ color: C.muted }}> — {e.detail}</span>}
        </div>)}
      </div>
    </div>
  );
}
