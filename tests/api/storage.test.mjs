// Archivio documenti su Google Cloud Storage (STORAGE_PROVIDER=gcs), con il finto GCS di tests/fake-gcs.
import assert from "node:assert/strict";
const B = process.env.API_BUILD + "/api/";
process.env.DATABASE_URL = process.env.TEST_DB_URL;
process.env.ADMIN_EMAIL = "admin@test.it";
process.env.ADMIN_PASSWORD = "Admin-pass-123!";
process.env.SESSION_SECRET = "x".repeat(40);
process.env.STORAGE_PROVIDER = "gcs";
process.env.GCS_BUCKET = "test-bucket";
const portal = await import(B + "portal.js"),
  login = await import(B + "login.js"),
  upload = await import(B + "upload.js");
const db = await import(B + "_db.js"),
  crypto = await import(B + "_crypto.js"),
  blob = await import(B + "_blob.js"),
  gcs = await import(process.env.API_BUILD + "/node_modules/@google-cloud/storage/index.js"),
  vercel = await import(process.env.API_BUILD + "/node_modules/@vercel/blob/index.js");
await db.ensureSchema();
const pool = db.getPool();
let passed = 0;
const ok = n => {
  passed++;
  console.log("  ✓", n);
};
const call = async (mod, cookie, method, qs, body) => {
  const r = new Request("https://app.test/api/x" + qs, {
    method,
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const res = await mod[method](r);
  const sc = res.headers.get("set-cookie");
  let data;
  try {
    data = await res.clone().json();
  } catch {
    data = null;
  }
  return { status: res.status, data, cookie: sc ? sc.split(";")[0] : null };
};
const signin = async (e, p) => (await call(login, null, "POST", "", { email: e, password: p })).cookie;
await pool.query("insert into users (email,name,role,title,password_hash) values ('fin@test.it','Finance Uno','finance','t',$1)", [
  await crypto.hashPassword("Password-123!"),
]);
const admin = await signin("admin@test.it", "Admin-pass-123!"),
  fin = await signin("fin@test.it", "Password-123!");
const uuid = () => globalThis.crypto.randomUUID();
const PDF = "application/pdf",
  MAX = 25 * 1024 * 1024;

console.log("Scelta dell'archivio");
assert.equal(blob.storageProvider(), "gcs");
assert.deepEqual((await call(portal, null, "GET", "?op=health")).data, { ok: true });
const kind = await call(upload, admin, "POST", "", { type: "storage.kind" });
assert.equal(kind.status, 200);
assert.equal(kind.data.provider, "gcs");
assert.equal((await call(upload, null, "POST", "", { type: "storage.kind" })).status, 401);
ok("il browser chiede quale archivio usare solo dopo l'accesso; il controllo di salute resta senza dati");

console.log("Caricamento dei contratti: URL firmato");
const path = `contracts/${uuid()}/contratto.pdf`;
const sig = await call(upload, admin, "POST", "", { type: "gcs.sign", pathname: path, contentType: PDF, size: 1000 });
assert.equal(sig.status, 200, JSON.stringify(sig.data));
assert.equal(sig.data.provider, "gcs");
assert.equal(sig.data.pathname, path);
assert.match(sig.data.url, /^https:\/\/storage\.googleapis\.com\/test-bucket\//);
assert.deepEqual(sig.data.headers, { "Content-Type": PDF, "x-goog-content-length-range": `0,${MAX}` });
const last = gcs.signed.at(-1);
assert.equal(last.name, path);
assert.equal(last.version, "v4");
assert.equal(last.action, "write");
assert.equal(last.contentType, PDF);
assert.deepEqual(last.extensionHeaders, { "x-goog-content-length-range": `0,${MAX}` });
assert(last.expires > Date.now() && last.expires <= Date.now() + 10 * 60_000);
ok("URL firmato V4 per un solo file: tipo e dimensione massima vincolati dalla firma, scade in 10 minuti");
const bad = async (body, status, label) => {
  const r = await call(upload, admin, "POST", "", body);
  assert.equal(r.status, status, `${label}: ${JSON.stringify(r.data)}`);
};
await bad({ type: "gcs.sign", pathname: `suppliers/${uuid()}/x.pdf`, contentType: PDF, size: 10 }, 400, "percorso di un altro archivio");
await bad({ type: "gcs.sign", pathname: "contracts/../x.pdf", contentType: PDF, size: 10 }, 400, "percorso con ..");
await bad({ type: "gcs.sign", pathname: path, contentType: "text/html", size: 10 }, 400, "tipo non ammesso");
await bad({ type: "gcs.sign", pathname: path, contentType: PDF, size: MAX + 1 }, 400, "file troppo grande");
await bad({ type: "gcs.sign", pathname: path, contentType: PDF, size: 0 }, 400, "file vuoto");
await bad({ type: "blob.generate-client-token", payload: { pathname: path } }, 400, "richiesta Vercel su archivio GCS");
await bad({ pathname: path }, 400, "richiesta senza tipo");
ok("percorso, tipo, dimensione e formato della richiesta controllati");
assert.equal((await call(upload, fin, "POST", "", { type: "gcs.sign", pathname: path, contentType: PDF, size: 10 })).status, 403);
assert.equal((await call(upload, null, "POST", "", { type: "gcs.sign", pathname: path, contentType: PDF, size: 10 })).status, 401);
ok("permessi invariati: Finance 403, anonimo 401");

console.log("Lettura ed eliminazione");
gcs.objects.set(`test-bucket/${path}`, { data: Buffer.from("contenuto-pdf"), contentType: PDF });
const opened = await blob.openDocument(path);
assert.equal(opened.blob.size, 13);
assert.equal(await new Response(opened.stream).text(), "contenuto-pdf");
assert.equal(await blob.openDocument(`contracts/${uuid()}/manca.pdf`), null);
ok("lettura con dimensione; file mancante = null");
await blob.deleteDocuments([path, `contracts/${uuid()}/gia-eliminato.pdf`]);
assert(!gcs.objects.has(`test-bucket/${path}`));
assert(gcs.deleted.includes(path));
ok("eliminazione, anche di file già assenti, senza errori");
assert.equal(vercel.store.size, 0);
assert.equal(vercel.deleted.length, 0);
ok("Vercel Blob non viene mai usato");

console.log("Fornitore: caricamento dei documenti");
await call(portal, admin, "POST", "?op=config-save", {
  entity: "company",
  action: "save",
  item: { code: "ACME", name: "Acme Italia", sapCompanyCode: "1000", purchOrg: "1000" },
});
await call(portal, admin, "POST", "?op=config-save", {
  entity: "industry",
  action: "save",
  item: { code: "IT01", name: "IT services", buyerIds: [] },
});
const demo = await call(portal, admin, "POST", "?op=vendor-demo");
assert.equal(demo.status, 201, JSON.stringify(demo.data));
assert([...gcs.objects.keys()].some(k => k.startsWith("test-bucket/suppliers/")));
ok("gli strumenti di prova scrivono su GCS");
const sup = await signin(demo.data.email, demo.data.password);
assert(sup);
const spath = `suppliers/${uuid()}/visura.pdf`;
const ssig = await call(portal, sup, "POST", "?op=supplier-upload-token", {
  type: "gcs.sign",
  pathname: spath,
  contentType: PDF,
  size: 500,
});
assert.equal(ssig.status, 200, JSON.stringify(ssig.data));
assert.equal(ssig.data.headers["x-goog-content-length-range"], `0,${10 * 1024 * 1024}`);
const sbad = await call(portal, sup, "POST", "?op=supplier-upload-token", {
  type: "gcs.sign",
  pathname: `suppliers/${uuid()}/x.exe`,
  contentType: PDF,
  size: 10,
});
assert.equal(sbad.status, 400);
assert.equal(
  (await call(portal, admin, "POST", "?op=supplier-upload-token", { type: "gcs.sign", pathname: spath, contentType: PDF, size: 10 }))
    .status,
  403,
);
ok("fornitore: URL firmato col limite dei documenti; .exe rifiutato; lo staff non usa questa operazione");

console.log(`\n${passed} controlli superati`);
await pool.end();
