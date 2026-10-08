import { requireUser } from "./_auth.js";
import { MIME_BY_EXT, openDocument } from "./_blob.js";
import { getContract } from "./_db.js";
import { errorResponse, HttpError } from "./_http.js";
import { canViewContract } from "./_permissions.js";

// Consegna il documento di un contratto solo a chi può vedere quel contratto.
export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const url = new URL(request.url);
    const id = Number(url.searchParams.get("id"));
    const contract = Number.isInteger(id) ? await getContract(id) : undefined;
    if (!contract || !canViewContract(user, contract) || !contract.filePath) throw new HttpError(404, "Documento non trovato");
    const blob = await openDocument(contract.filePath);
    if (!blob) throw new HttpError(404, "Documento non trovato");

    const ext = (contract.fileName ?? "").toLowerCase().split(".").pop() ?? "";
    const type = MIME_BY_EXT[ext] ?? "application/octet-stream";
    const inline = type === "application/pdf" && url.searchParams.get("download") !== "1";
    const safeName = (contract.fileName || `contratto-${contract.id}.${ext}`).replace(/[\r\n"\\/]/g, "_");
    return new Response(blob.stream, {
      headers: {
        "Content-Type": type,
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(safeName)}`,
        "Content-Length": String(blob.blob.size),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
