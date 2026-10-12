// Scrittura minimale di un .docx (Word) da paragrafi di testo: serve per scaricare le bozze generate dai modelli.
// Un .docx è uno zip di file XML: qui si scrive solo il necessario (testo, grassetto, tabella a due colonne per i testi bilingue).
import { deflateRawSync } from "node:zlib";

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b: Buffer) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

function zip(files: { name: string; data: Buffer }[]): Buffer {
  const parts: Buffer[] = [], central: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name), comp = deflateRawSync(f.data), crc = crc32(f.data);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(f.data.length, 22); lh.writeUInt16LE(name.length, 26);
    const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(8, 10); cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(comp.length, 20); cd.writeUInt32LE(f.data.length, 24); cd.writeUInt16LE(name.length, 28); cd.writeUInt32LE(offset, 42);
    parts.push(lh, name, comp); central.push(cd, name);
    offset += 30 + name.length + comp.length;
  }
  const cdBuf = Buffer.concat(central), eo = Buffer.alloc(22);
  eo.writeUInt32LE(0x06054b50, 0); eo.writeUInt16LE(files.length, 8); eo.writeUInt16LE(files.length, 10); eo.writeUInt32LE(cdBuf.length, 12); eo.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cdBuf, eo]);
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const para = (text: string, bold: boolean) => {
  const runs = text.split("\n").map(l => `<w:t xml:space="preserve">${esc(l)}</w:t>`).join("<w:br/>");
  return `<w:p><w:pPr><w:spacing w:after="120"/></w:pPr><w:r>${bold ? "<w:rPr><w:b/></w:rPr>" : ""}${runs}</w:r></w:p>`;
};

export interface DocxLayout { cols?: 1 | 2; langs?: string[]; heads?: number[] }
/** Con cols = 2 i paragrafi sono a coppie (lingua 1, lingua 2): una riga di tabella per coppia. */
export function buildDocx(paras: string[], layout: DocxLayout = {}): Buffer {
  const heads = new Set(layout.heads ?? []);
  let body = "";
  if (layout.cols === 2) {
    const border = ["top", "left", "bottom", "right", "insideH", "insideV"].map(b => `<w:${b} w:val="single" w:sz="4" w:color="BBBBBB"/>`).join("");
    body += `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>${border}</w:tblBorders><w:tblCellMar><w:left w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="4500"/><w:gridCol w:w="4500"/></w:tblGrid>`;
    for (let i = 0; i < paras.length; i += 2) {
      const cell = (j: number) => `<w:tc><w:tcPr><w:tcW w:w="2500" w:type="pct"/></w:tcPr>${para(paras[j] ?? "", heads.has(j))}</w:tc>`;
      body += `<w:tr>${cell(i)}${cell(i + 1)}</w:tr>`;
    }
    body += `</w:tbl><w:p/>`;
  } else paras.forEach((p, i) => { body += para(p, heads.has(i)); });
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  return zip([
    { name: "[Content_Types].xml", data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`) },
    { name: "_rels/.rels", data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`) },
    { name: "word/document.xml", data: Buffer.from(doc) },
  ]);
}
