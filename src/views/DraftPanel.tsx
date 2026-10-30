import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { ClmBundle, ClmComment, FuncKey, ReviewStatus, User } from "../types.ts";
import { draftFileUrl, portalApi, uploadDocument } from "../api.ts";
import { btnGhost, btnPrimary, C, iStyle, sans } from "../theme.ts";
import { FUNC_LABEL } from "../clmRules.ts";
import { Portal } from "../components/vendorUi.tsx";
import { AuditView, DiffView, FindingsView, TemplateWizard } from "./DraftTools.tsx";
import { AlertTriangle, Check, CheckCircle2, Clock, Download, Loader2, MessageSquare, Send, Upload, X } from "../components/icons.tsx";
import { locale, t } from "../i18n/index.ts";

// Bozza del contratto: versioni, testo con commenti ancorati, pareri delle funzioni. Riservata a buyer, Manager e funzioni invitate.
const STATUS: Record<ReviewStatus, { label: string; fg: string; bg: string }> = {
  pending: { label: "in attesa", fg: C.yellow, bg: C.yellowBg },
  approved: { label: "approva", fg: C.green, bg: C.greenBg },
  approved_comments: { label: "approva con commenti", fg: C.green, bg: C.greenBg },
  changes: { label: "chiede modifiche", fg: C.red, bg: C.redBg },
};
const fmtDay = (d: string | null) => (d ? d.split("-").reverse().join("/") : "");
const errText = (e: unknown) => (e instanceof Error ? e.message : t("Operazione non riuscita"));

export function ReviewChips({ bundle }: { bundle: ClmBundle }) {
  if (!bundle.reviews.length) return <span style={{ ...sans, fontSize: 12.5, color: C.subtle }}>{t("Nessuna funzione invitata")}</span>;
  return (
    <span style={{ display: "inline-flex", flexWrap: "wrap", gap: 6 }}>
      {bundle.reviews.map(r => {
        const s = STATUS[r.status];
        return (
          <span
            key={r.id}
            style={{ ...sans, background: s.bg, color: s.fg, borderRadius: 999, padding: "2px 9px", fontSize: 11.5, fontWeight: 650 }}
          >
            {t(FUNC_LABEL[r.func])}: {t(s.label)}
          </span>
        );
      })}
    </span>
  );
}

/** Riepilogo nel quadrante del contratto + apertura della bozza a schermo intero. */
export function DraftSummary({
  taskId,
  canManage,
  onChanged,
  currentUser,
}: {
  taskId: number;
  canManage: boolean;
  onChanged?: () => void;
  currentUser?: User;
}) {
  const [b, setB] = useState<ClmBundle | null>(null);
  const [open, setOpen] = useState(false);
  const load = useCallback(() => {
    portalApi.clm
      .bundle(taskId)
      .then(setB)
      .catch(() => setB(null));
  }, [taskId]);
  useEffect(load, [load]);
  const close = () => {
    setOpen(false);
    load();
    onChanged?.();
  };
  const cur = b?.drafts[0];
  return (
    <div style={{ display: "grid", gap: 6 }}>
      {b && cur ? (
        <>
          <div style={{ ...sans, fontSize: 13, color: C.text }}>{t("Versione {v} · {file}", { v: cur.version, file: cur.fileName })}</div>
          <ReviewChips bundle={b} />
          {b.gate && (
            <div style={{ ...sans, fontSize: 12.5, color: C.red, display: "flex", gap: 6, alignItems: "flex-start" }}>
              <AlertTriangle size={14} style={{ marginTop: 2, flexShrink: 0 }} />
              {b.gate}
            </div>
          )}
          {!b.gate && (
            <div style={{ ...sans, fontSize: 12.5, color: C.green, display: "flex", gap: 6, alignItems: "center" }}>
              <CheckCircle2 size={14} />
              {t("Tutte le funzioni hanno approvato: si può firmare")}
            </div>
          )}
        </>
      ) : (
        <div style={{ ...sans, fontSize: 13, color: C.muted }}>
          {t("Nessuna bozza caricata. Carica la bozza per farla rivedere a richiedente, Legal, Compliance e IT Security.")}
        </div>
      )}
      {canManage && (
        <div>
          <button
            onClick={() => setOpen(true)}
            style={{ ...btnGhost, padding: "6px 12px", fontSize: 12.5, display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            <MessageSquare size={14} />
            {cur ? t("Apri bozza e revisioni") : t("Carica la bozza")}
          </button>
        </div>
      )}
      {open && <DraftDialog taskId={taskId} onClose={close} currentUser={currentUser} />}
    </div>
  );
}

export function DraftDialog({ taskId, onClose, currentUser }: { taskId: number; onClose: () => void; currentUser?: User }) {
  return (
    <Portal>
      <div
        className="dialog-overlay"
        role="dialog"
        aria-modal="true"
        aria-label={t("Bozza del contratto")}
        onClick={e => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div className="dialog" style={{ maxWidth: 980, padding: 18 }}>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button
              onClick={onClose}
              aria-label={t("Chiudi")}
              style={{ background: "none", border: "none", cursor: "pointer", color: C.muted }}
            >
              <X size={20} />
            </button>
          </div>
          <DraftPanel taskId={taskId} currentUser={currentUser} />
        </div>
      </div>
    </Portal>
  );
}

/** Segmenti di un paragrafo: il testo con evidenziati gli intervalli commentati (ancora aperti). */
function segments(text: string, comments: ClmComment[]): { t: string; ids: number[] }[] {
  const marks = comments.filter(c => c.status === "open" && c.start !== null && c.end !== null && c.end > c.start && !c.parentId);
  const cuts = new Set<number>([0, text.length]);
  marks.forEach(m => {
    cuts.add(Math.min(m.start as number, text.length));
    cuts.add(Math.min(m.end as number, text.length));
  });
  const pts = [...cuts].sort((a, b) => a - b);
  return pts
    .slice(0, -1)
    .map((a, i) => ({
      t: text.slice(a, pts[i + 1]),
      ids: marks.filter(m => (m.start as number) <= a && (m.end as number) >= pts[i + 1]).map(m => m.id),
    }))
    .filter(s => s.t);
}

export function DraftPanel({ taskId, currentUser }: { taskId: number; currentUser?: User }) {
  const [b, setB] = useState<ClmBundle | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [sel, setSel] = useState<{ para: number; start: number; end: number; quote: string } | null>(null);
  const [text, setText] = useState("");
  const [reply, setReply] = useState<{ id: number; text: string } | null>(null);
  const [inviting, setInviting] = useState(false);
  const [note, setNote] = useState("");
  const [tab, setTab] = useState<"text" | "diff" | "clauses" | "audit">("text");
  const [wizard, setWizard] = useState(false);
  const [ext, setExt] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const load = useCallback(
    (draftId?: number) => {
      portalApi.clm
        .bundle(taskId, draftId)
        .then(x => {
          setB(x);
          setErr(null);
        })
        .catch(e => setErr(errText(e)));
    },
    [taskId],
  );
  useEffect(() => load(), [load]);
  const run = async (key: string, f: () => Promise<ClmBundle>) => {
    setBusy(key);
    setErr(null);
    try {
      setB(await f());
      return true;
    } catch (e) {
      setErr(errText(e));
      return false;
    } finally {
      setBusy(null);
    }
  };

  if (err && !b) return <div style={{ ...sans, color: C.red, fontSize: 13 }}>{err}</div>;
  if (!b)
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: 30 }}>
        <Loader2 className="spin" size={22} color={C.subtle} />
      </div>
    );
  const cur = b.drafts.find(d => d.id === b.draftId);
  const isLatest = b.draftId === b.latestId;

  const onUpload = (f: File | undefined) => {
    if (!f) return;
    void run("upload", async () =>
      portalApi.clm.upload(taskId, { fileName: f.name, filePath: await uploadDocument(f), size: f.size, note: note.trim() }),
    ).then(ok => {
      if (ok) setNote("");
    });
    if (fileRef.current) fileRef.current.value = "";
  };
  /** Selezione di testo dentro un paragrafo → posizione del commento (offset nel testo del paragrafo). */
  const onSelect = () => {
    const s = window.getSelection();
    if (!s || s.isCollapsed || !s.rangeCount) return;
    const r = s.getRangeAt(0);
    const el = (r.startContainer.nodeType === 3 ? r.startContainer.parentElement : (r.startContainer as Element))?.closest(
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
    if (!text.trim() || !b.draftId) return;
    const ok = await run("comment", () =>
      portalApi.clm.comment(taskId, { draftId: b.draftId as number, body: text, external: ext && !!cur?.sharedAt, ...(sel ? sel : {}) }),
    );
    if (ok) {
      setText("");
      setSel(null);
      window.getSelection()?.removeAllRanges();
    }
  };
  const top = b.comments.filter(c => !c.parentId);
  const threadOf = (id: number) => b.comments.filter(c => c.parentId === id);
  const paraComments = (i: number) => b.comments.filter(c => c.para === i);

  return (
    <div style={{ ...sans, display: "grid", gap: 14, minWidth: 0 }}>
      <div>
        <h3 style={{ margin: 0, fontSize: 17, color: C.text }}>{b.brief.title}</h3>
        <div style={{ fontSize: 12.5, color: C.muted, marginTop: 3 }}>
          {[
            b.brief.supplier,
            b.brief.value ? `${b.brief.value.toLocaleString(locale())} ${b.brief.currency}` : "",
            b.brief.due ? t("scadenza task {d}", { d: fmtDay(b.brief.due) }) : "",
          ]
            .filter(Boolean)
            .join(" · ")}
        </div>
        <div style={{ fontSize: 11.5, color: C.subtle, marginTop: 4 }}>
          {t("Riservata: la vedono solo il buyer, il Manager e le funzioni invitate.")}
        </div>
      </div>
      {err && (
        <div role="alert" style={{ color: C.red, fontSize: 13, background: C.redBg, borderRadius: 10, padding: "8px 12px" }}>
          {err}
        </div>
      )}

      {/* Versioni e caricamento */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        {b.drafts.map(d => (
          <button
            key={d.id}
            onClick={() => load(d.id)}
            style={{
              ...btnGhost,
              padding: "5px 11px",
              fontSize: 12.5,
              ...(d.id === b.draftId ? { borderColor: C.accent, color: C.accent, fontWeight: 650 } : {}),
            }}
          >
            v{d.version}
            {d.origin === "supplier" ? " " + t("(fornitore)") : d.sharedAt ? " · " + t("condivisa") : ""}
          </button>
        ))}
        {b.owner && cur && cur.origin === "internal" && isLatest && (
          <button
            onClick={() => run("share", () => portalApi.clm.share(taskId, cur.id, !cur.sharedAt))}
            disabled={busy === "share"}
            style={{ ...btnGhost, padding: "5px 11px", fontSize: 12.5, ...(cur.sharedAt ? { borderColor: C.blue, color: C.blue } : {}) }}
          >
            {busy === "share" ? "…" : cur.sharedAt ? t("Ritira dal fornitore") : t("Condividi con il fornitore")}
          </button>
        )}
        {cur && (
          <a
            href={draftFileUrl(cur.id)}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: 12.5, color: C.blue, display: "inline-flex", gap: 5, alignItems: "center", textDecoration: "none" }}
          >
            <Download size={14} />
            {cur.fileName}
          </a>
        )}
        {b.owner && (
          <>
            <input
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder={t("Nota sulla nuova versione (facoltativa)")}
              style={{ ...iStyle, flex: 1, minWidth: 160, padding: "6px 10px", fontSize: 12.5 }}
            />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={busy === "upload"}
              style={{ ...btnGhost, padding: "6px 12px", fontSize: 12.5, display: "inline-flex", gap: 6, alignItems: "center" }}
            >
              {busy === "upload" ? <Loader2 className="spin" size={14} /> : <Upload size={14} />}
              {b.drafts.length ? t("Carica nuova versione") : t("Carica la bozza")}
            </button>
            <button onClick={() => setWizard(true)} style={{ ...btnGhost, padding: "6px 12px", fontSize: 12.5 }}>
              {t("Nuova da modello")}
            </button>
            <input ref={fileRef} type="file" accept=".docx,.doc,.pdf" hidden onChange={e => onUpload(e.target.files?.[0])} />
          </>
        )}
      </div>
      {wizard && (
        <TemplateWizard
          taskId={taskId}
          onClose={() => setWizard(false)}
          onDone={nb => {
            setB(nb);
            setWizard(false);
            setTab("text");
          }}
        />
      )}
      {cur && !isLatest && (
        <div style={{ fontSize: 12.5, color: C.yellow }}>{t("Stai guardando una versione precedente: i pareri si danno sull'ultima.")}</div>
      )}
      {cur?.note && <div style={{ fontSize: 12.5, color: C.muted }}>{t("Nota del buyer: {n}", { n: cur.note })}</div>}

      {/* Pareri */}
      {cur && (
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 12, padding: 12, display: "grid", gap: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <strong style={{ fontSize: 13, color: C.text }}>{t("Pareri delle funzioni")}</strong>
            {b.owner && isLatest && (
              <button onClick={() => setInviting(v => !v)} style={{ ...btnGhost, padding: "5px 11px", fontSize: 12.5 }}>
                {inviting ? t("Chiudi") : t("Invita funzioni")}
              </button>
            )}
          </div>
          {b.reviews.map(r => {
            const s = STATUS[r.status];
            return (
              <div key={r.id} style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap", fontSize: 13 }}>
                <span
                  style={{
                    background: s.bg,
                    color: s.fg,
                    borderRadius: 999,
                    padding: "2px 9px",
                    fontSize: 11.5,
                    fontWeight: 650,
                    whiteSpace: "nowrap",
                  }}
                >
                  {t(FUNC_LABEL[r.func])}: {t(s.label)}
                </span>
                {r.status === "pending" && r.due && (
                  <span
                    style={{
                      color: r.due < new Date().toISOString().slice(0, 10) ? C.red : C.subtle,
                      fontSize: 12,
                      display: "inline-flex",
                      gap: 4,
                      alignItems: "center",
                    }}
                  >
                    <Clock size={12} />
                    {t("entro {d}", { d: fmtDay(r.due) })}
                  </span>
                )}
                {r.decidedBy && <span style={{ color: C.subtle, fontSize: 12 }}>{r.decidedBy}</span>}
                {r.note && <span style={{ color: C.muted, fontSize: 12.5 }}>— {r.note}</span>}
              </div>
            );
          })}
          {!b.reviews.length && <div style={{ fontSize: 13, color: C.muted }}>{t("Nessuna funzione invitata.")}</div>}
          {b.required.some(q => !q.invited) && (
            <div style={{ fontSize: 12.5, color: C.yellow }}>
              {t("Richieste dalle regole e non ancora invitate: {list}.", {
                list: b.required
                  .filter(q => !q.invited)
                  .map(q => `${t(FUNC_LABEL[q.func])} (${q.reason})`)
                  .join("; "),
              })}
            </div>
          )}
          {inviting && (
            <InviteForm
              bundle={b}
              busy={busy === "invite"}
              onSend={(funcs, msg) =>
                run("invite", () => portalApi.clm.invite(taskId, funcs, msg)).then(ok => {
                  if (ok) setInviting(false);
                })
              }
            />
          )}
          {b.gate ? (
            <div style={{ fontSize: 12.5, color: C.red }}>{b.gate}</div>
          ) : (
            cur && b.reviews.length > 0 && <div style={{ fontSize: 12.5, color: C.green }}>{t("Tutte le funzioni hanno approvato.")}</div>
          )}
          {b.canDecide && b.myFunc && (
            <DecideForm
              func={b.myFunc}
              mine={b.reviews.find(r => r.func === b.myFunc)?.status}
              busy={busy === "decide"}
              onDecide={(d, n) => run("decide", () => portalApi.clm.decide(taskId, d, n))}
            />
          )}
        </div>
      )}

      {/* Testo e commenti */}
      {cur && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 14, alignItems: "start" }}>
          <div>
            <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
              {(
                [
                  ["text", t("Testo")],
                  ["diff", t("Confronta")],
                  ["clauses", t("Clausole")],
                  ...(b.owner ? [["audit", t("Storico")]] : []),
                ] as [typeof tab, string][]
              ).map(([k, n]) => (
                <button
                  key={k}
                  onClick={() => setTab(k)}
                  style={{
                    ...btnGhost,
                    padding: "4px 11px",
                    fontSize: 12.5,
                    ...(tab === k ? { borderColor: C.accent, color: C.accent, fontWeight: 650 } : {}),
                  }}
                >
                  {n}
                </button>
              ))}
            </div>
            {tab === "diff" && <DiffView taskId={taskId} versions={b.drafts.map(d => ({ id: d.id, version: d.version }))} />}
            {tab === "clauses" && b.draftId && (
              <FindingsView
                taskId={taskId}
                draftId={b.draftId}
                paras={b.paras}
                canAccept={b.myFunc === "legal" || (b.owner && currentUser?.role === "manager")}
                onChanged={() => load(b.draftId ?? undefined)}
              />
            )}
            {tab === "audit" && <AuditView taskId={taskId} />}
            {tab === "text" && (
              <>
                {b.paras.length ? (
                  <div
                    ref={textRef}
                    onMouseUp={onSelect}
                    onTouchEnd={onSelect}
                    style={{
                      border: `1px solid ${C.border}`,
                      borderRadius: 12,
                      padding: "10px 14px",
                      maxHeight: 460,
                      overflowY: "auto",
                      background: "#fff",
                    }}
                  >
                    {(() => {
                      const heads = new Set(b.layout.heads ?? []);
                      const cell = (p: string, i: number) => (
                        <p
                          key={i}
                          data-para={i}
                          style={{
                            margin: "0 0 10px",
                            fontSize: 13.5,
                            lineHeight: 1.55,
                            color: C.text,
                            whiteSpace: "pre-wrap",
                            fontWeight: heads.has(i) ? 700 : 400,
                            borderLeft: paraComments(i).length ? `3px solid ${C.accent}` : "3px solid transparent",
                            paddingLeft: 8,
                          }}
                        >
                          {segments(p, paraComments(i)).map((sg, k) =>
                            sg.ids.length ? (
                              <mark key={k} style={{ background: C.yellowBg, borderRadius: 3 }}>
                                {sg.t}
                              </mark>
                            ) : (
                              <span key={k}>{sg.t}</span>
                            ),
                          )}
                        </p>
                      );
                      if (b.layout.cols !== 2) return b.paras.map(cell);
                      const rows: ReactNode[] = [];
                      for (let i = 0; i < b.paras.length; i += 2)
                        rows.push(
                          <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                            {cell(b.paras[i], i)}
                            {cell(b.paras[i + 1] ?? "", i + 1)}
                          </div>,
                        );
                      return rows;
                    })()}
                  </div>
                ) : (
                  <div style={{ border: `1px dashed ${C.border}`, borderRadius: 12, padding: 14, fontSize: 13, color: C.muted }}>
                    {t(
                      "Anteprima del testo non disponibile per questo formato: scarica il file e usa i commenti generali. Per commentare frase per frase carica la bozza in Word (.docx).",
                    )}
                  </div>
                )}
              </>
            )}
          </div>
          <div style={{ display: "grid", gap: 10 }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: C.subtle, textTransform: "uppercase", letterSpacing: ".04em" }}>
              {t("Commenti ({n} aperti)", { n: top.filter(c => c.status === "open").length })}
            </div>
            <div style={{ display: "grid", gap: 8, maxHeight: 340, overflowY: "auto" }}>
              {!top.length && <div style={{ fontSize: 13, color: C.muted }}>{t("Nessun commento su questa versione.")}</div>}
              {top.map(c => (
                <CommentCard
                  key={c.id}
                  c={c}
                  thread={threadOf(c.id)}
                  owner={b.owner}
                  busy={busy}
                  reply={reply}
                  setReply={setReply}
                  onResolve={(id, v) => run("res" + id, () => portalApi.clm.resolve(id, v))}
                  onReply={txt =>
                    run("reply", () => portalApi.clm.comment(taskId, { draftId: c.draftId, body: txt, parentId: c.id })).then(ok => {
                      if (ok) setReply(null);
                    })
                  }
                  onJump={() => {
                    if (c.para !== null)
                      textRef.current?.querySelector(`[data-para="${c.para}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
                  }}
                />
              ))}
            </div>
            <div style={{ border: `1px solid ${C.border}`, borderRadius: 12, padding: 10, display: "grid", gap: 8 }}>
              {sel ? (
                <div style={{ fontSize: 12.5, color: C.muted, display: "flex", gap: 6, justifyContent: "space-between" }}>
                  <span>{t("Su: «{q}»", { q: sel.quote.length > 90 ? sel.quote.slice(0, 90) + "…" : sel.quote })}</span>
                  <button
                    onClick={() => setSel(null)}
                    aria-label={t("Togli selezione")}
                    style={{ background: "none", border: "none", cursor: "pointer", color: C.subtle }}
                  >
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <div style={{ fontSize: 12.5, color: C.subtle }}>
                  {t("Commento generale (seleziona una frase nel testo per ancorarlo).")}
                </div>
              )}
              <textarea
                value={text}
                onChange={e => setText(e.target.value)}
                rows={3}
                placeholder={t("Scrivi il commento…")}
                style={{ ...iStyle, resize: "vertical" }}
              />
              {b.owner && cur?.sharedAt && (
                <label style={{ fontSize: 12.5, color: C.text, display: "flex", gap: 6, alignItems: "center" }}>
                  <input type="checkbox" checked={ext} onChange={e => setExt(e.target.checked)} />
                  {t("Visibile al fornitore")}
                </label>
              )}
              <button
                onClick={send}
                disabled={!text.trim() || busy === "comment"}
                style={{
                  ...btnPrimary,
                  padding: "8px 14px",
                  fontSize: 13,
                  justifySelf: "end",
                  display: "inline-flex",
                  gap: 6,
                  alignItems: "center",
                  opacity: text.trim() ? 1 : 0.5,
                }}
              >
                {busy === "comment" ? <Loader2 className="spin" size={14} /> : <Send size={14} />}
                {t("Commenta")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CommentCard({
  c,
  thread,
  owner,
  busy,
  reply,
  setReply,
  onResolve,
  onReply,
  onJump,
}: {
  c: ClmComment;
  thread: ClmComment[];
  owner: boolean;
  busy: string | null;
  reply: { id: number; text: string } | null;
  setReply: (r: { id: number; text: string } | null) => void;
  onResolve: (id: number, v: boolean) => void;
  onReply: (t: string) => void;
  onJump: () => void;
}) {
  const resolved = c.status === "resolved";
  const line = (x: ClmComment, first = false): ReactNode => (
    <div key={x.id} style={{ fontSize: 13, color: C.text, paddingTop: first ? 0 : 6 }}>
      <span style={{ fontWeight: 650 }}>{x.authorName}</span>{" "}
      <span style={{ color: C.subtle, fontSize: 11.5 }}>
        {x.func === "buyer"
          ? t("Buyer")
          : x.func === "supplier"
            ? t("Fornitore")
            : FUNC_LABEL[x.func as FuncKey]
              ? t(FUNC_LABEL[x.func as FuncKey])
              : x.func}
        {x.external && x.func !== "supplier" ? " (" + t("visibile al fornitore") + ")" : ""} ·{" "}
        {new Date(x.createdAt).toLocaleDateString(locale())}
      </span>
      <div style={{ whiteSpace: "pre-wrap", marginTop: 2 }}>{x.body}</div>
    </div>
  );
  return (
    <div
      style={{
        border: `1px solid ${C.borderLight}`,
        borderRadius: 10,
        padding: 10,
        opacity: resolved ? 0.65 : 1,
        background: resolved ? C.bg : "#fff",
      }}
    >
      {c.quote && (
        <button
          onClick={onJump}
          style={{
            all: "unset",
            cursor: "pointer",
            display: "block",
            fontSize: 12,
            color: C.muted,
            borderLeft: `3px solid ${C.accent}`,
            paddingLeft: 7,
            marginBottom: 6,
          }}
        >
          «{c.quote.length > 110 ? c.quote.slice(0, 110) + "…" : c.quote}»
        </button>
      )}
      {line(c, true)}
      {thread.map(y => line(y))}
      <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
        <button
          onClick={() => setReply(reply?.id === c.id ? null : { id: c.id, text: "" })}
          style={{ all: "unset", cursor: "pointer", fontSize: 12, color: C.blue }}
        >
          {t("Rispondi")}
        </button>
        {(owner || c.mine) && (
          <button
            onClick={() => onResolve(c.id, !resolved)}
            disabled={busy === "res" + c.id}
            style={{ all: "unset", cursor: "pointer", fontSize: 12, color: C.muted, display: "inline-flex", gap: 4, alignItems: "center" }}
          >
            <Check size={12} />
            {resolved ? t("Riapri") : t("Segna risolto")}
          </button>
        )}
      </div>
      {reply?.id === c.id && (
        <div style={{ display: "grid", gap: 6, marginTop: 6 }}>
          <textarea
            value={reply.text}
            onChange={e => setReply({ id: c.id, text: e.target.value })}
            rows={2}
            style={{ ...iStyle, fontSize: 13 }}
          />
          <button
            onClick={() => onReply(reply.text)}
            disabled={!reply.text.trim() || busy === "reply"}
            style={{ ...btnGhost, padding: "5px 11px", fontSize: 12.5, justifySelf: "end" }}
          >
            {t("Invia risposta")}
          </button>
        </div>
      )}
    </div>
  );
}

function InviteForm({
  bundle,
  busy,
  onSend,
}: {
  bundle: ClmBundle;
  busy: boolean;
  onSend: (funcs: { func: FuncKey; userId?: number }[], msg: string) => void;
}) {
  const [picked, setPicked] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(bundle.required.filter(q => !q.invited).map(q => [q.func, true])),
  );
  const [req, setReq] = useState<number>(bundle.requesters[0]?.id ?? 0);
  const [msg, setMsg] = useState("");
  const list = (["requester", "legal", "compliance", "itsec"] as FuncKey[]).filter(f => !bundle.reviews.some(r => r.func === f));
  if (!list.length) return <div style={{ fontSize: 12.5, color: C.muted }}>{t("Sono già state invitate tutte le funzioni.")}</div>;
  const funcs = list.filter(f => picked[f]).map(f => (f === "requester" ? { func: f, userId: req } : { func: f }));
  return (
    <div style={{ display: "grid", gap: 8, borderTop: `1px solid ${C.borderLight}`, paddingTop: 8 }}>
      {list.map(f => (
        <label key={f} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, color: C.text }}>
          <input type="checkbox" checked={!!picked[f]} onChange={e => setPicked({ ...picked, [f]: e.target.checked })} />
          {t(FUNC_LABEL[f])}
          {f === "requester" && picked[f] && (
            <select
              value={req}
              onChange={e => setReq(Number(e.target.value))}
              style={{ ...iStyle, width: "auto", padding: "4px 8px", fontSize: 12.5 }}
            >
              {bundle.requesters.map(u => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          )}
        </label>
      ))}
      <textarea
        value={msg}
        onChange={e => setMsg(e.target.value)}
        rows={2}
        placeholder={t("Messaggio per chi deve rivedere (facoltativo)")}
        style={{ ...iStyle, fontSize: 13 }}
      />
      <button
        onClick={() => onSend(funcs, msg)}
        disabled={!funcs.length || busy}
        style={{ ...btnPrimary, padding: "8px 14px", fontSize: 13, justifySelf: "end", opacity: funcs.length ? 1 : 0.5 }}
      >
        {busy ? t("Invio…") : t("Invita e avvisa per email")}
      </button>
    </div>
  );
}

function DecideForm({
  func,
  mine,
  busy,
  onDecide,
}: {
  func: FuncKey;
  mine?: ReviewStatus;
  busy: boolean;
  onDecide: (d: ReviewStatus, note: string) => void;
}) {
  const [note, setNote] = useState("");
  return (
    <div style={{ display: "grid", gap: 8, borderTop: `1px solid ${C.borderLight}`, paddingTop: 8 }}>
      <strong style={{ fontSize: 13, color: C.text }}>
        {t("Il tuo parere come {f}", { f: t(FUNC_LABEL[func]) })}
        {mine && mine !== "pending" ? " " + t("(attuale: {s})", { s: t(STATUS[mine].label) }) : ""}
      </strong>
      <textarea
        value={note}
        onChange={e => setNote(e.target.value)}
        rows={2}
        placeholder={t("Nota (obbligatoria se chiedi modifiche)")}
        style={{ ...iStyle, fontSize: 13 }}
      />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          onClick={() => onDecide("approved", note)}
          disabled={busy}
          style={{ ...btnPrimary, background: C.green, padding: "8px 14px", fontSize: 13 }}
        >
          {t("Approvo")}
        </button>
        <button
          onClick={() => onDecide("approved_comments", note)}
          disabled={busy}
          style={{ ...btnGhost, padding: "8px 14px", fontSize: 13, color: C.green, borderColor: C.green }}
        >
          {t("Approvo con commenti")}
        </button>
        <button
          onClick={() => onDecide("changes", note)}
          disabled={busy}
          style={{ ...btnGhost, padding: "8px 14px", fontSize: 13, color: C.red, borderColor: C.red }}
        >
          {t("Chiedo modifiche")}
        </button>
      </div>
    </div>
  );
}
