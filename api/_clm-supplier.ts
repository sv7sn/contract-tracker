// Trattativa con il fornitore: il buyer condivide una versione già approvata internamente, il fornitore la legge nel suo portale,
// scrive commenti visibili solo a buyer (separati da quelli interni) e può caricare una sua proposta di modifica.
// Il fornitore non vede mai commenti interni, pareri delle funzioni, regole o registro: solo ciò che è stato condiviso con lui.
import type { ClmBundle, NegotiationBundle, NegotiationSummary, User } from "../src/types.ts";
import { openDocument } from "./_blob.js";
import { getPool, type Queryable } from "./_db.js";
import { HttpError } from "./_http.js";
import { sendMail } from "./_notify.js";
import { SUPPLIER_FILE_PATH_RE } from "./_supplier-rules.js";
import { buildDocx } from "./_docx.js";
import { docxParagraphs, draftBundle, logDraft, nextVersion, reviewGate } from "./_clm.js";
import { getTask } from "./_tasks.js";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const bad = (m: string): never => { throw new HttpError(400, m); };
const iso = (v: unknown) => new Date(v as string).toISOString();

async function supplierUsers(db: Queryable, supplierId: number) {
  return (await db.query("select u.email, u.name from suppliers s join users u on u.id = s.user_id where s.id = $1 and u.active", [supplierId])).rows as { email: string; name: string }[];
}

/** Il buyer condivide (o ritira) una versione interna con il fornitore scelto. Si condivide solo testo senza blocchi interni. */
export async function shareDraft(user: User, taskId: number, input: Row, origin: string): Promise<ClmBundle> {
  if (user.role !== "manager" && user.role !== "buyer") throw new HttpError(403, "Solo il buyer condivide la bozza");
  const t = await getTask(user, taskId);
  if (t.status !== "open") bad("La pratica è chiusa");
  const supId = t.chosenSupplierId;
  if (!supId) bad("Scegli prima il fornitore: la bozza si condivide con lui");
  const db = getPool();
  const d = (await db.query("select id, version, file_name from contract_drafts where id = $1 and task_id = $2 and origin = 'internal'", [Number(input?.draftId), taskId])).rows[0];
  if (!d) throw new HttpError(404, "Versione non trovata");
  if (input?.share === false) {
    await db.query("update contract_drafts set shared_at = null where id = $1", [d.id]);
    await logDraft(db, user, taskId, d.id, "Condivisione ritirata", `versione ${d.version}`);
    return draftBundle(user, taskId, d.id);
  }
  const latest = (await db.query("select id from contract_drafts where task_id = $1 and origin = 'internal' order by version desc limit 1", [taskId])).rows[0];
  if (latest.id !== d.id) bad("Si condivide solo l'ultima versione");
  const gate = await reviewGate(db, taskId);
  if (gate) throw new HttpError(409, `Non si può condividere: ${gate.replace(/^Firma bloccata: /, "")}`);
  const users = await supplierUsers(db, supId as number);
  if (!users.length) bad("Il fornitore non ha ancora un accesso al portale: invitalo prima");
  await db.query("update contract_drafts set shared_at = now(), shared_by = $2 where id = $1", [d.id, user.name]);
  const message = String(input?.message ?? "").trim().slice(0, 600);
  for (const u of users) await sendMail(db, { to: u.email, template: "negotiation_shared", supplierId: supId as number, vars: { name: u.name, link: `${origin}/`, reason: d.file_name.replace(/\.[a-z]+$/i, ""), detail: `${t.chosenSupplierName || "Il buyer"} — ${user.name} ha condiviso con te la versione ${d.version} della bozza di contratto.${message ? `\n\n${message}` : ""}` } }).catch(() => "failed");
  await logDraft(db, user, taskId, d.id, "Bozza condivisa con il fornitore", `versione ${d.version} a ${t.chosenSupplierName}`);
  return draftBundle(user, taskId, d.id);
}

async function mySupplierId(user: User): Promise<number> {
  if (user.role !== "supplier") throw new HttpError(403, "Operazione non consentita");
  const r = (await getPool().query("select id from suppliers where user_id = $1", [user.id])).rows[0];
  if (!r) throw new HttpError(404, "Scheda fornitore non trovata");
  return r.id;
}
/** Una bozza condivisa con questo fornitore: se non lo è, per lui non esiste. */
async function sharedDraft(sid: number, draftId: number): Promise<Row> {
  const r = (await getPool().query("select d.*, t.title as task_title, t.assignee_id from contract_drafts d join tasks t on t.id = d.task_id where d.id = $1 and d.shared_at is not null and t.chosen_supplier_id = $2", [draftId, sid])).rows[0];
  if (!r) throw new HttpError(404, "Bozza non trovata");
  return r;
}
const nameOf = (f: string) => f.replace(/\.[a-z]+$/i, "");

export async function myNegotiations(user: User): Promise<NegotiationSummary[]> {
  const sid = await mySupplierId(user);
  const rows = (await getPool().query("select d.id, d.task_id, d.version, d.file_name, d.shared_at from contract_drafts d join tasks t on t.id = d.task_id where t.chosen_supplier_id = $1 and d.shared_at is not null order by d.task_id, d.version desc", [sid])).rows;
  const out: NegotiationSummary[] = [];
  for (const r of rows) {
    if (out.some(o => o.taskId === r.task_id)) continue;
    const open = (await getPool().query("select count(*)::int as n from draft_comments where draft_id = $1 and external and func <> 'supplier' and status = 'open' and parent_id is null", [r.id])).rows[0].n;
    out.push({ taskId: r.task_id, title: nameOf(r.file_name), latestVersion: r.version, sharedAt: iso(r.shared_at), openComments: open });
  }
  return out;
}

export async function negotiationBundle(user: User, taskId: number, draftId?: number): Promise<NegotiationBundle> {
  const sid = await mySupplierId(user);
  const db = getPool();
  const drafts = (await db.query("select d.id, d.version, d.origin, d.shared_at, d.file_name, d.paras, d.layout from contract_drafts d join tasks t on t.id = d.task_id where d.task_id = $1 and t.chosen_supplier_id = $2 and d.shared_at is not null order by d.version desc", [taskId, sid])).rows;
  if (!drafts.length) throw new HttpError(404, "Bozza non trovata");
  const cur = draftId ? drafts.find(d => d.id === draftId) : drafts[0];
  if (!cur) throw new HttpError(404, "Versione non trovata");
  const comments = (await db.query("select * from draft_comments where draft_id = $1 and external order by id", [cur.id])).rows;
  return {
    title: nameOf(drafts[0].file_name), draftId: cur.id, paras: cur.paras, layout: cur.layout,
    drafts: drafts.map(d => ({ id: d.id, version: d.version, origin: d.origin, sharedAt: iso(d.shared_at), fileName: d.file_name })),
    comments: comments.map(c => ({ id: c.id, fromSupplier: c.func === "supplier", author: c.func === "supplier" ? c.author_name : "Ufficio acquisti", para: c.para, start: c.start_pos, end: c.end_pos, quote: c.quote, body: c.body, parentId: c.parent_id, createdAt: iso(c.created_at), status: c.status })),
  };
}

async function tellBuyer(db: Queryable, d: Row, supplier: string, what: string, origin: string) {
  const b = (await db.query("select u.email, u.name from users u where u.id = $1 and u.active", [d.assignee_id])).rows[0];
  if (b) await sendMail(db, { to: b.email, template: "negotiation_reply", vars: { name: b.name, link: `${origin}/?task=${d.task_id}`, reason: d.task_title, detail: `${supplier} ${what}.` } }).catch(() => "failed");
}

export async function supplierComment(user: User, taskId: number, input: Row, origin: string): Promise<NegotiationBundle> {
  const sid = await mySupplierId(user);
  if (!Number.isInteger(input?.draftId)) bad("Versione non valida");
  const d = await sharedDraft(sid, input.draftId as number);
  if (d.task_id !== taskId) throw new HttpError(404, "Bozza non trovata");
  const body = String(input?.body ?? "").trim().slice(0, 2000);
  if (!body) bad("Scrivi il commento");
  const db = getPool();
  const paras: string[] = d.paras ?? [];
  const para = Number.isInteger(input?.para) && input.para >= 0 && input.para < paras.length ? input.para as number : null;
  const pos = (v: unknown) => (para !== null && Number.isInteger(v) && (v as number) >= 0 && (v as number) <= paras[para].length ? v as number : null);
  const parentId = input?.parentId ? Number(input.parentId) : null;
  if (parentId && !(await db.query("select 1 from draft_comments where id = $1 and draft_id = $2 and external", [parentId, d.id])).rows.length) bad("Commento non trovato");
  await db.query("insert into draft_comments (task_id, draft_id, author_id, author_name, func, para, start_pos, end_pos, quote, body, parent_id, external) values ($1,$2,$3,$4,'supplier',$5,$6,$7,$8,$9,$10,true)",
    [taskId, d.id, user.id, user.name, para, pos(input?.start), pos(input?.end), String(input?.quote ?? "").slice(0, 300), body, parentId]);
  await logDraft(db, user, taskId, d.id, "Commento del fornitore", body.slice(0, 120));
  await tellBuyer(db, d, user.name, "ha scritto un commento sulla bozza", origin);
  return negotiationBundle(user, taskId, d.id);
}

/** Controproposta del fornitore: un file suo, che il buyer confronta con la nostra versione. Non entra nel giro di revisioni interne. */
export async function supplierUpload(user: User, taskId: number, input: Row, origin: string): Promise<NegotiationBundle> {
  const sid = await mySupplierId(user);
  const db = getPool();
  const ref = (await db.query("select d.id, t.title as task_title, t.assignee_id, d.task_id from contract_drafts d join tasks t on t.id = d.task_id where d.task_id = $1 and t.chosen_supplier_id = $2 and d.shared_at is not null limit 1", [taskId, sid])).rows[0];
  if (!ref) throw new HttpError(404, "Bozza non trovata");
  const path = String(input?.filePath ?? ""), name = String(input?.fileName ?? "").trim().slice(0, 200);
  if (!SUPPLIER_FILE_PATH_RE.test(path) || !name) bad("Documento non valido");
  if (!/\.(docx|doc|pdf)$/i.test(name)) bad("Carica la tua versione in Word (.docx) o PDF");
  let paras: string[] = [];
  if (/\.docx$/i.test(name)) { try { const b = await openDocument(path); if (b) paras = docxParagraphs(Buffer.from(await new Response(b.stream).arrayBuffer())); } catch { paras = []; } }
  const version = await nextVersion(db, taskId);
  const id = (await db.query("insert into contract_drafts (task_id, version, file_name, file_path, size, paras, note, uploaded_by, origin, shared_at, shared_by) values ($1,$2,$3,$4,$5,$6,$7,$8,'supplier',now(),$8) returning id",
    [taskId, version, name, path, Math.max(0, Number(input?.size) || 0), JSON.stringify(paras), String(input?.note ?? "").trim().slice(0, 500), user.name])).rows[0].id as number;
  await logDraft(db, user, taskId, id, "Controproposta del fornitore", `versione ${version}: ${name}`);
  await tellBuyer(db, ref, user.name, `ha caricato una sua versione della bozza (v${version})`, origin);
  return negotiationBundle(user, taskId, id);
}

export async function supplierDraftFile(user: User, draftId: number): Promise<{ fileName: string; filePath: string | null; buffer?: Buffer }> {
  const d = await sharedDraft(await mySupplierId(user), draftId);
  return d.file_path ? { fileName: d.file_name, filePath: d.file_path } : { fileName: d.file_name, filePath: null, buffer: buildDocx(d.paras, d.layout) };
}
