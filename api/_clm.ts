// CLM (fase 1): bozze del contratto in versioni, commenti sul testo, revisione delle funzioni (Richiedente, Legal, Compliance, IT Security)
// e blocco della firma finché ogni funzione invitata non approva. Le bozze sono riservate: le vedono solo buyer, Manager e funzioni invitate.
import type { ClmAuditEntry, ClmBundle, ClmComment, ClmDiff, ClmDraft, ClmFindings, ClmReview, ClmTemplateInfo, FuncKey, MyReview, ReviewStatus, User } from "../src/types.ts";
import { FILE_PATH_RE, openDocument } from "./_blob.js";
import { getPool, type Queryable } from "./_db.js";
import { HttpError } from "./_http.js";
import { sendMail } from "./_notify.js";
import { FUNC_LABEL, FUNC_ROLE, FUNCS, funcOfRole, REVIEW_SLA_DAYS } from "./_clm-rules.js";
import { getTask } from "./_tasks.js";
import { buildDocx } from "./_docx.js";
import { diffParas } from "./_clm-diff.js";
import { analyzeParas, liveClauses } from "./_clm-clauses.js";
import { renderTemplate, TEMPLATES, LANGS, type Lang } from "./_clm-templates.js";
import { unzip } from "./_xlsx.js";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const bad = (msg: string): never => { throw new HttpError(400, msg); };
const today = () => new Date().toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const day = (v: unknown) => (v ? (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10) : null);
const iso = (v: unknown) => new Date(v as string).toISOString();
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 864e5);
const STATUSES: ReviewStatus[] = ["approved", "approved_comments", "changes"];
const MAX_PARAS = 4000;

const unescapeXml = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, "&");
/** Paragrafi di testo di un .docx (word/document.xml): servono per commentare il testo e per confrontare le versioni. */
export function docxParagraphs(buf: Buffer): string[] {
  const xml = unzip(buf).get("word/document.xml")?.toString("utf8");
  if (!xml) return [];
  const out: string[] = [];
  for (const p of xml.split("</w:p>")) {
    let text = "";
    for (const m of p.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\s*\/>|<w:br\s*\/>/g)) text += m[1] !== undefined ? unescapeXml(m[1]) : m[0].startsWith("<w:tab") ? "\t" : "\n";
    if (text.trim()) out.push(text.trim());
    if (out.length >= MAX_PARAS) break;
  }
  return out;
}

async function latestDraft(db: Queryable, taskId: number): Promise<Row | undefined> {
  return (await db.query("select * from contract_drafts where task_id = $1 order by version desc limit 1", [taskId])).rows[0];
}

/** Chi può vedere la bozza: buyer/Manager del task, oppure la funzione invitata (il Richiedente solo se è la persona invitata). */
async function access(user: User, taskId: number): Promise<{ owner: boolean; func: FuncKey | null }> {
  if (user.role === "manager" || user.role === "buyer") { await getTask(user, taskId); return { owner: true, func: null }; }
  const func = funcOfRole(user.role);
  if (func) {
    const r = (await getPool().query("select 1 from draft_reviews where task_id = $1 and func = $2 and ($2 <> 'requester' or user_id = $3) limit 1", [taskId, func, user.id])).rows[0];
    if (r) return { owner: false, func };
  }
  throw new HttpError(404, "Bozza non trovata");
}

/** Perché non si può ancora firmare (null = via libera). Si applica solo se esiste una bozza: i task senza bozza seguono il flusso di sempre. */
export async function reviewGate(db: Queryable, taskId: number): Promise<string | null> {
  const d = await latestDraft(db, taskId);
  if (!d) return null;
  const msgs: string[] = [];
  const rows = (await db.query("select func, status from draft_reviews where draft_id = $1 and required order by id", [d.id])).rows;
  if (!rows.length) msgs.push("Bozza non ancora rivista: invita almeno una funzione (Legal, Compliance, IT Security o il Richiedente)");
  const open = rows.filter(r => r.status !== "approved" && r.status !== "approved_comments");
  if (open.length) msgs.push(`${open.map(r => `${FUNC_LABEL[r.func as FuncKey]} ${r.status === "changes" ? "chiede modifiche" : "non ha ancora approvato"}`).join(", ")}`);
  const forb = (await openForbidden(db, d)).map(f => `${f.code} (par. ${f.para + 1})`);
  if (forb.length) msgs.push(`clausole non ammesse senza l'ok del Legal: ${forb.join(", ")}`);
  return msgs.length ? `Firma bloccata: ${msgs.join("; ")}` : null;
}

/** Clausole non ammesse presenti nella bozza e non ancora accettate dal Legal. */
async function openForbidden(db: Queryable, d: Row) {
  const paras: string[] = d.paras ?? (await db.query("select paras from contract_drafts where id = $1", [d.id])).rows[0].paras;
  const found = analyzeParas(paras, await liveClauses(db)).filter(f => f.level === "forbidden");
  if (!found.length) return [];
  const ok = (await db.query("select para, clause_code from draft_deviations where draft_id = $1", [d.id])).rows;
  return found.filter(f => !ok.some(o => o.para === f.para && o.clause_code === f.code));
}

const mapReview = (r: Row): ClmReview => ({ id: r.id, func: r.func, required: r.required, due: day(r.due), status: r.status, note: r.note, decidedBy: r.decided_by, decidedAt: r.decided_at ? iso(r.decided_at) : null, invitedAt: iso(r.invited_at) });
const mapDraft = (r: Row): ClmDraft => ({ id: r.id, version: r.version, fileName: r.file_name, size: r.size, note: r.note, uploadedBy: r.uploaded_by, uploadedAt: iso(r.uploaded_at) });

export async function draftBundle(user: User, taskId: number, draftId?: number): Promise<ClmBundle> {
  const { owner, func } = await access(user, taskId);
  const db = getPool();
  const t = await getTask(user.role === "manager" || user.role === "buyer" ? user : ({ ...user, role: "manager" } as User), taskId);
  const drafts = (await db.query("select id, task_id, version, file_name, size, note, uploaded_by, uploaded_at, layout, (file_path is null) as generated from contract_drafts where task_id = $1 order by version desc", [taskId])).rows;
  const latest = drafts[0];
  const cur = draftId ? drafts.find(d => d.id === draftId) : latest;
  if (draftId && !cur) throw new HttpError(404, "Versione non trovata");
  const reviews = cur ? (await db.query("select * from draft_reviews where draft_id = $1 order by id", [cur.id])).rows : [];
  const comments = cur ? (await db.query("select * from draft_comments where draft_id = $1 order by id", [cur.id])).rows : [];
  const paras: string[] = cur ? (await db.query("select paras from contract_drafts where id = $1", [cur.id])).rows[0].paras : [];
  const mine = reviews.find(r => r.func === func);
  return {
    drafts: drafts.map(mapDraft), draftId: cur?.id ?? null, latestId: latest?.id ?? null, paras,
    reviews: reviews.map(mapReview),
    comments: comments.map((c): ClmComment => ({ id: c.id, draftId: c.draft_id, authorName: c.author_name, func: c.func, para: c.para, start: c.start_pos, end: c.end_pos, quote: c.quote, body: c.body, status: c.status, parentId: c.parent_id, createdAt: iso(c.created_at), mine: c.author_id === user.id })),
    brief: { taskId, title: t.title, supplier: t.chosenSupplierName || String(t.meta.supplier ?? ""), value: Number(t.meta.value) || null, currency: String(t.meta.currency ?? "EUR"), due: t.due, priority: t.priority },
    owner, myFunc: func, canDecide: !!mine && cur?.id === latest?.id, gate: await reviewGate(db, taskId),
    layout: cur?.layout ?? {}, generated: !!cur?.generated,
    requesters: owner ? (await db.query("select id, name from users where active and role = 'bo' order by name")).rows : [],
  };
}

/** Scadenza proposta per una revisione: SLA standard, ma mai oltre la scadenza del task (se è ancora futura). */
function dueFor(taskDue: string | null): string {
  const t0 = today(), sla = addDays(t0, REVIEW_SLA_DAYS);
  return taskDue && taskDue >= t0 && taskDue < sla ? taskDue : sla;
}

async function recipients(db: Queryable, func: FuncKey, userId: number | null): Promise<{ email: string; name: string }[]> {
  if (func === "requester") return (await db.query("select email, name from users where id = $1 and active and role = 'bo'", [userId])).rows;
  return (await db.query("select email, name from users where active and role = $1 order by id", [FUNC_ROLE[func]])).rows;
}
const mail = async (db: Queryable, to: { email: string; name: string }, template: "review_invite" | "review_reminder" | "review_decided", origin: string, reason: string, detail: string, deadline = "") =>
  sendMail(db, { to: to.email, template, vars: { name: to.name, link: `${origin}/`, reason: reason.slice(0, 160), detail, deadline } }).catch(() => "failed");

export async function uploadDraft(user: User, taskId: number, input: Row, origin: string): Promise<ClmBundle> {
  if (user.role !== "manager" && user.role !== "buyer") throw new HttpError(403, "Solo il buyer carica la bozza");
  const t = await getTask(user, taskId);
  if (t.status !== "open") bad("La pratica è chiusa");
  if (t.source === "contract") bad("Per i rinnovi la bozza si gestisce con il contratto esistente");
  const path = String(input?.filePath ?? ""), name = String(input?.fileName ?? "").trim().slice(0, 200);
  if (!FILE_PATH_RE.test(path) || !name) bad("Documento non valido");
  if (!/\.(docx|doc|pdf)$/i.test(name)) bad("Carica la bozza in Word (.docx) per commentare il testo, oppure in PDF");
  const db = getPool();
  let paras: string[] = [];
  if (/\.docx$/i.test(name)) {
    try { const b = await openDocument(path); if (b) paras = docxParagraphs(Buffer.from(await new Response(b.stream).arrayBuffer())); } catch { paras = []; }
  }
  const prev = await latestDraft(db, taskId);
  const version = (prev?.version ?? 0) + 1;
  const id = (await db.query("insert into contract_drafts (task_id, version, file_name, file_path, size, paras, note, uploaded_by) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id",
    [taskId, version, name, path, Math.max(0, Number(input?.size) || 0), JSON.stringify(paras), String(input?.note ?? "").trim().slice(0, 500), user.name])).rows[0].id as number;
  if (prev) {
    // La nuova versione azzera i pareri: ogni funzione già invitata deve rivederla.
    const due = dueFor(t.due);
    const old = (await db.query("select * from draft_reviews where draft_id = $1", [prev.id])).rows;
    for (const r of old) {
      await db.query("insert into draft_reviews (task_id, draft_id, func, user_id, required, due, invited_by) values ($1,$2,$3,$4,$5,$6,$7)", [taskId, id, r.func, r.user_id, r.required, due, user.name]);
      for (const to of await recipients(db, r.func, r.user_id)) await mail(db, to, "review_invite", origin, t.title, `${user.name} ha caricato la versione ${version} della bozza: serve di nuovo il tuo parere.`, `entro il ${due.split("-").reverse().join("/")}`);
    }
  }
  await logDraft(db, user, taskId, id, "Bozza caricata", `versione ${version}: ${name}`);
  return draftBundle(user, taskId, id);
}

export async function inviteReviewers(user: User, taskId: number, input: Row, origin: string): Promise<ClmBundle> {
  if (user.role !== "manager" && user.role !== "buyer") throw new HttpError(403, "Solo il buyer invita le funzioni");
  const t = await getTask(user, taskId);
  if (t.status !== "open") bad("La pratica è chiusa");
  const d = (await latestDraft(getPool(), taskId)) ?? bad("Carica prima la bozza del contratto");
  const list = Array.isArray(input?.funcs) ? input.funcs as Row[] : [];
  if (!list.length) bad("Scegli almeno una funzione da invitare");
  const db = getPool();
  const message = String(input?.message ?? "").trim().slice(0, 600);
  for (const f of list) {
    const func = f?.func as FuncKey;
    if (!FUNCS.includes(func)) bad("Funzione non valida");
    let userId: number | null = null;
    if (func === "requester") {
      userId = Number(f.userId);
      if (!Number.isInteger(userId) || !(await db.query("select 1 from users where id = $1 and active and role = 'bo'", [userId])).rows.length) bad("Scegli il Business Owner richiedente");
    } else if (!(await recipients(db, func, null)).length) bad(`Non c'è nessun utente con il ruolo ${FUNC_LABEL[func]}: crealo da Utenti`);
    const due = typeof f.due === "string" && /^\d{4}-\d{2}-\d{2}$/.test(f.due) ? f.due : dueFor(t.due);
    const had = (await db.query("select 1 from draft_reviews where draft_id = $1 and func = $2", [d.id, func])).rows.length > 0;
    await db.query(`insert into draft_reviews (task_id, draft_id, func, user_id, required, due, invited_by) values ($1,$2,$3,$4,true,$5,$6)
      on conflict (draft_id, func) do update set user_id = excluded.user_id, due = excluded.due`, [taskId, d.id, func, userId, due, user.name]);
    if (!had) for (const to of await recipients(db, func, userId)) await mail(db, to, "review_invite", origin, t.title, `${user.name} ti chiede di rivedere la bozza (versione ${d.version})${message ? `:\n${message}` : "."}`, `entro il ${due.split("-").reverse().join("/")}`);
  }
  await logDraft(db, user, taskId, d.id, "Funzioni invitate", list.map((f: Row) => FUNC_LABEL[f.func as FuncKey]).join(", "));
  return draftBundle(user, taskId);
}

export async function addComment(user: User, taskId: number, input: Row): Promise<ClmBundle> {
  const { owner, func } = await access(user, taskId);
  const db = getPool();
  const d = input?.draftId ? (await db.query("select id, version, paras from contract_drafts where id = $1 and task_id = $2", [Number(input.draftId), taskId])).rows[0] : await latestDraft(db, taskId);
  if (!d) bad("Bozza non trovata");
  const body = String(input?.body ?? "").trim().slice(0, 2000);
  if (!body) bad("Scrivi il commento");
  const paraCount = Array.isArray(d.paras) ? d.paras.length : 0;
  const para = Number.isInteger(input?.para) && input.para >= 0 && input.para < paraCount ? input.para as number : null;
  const clampPos = (v: unknown) => (para !== null && Number.isInteger(v) && (v as number) >= 0 && (v as number) <= String(d.paras[para]).length ? v as number : null);
  const parentId = input?.parentId ? Number(input.parentId) : null;
  if (parentId && !(await db.query("select 1 from draft_comments where id = $1 and draft_id = $2", [parentId, d.id])).rows.length) bad("Commento non trovato");
  await db.query("insert into draft_comments (task_id, draft_id, author_id, author_name, func, para, start_pos, end_pos, quote, body, parent_id) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
    [taskId, d.id, user.id, user.name, owner ? "buyer" : func, para, clampPos(input?.start), clampPos(input?.end), String(input?.quote ?? "").slice(0, 300), body, parentId]);
  await logDraft(db, user, taskId, d.id, "Commento", body.slice(0, 120));
  return draftBundle(user, taskId, d.id);
}

export async function resolveComment(user: User, commentId: number, resolved: boolean): Promise<ClmBundle> {
  const c = (await getPool().query("select * from draft_comments where id = $1", [commentId])).rows[0];
  if (!c) throw new HttpError(404, "Commento non trovato");
  const { owner } = await access(user, c.task_id);
  if (!owner && c.author_id !== user.id) throw new HttpError(403, "Solo chi ha scritto il commento o il buyer può chiuderlo");
  await getPool().query("update draft_comments set status = $2 where id = $1", [commentId, resolved ? "resolved" : "open"]);
  await logDraft(getPool(), user, c.task_id, c.draft_id, resolved ? "Commento risolto" : "Commento riaperto", c.body.slice(0, 80));
  return draftBundle(user, c.task_id, c.draft_id);
}

export async function decideReview(user: User, taskId: number, input: Row, origin: string): Promise<ClmBundle> {
  const { owner, func } = await access(user, taskId);
  if (owner || !func) throw new HttpError(403, "Il parere lo danno le funzioni invitate");
  const db = getPool();
  const d = await latestDraft(db, taskId);
  const r = d && (await db.query("select * from draft_reviews where draft_id = $1 and func = $2 and ($2 <> 'requester' or user_id = $3)", [d.id, func, user.id])).rows[0];
  if (!d || !r) throw new HttpError(404, "Revisione non trovata");
  const decision = input?.decision as ReviewStatus, note = String(input?.note ?? "").trim().slice(0, 1000);
  if (!STATUSES.includes(decision)) bad("Scegli: approvo, approvo con commenti oppure chiedo modifiche");
  if (decision === "changes" && note.length < 5) bad("Spiega cosa va modificato");
  await db.query("update draft_reviews set status = $2, note = $3, decided_by = $4, decided_at = now() where id = $1", [r.id, decision, note, user.name]);
  await logDraft(db, user, taskId, d.id, "Parere", `${FUNC_LABEL[func]}: ${({ approved: "approva", approved_comments: "approva con commenti", changes: "chiede modifiche" } as Record<string, string>)[decision]}${note ? ` — ${note}` : ""}`);
  const t = (await db.query("select t.title, u.email, u.name from tasks t left join users u on u.id = t.assignee_id where t.id = $1", [taskId])).rows[0];
  if (t?.email) {
    const verdict = decision === "approved" ? "ha approvato" : decision === "approved_comments" ? "ha approvato con commenti" : "chiede modifiche a";
    await mail(db, { email: t.email, name: t.name }, "review_decided", origin, t.title, `${FUNC_LABEL[func]} (${user.name}) ${verdict} la bozza (versione ${d.version}).${note ? `\n\n${note}` : ""}`);
  }
  return draftBundle(user, taskId);
}

export async function draftFile(user: User, draftId: number): Promise<{ fileName: string; filePath: string | null; buffer?: Buffer }> {
  const d = (await getPool().query("select task_id, file_name, file_path, paras, layout from contract_drafts where id = $1", [draftId])).rows[0];
  if (!d) throw new HttpError(404, "Bozza non trovata");
  await access(user, d.task_id);
  await logDraft(getPool(), user, d.task_id, draftId, "Bozza scaricata", d.file_name);
  return d.file_path ? { fileName: d.file_name, filePath: d.file_path } : { fileName: d.file_name, filePath: null, buffer: buildDocx(d.paras, d.layout) };
}

/** Le revisioni che aspettano questa funzione: stesse priorità e scadenze dei task, in ordine di urgenza. */
export async function myReviews(user: User): Promise<MyReview[]> {
  const func = funcOfRole(user.role);
  if (!func) throw new HttpError(403, "Operazione non consentita");
  const t0 = today();
  const rows = (await getPool().query(`select r.id, r.task_id, r.func, r.due, r.status, r.invited_at, d.version, t.title, t.due as task_due, t.priority, t.chosen_supplier_name, t.meta->>'supplier' as meta_supplier
    from draft_reviews r join contract_drafts d on d.id = r.draft_id join tasks t on t.id = r.task_id
    where r.func = $1 and ($1 <> 'requester' or r.user_id = $2) and t.status = 'open' and d.version = (select max(version) from contract_drafts where task_id = r.task_id)
    order by (r.status = 'pending') desc, r.due nulls last, case t.priority when 'high' then 0 when 'normal' then 1 else 2 end, r.id`, [func, user.id])).rows;
  return rows.map(r => ({ reviewId: r.id, taskId: r.task_id, func: r.func, title: r.title, supplier: r.chosen_supplier_name || r.meta_supplier || "", due: day(r.due), taskDue: day(r.task_due), priority: r.priority, version: r.version,
    invitedAt: iso(r.invited_at), overdueDays: r.status === "pending" && r.due && day(r.due)! < t0 ? daysBetween(t0, day(r.due)!) : 0, status: r.status }));
}

/** Revisioni in attesa e in ritardo, per task: usate dalla lista "Il mio lavoro" del buyer e del Manager. */
export async function pendingReviewsOf(db: Queryable, taskIds: number[] | null): Promise<{ taskId: number; title: string; func: FuncKey; due: string | null; waitDays: number; overdue: number; assigneeId: number | null }[]> {
  const t0 = today();
  const rows = (await db.query(`select r.task_id, r.func, r.due, r.invited_at, t.title, t.assignee_id from draft_reviews r join contract_drafts d on d.id = r.draft_id join tasks t on t.id = r.task_id
    where r.status = 'pending' and t.status = 'open' and d.version = (select max(version) from contract_drafts where task_id = r.task_id) and ($1::int[] is null or r.task_id = any($1))`, [taskIds])).rows;
  return rows.map(r => ({ taskId: r.task_id, title: r.title, func: r.func, due: day(r.due), assigneeId: r.assignee_id,
    waitDays: Math.max(0, daysBetween(t0, iso(r.invited_at).slice(0, 10))), overdue: r.due && day(r.due)! < t0 ? daysBetween(t0, day(r.due)!) : 0 }));
}

/** Solleciti alle funzioni in ritardo (ogni 2 giorni) e, dopo 2 giorni di ritardo, avviso anche al Manager. */
export async function runReviewReminders(origin: string): Promise<{ reminders: number; escalations: number }> {
  const db = getPool(), t0 = today();
  const rows = (await db.query(`select r.id, r.func, r.user_id, r.due, t.title, t.assignee_id from draft_reviews r join contract_drafts d on d.id = r.draft_id join tasks t on t.id = r.task_id
    where r.status = 'pending' and t.status = 'open' and r.due is not null and r.due <= $1 and (r.last_reminded is null or r.last_reminded <= $2)
      and d.version = (select max(version) from contract_drafts where task_id = r.task_id)`, [t0, addDays(t0, -2)])).rows;
  let reminders = 0, escalations = 0;
  const managers = (await db.query("select email, name from users where active and role = 'manager'")).rows;
  for (const r of rows) {
    const late = daysBetween(t0, day(r.due)!);
    for (const to of await recipients(db, r.func, r.user_id)) { await mail(db, to, "review_reminder", origin, r.title, `La bozza aspetta il parere di ${FUNC_LABEL[r.func as FuncKey]}${late > 0 ? ` da ${late} ${late === 1 ? "giorno" : "giorni"} oltre la scadenza` : " (scade oggi)"}.`); reminders++; }
    if (late >= 2) for (const m of managers) { await mail(db, m, "review_reminder", origin, r.title, `Escalation: ${FUNC_LABEL[r.func as FuncKey]} non ha ancora dato il parere sulla bozza, ${late} giorni oltre la scadenza. Il task del buyer è fermo su questa revisione.`); escalations++; }
    await db.query("update draft_reviews set last_reminded = $2 where id = $1", [r.id, t0]);
  }
  return { reminders, escalations };
}

// ─── Registro delle azioni sulle bozze ───────────────────────
export async function logDraft(db: Queryable, user: User, taskId: number, draftId: number | null, action: string, detail = ""): Promise<void> {
  await db.query("insert into draft_audit (task_id, draft_id, actor_id, actor_name, actor_role, action, detail) values ($1,$2,$3,$4,$5,$6,$7)", [taskId, draftId, user.id || null, user.name, user.role, action, detail.slice(0, 500)]);
}
export async function draftAudit(user: User, taskId: number): Promise<ClmAuditEntry[]> {
  const { owner } = await access(user, taskId);
  if (!owner) throw new HttpError(403, "Il registro lo vedono buyer e Manager");
  const rows = (await getPool().query("select * from draft_audit where task_id = $1 order by id desc limit 500", [taskId])).rows;
  return rows.map(r => ({ id: r.id, at: iso(r.at), actor: r.actor_name, role: r.actor_role, action: r.action, detail: r.detail, draftId: r.draft_id }));
}
export async function draftAuditCsv(user: User, taskId: number): Promise<string> {
  const list = (await draftAudit(user, taskId)).reverse();
  const q = (v: string) => `"${v.replace(/"/g, '""')}"`;
  return ["Data;Utente;Ruolo;Azione;Dettaglio", ...list.map(e => [e.at, e.actor, e.role, e.action, e.detail].map(q).join(";"))].join("\r\n");
}

// ─── Modelli con questionario ────────────────────────────────
const termDays = (code: unknown) => { const n = parseInt(String(code ?? ""), 10); return [30, 60, 90].includes(n) ? String(n) : ""; };
/** Modelli disponibili, con le risposte già compilate dal task e dall'anagrafica del fornitore scelto. */
export async function templateInfo(user: User, taskId: number): Promise<ClmTemplateInfo[]> {
  if (user.role !== "manager" && user.role !== "buyer") throw new HttpError(403, "Operazione non consentita");
  const t = await getTask(user, taskId);
  const db = getPool();
  const sup = t.chosenSupplierId ? (await db.query("select name, data, payment_terms from suppliers where id = $1", [t.chosenSupplierId])).rows[0] : null;
  const a = sup?.data?.address ?? {};
  const pre: Record<string, string> = {
    supplier: t.chosenSupplierName || sup?.data?.company?.legalName || sup?.name || String(t.meta.supplier ?? ""),
    supplierVat: sup?.data?.company?.vatCode ?? "", supplierAddress: [`${a.street ?? ""} ${a.houseNumber ?? ""}`.trim(), `${a.postalCode ?? ""} ${a.city ?? ""}`.trim(), a.country ?? ""].filter(Boolean).join(", "),
    value: t.meta.value ? String(t.meta.value) : "", currency: String(t.meta.currency ?? "EUR"), title: t.title, today: new Date().toISOString().slice(0, 10), paymentTerms: termDays(sup?.payment_terms),
  };
  return TEMPLATES.map(tp => ({ code: tp.code, name: tp.name, description: tp.description,
    questions: tp.questions.map(q => ({ key: q.key, label: q.label, type: q.type, required: q.required, options: q.options, value: (q.prefill && pre[q.prefill]) || q.default || "" })) }));
}

/** Crea una nuova versione della bozza dal modello e dalle risposte. Il file Word si genera quando serve (scarico). */
export async function draftFromTemplate(user: User, taskId: number, input: Row): Promise<ClmBundle> {
  if (user.role !== "manager" && user.role !== "buyer") throw new HttpError(403, "Solo il buyer crea la bozza");
  const t = await getTask(user, taskId);
  if (t.status !== "open") bad("La pratica è chiusa");
  if (t.source === "contract") bad("Per i rinnovi la bozza si gestisce con il contratto esistente");
  const tpl = TEMPLATES.find(x => x.code === input?.template);
  if (!tpl) bad("Modello non trovato");
  const langs = (Array.isArray(input?.langs) ? input.langs : ["it"]).filter((l: unknown): l is Lang => LANGS.includes(l as Lang));
  const answers = (input?.answers ?? {}) as Record<string, unknown>;
  const db = getPool();
  const live = await liveClauses(db);
  const out = renderTemplate(tpl!, answers, langs.length ? langs : ["it"], (code, l) => live.find(c => c.code === code)?.text[l] || null);
  const prev = await latestDraft(db, taskId);
  const version = (prev?.version ?? 0) + 1;
  const id = (await db.query("insert into contract_drafts (task_id, version, file_name, file_path, size, paras, layout, source, note, uploaded_by) values ($1,$2,$3,null,0,$4,$5,$6,$7,$8) returning id",
    [taskId, version, `${tpl!.code}-${(t.chosenSupplierName || "bozza").replace(/[^\p{L}\p{N}]+/gu, "_").slice(0, 40)}-v${version}.docx`, JSON.stringify(out.paras), JSON.stringify({ cols: out.cols, langs: out.langs, heads: out.heads }),
      JSON.stringify({ template: tpl!.code, answers }), `Generata dal modello "${tpl!.name.it}"`, user.name])).rows[0].id as number;
  if (prev) { // come per un caricamento: i pareri ripartono
    const old = (await db.query("select * from draft_reviews where draft_id = $1", [prev.id])).rows;
    const due = dueFor(t.due);
    for (const r of old) await db.query("insert into draft_reviews (task_id, draft_id, func, user_id, required, due, invited_by) values ($1,$2,$3,$4,$5,$6,$7)", [taskId, id, r.func, r.user_id, r.required, due, user.name]);
  }
  await logDraft(db, user, taskId, id, "Bozza creata dal modello", `${tpl!.name.it} (${out.langs.join("+")}), versione ${version}`);
  return draftBundle(user, taskId, id);
}

// ─── Confronto, clausole, deviazioni ─────────────────────────
export async function diffDrafts(user: User, taskId: number, fromId: number, toId: number): Promise<ClmDiff> {
  await access(user, taskId);
  const rows = (await getPool().query("select id, version, paras from contract_drafts where task_id = $1 and id = any($2)", [taskId, [fromId, toId]])).rows;
  const a = rows.find(r => r.id === fromId), b = rows.find(r => r.id === toId);
  if (!a || !b) throw new HttpError(404, "Versione non trovata");
  return { ...diffParas(a.paras, b.paras), from: a.version, to: b.version };
}

export async function draftFindings(user: User, taskId: number, draftId?: number): Promise<ClmFindings> {
  await access(user, taskId);
  const db = getPool();
  const d = draftId ? (await db.query("select id, paras from contract_drafts where id = $1 and task_id = $2", [draftId, taskId])).rows[0] : await latestDraft(db, taskId);
  if (!d) return { findings: [], accepted: [] };
  const findings = analyzeParas(d.paras, await liveClauses(db));
  const accepted = (await db.query("select para, clause_code, accepted_by, note from draft_deviations where draft_id = $1", [d.id])).rows.map(r => ({ para: r.para, code: r.clause_code, by: r.accepted_by, note: r.note }));
  return { findings, accepted };
}

/** Il Legal (o il Manager) accetta una deviazione dallo standard: sblocca la firma per le clausole non ammesse. */
export async function acceptDeviation(user: User, taskId: number, input: Row): Promise<ClmFindings> {
  const { owner, func } = await access(user, taskId);
  if (!(func === "legal" || user.role === "manager") || (owner && user.role !== "manager")) throw new HttpError(403, "Solo il Legal o il Manager accettano una deviazione");
  const db = getPool();
  const d = await latestDraft(db, taskId);
  if (!d) bad("Nessuna bozza");
  const para = Number(input?.para), code = String(input?.code ?? "");
  const f = analyzeParas(d!.paras, await liveClauses(db)).find(x => x.para === para && x.code === code && (x.level === "forbidden" || x.level === "deviates"));
  if (!f) bad("Su questo paragrafo non c'è nessuna deviazione da accettare");
  const note = String(input?.note ?? "").trim().slice(0, 500);
  if (f!.level === "forbidden" && note.length < 5) bad("Spiega perché accetti una clausola non ammessa");
  await db.query("insert into draft_deviations (draft_id, para, clause_code, accepted_by, note) values ($1,$2,$3,$4,$5) on conflict (draft_id, para, clause_code) do update set accepted_by = excluded.accepted_by, note = excluded.note, accepted_at = now()", [d!.id, para, code, user.name, note]);
  await logDraft(db, user, taskId, d!.id, "Deviazione accettata", `${code} al paragrafo ${para + 1}${note ? `: ${note}` : ""}`);
  return draftFindings(user, taskId, d!.id);
}
