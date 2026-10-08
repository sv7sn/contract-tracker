import { del, get } from "@vercel/blob";
import { handleUpload } from "@vercel/blob/client";

// I documenti stanno in un archivio Blob PRIVATO: si leggono solo con la chiave del server (BLOB_READ_WRITE_TOKEN),
// quindi passano sempre da /api/document, che controlla i permessi dell'utente.
export { handleUpload };

export const FILE_PATH_RE = /^contracts\/[0-9a-f-]{36}\/[^/\\]{1,150}$/;
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const ALLOWED_TYPES = ["application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"];

export const MIME_BY_EXT: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

export async function openDocument(path: string) {
  const blob = await get(path, { access: "private" });
  return blob && blob.statusCode === 200 ? blob : null;
}

/** Elimina i file non più referenziati. Un errore qui non deve far fallire l'operazione principale. */
export async function deleteDocuments(paths: string[]) {
  if (!paths.length) return;
  try { await del(paths); } catch (err) { console.error("Eliminazione documenti non riuscita", err); }
}
