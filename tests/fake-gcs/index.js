// Finto Google Cloud Storage per i test: stessa forma delle chiamate usate da api/_storage-gcs.ts.
import { Readable } from "node:stream";
export const objects = new Map(); // "bucket/path" -> { data, contentType }
export const deleted = [];
export const signed = []; // opzioni ricevute da getSignedUrl
const notFound = () => Object.assign(new Error("No such object"), { code: 404 });
class File {
  constructor(bucket, name) {
    this.bucket = bucket;
    this.name = name;
    this.key = `${bucket}/${name}`;
  }
  async getMetadata() {
    const o = objects.get(this.key);
    if (!o) throw notFound();
    return [{ size: String(o.data.length), contentType: o.contentType }];
  }
  createReadStream() {
    const o = objects.get(this.key);
    if (!o) throw notFound();
    return Readable.from([o.data]);
  }
  async delete({ ignoreNotFound } = {}) {
    if (!objects.has(this.key) && !ignoreNotFound) throw notFound();
    deleted.push(this.name);
    objects.delete(this.key);
  }
  async save(data, { contentType }) {
    objects.set(this.key, { data: Buffer.from(data), contentType });
  }
  async getSignedUrl(o) {
    signed.push({ name: this.name, ...o });
    return [`https://storage.googleapis.com/${this.bucket}/${encodeURIComponent(this.name)}?X-Goog-Signature=test`];
  }
}
export class Storage {
  bucket(name) {
    return { file: n => new File(name, n) };
  }
}
