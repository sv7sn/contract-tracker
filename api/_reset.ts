// Pulizia dei dati di prova: il Manager sceglie cosa svuotare prima di passare ai dati veri.
// Configurazione (società, codici merceologici, documenti richiesti, regole), utenti staff e liste sanzioni non si toccano mai.
import type { ResetArea, ResetPreview, User } from "../src/types.ts";
import { logChange } from "./_audit.js";
import { deleteDocuments } from "./_blob.js";
import { getPool, inTransaction, type Queryable } from "./_db.js";
import { HttpError } from "./_http.js";

const TEST_SUPPLIERS = "(name ilike 'Fornitore di Prova%' or sap_code like 'PROVA%' or sap_code like 'SIMV%')";
export const RESET_AREAS: ResetArea[] = ["tasks", "contracts", "suppliers_test", "suppliers_all", "sap", "budget", "categories"];

const n = async (db: Queryable, sql: string) => (await db.query(sql)).rows[0].n as number;

export async function resetPreview(user: User): Promise<ResetPreview> {
  if (user.role !== "manager") throw new HttpError(403, "Solo il Manager può svuotare i dati");
  const db = getPool();
  return {
    tasks: await n(db, "select count(*)::int n from tasks"),
    contracts: await n(db, "select count(*)::int n from contracts"),
    suppliers_test: await n(db, `select count(*)::int n from suppliers where ${TEST_SUPPLIERS}`),
    suppliers_all: await n(db, "select count(*)::int n from suppliers"),
    sap: await n(db, "select (select count(*) from po_lines) + (select count(distinct pr) from rda_lines) n").then(Number),
    budget: await n(db, "select count(*)::int n from mp_versions"),
    categories: await n(db, "select count(*)::int n from categories"),
  };
}

async function dropSuppliers(tx: Queryable, where: string, files: string[]): Promise<number> {
  const ids = (await tx.query(`select id, user_id from suppliers where ${where}`)).rows;
  if (!ids.length) return 0;
  const sid = ids.map(r => r.id as number);
  files.push(...(await tx.query("select file_path from supplier_documents where supplier_id = any($1)", [sid])).rows.map(r => r.file_path as string));
  files.push(...(await tx.query("select quote_file_path as p from rfq_invites where supplier_id = any($1) and quote_file_path <> ''", [sid])).rows.map(r => r.p as string));
  await tx.query("delete from suppliers where id = any($1)", [sid]);
  await tx.query("delete from users where id = any($1) and role = 'supplier'", [ids.map(r => r.user_id).filter(Boolean)]);
  return sid.length;
}

export async function resetData(user: User, areasIn: unknown, confirm: unknown): Promise<Partial<Record<ResetArea, number>>> {
  if (user.role !== "manager") throw new HttpError(403, "Solo il Manager può svuotare i dati");
  if (confirm !== "ELIMINA") throw new HttpError(400, "Scrivi ELIMINA per confermare");
  const areas = RESET_AREAS.filter(a => Array.isArray(areasIn) && areasIn.includes(a));
  if (!areas.length) throw new HttpError(400, "Scegli cosa svuotare");
  const files: string[] = [], done: Partial<Record<ResetArea, number>> = {};
  await inTransaction(async tx => {
    // Ordine: prima ciò che dipende da altro (task e contratti), poi fornitori e dati importati.
    if (areas.includes("tasks")) {
      files.push(...(await tx.query("select file_path as p from task_documents").then(r => r.rows.map(x => x.p as string))));
      files.push(...(await tx.query("select spec_path as p from rfqs where spec_path <> ''").then(r => r.rows.map(x => x.p as string))));
      files.push(...(await tx.query("select quote_file_path as p from rfq_invites where quote_file_path <> ''").then(r => r.rows.map(x => x.p as string))));
      done.tasks = (await tx.query("delete from tasks")).rowCount ?? 0;
    }
    if (areas.includes("contracts")) {
      const r = await tx.query("delete from contracts returning file_path");
      files.push(...r.rows.map(x => x.file_path as string).filter(Boolean)); done.contracts = r.rowCount ?? 0;
    }
    if (areas.includes("suppliers_all")) done.suppliers_all = await dropSuppliers(tx, "true", files);
    else if (areas.includes("suppliers_test")) done.suppliers_test = await dropSuppliers(tx, TEST_SUPPLIERS, files);
    if (areas.includes("sap")) {
      done.sap = (await tx.query("select (select count(*) from po_lines) + (select count(distinct pr) from rda_lines) n")).rows[0].n * 1;
      await tx.query("delete from po_lines"); await tx.query("delete from sap_pos"); await tx.query("delete from rda_lines"); await tx.query("delete from sap_imports");
    }
    if (areas.includes("budget")) done.budget = (await tx.query("delete from mp_versions")).rowCount ?? 0;
    if (areas.includes("categories")) done.categories = (await tx.query("delete from categories")).rowCount ?? 0;
    const entries = Object.entries(done) as [ResetArea, number][];
    await logChange(tx, user, "reset", "delete", "Pulizia dati", Object.fromEntries(entries.map(([k, v]) => [LABEL[k], v])), Object.fromEntries(entries.map(([k]) => [LABEL[k], 0])));
  });
  await deleteDocuments([...new Set(files.filter(Boolean))]);
  return done;
}

const LABEL: Record<ResetArea, string> = { tasks: "Task e pratiche", contracts: "Contratti", suppliers_test: "Fornitori di prova", suppliers_all: "Tutti i fornitori", sap: "Dati importati da SAP", budget: "Master Plan", categories: "Categorie" };
