import { del, get, issueSignedToken, put } from "@vercel/blob";
import { handleUploadPresigned } from "@vercel/blob/client";
import { HttpError } from "./_http.js";
import { gcsDelete, gcsOpen, gcsPut, gcsSignUpload } from "./_storage-gcs.js";

// I documenti stanno in un archivio PRIVATO: si leggono solo dal server, quindi passano sempre da /api/document
// (o dalle operazioni di download del portale), che controllano i permessi dell'utente.
// Due archivi possibili, scelti con STORAGE_PROVIDER:
//   vercel (predefinito)  Vercel Blob: BLOB_READ_WRITE_TOKEN oppure accesso OIDC (BLOB_STORE_ID, impostato da Vercel)
//   gcs                   Google Cloud Storage: bucket in GCS_BUCKET, credenziali dell'ambiente (vedi _storage-gcs.ts)
// Il resto dell'app usa solo le funzioni di questo file, mai direttamente un archivio.
export { handleUploadPresigned, issueSignedToken };

export const storageProvider = (): "vercel" | "gcs" => (process.env.STORAGE_PROVIDER?.trim().toLowerCase() === "gcs" ? "gcs" : "vercel");

export const FILE_PATH_RE = /^contracts\/[0-9a-f-]{36}\/[^/\\]{1,150}$/;
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const ALLOWED_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

export const MIME_BY_EXT: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

export async function openDocument(path: string) {
  if (storageProvider() === "gcs") return gcsOpen(path);
  const blob = await get(path, { access: "private" });
  return blob && blob.statusCode === 200 ? blob : null;
}

/** Elimina i file non più referenziati. Un errore qui non deve far fallire l'operazione principale. */
export async function deleteDocuments(paths: string[]) {
  if (!paths.length) return;
  try {
    if (storageProvider() === "gcs") await gcsDelete(paths);
    else await del(paths);
  } catch (err) {
    console.error("Eliminazione documenti non riuscita", err);
  }
}

/** Scrive un file dal server (usato solo dagli strumenti di prova). */
export async function putDocument(path: string, data: Buffer, contentType: string) {
  if (storageProvider() === "gcs") return gcsPut(path, data, contentType);
  await put(path, data, { access: "private", contentType, addRandomSuffix: false });
}

/**
 * Autorizza il browser a caricare UN file direttamente nell'archivio: il file non passa dal server.
 * Vercel: protocollo della libreria (token firmato). GCS: la richiesta { type: "gcs.sign", pathname, contentType, size }
 * riceve un URL firmato con le intestazioni da inviare. In entrambi i casi valgono gli stessi controlli: percorso, tipo e dimensione.
 * { type: "storage.kind" } restituisce solo quale archivio è attivo.
 */
export async function authorizeUpload(
  request: Request,
  body: unknown,
  rules: { checkPath: (pathname: string) => void; contentTypes: string[]; maxBytes: number },
) {
  if (!body || typeof body !== "object" || typeof (body as { type?: unknown }).type !== "string")
    throw new HttpError(400, "Richiesta di caricamento non valida");
  // Il browser chiede una volta quale archivio usare, a chi è già autorizzato a caricare.
  if ((body as { type: string }).type === "storage.kind") return { provider: storageProvider() };
  if (storageProvider() === "gcs") {
    const b = body as { type: string; pathname?: unknown; contentType?: unknown; size?: unknown };
    if (b.type !== "gcs.sign" || typeof b.pathname !== "string" || typeof b.contentType !== "string")
      throw new HttpError(400, "Richiesta di caricamento non valida");
    rules.checkPath(b.pathname);
    if (!rules.contentTypes.includes(b.contentType)) throw new HttpError(400, "Formato del file non ammesso");
    const size = Number(b.size);
    if (!Number.isInteger(size) || size < 1 || size > rules.maxBytes) throw new HttpError(400, "Dimensione del file non ammessa");
    return { provider: "gcs", pathname: b.pathname, ...(await gcsSignUpload(b.pathname, b.contentType, rules.maxBytes)) };
  }
  return handleUploadPresigned({
    request,
    body: body as Parameters<typeof handleUploadPresigned>[0]["body"],
    getSignedToken: async pathname => {
      rules.checkPath(pathname);
      return {
        token: await issueSignedToken({
          pathname,
          operations: ["put"],
          allowedContentTypes: rules.contentTypes,
          maximumSizeInBytes: rules.maxBytes,
        }),
      };
    },
  });
}
