import { requireUser } from "./_auth.js";
import { ALLOWED_TYPES, authorizeUpload, FILE_PATH_RE, MAX_FILE_BYTES } from "./_blob.js";
import { errorResponse, HttpError, readJson } from "./_http.js";
import { canCreateContract } from "./_permissions.js";

// Rilascia al browser un permesso temporaneo (URL firmato) per caricare UN solo file, di un solo percorso,
// direttamente nell'archivio privato (Vercel Blob o Google Cloud Storage, vedi _blob.ts). Il file non passa da qui.
export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    if (!canCreateContract(user)) throw new HttpError(403, "Operazione non consentita");
    const result = await authorizeUpload(request, await readJson(request), {
      checkPath: pathname => {
        if (!FILE_PATH_RE.test(pathname)) throw new HttpError(400, "Percorso del documento non valido");
      },
      contentTypes: ALLOWED_TYPES,
      maxBytes: MAX_FILE_BYTES,
    });
    return Response.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
