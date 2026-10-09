import type { User } from "../src/types.ts";

/** Quali fornitori può vedere ciascun ruolo interno (l'id è un intero preso dal database: sicuro da inserire). */
export function visibleWhere(user: User): string {
  const id = Number(user.id);
  if (user.role === "manager") return "true";
  if (user.role === "buyer") return `(s.reference_buyer_id = ${id} or s.industry_code in (select industry_code from industry_buyers where user_id = ${id}))`;
  if (user.role === "finance") return "s.status in ('pending','pending_revision','approved','rejected','registered')";
  return "false";
}
