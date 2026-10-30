import { useCallback, useEffect, useRef, useState } from "react";
import type { NegotiationBundle, NegotiationSummary } from "../types.ts";
import { portalApi, supplierNegotiationFileUrl, uploadSupplierDocument } from "../api.ts";
import { btnGhost, btnPrimary, C, iStyle, sans } from "../theme.ts";
import { Card, CardTitle } from "./ui.tsx";
import { Download, FileText, Loader2, Send, Upload, X } from "./icons.tsx";
import { locale, t } from "../i18n/index.ts";

/** Trattative contrattuali: bozze che l'ufficio acquisti ha condiviso con il fornitore. Commenta il testo o carica la tua versione. */
export function SupplierNegotiations({ fail }: { fail: (e: unknown) => string }) {
  const [list, setList] = useState<NegotiationSummary[] | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const load = useCallback(() => {
    portalApi
      .negotiations()
      .then(setList)
      .catch(() => setList([]));
  }, []);
  useEffect(load, [load]);
  if (!list || !list.length) return null;
  return (
    <Card>
      <CardTitle icon={<FileText size={16} />}>{t("Bozze di contratto")}</CardTitle>
      <div style={{ display: "grid", gap: 8 }}>
        {list.map(n => (
          <div
            key={n.taskId}
            style={{
              ...sans,
              display: "flex",
              gap: 10,
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
              fontSize: 13.5,
              color: C.text,
            }}
          >
            <span>
              <b>{n.title}</b>{" "}
              <span style={{ color: C.muted, fontSize: 12.5 }}>
                · {t("versione {n}", { n: n.latestVersion })}
                {n.openComments ? " · " + t("{n} commenti dell'ufficio acquisti", { n: n.openComments }) : ""}
              </span>
            </span>
            <button onClick={() => setOpen(n.taskId)} style={{ ...btnGhost, padding: "6px 12px", fontSize: 12.5 }}>
              {t("Apri")}
            </button>
          </div>
        ))}
      </div>
      {open !== null && (
        <NegotiationDialog
          taskId={open}
          fail={fail}
          onClose={() => {
            setOpen(null);
            load();
          }}
        />
      )}
    </Card>
  );
}

function NegotiationDialog({ taskId, fail, onClose }: { taskId: number; fail: (e: unknown) => string; onClose: () => void }) {
  const [b, setB] = useState<NegotiationBundle | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [sel, setSel] = useState<{ para: number; start: number; end: number; quote: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const load = useCallback(
    (d?: number) => {
      portalApi
        .negotiation(taskId, d)
        .then(x => {
          setB(x);
          setErr(null);
        })
        .catch(e => setErr(fail(e)));
    },
    [taskId, fail],
  );
  useEffect(() => load(), [load]);
  const run = async (key: string, f: () => Promise<NegotiationBundle>) => {
    setBusy(key);
    try {
      setB(await f());
      setErr(null);
      return true;
    } catch (e) {
      setErr(fail(e));
      return false;
    } finally {
      setBusy(null);
    }
  };
  const onSelect = () => {
    const s = window.getSelection();
    if (!s || s.isCollapsed || !s.rangeCount) return;
    const r = s.getRangeAt(0),
      el = (r.startContainer.nodeType === 3 ? r.startContainer.parentElement : (r.startContainer as Element))?.closest(
        "[data-para]",
      ) as HTMLElement | null;
    if (!el || !textRef.current?.contains(el) || !el.contains(r.endContainer)) return;
    const pre = document.createRange();
    pre.selectNodeContents(el);
    pre.setEnd(r.startContainer, r.startOffset);
    const start = pre.toString().length,
      quote = s.toString();
    setSel({ para: Number(el.dataset.para), start, end: start + quote.length, quote: quote.slice(0, 300) });
  };
  const send = async () => {
    if (!b || !text.trim()) return;
    if (await run("c", () => portalApi.negotiationComment(taskId, { draftId: b.draftId, body: text, ...(sel ?? {}) }))) {
      setText("");
      setSel(null);
    }
  };
  const upload = (f: File | undefined) => {
    if (!f) return;
    void run("u", async () =>
      portalApi.negotiationUpload(taskId, { fileName: f.name, filePath: await uploadSupplierDocument(f), size: f.size }),
    );
    if (fileRef.current) fileRef.current.value = "";
  };
  const heads = new Set(b?.layout.heads ?? []);
  const cell = (p: string, i: number) => (
    <p
      key={i}
      data-para={i}
      style={{
        margin: "0 0 10px",
        fontSize: 13.5,
        lineHeight: 1.55,
        whiteSpace: "pre-wrap",
        fontWeight: heads.has(i) ? 700 : 400,
        borderLeft: b?.comments.some(c => c.para === i) ? `3px solid ${C.accent}` : "3px solid transparent",
        paddingLeft: 8,
      }}
    >
      {p}
    </p>
  );
  return (
    <div
      className="dialog-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={t("Bozza di contratto")}
      style={{ zIndex: 260 }}
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="dialog" style={{ maxWidth: 940, padding: 18 }}>
        <div style={{ ...sans, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0, fontSize: 17, color: C.text }}>{b?.title ?? t("Bozza di contratto")}</h3>
          <button
            onClick={onClose}
            aria-label={t("Chiudi")}
            style={{ background: "none", border: "none", cursor: "pointer", color: C.muted }}
          >
            <X size={20} />
          </button>
        </div>
        {err && (
          <div role="alert" style={{ ...sans, color: C.red, fontSize: 13, margin: "8px 0" }}>
            {err}
          </div>
        )}
        {!b && !err && (
          <div style={{ padding: 30, textAlign: "center" }}>
            <Loader2 className="spin" size={22} color={C.subtle} />
          </div>
        )}
        {b && (
          <div style={{ ...sans, display: "grid", gap: 12, marginTop: 10 }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              {b.drafts.map(d => (
                <button
                  key={d.id}
                  onClick={() => load(d.id)}
                  style={{
                    ...btnGhost,
                    padding: "4px 11px",
                    fontSize: 12.5,
                    ...(d.id === b.draftId ? { borderColor: C.accent, color: C.accent, fontWeight: 650 } : {}),
                  }}
                >
                  v{d.version}
                  {d.origin === "supplier" ? " " + t("(la tua)") : ""}
                </button>
              ))}
              <a
                href={supplierNegotiationFileUrl(b.draftId)}
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontSize: 12.5, color: C.blue, display: "inline-flex", gap: 5, alignItems: "center", textDecoration: "none" }}
              >
                <Download size={14} />
                {t("Scarica il file")}
              </a>
              <button
                onClick={() => fileRef.current?.click()}
                disabled={busy === "u"}
                style={{
                  ...btnGhost,
                  padding: "5px 12px",
                  fontSize: 12.5,
                  display: "inline-flex",
                  gap: 6,
                  alignItems: "center",
                  marginLeft: "auto",
                }}
              >
                {busy === "u" ? <Loader2 className="spin" size={14} /> : <Upload size={14} />}
                {t("Carica la tua versione")}
              </button>
              <input ref={fileRef} type="file" accept=".docx,.doc,.pdf" hidden onChange={e => upload(e.target.files?.[0])} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 14, alignItems: "start" }}>
              <div
                ref={textRef}
                onMouseUp={onSelect}
                onTouchEnd={onSelect}
                style={{ border: `1px solid ${C.border}`, borderRadius: 12, padding: "10px 14px", maxHeight: 440, overflowY: "auto" }}
              >
                {b.paras.length === 0 ? (
                  <div style={{ fontSize: 13, color: C.muted }}>
                    {t("Anteprima non disponibile per questo formato: scarica il file e scrivi i tuoi commenti qui.")}
                  </div>
                ) : b.layout.cols === 2 ? (
                  Array.from({ length: Math.ceil(b.paras.length / 2) }, (_, k) => (
                    <div key={k} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                      {cell(b.paras[k * 2], k * 2)}
                      {cell(b.paras[k * 2 + 1] ?? "", k * 2 + 1)}
                    </div>
                  ))
                ) : (
                  b.paras.map(cell)
                )}
              </div>
              <div style={{ display: "grid", gap: 8 }}>
                <div style={{ display: "grid", gap: 6, maxHeight: 280, overflowY: "auto" }}>
                  {!b.comments.length && (
                    <div style={{ fontSize: 13, color: C.muted }}>{t("Nessun commento. Seleziona una frase per commentarla.")}</div>
                  )}
                  {b.comments.map(c => (
                    <div
                      key={c.id}
                      style={{
                        border: `1px solid ${C.borderLight}`,
                        borderRadius: 10,
                        padding: 8,
                        fontSize: 13,
                        marginLeft: c.parentId ? 16 : 0,
                        background: c.fromSupplier ? "#fff" : C.blueBg,
                      }}
                    >
                      {c.quote && (
                        <div style={{ fontSize: 12, color: C.muted, borderLeft: `3px solid ${C.accent}`, paddingLeft: 6, marginBottom: 4 }}>
                          «{c.quote.slice(0, 100)}»
                        </div>
                      )}
                      <b>{c.author}</b>{" "}
                      <span style={{ color: C.subtle, fontSize: 11.5 }}>{new Date(c.createdAt).toLocaleDateString(locale())}</span>
                      <div style={{ whiteSpace: "pre-wrap" }}>{c.body}</div>
                    </div>
                  ))}
                </div>
                {sel && (
                  <div style={{ fontSize: 12.5, color: C.muted, display: "flex", justifyContent: "space-between", gap: 6 }}>
                    <span>{t("Su: «{quote}»", { quote: sel.quote.slice(0, 80) })}</span>
                    <button
                      onClick={() => setSel(null)}
                      aria-label={t("Togli selezione")}
                      style={{ background: "none", border: "none", cursor: "pointer", color: C.subtle }}
                    >
                      <X size={14} />
                    </button>
                  </div>
                )}
                <textarea
                  value={text}
                  onChange={e => setText(e.target.value)}
                  rows={3}
                  placeholder={t("Scrivi il tuo commento…")}
                  style={iStyle}
                />
                <button
                  onClick={send}
                  disabled={!text.trim() || busy === "c"}
                  style={{
                    ...btnPrimary,
                    padding: "8px 14px",
                    justifySelf: "end",
                    display: "inline-flex",
                    gap: 6,
                    alignItems: "center",
                    opacity: text.trim() ? 1 : 0.5,
                  }}
                >
                  {busy === "c" ? <Loader2 className="spin" size={14} /> : <Send size={14} />}
                  {t("Invia")}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
