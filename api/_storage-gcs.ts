// Archivio documenti su Google Cloud Storage: si usa con STORAGE_PROVIDER=gcs e il nome del bucket in GCS_BUCKET.
// Credenziali: quelle dell'ambiente (su GKE l'identità di servizio dell'app, Workload Identity), quindi nessuna chiave
// nel codice o nelle variabili. Il bucket è privato: i file si leggono solo da qui, dopo il controllo dei permessi.
// I caricamenti dal browser usano URL firmati V4, validi pochi minuti, per un solo percorso, un tipo di file e una dimensione massima.
import { Readable } from "node:stream";
import { HttpError } from "./_http.js";

interface GcsFile {
  createReadStream(): Readable;
  getMetadata(): Promise<[{ size?: string | number }]>;
  delete(options?: { ignoreNotFound?: boolean }): Promise<unknown>;
  save(data: Buffer, options: { contentType: string; resumable: boolean }): Promise<void>;
  getSignedUrl(options: {
    version: "v4";
    action: "write";
    expires: number;
    contentType: string;
    extensionHeaders: Record<string, string>;
  }): Promise<[string]>;
}
interface GcsBucket {
  file(name: string): GcsFile;
}

/** Minuti di validità di un URL di caricamento. */
export const SIGNED_URL_MINUTES = 10;

// Il nome del modulo sta in una variabile: la libreria Google si carica solo quando l'archivio è GCS,
// e non entra nelle funzioni pubblicate su Vercel, che usano Vercel Blob.
const MODULE = "@google-cloud/storage";
let bucketPromise: Promise<GcsBucket> | undefined;
function bucket(): Promise<GcsBucket> {
  const name = process.env.GCS_BUCKET?.trim();
  if (!name) throw new HttpError(503, "Archivio documenti non configurato (manca GCS_BUCKET)");
  bucketPromise ??= import(MODULE).then((m: { Storage: new () => { bucket(n: string): GcsBucket } }) => new m.Storage().bucket(name));
  return bucketPromise;
}
const isNotFound = (err: unknown) => (err as { code?: number } | null)?.code === 404;

/** Apre un file per leggerlo; null se non esiste. Stessa forma della lettura da Vercel Blob: contenuto e dimensione. */
export async function gcsOpen(path: string): Promise<{ stream: ReadableStream<Uint8Array>; blob: { size: number } } | null> {
  const file = (await bucket()).file(path);
  try {
    const [meta] = await file.getMetadata();
    return { stream: Readable.toWeb(file.createReadStream()) as ReadableStream<Uint8Array>, blob: { size: Number(meta.size ?? 0) } };
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

export async function gcsDelete(paths: string[]): Promise<void> {
  const b = await bucket();
  await Promise.all(paths.map(p => b.file(p).delete({ ignoreNotFound: true })));
}

export async function gcsPut(path: string, data: Buffer, contentType: string): Promise<void> {
  await (await bucket()).file(path).save(data, { contentType, resumable: false });
}

/**
 * URL firmato per caricare UN file dal browser con PUT. Le intestazioni restituite vanno inviate tali e quali:
 * fanno parte della firma, quindi l'archivio rifiuta un tipo di file diverso o un file più grande del limite.
 */
export async function gcsSignUpload(
  path: string,
  contentType: string,
  maxBytes: number,
): Promise<{ url: string; headers: Record<string, string> }> {
  const range = `0,${maxBytes}`;
  const [url] = await (await bucket()).file(path).getSignedUrl({
    version: "v4",
    action: "write",
    expires: Date.now() + SIGNED_URL_MINUTES * 60_000,
    contentType,
    extensionHeaders: { "x-goog-content-length-range": range },
  });
  return { url, headers: { "Content-Type": contentType, "x-goog-content-length-range": range } };
}
