// Categorie merceologiche unificate: lo stesso elenco per gruppi merci SAP (spesa) e categorie del Master Plan (budget).
import type { CategoriesView, CategorySource, User } from "../src/types.ts";
import { canSeeBudget } from "./_budget.js";
import { logChange } from "./_audit.js";
import { getPool, inTransaction } from "./_db.js";
import { HttpError } from "./_http.js";

const clean = (s: unknown, max = 80) => String(s ?? "").trim().slice(0, max);
const needManager = (u: User) => { if (u.role !== "manager") throw new HttpError(403, "Solo il Manager gestisce le categorie"); };

export async function listCategories(user: User): Promise<CategoriesView> {
  if (!canSeeBudget(user)) throw new HttpError(403, "Operazione non consentita");
  const db = getPool();
  const categories = (await db.query("select id, name from categories order by name")).rows.map(r => ({ id: r.id as number, name: r.name as string }));
  const maps = new Map((await db.query("select kind, key, category_id from category_map")).rows.map(r => [`${r.kind}|${r.key}`, r.category_id as number]));
  const sap = (await db.query(`select matl_group as key, max(matl_group_desc) as label, sum(value)::float as amount from po_lines where matl_group <> '' group by matl_group order by 3 desc`)).rows;
  // Categorie del Master Plan: dalla versione in uso di ogni anno.
  const mp = (await db.query(`select m.category as key, sum(m.amount)::float as amount from mp_lines m join mp_versions v on v.id = m.version_id
    where m.category <> '' and v.version = (select max(version) from mp_versions where year = v.year) group by m.category order by 2 desc`)).rows;
  const sources: CategorySource[] = [
    ...sap.map(r => ({ kind: "sap" as const, key: r.key as string, label: (r.label as string) || "", amount: Math.round(r.amount ?? 0), categoryId: maps.get(`sap|${r.key}`) ?? null })),
    ...mp.map(r => ({ kind: "mp" as const, key: r.key as string, label: "", amount: Math.round(r.amount ?? 0), categoryId: maps.get(`mp|${r.key}`) ?? null })),
  ];
  return { categories, sources };
}

export async function saveCategory(user: User, id: number | null, nameIn: string): Promise<CategoriesView> {
  needManager(user);
  const name = clean(nameIn);
  if (!name) throw new HttpError(400, "Indica il nome della categoria");
  await inTransaction(async tx => {
    if (id) {
      const old = (await tx.query("select name from categories where id = $1", [id])).rows[0]; if (!old) throw new HttpError(404, "Categoria non trovata");
      if ((await tx.query("select 1 from categories where lower(name) = lower($1) and id <> $2", [name, id])).rows.length) throw new HttpError(409, "Esiste già una categoria con questo nome");
      await tx.query("update categories set name = $1 where id = $2", [name, id]);
      await logChange(tx, user, "category", "update", name, { name: old.name }, { name });
    } else {
      if ((await tx.query("select 1 from categories where lower(name) = lower($1)", [name])).rows.length) throw new HttpError(409, "Esiste già una categoria con questo nome");
      await tx.query("insert into categories (name) values ($1)", [name]);
      await logChange(tx, user, "category", "create", name, null, { name });
    }
  });
  return listCategories(user);
}

export async function deleteCategory(user: User, id: number): Promise<CategoriesView> {
  needManager(user);
  const old = (await getPool().query("delete from categories where id = $1 returning name", [id])).rows[0];
  if (!old) throw new HttpError(404, "Categoria non trovata");
  await logChange(getPool(), user, "category", "delete", old.name, { name: old.name }, null);
  return listCategories(user);
}

export async function setCategoryMap(user: User, kind: string, key: string, categoryId: number | null): Promise<CategoriesView> {
  needManager(user);
  if (kind !== "sap" && kind !== "mp") throw new HttpError(400, "Origine non valida");
  const k = clean(key, 120); if (!k) throw new HttpError(400, "Voce non valida");
  const db = getPool();
  if (categoryId === null) await db.query("delete from category_map where kind = $1 and key = $2", [kind, k]);
  else {
    if (!(await db.query("select 1 from categories where id = $1", [categoryId])).rows.length) throw new HttpError(404, "Categoria non trovata");
    await db.query("insert into category_map (kind, key, category_id) values ($1,$2,$3) on conflict (kind, key) do update set category_id = excluded.category_id", [kind, k, categoryId]);
  }
  return listCategories(user);
}

/** Crea una categoria per ogni categoria del Master Plan non ancora classificata e le collega 1 a 1: punto di partenza dell'elenco. */
export async function seedCategoriesFromMp(user: User): Promise<CategoriesView> {
  needManager(user);
  const v = await listCategories(user);
  await inTransaction(async tx => {
    for (const s of v.sources.filter(x => x.kind === "mp" && x.categoryId === null)) {
      const name = s.key.charAt(0).toUpperCase() + s.key.slice(1).toLowerCase();
      const id = (await tx.query("insert into categories (name) values ($1) on conflict (name) do update set name = excluded.name returning id", [name])).rows[0].id;
      await tx.query("insert into category_map (kind, key, category_id) values ('mp',$1,$2) on conflict do nothing", [s.key, id]);
      await logChange(tx, user, "category", "create", name, null, { name });
    }
  });
  return listCategories(user);
}
