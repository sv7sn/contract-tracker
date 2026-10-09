import { requireRole, requireUser } from "./_auth.js";
import { deleteDocuments, handleUploadPresigned, issueSignedToken, openDocument } from "./_blob.js";
import { createSessionToken, sessionCookie } from "./_crypto.js";
import { checkStoredDocument } from "./_docai.js";
import { monitorData, remindSupplier, runReminders } from "./_docs.js";
import { ensureSchema, getPool } from "./_db.js";
import { runExternalChecks } from "./_governance.js";
import { createManualTask, deleteManualTask, getTask, importSapFile, listTasks, taskSummary, updateTask } from "./_tasks.js";
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
      return json(await runReminders(originOf(request)));
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
    if (op.startsWith("task") || op === "rda-import") {
      if (user.role !== "manager" && user.role !== "buyer") throw new HttpError(403, "Operazione non consentita");
      if (op === "tasks" && method === "GET") return json(await listTasks(user));
      if (op === "task-summary" && method === "GET") return json(await taskSummary(user));
      if (op === "task" && method === "GET") return json({ task: await getTask(user, idOf(url)) });
      if (op === "task-create" && method === "POST") return json({ task: await createManualTask(user, (await readJson(request)) as Record<string, unknown>) }, { status: 201 });
      if (op === "task-update" && method === "POST") return json({ task: await updateTask(user, idOf(url), (await readJson(request)) as Record<string, unknown>) });
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
    if (op === "vendors" && method === "GET") return json({ vendors: await listVendors(user) });
    if (op === "vendor-checks" && method === "POST") {
      const id = idOf(url); await getVendor(user, id);
      await runExternalChecks(getPool(), id);
      return json({ supplier: await getVendor(user, id) });
    }
    if (op === "vendor" && method === "GET") return json({ supplier: await getVendor(user, idOf(url)) });
    if (op === "config" && method === "GET") return json({ config: await loadConfig() });
    if (op === "config-save" && method === "POST") {
      if (!canConfigurePortal(user)) throw new HttpError(403, "Operazione non consentita");
      const body = (await readJson(request)) as { entity?: unknown; action?: unknown; item?: unknown };
      await saveConfig(String(body.entity ?? ""), String(body.action ?? ""), (body.item ?? {}) as Record<string, unknown>);
      return json({ config: await loadConfig() });
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
