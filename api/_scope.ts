// Perimetro di spesa e budget di un buyer: le categorie che segue (e quelle dei colleghi che sostituisce). Senza categorie assegnate vede tutto.
import type { User } from "../src/types.ts";
import { getPool } from "./_db.js";

/** Nomi delle categorie visibili al buyer, oppure null se non ha restrizioni (Manager, Finance, Controlling o buyer senza categorie). */
export async function categoryScope(user: User): Promise<Set<string> | null> {
  if (user.role !== "buyer") return null;
  const ids = user.acting?.ids ?? [user.id];
  const rows = (await getPool().query("select distinct c.name from category_buyers b join categories c on c.id = b.category_id where b.user_id = any($1)", [ids])).rows;
  return rows.length ? new Set(rows.map(r => r.name as string)) : null;
}
