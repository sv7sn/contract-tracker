// Chi deve rivedere una bozza lo decidono regole configurate dal Manager (valore, dati personali, paese del fornitore),
// non la memoria del buyer. Le regole si sommano: una funzione è richiesta se almeno una sua regola è soddisfatta.
import type { FuncKey, ReviewRule, User } from "../src/types.ts";
import { getPool, type Queryable } from "./_db.js";
import { HttpError } from "./_http.js";
import { FUNCS } from "./_clm-rules.js";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const bad = (m: string): never => {
  throw new HttpError(400, m);
};
const map = (r: Row): ReviewRule => ({
  id: r.id,
  func: r.func,
  minValue: r.min_value === null ? null : Number(r.min_value),
  personalData: r.personal_data,
  countries: r.countries,
  label: r.label,
});

/** Regole di partenza: Legal sempre, Compliance sopra 50.000, IT Security quando il fornitore tratta dati personali. */
async function ensureRules(db: Queryable): Promise<void> {
  if ((await db.query("select 1 from review_rules limit 1")).rows.length) return;
  await db.query(`insert into review_rules (func, min_value, personal_data, countries, label) values
    ('legal', null, null, '{}', 'Legal rivede sempre'), ('compliance', 50000, null, '{}', 'Compliance sopra 50.000'), ('itsec', null, true, '{}', 'IT Security quando si trattano dati personali')`);
}

export async function listRules(user: User): Promise<ReviewRule[]> {
  if (user.role !== "manager") throw new HttpError(403, "Solo il Manager gestisce le regole");
  const db = getPool();
  await ensureRules(db);
  return (await db.query("select * from review_rules order by id")).rows.map(map);
}
export async function saveRule(user: User, input: Row): Promise<ReviewRule[]> {
  if (user.role !== "manager") throw new HttpError(403, "Solo il Manager gestisce le regole");
  const func = input?.func as FuncKey;
  if (!FUNCS.includes(func) || func === "requester") bad("Scegli Legal, Compliance o IT Security");
  const minValue = input?.minValue === null || input?.minValue === "" || input?.minValue === undefined ? null : Number(input.minValue);
  if (minValue !== null && (!Number.isFinite(minValue) || minValue < 0)) bad("Importo minimo non valido");
  const personalData = input?.personalData === true ? true : null;
  const countries = (Array.isArray(input?.countries) ? input.countries : String(input?.countries ?? "").split(/[\s,;]+/))
    .map((c: unknown) => String(c).trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 30);
  if (countries.some((c: string) => !/^[A-Z]{2}$/.test(c))) bad("I paesi vanno indicati con il codice a due lettere (es. BR, CN)");
  const label =
    String(input?.label ?? "")
      .trim()
      .slice(0, 120) || `${func}${minValue ? ` sopra ${minValue}` : ""}`;
  const db = getPool();
  await ensureRules(db);
  if (input?.id) {
    if (
      !(
        await db.query(
          "update review_rules set func = $2, min_value = $3, personal_data = $4, countries = $5, label = $6 where id = $1 returning id",
          [Number(input.id), func, minValue, personalData, countries, label],
        )
      ).rows.length
    )
      throw new HttpError(404, "Regola non trovata");
  } else
    await db.query("insert into review_rules (func, min_value, personal_data, countries, label) values ($1,$2,$3,$4,$5)", [
      func,
      minValue,
      personalData,
      countries,
      label,
    ]);
  await db.query("insert into config_audit (actor, area, action, subject, detail) values ($1,'review_rules','save',$2,$3)", [
    user.name,
    label,
    JSON.stringify({ func, minValue, personalData, countries }),
  ]);
  return listRules(user);
}
export async function deleteRule(user: User, id: number): Promise<ReviewRule[]> {
  if (user.role !== "manager") throw new HttpError(403, "Solo il Manager gestisce le regole");
  const r = (await getPool().query("delete from review_rules where id = $1 returning label", [id])).rows[0];
  if (!r) throw new HttpError(404, "Regola non trovata");
  await getPool().query("insert into config_audit (actor, area, action, subject, detail) values ($1,'review_rules','delete',$2,'')", [
    user.name,
    r.label,
  ]);
  return listRules(user);
}

/** Funzioni richieste per questa pratica, con il motivo della prima regola soddisfatta. */
export async function requiredFuncs(db: Queryable, taskId: number): Promise<{ func: FuncKey; reason: string }[]> {
  await ensureRules(db);
  const t = (
    await db.query(
      "select t.meta, t.chosen_supplier_id, s.data from tasks t left join suppliers s on s.id = t.chosen_supplier_id where t.id = $1",
      [taskId],
    )
  ).rows[0];
  if (!t) return [];
  const value = Number(t.meta?.value) || 0,
    country = String(t.data?.address?.country ?? "").toUpperCase();
  const src = (
    await db.query("select source from contract_drafts where task_id = $1 and source is not null order by version desc limit 1", [taskId])
  ).rows[0]?.source;
  const personal = src?.answers?.dataProtection === true;
  const out: { func: FuncKey; reason: string }[] = [];
  for (const r of (await db.query("select * from review_rules order by id")).rows.map(map)) {
    if (out.some(o => o.func === r.func)) continue;
    if (r.minValue !== null && value < r.minValue) continue;
    if (r.personalData === true && !personal) continue;
    if (r.countries.length && !r.countries.includes(country)) continue;
    out.push({ func: r.func, reason: r.label });
  }
  return out;
}
