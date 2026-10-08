import { requireUser } from "./_auth.js";
import { ALLOWED_TYPES, FILE_PATH_RE, handleUpload, MAX_FILE_BYTES } from "./_blob.js";
import { errorResponse, HttpError, readJson } from "./_http.js";
import { canCreateContract } from "./_permissions.js";

// Rilascia al browser un permesso temporaneo per caricare UN file direttamente nell'archivio privato.
// Il file non passa da qui, quindi non vale il limite di 4,5 MB delle funzioni Vercel.
export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    if (!canCreateContract(user)) throw new HttpError(403, "Operazione non consentita");
    const body = (await readJson(request)) as Parameters<typeof handleUpload>[0]["body"];
    const result = await handleUpload({
      request, body,
      onBeforeGenerateToken: async pathname => {
        if (!FILE_PATH_RE.test(pathname)) throw new HttpError(400, "Percorso del documento non valido");
        return { allowedContentTypes: ALLOWED_TYPES, maximumSizeInBytes: MAX_FILE_BYTES, addRandomSuffix: false, allowOverwrite: false };
      },
    });
    return Response.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
