// Liste sanzioni ufficiali e gratuite (UE, ONU, USA/OFAC): scaricate ogni notte e confrontate in locale con i fornitori.
// Non serve nessun servizio a pagamento né una chiave: le liste sono pubbliche.
import type { CheckStatus, SanctionsStatus } from "../src/types.ts";
import { getPool, inTransaction, type Queryable } from "./_db.js";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
interface Entry { ref: string; name: string }
interface Source { key: string; label: string; urls: () => string[]; parse: (bodies: string[]) => Entry[] }

// ─── Normalizzazione dei nomi ────────────────────────────────
// Forme societarie e parole comuni che non identificano un soggetto.
const STOP = new Set(("SRL SRLS SPA SAS SNC SAPA SCARL SCRL SOC SOCIETA COOP COOPERATIVA LTD LIMITED LLC LLP INC CORP CORPORATION CO COMPANY PLC GMBH AG KG OHG UG MBH " +
  "SA SL SLU SARL SASU EURL BV NV OY AB AS APS SPZOO ZOO SRO JSC OJSC CJSC PJSC OOO OAO ZAO TOO LLP PTE PVT PTY FZE FZCO FZ LLC DMCC " +
  "THE AND OF DE DI DA DEL DELLA DU LA LE EL AL GROUP HOLDING HOLDINGS INTERNATIONAL TRADING").split(" "));
export function nameTokens(name: string): string[] {
  const t = name.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim().split(" ");
  return [...new Set(t.filter(x => x.length >= 2 && !STOP.has(x)))].sort();
}

// ─── Lettura dei file ────────────────────────────────────────
/** CSV con virgolette ("" = virgoletta) e separatore a scelta. */
export function parseCsv(text: string, sep: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cell = ""; let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
const xmlText = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").trim();
const tag = (block: string, name: string) => [...block.matchAll(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, "g"))].map(m => xmlText(m[1]));

/** Lista consolidata UE (Financial Sanctions Files): CSV con ";" e colonna NameAlias_WholeName. */
export function parseEu([csv]: string[]): Entry[] {
  const rows = parseCsv(csv.replace(/^\uFEFF/, ""), ";");
  const head = rows[0] ?? [];
  const name = head.indexOf("NameAlias_WholeName"), id = head.indexOf("Entity_LogicalId");
  if (name < 0) throw new Error("formato del file UE cambiato (manca NameAlias_WholeName)");
  return rows.slice(1).filter(r => r[name]?.trim()).map(r => ({ ref: `UE ${r[id] ?? ""}`.trim(), name: r[name].trim() }));
}
/** Lista consolidata del Consiglio di Sicurezza ONU (XML): persone ed entità, con gli alias. */
export function parseUn([xml]: string[]): Entry[] {
  if (!xml.includes("CONSOLIDATED_LIST")) throw new Error("formato del file ONU cambiato");
  const out: Entry[] = [];
  for (const m of xml.matchAll(/<(INDIVIDUAL|ENTITY)>([\s\S]*?)<\/\1>/g)) {
    const b = m[2];
    const ref = `ONU ${tag(b, "REFERENCE_NUMBER")[0] ?? tag(b, "DATAID")[0] ?? ""}`.trim();
    const full = ["FIRST_NAME", "SECOND_NAME", "THIRD_NAME", "FOURTH_NAME"].map(t => tag(b, t)[0] ?? "").filter(Boolean).join(" ");
    if (full) out.push({ ref, name: full });
    for (const a of tag(b, "ALIAS_NAME")) if (a) out.push({ ref, name: a });
  }
  return out;
}
/** Lista SDN del Tesoro USA (OFAC): sdn.csv (nomi) + alt.csv (alias), senza intestazione. */
export function parseOfac([sdn, alt]: string[]): Entry[] {
  const out: Entry[] = [];
  const clean = (s: string | undefined) => (s ?? "").trim().replace(/^-0-$/, "");
  for (const r of parseCsv(sdn, ",")) { const n = clean(r[1]); if (n && /^\d+$/.test(r[0]?.trim() ?? "")) out.push({ ref: `OFAC ${r[0].trim()}`, name: n }); }
  for (const r of parseCsv(alt ?? "", ",")) { const n = clean(r[3]); if (n && /^\d+$/.test(r[0]?.trim() ?? "")) out.push({ ref: `OFAC ${r[0].trim()}`, name: n }); }
  if (!out.length) throw new Error("formato del file OFAC cambiato");
  return out;
}

const env = (k: string, d: string) => process.env[k]?.trim() || d;
export const SOURCES: Source[] = [
  { key: "eu", label: "Unione Europea", urls: () => [env("SANCTIONS_EU_URL", "https://webgate.ec.europa.eu/fsd/fsf/public/files/csvFullSanctionsList_1_1/content?token=dG9rZW4tMjAxNw")], parse: parseEu },
  { key: "un", label: "ONU", urls: () => [env("SANCTIONS_UN_URL", "https://scsanctions.un.org/resources/xml/en/consolidated.xml")], parse: parseUn },
  { key: "us", label: "USA (OFAC)", urls: () => [env("SANCTIONS_OFAC_URL", "https://www.treasury.gov/ofac/downloads/sdn.csv"), env("SANCTIONS_OFAC_ALT_URL", "https://www.treasury.gov/ofac/downloads/alt.csv")], parse: parseOfac },
];

// ─── Stato e aggiornamento ───────────────────────────────────
interface Meta { updatedAt: string | null; sources: Record<string, { count: number; at: string | null; error: string }> }
async function loadMeta(db: Queryable): Promise<Meta> {
  return ((await db.query("select value from settings where key = 'sanctions_lists'")).rows[0]?.value as Meta | undefined) ?? { updatedAt: null, sources: {} };
}
export async function sanctionsStatus(db: Queryable): Promise<SanctionsStatus> {
  const m = await loadMeta(db);
  return { provider: providerOf(), updatedAt: m.updatedAt, sources: SOURCES.map(s => ({ key: s.key, label: s.label, count: m.sources[s.key]?.count ?? 0, at: m.sources[s.key]?.at ?? null, error: m.sources[s.key]?.error ?? "" })) };
}
const providerOf = () => (process.env.SANCTIONS_PROVIDER === "mock" ? "mock" : process.env.SANCTIONS_PROVIDER === "opensanctions" && process.env.OPENSANCTIONS_API_KEY ? "opensanctions" : "lists");

/** Scarica le liste e sostituisce quelle salvate. Una lista che non si scarica o è sospettamente vuota non cancella quella precedente. */
export async function refreshSanctionLists(fetcher: (url: string) => Promise<string> = defaultFetch): Promise<{ updated: string[]; errors: string[]; rescreened: number; newHits: number }> {
  const db = getPool();
  const meta = await loadMeta(db);
  const updated: string[] = [], errors: string[] = [];
  for (const s of SOURCES) {
    try {
      const entries = s.parse(await Promise.all(s.urls().map(fetcher)));
      const rows = entries.map(e => ({ ...e, tokens: nameTokens(e.name) })).filter(e => e.tokens.length);
      if (rows.length < 50) throw new Error(`solo ${rows.length} nomi: file incompleto`);
      await inTransaction(async tx => {
        await tx.query("delete from sanction_entries where source = $1", [s.key]);
        for (let i = 0; i < rows.length; i += 2000) {
          const part = rows.slice(i, i + 2000);
          await tx.query(`insert into sanction_entries (source, ref, name, key, tokens) select $1, r, n, k, string_to_array(t, ' ') from unnest($2::text[], $3::text[], $4::text[], $5::text[]) as x(r, n, k, t)`,
            [s.key, part.map(e => e.ref.slice(0, 60)), part.map(e => e.name.slice(0, 300)), part.map(e => e.tokens.join(" ")), part.map(e => e.tokens.join(" "))]);
        }
      });
      meta.sources[s.key] = { count: rows.length, at: new Date().toISOString(), error: "" };
      updated.push(s.key);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "errore";
      meta.sources[s.key] = { ...(meta.sources[s.key] ?? { count: 0, at: null }), error: msg.slice(0, 200) };
      errors.push(`${s.label}: ${msg}`);
    }
  }
  if (updated.length) meta.updatedAt = new Date().toISOString();
  await db.query("insert into settings (key, value) values ('sanctions_lists', $1) on conflict (key) do update set value = excluded.value", [JSON.stringify(meta)]);
  const { rescreened, newHits } = updated.length ? await rescreenAll(db) : { rescreened: 0, newHits: 0 };
  return { updated, errors, rescreened, newHits };
}
async function defaultFetch(url: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(90_000), headers: { "User-Agent": "ProcurementLab/1.0 (sanctions screening)" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}
/** Una volta al giorno è sufficiente: le liste cambiano di rado. */
export async function refreshIfStale(): Promise<Awaited<ReturnType<typeof refreshSanctionLists>> | null> {
  if (providerOf() !== "lists") return null;
  const m = await loadMeta(getPool());
  if (m.updatedAt && Date.now() - new Date(m.updatedAt).getTime() < 20 * 3600e3 && !Object.values(m.sources).some(s => s.error)) return null;
  return refreshSanctionLists();
}

// ─── Confronto ───────────────────────────────────────────────
/** Cerca il nome nelle liste salvate: stesso nome = corrispondenza; tutte le parole di un nome in lista presenti = possibile corrispondenza. */
export async function screenName(db: Queryable, legalName: string): Promise<{ status: CheckStatus; detail: string }> {
  const total = (await db.query("select count(*)::int as n from sanction_entries")).rows[0].n as number;
  if (!total) return { status: "todo", detail: "Liste sanzioni non ancora scaricate (avviene ogni notte, o da Configurazione): serve la verifica manuale" };
  const tokens = nameTokens(legalName);
  if (!tokens.length) return { status: "todo", detail: "Ragione sociale mancante" };
  const key = tokens.join(" ");
  const hits: Row[] = (await db.query(`select source, ref, name, key, cardinality(tokens) as n from sanction_entries
    where key = $1 or (cardinality(tokens) >= 2 and tokens <@ $2::text[]) order by (key = $1) desc, cardinality(tokens) desc limit 5`, [key, tokens])).rows;
  const src = Object.fromEntries(SOURCES.map(s => [s.key, s.label]));
  const lists = SOURCES.map(s => s.label).join(", ");
  if (!hits.length) return { status: "ok", detail: `Nessuna corrispondenza nelle liste ${lists}` };
  const h = hits[0];
  const desc = `"${h.name}" (${src[h.source]}, ${h.ref})${hits.length > 1 ? ` e altre ${hits.length - 1}` : ""}`;
  if (h.key === key && tokens.length >= 2) return { status: "fail", detail: `Corrispondenza nella lista sanzioni: ${desc}. Verifica prima di procedere` };
  return { status: "warn", detail: `Possibile corrispondenza: ${desc}. Controlla che non sia lo stesso soggetto` };
}

/** Dopo ogni aggiornamento ricontrolla tutti i fornitori: una persona o società può entrare in lista in qualunque momento. */
async function rescreenAll(db: Queryable): Promise<{ rescreened: number; newHits: number }> {
  const rows = (await db.query("select id, name, data, compliance from suppliers where anonymized_at is null and status <> 'invited'")).rows;
  let newHits = 0;
  for (const r of rows) {
    const res = await screenName(db, r.data?.company?.legalName || r.name);
    const prev = r.compliance?.sanctions?.status;
    if (res.status !== "ok" && res.status !== "todo" && prev !== res.status) {
      newHits++;
      await db.query("insert into supplier_events (supplier_id, actor, action, detail) values ($1,'Sistema','Controllo sanzioni: da verificare',$2)", [r.id, res.detail]);
    }
    await db.query("update suppliers set compliance = $1 where id = $2", [JSON.stringify({ ...(r.compliance ?? {}), sanctions: res, sanctionsAt: new Date().toISOString() }), r.id]);
  }
  return { rescreened: rows.length, newHits };
}
