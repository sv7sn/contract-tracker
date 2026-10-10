// Lettura dei fogli Excel (.xlsx) senza librerie esterne: un .xlsx è uno ZIP di file XML.
// Si legge il primo foglio (con le stringhe condivise) e si restituisce una matrice di celle come per i file SAP.
import { inflateRawSync } from "node:zlib";

function unzip(buf: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  // Fine della "central directory": firma 0x06054b50 negli ultimi 64 KB.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("File Excel non valido");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20), nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32), local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    const lNameLen = buf.readUInt16LE(local + 26), lExtraLen = buf.readUInt16LE(local + 28);
    const data = buf.subarray(local + 30 + lNameLen + lExtraLen, local + 30 + lNameLen + lExtraLen + size);
    if (method === 0) out.set(name, Buffer.from(data)); else if (method === 8) out.set(name, inflateRawSync(data));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const xmlText = (s: string) => s.replace(/<[^>]+>/g, "").replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENT[e.toLowerCase()] ?? m);
const colIndex = (ref: string) => { let n = 0; for (const ch of ref.replace(/\d+/g, "")) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };

export const isXlsx = (buf: Uint8Array) => buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;

/** Righe del primo foglio di un .xlsx (null = cella vuota). */
export function parseXlsx(input: Uint8Array): (string | null)[][] {
  const files = unzip(Buffer.from(input));
  const shared = [...(files.get("xl/sharedStrings.xml")?.toString("utf8") ?? "").matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => xmlText(m[1]));
  // Primo foglio secondo l'ordine del workbook.
  const wb = files.get("xl/workbook.xml")?.toString("utf8") ?? "";
  const rels = files.get("xl/_rels/workbook.xml.rels")?.toString("utf8") ?? "";
  const rid = /<sheet\b[^>]*r:id="([^"]+)"/.exec(wb)?.[1];
  const target = rid ? new RegExp(`<Relationship\\b[^>]*Id="${rid}"[^>]*Target="([^"]+)"`).exec(rels)?.[1] ?? new RegExp(`<Relationship\\b[^>]*Target="([^"]+)"[^>]*Id="${rid}"`).exec(rels)?.[1] : undefined;
  const path = target ? (target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`) : [...files.keys()].find(k => /^xl\/worksheets\/sheet\d+\.xml$/.test(k));
  const sheet = path ? files.get(path)?.toString("utf8") : undefined;
  if (!sheet) throw new Error("Il file Excel non contiene fogli");
  const rows: (string | null)[][] = [];
  for (const rm of sheet.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>|<row\b([^>]*)\/>/g)) {
    const rn = Number(/\br="(\d+)"/.exec(rm[1] ?? rm[3] ?? "")?.[1] ?? rows.length + 1);
    while (rows.length < rn - 1) rows.push([]);
    const cells: (string | null)[] = [];
    for (const cm of (rm[2] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = /\br="([A-Z]+\d+)"/.exec(cm[1])?.[1];
      const t = /\bt="([^"]+)"/.exec(cm[1])?.[1];
      const i = ref ? colIndex(ref) : cells.length;
      while (cells.length < i) cells.push(null);
      const v = /<v>([\s\S]*?)<\/v>/.exec(cm[2] ?? "")?.[1];
      let val: string | null = null;
      if (t === "s" && v !== undefined) val = shared[Number(v)] ?? null;
      else if (t === "inlineStr") val = xmlText(/<is>([\s\S]*?)<\/is>/.exec(cm[2] ?? "")?.[1] ?? "");
      else if (v !== undefined) val = xmlText(v);
      cells[i] = val === null || val.trim() === "" ? null : val.trim();
    }
    rows.push(cells);
  }
  return rows;
}

/** CSV con separatore ";" o "," (scelto contando quelli della prima riga). */
export function parseCsvRows(text: string): (string | null)[][] {
  const first = text.split(/\r?\n/, 1)[0] ?? "";
  const sep = (first.match(/;/g)?.length ?? 0) >= (first.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: (string | null)[][] = []; let row: (string | null)[] = []; let cell = ""; let q = false;
  const push = () => { row.push(cell.trim() || null); cell = ""; };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === sep) push();
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; push(); rows.push(row); row = []; }
    else cell += ch;
  }
  if (cell || row.length) { push(); rows.push(row); }
  return rows;
}
