// Libreria di clausole: testo standard, alternativa accettabile (ripiego) e frasi non ammesse, con versioni e approvazione.
// L'analisi di una bozza confronta ogni paragrafo con la libreria: nessuna AI, solo confronto dei testi.
import type { ClauseVersionView, ClauseView, ClmFinding, User } from "../src/types.ts";
import { getPool, type Queryable } from "./_db.js";
import { HttpError } from "./_http.js";
import { CLAUSE_SEEDS, LANGS, SEED_GUIDANCE, type Lang } from "./_clm-templates.js";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const bad = (m: string): never => { throw new HttpError(400, m); };
export const canEditClauses = (u: User) => u.role === "legal" || u.role === "manager";
export const canReadClauses = (u: User) => ["manager", "buyer", "legal", "compliance", "itsec"].includes(u.role);
const iso = (v: unknown) => new Date(v as string).toISOString();

/** La prima volta crea le clausole di partenza, già approvate (testi d'esempio da validare). */
export async function ensureClauseSeeds(db: Queryable): Promise<void> {
  if ((await db.query("select 1 from clause_library limit 1")).rows.length) return;
  for (const c of CLAUSE_SEEDS) {
    const id = (await db.query("insert into clause_library (code, title, category, created_by) values ($1,$2,$3,'Sistema') on conflict (code) do nothing returning id", [c.code, c.title, c.category])).rows[0]?.id;
    if (id) await db.query("insert into clause_versions (clause_id, version, text, fallback, forbidden, guidance, status, created_by, approved_by, approved_at) values ($1,1,$2,$3,$4,$5,'approved','Sistema','Sistema',now())", [id, JSON.stringify(c.text), JSON.stringify(c.fallback), c.forbidden, SEED_GUIDANCE]);
  }
}

const mapVersion = (v: Row): ClauseVersionView => ({ id: v.id, version: v.version, text: v.text, fallback: v.fallback, forbidden: v.forbidden, guidance: v.guidance, status: v.status, createdBy: v.created_by, createdAt: iso(v.created_at), approvedBy: v.approved_by, approvedAt: v.approved_at ? iso(v.approved_at) : null, note: v.note });

export async function listClauses(user: User): Promise<ClauseView[]> {
  if (!canReadClauses(user)) throw new HttpError(403, "Operazione non consentita");
  const db = getPool();
  await ensureClauseSeeds(db);
  const clauses = (await db.query("select * from clause_library order by category, code")).rows;
  const versions = (await db.query("select * from clause_versions order by clause_id, version desc")).rows;
  return clauses.map(c => {
    const vs = versions.filter(v => v.clause_id === c.id).map(mapVersion);
    return { id: c.id, code: c.code, title: c.title, category: c.category, status: c.status, current: vs.find(v => v.status === "approved") ?? null, versions: vs };
  });
}

const cleanText = (v: unknown, name: string): Record<Lang, string> => {
  const o = (v ?? {}) as Record<string, unknown>;
  const out = {} as Record<Lang, string>;
  for (const l of LANGS) { out[l] = String(o[l] ?? "").trim().slice(0, 4000); }
  if (!out.it && !out.en) bad(`${name}: scrivi il testo in almeno una lingua`);
  return out;
};

/** Crea una clausola nuova o una nuova versione (da approvare). */
export async function saveClause(user: User, input: Row): Promise<ClauseView[]> {
  if (!canEditClauses(user)) throw new HttpError(403, "Solo Legal e Manager gestiscono la libreria");
  const db = getPool();
  await ensureClauseSeeds(db);
  const code = String(input?.code ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9-]{1,29}$/.test(code)) bad("Codice non valido (lettere maiuscole, numeri e trattini)");
  const text = cleanText(input?.text, "Testo standard"), fallback = cleanText(input?.fallback ?? input?.text, "Ripiego");
  const forbidden = (Array.isArray(input?.forbidden) ? input.forbidden : String(input?.forbidden ?? "").split("\n")).map((x: unknown) => String(x).trim().toLowerCase()).filter(Boolean).slice(0, 30);
  const guidance = String(input?.guidance ?? "").trim().slice(0, 1000);
  let c = (await db.query("select * from clause_library where code = $1", [code])).rows[0];
  if (!c) {
    const title = String(input?.title ?? "").trim().slice(0, 120);
    if (title.length < 3) bad("Dai un titolo alla clausola");
    c = (await db.query("insert into clause_library (code, title, category, created_by) values ($1,$2,$3,$4) returning *", [code, title, String(input?.category ?? "Generale").trim().slice(0, 40) || "Generale", user.name])).rows[0];
  } else if (input?.title) await db.query("update clause_library set title = $2, category = coalesce(nullif($3,''), category) where id = $1", [c.id, String(input.title).trim().slice(0, 120), String(input?.category ?? "").trim().slice(0, 40)]);
  const next = ((await db.query("select max(version) as v from clause_versions where clause_id = $1", [c.id])).rows[0].v ?? 0) + 1;
  await db.query("insert into clause_versions (clause_id, version, text, fallback, forbidden, guidance, status, created_by, created_by_id) values ($1,$2,$3,$4,$5,$6,'proposed',$7,$8)", [c.id, next, JSON.stringify(text), JSON.stringify(fallback), forbidden, guidance, user.name, user.id]);
  return listClauses(user);
}

export async function decideClauseVersion(user: User, versionId: number, approve: boolean, note: string): Promise<ClauseView[]> {
  if (!canEditClauses(user)) throw new HttpError(403, "Solo Legal e Manager approvano le clausole");
  const db = getPool();
  const v = (await db.query("select * from clause_versions where id = $1", [versionId])).rows[0];
  if (!v) throw new HttpError(404, "Versione non trovata");
  if (v.status !== "proposed") bad("Questa versione è già stata decisa");
  // Quattro occhi: chi propone non approva, a meno che sia l'unico che potrebbe farlo (altrimenti la libreria resterebbe ferma).
  if (v.created_by_id === user.id && (await db.query("select 1 from users where active and role in ('legal','manager') and id <> $1 limit 1", [user.id])).rows.length)
    throw new HttpError(403, "Hai proposto tu questa versione: la deve approvare un'altra persona (Legal o Manager)");
  await db.query("update clause_versions set status = $2, approved_by = $3, approved_at = now(), note = $4 where id = $1", [versionId, approve ? "approved" : "rejected", user.name, String(note ?? "").trim().slice(0, 500)]);
  return listClauses(user);
}

export interface LiveClause { code: string; title: string; version: number; text: Record<Lang, string>; fallback: Record<Lang, string>; forbidden: string[] }
export async function liveClauses(db: Queryable): Promise<LiveClause[]> {
  await ensureClauseSeeds(db);
  const rows = (await db.query(`select c.code, c.title, v.version, v.text, v.fallback, v.forbidden from clause_library c join lateral
    (select * from clause_versions where clause_id = c.id and status = 'approved' order by version desc limit 1) v on true where c.status = 'active'`)).rows;
  return rows.map(r => ({ code: r.code, title: r.title, version: r.version, text: r.text, fallback: r.fallback, forbidden: r.forbidden }));
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const toks = (s: string) => new Set(norm(s).split(" ").filter(Boolean));
const dice = (a: string, b: string) => { const x = toks(a), y = toks(b); if (!x.size || !y.size) return 0; let k = 0; for (const w of x) if (y.has(w)) k++; return (2 * k) / (x.size + y.size); };

/** Confronta i paragrafi con la libreria: conforme (standard o ripiego), si discosta, oppure contiene una frase non ammessa. */
export function analyzeParas(paras: string[], clauses: LiveClause[]): ClmFinding[] {
  const out: ClmFinding[] = [];
  paras.forEach((p, para) => {
    if (norm(p).length < 40) return;
    const low = norm(p);
    let hit: ClmFinding | null = null;
    for (const c of clauses) for (const f of c.forbidden) if (f && low.includes(norm(f))) hit = { para, code: c.code, title: c.title, level: "forbidden", similarity: 1, phrase: f };
    if (hit) { out.push(hit); return; }
    let best: ClmFinding | null = null;
    for (const c of clauses) for (const l of LANGS) for (const variant of ["standard", "fallback"] as const) {
      const ref = variant === "standard" ? c.text[l] : c.fallback[l];
      if (!ref) continue;
      const exact = norm(ref) === low, s = exact ? 1 : dice(p, ref);
      if (s < 0.45) continue;
      const level: ClmFinding["level"] = exact ? variant : "deviates";
      if (!best || s > best.similarity || (exact && level === "standard" && best.level !== "standard")) best = { para, code: c.code, title: c.title, level, similarity: Math.round(s * 100) / 100 };
    }
    if (best) out.push(best);
  });
  return out;
}
