import { useCallback, useEffect, useState } from "react";
import type { ClauseVersionView, ClauseView, User } from "../types.ts";
import { portalApi } from "../api.ts";
import { btnGhost, btnPrimary, C, font, iStyle, sans } from "../theme.ts";
import { Card, EmptyState } from "../components/ui.tsx";
import { AlertTriangle, CheckCircle2, Loader2, Plus } from "../components/icons.tsx";
import { t } from "../i18n/index.ts";

const errText = (e: unknown) => (e instanceof Error ? e.message : t("Operazione non riuscita"));
const VSTATE = { proposed: { label: "Da approvare", fg: C.yellow, bg: C.yellowBg }, approved: { label: "Approvata", fg: C.green, bg: C.greenBg }, rejected: { label: "Respinta", fg: C.red, bg: C.redBg } } as const;
interface Form { code: string; title: string; category: string; textIt: string; textEn: string; fbIt: string; fbEn: string; forbidden: string; guidance: string; isNew: boolean }
const emptyForm: Form = { code: "", title: "", category: "Generale", textIt: "", textEn: "", fbIt: "", fbEn: "", forbidden: "", guidance: "", isNew: true };

/** Libreria di clausole: testo standard, ripiego accettabile e frasi non ammesse. Scrivono Legal e Manager; gli altri leggono. */
export function ClausesView({ currentUser, onSessionExpired }: { currentUser: User; onSessionExpired: () => void }) {
  const [list, setList] = useState<ClauseView[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const canEdit = currentUser.role === "legal" || currentUser.role === "manager";
  const load = useCallback(() => { portalApi.clm.clauses().then(setList).catch(e => { if (e?.status === 401) onSessionExpired(); else setErr(errText(e)); }); }, [onSessionExpired]);
  useEffect(load, [load]);
  const run = async (f: () => Promise<ClauseView[]>) => { setBusy(true); setErr(null); try { setList(await f()); return true; } catch (e) { setErr(errText(e)); return false; } finally { setBusy(false); } };
  const edit = (c: ClauseView, v: ClauseVersionView | null) => setForm({ code: c.code, title: c.title, category: c.category, textIt: v?.text.it ?? "", textEn: v?.text.en ?? "", fbIt: v?.fallback.it ?? "", fbEn: v?.fallback.en ?? "", forbidden: (v?.forbidden ?? []).join("\n"), guidance: v?.guidance ?? "", isNew: false });
  const save = async () => {
    if (!form) return;
    const ok = await run(() => portalApi.clm.saveClause({ code: form.code, title: form.title, category: form.category, text: { it: form.textIt, en: form.textEn }, fallback: { it: form.fbIt || form.textIt, en: form.fbEn || form.textEn }, forbidden: form.forbidden, guidance: form.guidance }));
    if (ok) setForm(null);
  };
  if (!list) return err ? <EmptyState icon={<AlertTriangle size={26} />} title={t("Impossibile caricare la libreria")} text={err} /> : <div style={{ display: "flex", justifyContent: "center", padding: 60 }}><Loader2 className="spin" size={26} color={C.subtle} /></div>;
  const cats = [...new Set(list.map(c => c.category))];
  const F = (k: keyof Form) => ({ value: String(form?.[k] ?? ""), onChange: (e: { target: { value: string } }) => setForm(f => (f ? { ...f, [k]: e.target.value } : f)) });
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div>
          <h2 style={{ ...font, margin: 0, fontSize: 22, fontWeight: 700, color: C.text }}>{t("Libreria di clausole")}</h2>
          <p style={{ ...sans, margin: "4px 0 0", fontSize: 13.5, color: C.muted, maxWidth: 640 }}>{t("Testi approvati usati dai modelli e confrontati con le bozze: ogni paragrafo risulta conforme, di ripiego, fuori standard oppure non ammesso.")} {canEdit ? t("Una modifica è una nuova versione che va approvata.") : t("Solo Legal e Manager possono modificarla.")}</p>
        </div>
        {canEdit && <button onClick={() => setForm({ ...emptyForm })} style={{ ...btnPrimary, padding: "9px 14px", display: "inline-flex", gap: 6, alignItems: "center" }}><Plus size={16} />{t("Nuova clausola")}</button>}
      </div>
      {err && <div role="alert" style={{ ...sans, color: C.red, fontSize: 13 }}>{err}</div>}
      {form && (
        <Card style={{ padding: 16, display: "grid", gap: 10 }}>
          <strong style={{ ...sans, fontSize: 14, color: C.text }}>{form.isNew ? t("Nuova clausola") : t("Nuova versione di {code}", { code: form.code })}</strong>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
            <input placeholder={t("Codice (es. PAYMENT)")} disabled={!form.isNew} {...F("code")} style={iStyle} />
            <input placeholder={t("Titolo")} {...F("title")} style={iStyle} />
            <input placeholder={t("Categoria")} {...F("category")} style={iStyle} />
          </div>
          {([["textIt", t("Testo standard (italiano)")], ["textEn", t("Testo standard (inglese)")], ["fbIt", t("Ripiego accettabile (italiano)")], ["fbEn", t("Ripiego accettabile (inglese)")]] as const).map(([k, l]) => <label key={k} style={{ ...sans, display: "grid", gap: 4, fontSize: 12.5, color: C.muted }}>{l}<textarea rows={3} {...F(k)} style={iStyle} /></label>)}
          <label style={{ ...sans, display: "grid", gap: 4, fontSize: 12.5, color: C.muted }}>{t("Frasi non ammesse (una per riga)")}<textarea rows={2} {...F("forbidden")} style={iStyle} /></label>
          <label style={{ ...sans, display: "grid", gap: 4, fontSize: 12.5, color: C.muted }}>{t("Note per chi usa la clausola")}<textarea rows={2} {...F("guidance")} style={iStyle} /></label>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button onClick={() => setForm(null)} style={{ ...btnGhost, padding: "8px 14px" }}>{t("Annulla")}</button>
            <button onClick={save} disabled={busy} style={{ ...btnPrimary, padding: "8px 14px" }}>{busy ? t("Salvo…") : t("Proponi la versione")}</button>
          </div>
        </Card>)}
      {cats.map(cat => (
        <div key={cat} style={{ display: "grid", gap: 10 }}>
          <div style={{ ...sans, fontSize: 11.5, fontWeight: 700, color: C.subtle, textTransform: "uppercase", letterSpacing: ".04em" }}>{cat}</div>
          {list.filter(c => c.category === cat).map(c => {
            const pending = c.versions.filter(v => v.status === "proposed");
            return (
              <Card key={c.id} style={{ padding: 14, display: "grid", gap: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <div style={{ ...sans }}><b style={{ fontSize: 14.5, color: C.text }}>{c.title}</b> <span style={{ color: C.subtle, fontSize: 12 }}>{c.code}{c.current ? " · " + t("versione {n}", { n: c.current.version }) : ""}</span></div>
                  {canEdit && <button onClick={() => edit(c, c.current)} style={{ ...btnGhost, padding: "5px 11px", fontSize: 12.5 }}>{t("Proponi una modifica")}</button>}
                </div>
                {c.current ? <>
                  <div style={{ ...sans, fontSize: 13, color: C.text, lineHeight: 1.5 }}>{c.current.text.it || c.current.text.en}</div>
                  {c.current.forbidden.length > 0 && <div style={{ ...sans, fontSize: 12.5, color: C.red }}>{t("Non ammesso:")} {c.current.forbidden.map(x => `«${x}»`).join(", ")}</div>}
                  {c.current.guidance && <div style={{ ...sans, fontSize: 12, color: C.subtle }}>{c.current.guidance}</div>}
                  <div style={{ ...sans, fontSize: 12, color: C.green, display: "flex", gap: 5, alignItems: "center" }}><CheckCircle2 size={13} />{t("approvata da {name}", { name: c.current.approvedBy ?? "" })}</div>
                </> : <div style={{ ...sans, fontSize: 13, color: C.muted }}>{t("Nessuna versione approvata: non è ancora usata dai modelli.")}</div>}
                {pending.map(v => (
                  <div key={v.id} style={{ border: `1px dashed ${C.border}`, borderRadius: 10, padding: 10, display: "grid", gap: 6 }}>
                    <div style={{ ...sans, fontSize: 12.5, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}><span style={{ background: VSTATE.proposed.bg, color: VSTATE.proposed.fg, borderRadius: 999, padding: "2px 9px", fontSize: 11.5, fontWeight: 650 }}>{t(VSTATE.proposed.label)}</span>{t("versione {n} proposta da {name}", { n: v.version, name: v.createdBy })}</div>
                    <div style={{ ...sans, fontSize: 13, color: C.text, lineHeight: 1.5 }}>{v.text.it || v.text.en}</div>
                    {canEdit && <div style={{ display: "flex", gap: 8 }}>
                      <button onClick={() => run(() => portalApi.clm.decideClause(v.id, true, ""))} disabled={busy} style={{ ...btnPrimary, background: C.green, padding: "6px 12px", fontSize: 12.5 }}>{t("Approva")}</button>
                      <button onClick={() => run(() => portalApi.clm.decideClause(v.id, false, ""))} disabled={busy} style={{ ...btnGhost, padding: "6px 12px", fontSize: 12.5 }}>{t("Respingi")}</button>
                    </div>}
                  </div>))}
              </Card>);
          })}
        </div>))}
    </div>
  );
}
