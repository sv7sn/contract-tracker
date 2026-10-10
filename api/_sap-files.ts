// Lettura dei file Excel che SAP invia ogni mattina (formato "Foglio di calcolo XML 2003", codifica UTF-16).
// SAP non sempre produce XML ben formato (caratteri speciali non codificati), quindi si legge a espressioni regolari.

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const unescape = (s: string) => s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
  if (e[0] === "#") { const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
  return ENT[e.toLowerCase()] ?? m;
});

/** Decodifica il file (UTF-16 con o senza BOM, oppure UTF-8) in testo. */
export function decodeSap(buf: Uint8Array): string {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder("utf-16le").decode(buf.subarray(2));
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder("utf-16be").decode(buf.subarray(2));
  if (buf.length >= 4 && buf[1] === 0 && buf[3] === 0) return new TextDecoder("utf-16le").decode(buf);
  return new TextDecoder("utf-8").decode(buf);
}

/** Righe del primo foglio come matrice di celle (null = cella vuota). */
export function parseSheet(buf: Uint8Array): (string | null)[][] {
  const txt = decodeSap(buf);
  const rows: (string | null)[][] = [];
  for (const rm of txt.matchAll(/<(?:ss:)?Row\b[^>]*>([\s\S]*?)<\/(?:ss:)?Row>/g)) {
    const cells: (string | null)[] = [];
    for (const cm of rm[1].matchAll(/<(?:ss:)?Cell\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:ss:)?Cell>)/g)) {
      const im = /(?:ss:)?Index="(\d+)"/.exec(cm[1]);
      if (im) while (cells.length < Number(im[1]) - 1) cells.push(null);
      const dm = /<(?:ss:)?Data\b[^>]*>([\s\S]*?)<\/(?:ss:)?Data>/.exec(cm[2] ?? "");
      cells.push(dm ? unescape(dm[1].replace(/<[^>]+>/g, "")).trim() || null : null);
    }
    rows.push(cells);
  }
  return rows;
}

export type SapKind = "pr" | "po";
export function detectKind(header: (string | null)[]): SapKind | null {
  const h = new Set(header.map(x => (x ?? "").trim()));
  if (h.has("Purch.Req.") && h.has("Release Dt") && h.has("Document Type")) return "pr";
  if (h.has("Purch.Doc.") && h.has("Doc. Date") && h.has("PR VALUE")) return "po";
  return null;
}

const num = (v: string | null | undefined) => { if (v == null) return 0; const n = Number(v.replace(",", ".")); return Number.isFinite(n) ? n : 0; };
const date = (v: string | null | undefined) => { const m = /^(\d{4}-\d{2}-\d{2})/.exec(v ?? ""); return m ? m[1] : null; };
/** Costruisce l'accesso per nome di colonna (a parità di nome vale la prima colonna). */
function columns(header: (string | null)[]) {
  const idx = new Map<string, number>();
  header.forEach((h, i) => { const k = (h ?? "").trim(); if (k && !idx.has(k)) idx.set(k, i); });
  return (row: (string | null)[], name: string): string | null => { const i = idx.get(name); return i === undefined ? null : row[i] ?? null; };
}

export interface PrLine { pr: string; item: string; pgr: string; shortText: string; qty: number; unit: string; price: number; per: number; currency: string; reqDate: string | null; delivDate: string | null; releaseDate: string | null; requestedBy: string; createdBy: string; plant: string; costCenter: string; glAccount: string; value: number;
  /** Internal order (riga del Master Plan) e tipo di imputazione SAP (F = ordine, K = centro di costo). */
  internalOrder: string; accountAssignment: string }
export function parsePrLines(rows: (string | null)[][]): PrLine[] {
  const col = columns(rows[0] ?? []);
  const out: PrLine[] = [];
  for (const r of rows.slice(1)) {
    const pr = col(r, "Purch.Req.");
    if (!pr) continue;
    const qty = num(col(r, "Qty Requested")), price = num(col(r, "Valn Price")), per = num(col(r, "Per")) || 1;
    out.push({ pr, item: col(r, "Item") ?? "0", pgr: col(r, "PGr") ?? "", shortText: col(r, "Short Text") ?? "", qty, unit: col(r, "Un") ?? "", price, per, currency: col(r, "Crcy") ?? "EUR",
      reqDate: date(col(r, "Req.Date")), delivDate: date(col(r, "Deliv. Date")), releaseDate: date(col(r, "Release Dt")), requestedBy: col(r, "Requested By") ?? "", createdBy: col(r, "Created By") ?? "",
      plant: col(r, "Plnt") ?? "", costCenter: col(r, "Cost Ctr") ?? "", glAccount: col(r, "G/L Acct") ?? "", value: Math.round((qty * price / per) * 100) / 100,
      internalOrder: (col(r, "Order") ?? "").trim(), accountAssignment: (col(r, "A") ?? "").trim() });
  }
  return out;
}

export interface PoLine { po: string; pr: string; supplierCode: string; supplierName: string; docDate: string | null; pgr: string; createdBy: string }
/** Righe d'ordine con il riferimento alla RDA (le righe senza RDA non servono ai task). */
export function parsePoLines(rows: (string | null)[][]): PoLine[] {
  const col = columns(rows[0] ?? []);
  const out: PoLine[] = [];
  for (const r of rows.slice(1)) {
    const po = col(r, "Purch.Doc.");
    if (!po) continue; // riga dei totali
    out.push({ po, pr: col(r, "Purch.Req.") ?? "", supplierCode: col(r, "Supplier") ?? "", supplierName: col(r, "Name 1") ?? "", docDate: date(col(r, "Doc. Date")), pgr: col(r, "PGr") ?? "", createdBy: col(r, "Created by") ?? "" });
  }
  return out;
}
