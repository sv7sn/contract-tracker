// Controlla che ogni testo da tradurre abbia la versione inglese.
// Testi dell'interfaccia: t("...") nei file di src/. Messaggi del server: new HttpError(n, "...") e HttpError.t(n, "...") in api/.
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const files = dir =>
  fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap(e =>
      e.isDirectory()
        ? e.name === "i18n"
          ? []
          : files(path.join(dir, e.name))
        : /\.(ts|tsx)$/.test(e.name)
          ? [path.join(dir, e.name)]
          : [],
    );
const dict = {};
for (const f of fs.readdirSync(path.join(root, "src/i18n/en"))) {
  if (f === "index.ts") continue;
  const src = fs.readFileSync(path.join(root, "src/i18n/en", f), "utf8");
  // I dizionari sono oggetti letterali "chiave": "valore": li leggiamo come JSON senza eseguire TypeScript.
  const body = src
    .slice(src.indexOf("{"), src.lastIndexOf("}") + 1)
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/,(\s*})/g, "$1");
  try {
    Object.assign(dict, JSON.parse(body));
  } catch (e) {
    console.error(`✗ ${f}: dizionario non leggibile (${e.message})`);
    process.exitCode = 1;
  }
}
// Testo tra virgolette doppie o singole (la formattazione automatica può scegliere le singole quando il testo contiene ").
const STR = String.raw`(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')`;
const unquote = (dq, sq) => (dq !== undefined ? JSON.parse(`"${dq}"`) : JSON.parse(`"${sq.replace(/\\'/g, "'").replace(/"/g, '\\"')}"`));
const patterns = [
  [path.join(root, "src"), new RegExp(String.raw`\bt\(\s*` + STR, "g")],
  [path.join(root, "api"), new RegExp(String.raw`new HttpError\(\s*\d+\s*,\s*` + STR, "g")],
  [path.join(root, "api"), new RegExp(String.raw`HttpError\.t\(\s*\d+\s*,\s*` + STR, "g")],
];
const missing = new Map(),
  bad = [];
for (const [dir, re] of patterns)
  for (const f of files(dir)) {
    const src = fs.readFileSync(f, "utf8");
    for (const m of src.matchAll(re)) {
      const key = unquote(m[1], m[2]);
      if (!(key in dict)) missing.set(key, path.relative(root, f));
    }
    if (dir.endsWith("src"))
      for (const m of src.matchAll(new RegExp(String.raw`\btc\(\s*["']([^"']+)["']\s*,\s*` + STR, "g"))) {
        const key = unquote(m[2], m[3]);
        if (!(`${key}#${m[1]}` in dict)) missing.set(`${key}#${m[1]}`, path.relative(root, f));
      }
    if (dir.endsWith("src"))
      for (const m of src.matchAll(/\bt\(\s*`/g))
        bad.push(`${path.relative(root, f)}: t() con un template literal (usa "..." con {valori})`);
  }
for (const b of bad) console.error("✗", b);
for (const [k, f] of missing) console.error(`✗ manca l'inglese: ${JSON.stringify(k)}  (${f})`);
const ok = !missing.size && !bad.length && !process.exitCode;
console.log(
  ok ? `✓ traduzioni complete (${Object.keys(dict).length} testi)` : `✗ ${missing.size} testi senza inglese, ${bad.length} usi non validi`,
);
if (!ok) process.exitCode = 1;
