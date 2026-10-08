import { requireUser } from "./_auth.js";
import { ALLOWED_TYPES, FILE_PATH_RE, handleUploadPresigned, issueSignedToken, MAX_FILE_BYTES } from "./_blob.js";
import { errorResponse, HttpError, readJson } from "./_http.js";
import { canCreateContract } from "./_permissions.js";

// Rilascia al browser un permesso temporaneo (URL firmato) per caricare UN solo file, di un solo percorso,
// direttamente nell'archivio privato. Il file non passa da qui, quindi non vale il limite di 4,5 MB delle funzioni Vercel.
export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    if (!canCreateContract(user)) throw new HttpError(403, "Operazione non consentita");
    const body = (await readJson(request)) as Parameters<typeof handleUploadPresigned>[0]["body"];
    const result = await handleUploadPresigned({
      request, body,
      getSignedToken: async pathname => {
        if (!FILE_PATH_RE.test(pathname)) throw new HttpError(400, "Percorso del documento non valido");
        return { token: await issueSignedToken({ pathname, operations: ["put"], allowedContentTypes: ALLOWED_TYPES, maximumSizeInBytes: MAX_FILE_BYTES }) };
      },
    });
    return Response.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
