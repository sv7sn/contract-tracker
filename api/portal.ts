import { requireRole, requireUser } from "./_auth.js";
import { deleteDocuments, handleUploadPresigned, issueSignedToken, openDocument } from "./_blob.js";
import { createSessionToken, sessionCookie } from "./_crypto.js";
import { checkStoredDocument } from "./_docai.js";
import { monitorData, remindSupplier, runReminders } from "./_docs.js";
import { ensureSchema, getPool } from "./_db.js";
import { runExternalChecks } from "./_governance.js";
import { listConfigAudit, logConfigChange } from "./_audit.js";
import { anonymizeSupplier, exportSupplier, runRetention } from "./_privacy.js";
import { computeKpis } from "./_kpi.js";
import { spendLines, spendView } from "./_spend.js";
import { myWork } from "./_work.js";
import { addRating, deleteRating, ratingSummary, supplierScorecard } from "./_rating.js";
import { closeRfq, createRfq, listMyRfqs, listTaskRfqs, submitQuote, applyRfq } from "./_rfq.js";
import { deleteCategory, listCategories, saveCategory, seedCategoriesFromMp, setCategoryMap } from "./_categories.js";
import { createDemoSupplier } from "./_demo.js";
import { deleteBudgetDemo, demoPoFile, demoPrFile, loadBudgetDemo } from "./_budget-demo.js";
import { BUDGET_TEMPLATE, budgetIo, budgetView, deleteBudgetVersion, importBudget } from "./_budget.js";
import { refreshIfStale, refreshSanctionLists } from "./_sanctions.js";
import { addTaskDocument, createManualTask, registerPurchaseContract, decideSourcingException, deleteManualTask, deleteTaskDocument, getTask, importSapFile, listTasks, saveSourcing, setRenewalOutcome, setTaskLinks, taskDocumentPath, taskSummary, updateTask } from "./_tasks.js";
import { errorResponse, HttpError, readJson } from "./_http.js";
import { canConfigurePortal, canInviteSuppliers } from "./_permissions.js";
import {
  documentOwner, activateInvite, addMyDocument, deleteInvite, deleteMyDocument, documentForDownload, getMySupplier, getVendor, inviteInfo,
  inviteSupplier, listVendors, loadConfig, reinviteSupplier, saveConfig, saveMyData, submitMyRegistration, vendorAction,
} from "./_portal.js";
import { DOC_EXTENSIONS, DOC_MIME, MAX_DOC_BYTES, SUPPLIER_FILE_PATH_RE } from "./_supplier-rules.js";
import type { VendorAction } from "../src/types.ts";

// Router unico del portale fornitori (un solo file = una sola funzione Vercel). Si sceglie l'operazione con ?op=...
const VENDOR_ACTIONS: VendorAction[] = ["approve", "reject", "request_revision", "set_payment_terms", "change_status", "block", "deactivate", "exclude", "reactivate", "sanctions_manual"];
const STAFF = ["manager", "buyer", "finance"] as const;

function originOf(request: Request) {
  const fixed = process.env.APP_URL?.trim().replace(/\/+$/, "");
  return fixed || new URL(request.url).origin;
}
const noStore = { "Cache-Control": "no-store" };
const json = (data: unknown, init?: ResponseInit) => Response.json(data, { ...init, headers: { ...noStore, ...(init?.headers ?? {}) } });
const download = (data: unknown, name: string) => new Response(JSON.stringify(data, null, 2), { headers: { ...noStore, "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"` } });
const idOf = (url: URL) => {
  const id = Number(url.searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, "Identificativo non valido");
  return id;
};

async function handle(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const op = url.searchParams.get("op") ?? "";
    const method = request.method;
    await ensureSchema();

    // ── Pubbliche (invito) ──
    if (op === "invite-info" && method === "GET") return json(await inviteInfo(url.searchParams.get("token") ?? ""));
    if (op === "activate" && method === "POST") {
      const body = (await readJson(request)) as { token?: unknown; password?: unknown };
      const user = await activateInvite(typeof body.token === "string" ? body.token : "", typeof body.password === "string" ? body.password : "");
      return json({ user }, { headers: { "Set-Cookie": sessionCookie(request, createSessionToken(user.id)) } });
    }

    // ── Cron giornaliero dei reminder (Vercel Cron invia "Authorization: Bearer <CRON_SECRET>") ──
    if (op === "cron-reminders" && (method === "GET" || method === "POST")) {
      const secret = process.env.CRON_SECRET;
      if (!secret) throw new HttpError(503, "CRON_SECRET non configurato");
      if (request.headers.get("authorization") !== `Bearer ${secret}`) throw new HttpError(401, "Non autorizzato");
      const reminders = await runReminders(originOf(request));
      const { staleFiles, ...retention } = await runRetention();
      await deleteDocuments(staleFiles);
      // Liste sanzioni: un errore di download non deve bloccare reminder e pulizia.
      const sanctions = await refreshIfStale().catch(err => ({ error: err instanceof Error ? err.message : "errore" }));
      return json({ ...reminders, retention, sanctions });
    }

    // ── Ingresso automatico dei file SAP (es. da una regola sulla casella che riceve le mail di SAP) ──
    if (op === "rda-ingest" && method === "POST") {
      const secret = process.env.RDA_INGEST_SECRET;
      if (!secret) throw new HttpError(503, "RDA_INGEST_SECRET non configurato");
      if (request.headers.get("authorization") !== `Bearer ${secret}`) throw new HttpError(401, "Non autorizzato");
      const name = decodeURIComponent(request.headers.get("x-file-name") ?? "") || "allegato.xls";
      return json(await importSapFile("Automatico", name, new Uint8Array(await request.arrayBuffer()), url.searchParams.get("force") === "1"));
    }

    // ── Area del fornitore ──
    if (op.startsWith("supplier-")) {
      const user = await requireRole(request, ["supplier"]);
      const origin = originOf(request);
      if (op === "supplier-me" && method === "GET") return json({ supplier: await getMySupplier(user) });
      if (op === "supplier-export" && method === "GET") return download(await exportSupplier(getPool(), (await getMySupplier(user)).id), "i-miei-dati.json");
      if (op === "supplier-rfqs" && method === "GET") return json({ rfqs: await listMyRfqs(user) });
      if (op === "supplier-rfq-quote" && method === "POST") return json({ rfqs: await submitQuote(user, idOf(url), (await readJson(request)) as Record<string, unknown>, origin) });
      if (op === "supplier-save" && method === "POST") return json({ supplier: await saveMyData(user, await readJson(request), origin) });
      if (op === "supplier-submit" && method === "POST") return json({ supplier: await submitMyRegistration(user, origin) });
      if (op === "supplier-upload-token" && method === "POST") {
        const body = (await readJson(request)) as Parameters<typeof handleUploadPresigned>[0]["body"];
        const result = await handleUploadPresigned({
          request, body,
          getSignedToken: async pathname => {
            const m = SUPPLIER_FILE_PATH_RE.exec(pathname);
            const ext = pathname.toLowerCase().split(".").pop() ?? "";
            if (!m || !DOC_EXTENSIONS.includes(ext)) throw new HttpError(400, "Percorso del documento non valido");
            return { token: await issueSignedToken({ pathname, operations: ["put"], allowedContentTypes: Object.values(DOC_MIME), maximumSizeInBytes: MAX_DOC_BYTES }) };
          },
        });
        return json(result);
      }
      if (op === "supplier-doc-add" && method === "POST") {
        const { supplier, staleFiles, docId } = await addMyDocument(user, await readJson(request), origin);
        await deleteDocuments(staleFiles);
        return json({ supplier, docId });
      }
      if (op === "supplier-doc-check" && method === "POST") {
        // Controllo automatico in una richiesta a parte: così il caricamento è immediato e l'analisi non rischia i tempi massimi.
        const id = idOf(url);
        if (!(await getMySupplier(user)).documents.some(d => d.id === id)) throw new HttpError(404, "Documento non trovato");
        await checkStoredDocument(id);
        return json({ supplier: await getMySupplier(user) });
      }
      if (op === "supplier-doc" && method === "DELETE") {
        const { supplier, staleFiles } = await deleteMyDocument(user, idOf(url), origin);
        await deleteDocuments(staleFiles);
        return json({ supplier });
      }
    }

    // ── Download documenti (fornitore proprietario o staff autorizzato) ──
    if (op === "doc-download" && method === "GET") {
      const user = await requireUser(request);
      const doc = await documentForDownload(user, idOf(url));
      const blob = await openDocument(doc.filePath);
      if (!blob) throw new HttpError(404, "Documento non trovato");
      const ext = doc.fileName.toLowerCase().split(".").pop() ?? "";
      const type = DOC_MIME[ext] ?? "application/octet-stream";
      const inline = (type === "application/pdf" || type.startsWith("image/")) && url.searchParams.get("download") !== "1";
      const safeName = doc.fileName.replace(/[\r\n"\\/]/g, "_");
      return new Response(blob.stream, {
        headers: {
          "Content-Type": type,
          "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(safeName)}`,
          "Content-Length": String(blob.blob.size),
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "private, no-store",
        },
      });
    }

    // ── Staff ──
    const user = await requireRole(request, [...STAFF]);
    const origin = originOf(request);
    // ── Task (Manager e Buyer) ──
    if (op.startsWith("task") || op.startsWith("rfq") || op === "rda-import") {
      if (user.role !== "manager" && user.role !== "buyer") throw new HttpError(403, "Operazione non consentita");
      if (op === "tasks" && method === "GET") return json(await listTasks(user));
      if (op === "task-summary" && method === "GET") return json(await taskSummary(user));
      if (op === "task" && method === "GET") return json({ task: await getTask(user, idOf(url)) });
      if (op === "task-create" && method === "POST") return json({ task: await createManualTask(user, (await readJson(request)) as Record<string, unknown>) }, { status: 201 });
      if (op === "task-update" && method === "POST") return json({ task: await updateTask(user, idOf(url), (await readJson(request)) as Record<string, unknown>) });
      if (op === "task-sourcing" && method === "POST") return json({ task: await saveSourcing(user, idOf(url), (await readJson(request)) as Record<string, unknown>) });
      if (op === "task-sourcing-approve" && method === "POST") return json({ task: await decideSourcingException(user, idOf(url), (await readJson(request)) as Record<string, unknown>) });
      if (op === "rfqs" && method === "GET") return json({ rfqs: await listTaskRfqs(user, Number(url.searchParams.get("taskId"))) });
      if (op === "rfq-create" && method === "POST") return json({ rfqs: await createRfq(user, (await readJson(request)) as Record<string, unknown>, originOf(request)) }, { status: 201 });
      if (op === "rfq-close" && method === "POST") return json({ rfqs: await closeRfq(user, idOf(url)) });
      if (op === "rfq-use" && method === "POST") return json({ task: await applyRfq(user, idOf(url), (await readJson(request)) as Record<string, unknown>) });
      if (op === "task-outcome" && method === "POST") return json({ task: await setRenewalOutcome(user, idOf(url), (await readJson(request)) as Record<string, unknown>) });
      if (op === "task-contract" && method === "POST") return json({ task: await registerPurchaseContract(user, idOf(url), (await readJson(request)) as Record<string, unknown>) });
      if (op === "task-links" && method === "POST") return json({ task: await setTaskLinks(user, idOf(url), (await readJson(request)) as Record<string, unknown>) });
      if (op === "task-doc" && method === "POST") return json({ task: await addTaskDocument(user, idOf(url), (await readJson(request)) as Record<string, unknown>) });
      if (op === "task-doc" && method === "DELETE") {
        const { task, staleFile } = await deleteTaskDocument(user, idOf(url), Number(url.searchParams.get("doc")));
        if (staleFile) await deleteDocuments([staleFile]);
        return json({ task });
      }
      if (op === "task-doc-download" && method === "GET") {
        const doc = await taskDocumentPath(user, idOf(url));
        const blob = await openDocument(doc.filePath);
        if (!blob) throw new HttpError(404, "Documento non trovato");
        const ext = doc.fileName.toLowerCase().split(".").pop() ?? "";
        const type = ext === "pdf" ? "application/pdf" : "application/octet-stream";
        return new Response(blob.stream, { headers: { "Content-Type": type, "Content-Disposition": `${type === "application/pdf" ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(doc.fileName.replace(/[\r\n"\\/]/g, "_"))}`, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store" } });
      }
      if (op === "task" && method === "DELETE") { await deleteManualTask(user, idOf(url)); return json({ ok: true }); }
      if (op === "rda-import" && method === "POST") {
        const name = decodeURIComponent(request.headers.get("x-file-name") ?? "") || "file.xls";
        return json(await importSapFile(user.name, name, new Uint8Array(await request.arrayBuffer()), url.searchParams.get("force") === "1"));
      }
    }
    if (op === "doc-monitor" && method === "GET") return json(await monitorData(user));
    if (op === "doc-remind" && method === "POST") {
      const body = (await readJson(request)) as { supplierId?: unknown; channel?: unknown; note?: unknown };
      return json(await remindSupplier(user, Number(body.supplierId), body.channel === "phone" ? "phone" : "email", typeof body.note === "string" ? body.note : "", origin));
    }
    if (op === "reminders-run" && method === "POST") {
      if (!canConfigurePortal(user)) throw new HttpError(403, "Operazione non consentita");
      return json(await runReminders(origin));
    }
    if (op === "doc-check" && method === "POST") {
      if (user.role !== "manager" && user.role !== "buyer") throw new HttpError(403, "Operazione non consentita");
      const id = idOf(url);
      const owner = await documentOwner(id);
      await getVendor(user, owner);
      await checkStoredDocument(id, true);
      return json({ supplier: await getVendor(user, owner) });
    }
    if (op === "kpis" && method === "GET") return json(await computeKpis(user));
    // ── Categorie unificate ──
    if (op === "categories" && method === "GET") return json(await listCategories(user));
    if (op === "category-save" && method === "POST") { const b = (await readJson(request)) as { id?: unknown; name?: string }; return json(await saveCategory(user, b.id ? Number(b.id) : null, String(b.name ?? ""))); }
    if (op === "category" && method === "DELETE") return json(await deleteCategory(user, Number(url.searchParams.get("id"))));
    if (op === "category-map" && method === "POST") { const b = (await readJson(request)) as { kind?: string; key?: string; categoryId?: unknown }; return json(await setCategoryMap(user, String(b.kind ?? ""), String(b.key ?? ""), b.categoryId ? Number(b.categoryId) : null)); }
    if (op === "category-seed" && method === "POST") return json(await seedCategoriesFromMp(user));
    if (op === "my-work" && method === "GET") return json({ items: await myWork(user) });
    // ── Spesa dai file ordini SAP ──
    if (op === "spend" && method === "GET") return json(await spendView(user, Number(url.searchParams.get("year")) || undefined));
    if (op === "spend-lines" && method === "GET") return json(await spendLines(user, Number(url.searchParams.get("year")), url.searchParams.get("supplier") ?? ""));
    // ── Master Plan (budget per internal order) ──
    if (op === "budget" && method === "GET") return json(await budgetView(user, Number(url.searchParams.get("year")) || undefined));
    if (op === "budget-io" && method === "GET") return json(await budgetIo(user, url.searchParams.get("io") ?? "", Number(url.searchParams.get("year")) || undefined));
    if (op === "budget-import" && method === "POST") {
      const name = decodeURIComponent(request.headers.get("x-file-name") ?? "") || "master-plan.xlsx";
      return json(await importBudget(user, Number(url.searchParams.get("year")), url.searchParams.get("label") ?? "", name, new Uint8Array(await request.arrayBuffer())), { status: 201 });
    }
    if (op === "budget-version" && method === "DELETE") { await deleteBudgetVersion(user, idOf(url)); return json({ ok: true }); }
    if (op === "budget-demo" && method === "POST") return json(await loadBudgetDemo(user), { status: 201 });
    if (op === "budget-demo" && method === "DELETE") return json(await deleteBudgetDemo(user));
    if (op === "budget-demo-file" && method === "GET") {
      const po = url.searchParams.get("kind") === "po";
      return new Response(Buffer.from(po ? demoPoFile() : demoPrFile()), { headers: { ...noStore, "Content-Type": "application/vnd.ms-excel", "Content-Disposition": `attachment; filename="${po ? "PO_LAST_7D_PROVA.XLS" : "OPEN_PR_PROVA.XLS"}"` } });
    }
    if (op === "budget-template" && method === "GET") return new Response(BUDGET_TEMPLATE, { headers: { ...noStore, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="modello-master-plan.csv"' } });
    if (op === "vendor-demo" && method === "POST") return json(await createDemoSupplier(user), { status: 201 });
    if (op === "vendors" && method === "GET") return json({ vendors: await listVendors(user) });
    if (op === "vendor-checks" && method === "POST") {
      const id = idOf(url); await getVendor(user, id);
      await runExternalChecks(getPool(), id);
      return json({ supplier: await getVendor(user, id) });
    }
    if (op === "vendor-rating" && method === "GET") return json({ scorecard: await supplierScorecard(user, idOf(url)) });
    if (op === "vendor-rating-add" && method === "POST") return json({ scorecard: await addRating(user, idOf(url), (await readJson(request)) as Record<string, unknown>) }, { status: 201 });
    if (op === "vendor-rating" && method === "DELETE") return json({ scorecard: await deleteRating(user, idOf(url)) });
    if (op === "vendor-ratings" && method === "GET") return json({ ratings: await ratingSummary(user) });
    if (op === "vendor" && method === "GET") return json({ supplier: await getVendor(user, idOf(url)) });
    if (op === "config" && method === "GET") return json({ config: await loadConfig() });
    if (op === "config-save" && method === "POST") {
      if (!canConfigurePortal(user)) throw new HttpError(403, "Operazione non consentita");
      const body = (await readJson(request)) as { entity?: unknown; action?: unknown; item?: unknown };
      const entity = String(body.entity ?? ""), action = String(body.action ?? ""), item = (body.item ?? {}) as Record<string, unknown>;
      const before = await loadConfig();
      await saveConfig(entity, action, item);
      const after = await loadConfig();
      // Ogni modifica alle regole resta tracciata: chi, quando, valori prima e dopo.
      await logConfigChange(user, entity, action, item, before, after);
      return json({ config: after });
    }
    if (op === "sanctions-refresh" && method === "POST") {
      if (!canConfigurePortal(user)) throw new HttpError(403, "Operazione non consentita");
      const res = await refreshSanctionLists();
      return json({ ...res, config: await loadConfig() });
    }
    if (op === "config-audit" && method === "GET") {
      if (!canConfigurePortal(user)) throw new HttpError(403, "Operazione non consentita");
      return json({ entries: await listConfigAudit() });
    }
    if (op === "vendor-export" && method === "GET") {
      if (user.role !== "manager") throw new HttpError(403, "Solo il Manager esporta i dati di un fornitore");
      const id = idOf(url); await getVendor(user, id);
      return download(await exportSupplier(getPool(), id), `fornitore-${id}.json`);
    }
    if (op === "vendor-anonymize" && method === "POST") {
      const id = idOf(url); await getVendor(user, id);
      const body = (await readJson(request)) as { reason?: unknown };
      await deleteDocuments(await anonymizeSupplier(user, id, typeof body.reason === "string" ? body.reason : ""));
      return json({ supplier: await getVendor(user, id) });
    }
    if (op === "vendor-invite" && method === "POST") {
      if (!canInviteSuppliers(user)) throw new HttpError(403, "Operazione non consentita");
      return json(await inviteSupplier(user, await readJson(request), origin), { status: 201 });
    }
    if (op === "vendor-reinvite" && method === "POST") {
      if (!canInviteSuppliers(user)) throw new HttpError(403, "Operazione non consentita");
      return json(await reinviteSupplier(user, idOf(url), origin));
    }
    if (op === "vendor-invite" && method === "DELETE") {
      if (!canInviteSuppliers(user)) throw new HttpError(403, "Operazione non consentita");
      await deleteInvite(user, idOf(url));
      return json({ ok: true });
    }
    if (op === "vendor-action" && method === "POST") {
      const body = (await readJson(request)) as { action?: unknown } & Record<string, unknown>;
      const action = body.action as VendorAction;
      if (!VENDOR_ACTIONS.includes(action)) throw new HttpError(400, "Azione non valida");
      return json({ supplier: await vendorAction(user, idOf(url), action, body, origin) });
    }
    throw new HttpError(404, "Operazione non trovata");
  } catch (err) {
    return errorResponse(err);
  }
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
