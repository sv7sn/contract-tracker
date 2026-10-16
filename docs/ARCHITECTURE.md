# Procurement Lab — Architettura

Documento per la design authority. Descrive cosa fa il software, come è fatto, dove stanno i dati, quali controlli di sicurezza ci sono e, soprattutto, **cosa non c'è ancora**. Tutte le affermazioni si riferiscono al codice di questo repository.

## 1. Cosa fa

Applicazione web per l'ufficio acquisti (procurement indiretto) che segue una pratica dalla richiesta d'acquisto (RDA) al contratto, tenendo insieme dati oggi sparsi in file e posta.

| Modulo | Funzione |
|---|---|
| **Task** | RDA importate da SAP, rinnovi in scadenza, acquisti manuali e attività. Flusso a passaggi, regola di confronto tra fornitori sopra soglia, chiusura automatica all'arrivo del PO, assegnazione del buyer dall'internal order |
| **Fornitori** | Registrazione da invito, qualifica e scadenza dei documenti, controlli (VIES, GLEIF, liste sanzioni, doppioni, IBAN), blocco/esclusione, valutazione, esportazione e anonimizzazione (GDPR). **Livello di rischio** (alto/medio/basso, con i motivi) e **verifica periodica automatica**: partita IVA, Registro Imprese e sanzioni si ripetono con frequenza secondo il rischio, con avviso ai buyer se la situazione peggiora |
| **Contratti** | Registro, scadenze e data limite di disdetta, piano di rinnovo, avvisi al Business Owner, obblighi contrattuali |
| **CLM** | Bozze in versioni, modelli con questionario, libreria di clausole, confronto versioni, revisione delle funzioni (Richiedente, Legal, Compliance, IT Security) con blocco della firma, trattativa con il fornitore, registro delle azioni |
| **Budget** | Master Plan per internal order: budget, impegnato (da PO SAP), previsto e impegni futuri dei contratti |
| **Spesa** | Spesa reale dai file ordini SAP: fornitori, categorie, copertura contrattuale, ordini senza RDA |
| **Indicatori** (solo Manager) | Tempi e rispetto delle regole: RDA, scelta del fornitore, onboarding, qualifica, revisione dei contratti; carico del team per mese |
| **Amministrazione** | Utenti e ruoli, parametri, regole di revisione, registro delle modifiche di configurazione |

Interfaccia in **italiano e inglese**: ogni utente sceglie la lingua dal menu del profilo; le email partono nella lingua di chi le riceve. Restano in italiano i dati inseriti dagli utenti e i testi legali dei modelli e delle clausole (la versione inglese va rivista da Legal).

Fuori ambito (non realizzato): firma elettronica, funzioni AI sui contratti, integrazione SAP in tempo reale.

## 2. Vista d'insieme

```
 Browser (React 19 + TypeScript, Vite)          Fornitori (portale esterno, stessa app)
        │  HTTPS, cookie di sessione HttpOnly
        ▼
 Vercel Functions (Node.js)  ── 11 funzioni; api/portal.ts è un router unico (~130 operazioni)
        │                         │                    │
        ▼                         ▼                    ▼
 PostgreSQL (Neon)          Vercel Blob (privato)   Servizi esterni (solo in uscita)
 49 tabelle, schema         documenti: contratti,   Resend (email), VIES, GLEIF, liste sanzioni
 creato dal codice          allegati, offerte       (UE, ONU, USA, UK, OpenSanctions),
                                                    openapi.com (dati societari),
                                                    Anthropic API (solo se attivata, vedi §7)

 SAP  ──►  file XLS/XLSX (RDA aperte, ordini) caricati a mano o inoltrati a un endpoint con segreto
```

**Scelte di fondo**
- **Un'unica applicazione, un solo database.** I moduli condividono i dati (task ↔ fornitori ↔ contratti ↔ budget ↔ bozze). Non sono servizi separati.
- **Nessun framework lato server e nessun ORM:** funzioni Vercel con SQL scritto a mano (libreria `pg`). Le dipendenze di produzione sono sei: `react`, `react-dom`, `pg`, `@vercel/blob`, `lucide-react`, un font.
- **Logica condivisa tra server e interfaccia** in `api/` (permessi, passaggi dei task, regole del CLM) e riesportata in `src/`: server e interfaccia usano le stesse regole.
- **Schema autogestito:** `ensureSchema` (`api/_db.ts`) esegue all'avvio istruzioni idempotenti (`create table if not exists`, `add column if not exists`). Non esiste una cartella di migrazioni da lanciare.

## 3. Struttura del codice

```
src/        interfaccia (views/, components/, lib/); ~8.200 righe
  i18n/       lingue: italiano (testo nel codice) e inglese (src/i18n/en/*.ts, chiave = testo italiano)
api/        funzioni e logica; ~7.400 righe. I file con prefisso _ sono moduli, gli altri sono funzioni
  portal.ts   router unico: ?op=<operazione>, con controllo del ruolo per blocco di operazioni
  _db.ts      schema, query, validazioni
  _permissions.ts, _auth.ts, _crypto.ts   accesso, sessioni, hash
  _tasks.ts, _task-steps.ts               task e passaggi
  _portal.ts, _governance.ts, _sanctions.ts, _docs.ts, _rating.ts, _privacy.ts, _risk.ts   fornitori (rischio e verifica periodica in _risk.ts)
  _budget.ts, _spend.ts, _sap*.ts, _kpi.ts   budget, spesa, SAP, indicatori
  _clm*.ts, _docx.ts, _obligations.ts     CLM e obblighi
tests/      suite automatiche (vedi §8)
```

## 4. Modello dei dati (49 tabelle)

| Area | Tabelle principali |
|---|---|
| Accesso | `users`, `login_attempts`, `buyer_cover` (assenze e sostituzioni) |
| Contratti | `contracts`, `plan_steps`, `audit_log`, `bo_notices`, `bo_messages`, `contract_obligations` |
| Fornitori | `suppliers` (dati in JSON), `supplier_documents`, `supplier_events`, `doc_types`, `doc_rules`, `doc_reminders`, `supplier_ratings`, `sanction_entries`, `sap_requests` |
| Task e acquisti | `tasks`, `task_documents`, `rda_lines`, `rfqs`, `rfq_invites`, `io_buyers`, `pgr_assignments`, `sap_imports` |
| Budget e spesa | `mp_versions`, `mp_lines`, `sap_pos`, `po_lines`, `categories`, `category_map`, `category_buyers` |
| CLM | `contract_drafts`, `draft_reviews`, `draft_comments`, `draft_deviations`, `draft_audit`, `clause_library`, `clause_versions`, `review_rules` |
| Configurazione | `settings`, `buying_companies`, `industry_codes`, `industry_buyers`, `payment_terms`, `config_audit`, `notifications` |

I file non sono nel database: PDF, Word e allegati stanno in Vercel Blob e il database conserva solo il percorso.

## 5. Sicurezza e accesso

**Autenticazione**
- Email e password (almeno 12 caratteri, regole su banalità e email). Hash `scrypt` con sale casuale; confronto a tempo costante anche per utenti inesistenti.
- Sessione: token firmato HMAC-SHA256 in cookie `HttpOnly`, `SameSite=Lax`, `Secure` su HTTPS; validità 7 giorni.
- Blocco dopo 5 tentativi falliti in 15 minuti per email e 30 per indirizzo. Sessioni revocabili (versione di sessione nel token).
- L'utente viene riletto dal database a ogni richiesta: disattivazioni e cambi di ruolo valgono subito.
- I fornitori entrano da un invito personale con scadenza (default 14 giorni) e creano la password.

**Autorizzazione**
- Ruoli: Manager, buyer, Finance, Business Owner, Controlling/CFO (sola lettura), Legal, Compliance, IT Security, fornitore.
- I permessi sono **applicati dal server**: ogni blocco di operazioni in `api/portal.ts` dichiara i ruoli ammessi, e le regole di visibilità per riga (un buyer vede solo le proprie pratiche) stanno nelle query. L'interfaccia nasconde solo i comandi.
- Le bozze di contratto sono riservate: le vedono solo buyer del task, Manager e funzioni invitate. Il fornitore vede solo la versione condivisa con lui e i commenti esterni; mai commenti interni, pareri, regole o registro.

**Altre protezioni**
- I POST richiedono `Content-Type: application/json` (impedisce l'invio da form di altri siti).
- Upload diretti nell'archivio privato con URL firmato per un solo percorso, con limite di tipo e di dimensione (25 MB contratti, 10 MB documenti fornitori).
- Download dei file solo tramite funzione che controlla i permessi; archivio Blob in modalità privata.
- Registri: modifiche ai contratti (`audit_log`), alla configurazione (`config_audit`), ai fornitori (`supplier_events`), alle bozze (`draft_audit`, con esportazione CSV), email inviate (`notifications`). L'autore lo stabilisce il server, mai il client.
- Dati personali: esportazione e anonimizzazione di un fornitore, conservazione configurabile (default 24 mesi), informativa privacy accettata al momento della registrazione.

## 6. Integrazioni

| Con | Come | Stato |
|---|---|---|
| **SAP — RDA e ordini** | File XLS/XLSX caricati a mano, oppure inoltrati a un endpoint protetto da segreto (`rda-ingest`) | Funziona; non è in tempo reale |
| **SAP — anagrafica fornitori** | Invio JSON a un endpoint configurabile (`SAP_MODE=http`); in modalità `simulated` genera un codice fittizio | Da collegare al sistema reale |
| **Email** | Resend; senza configurazione le email vengono solo registrate in `notifications` | Da configurare |
| **Controlli fornitori** | VIES (UE), GLEIF, liste sanzioni UE/ONU/USA/UK, OpenSanctions, openapi.com | Attivi; il token di openapi.com è opzionale |
| **Controllo AI dei documenti fornitore** | Anthropic API, **disattivato** se non è impostata la chiave | Opzionale |
| **Budget del CIO** | Non c'è. Punto di aggancio previsto: import del Master Plan (oggi file Excel con colonna buyer) e restituzione di impegni futuri dei contratti e consumo per internal order | Da definire |
| **Pianificazione automatica** | Un job giornaliero (Vercel Cron, 06:00 UTC): promemoria documenti, conservazione dati, aggiornamento liste sanzioni, avvisi al Business Owner, solleciti di revisione | Attivo |

## 7. Configurazione e ambienti

Variabili d'ambiente: vedi `.env.example` (solo segnaposto). Le principali: `DATABASE_URL`, `BLOB_STORE_ID`, `SESSION_SECRET`, `CRON_SECRET`, `RESEND_API_KEY`, `MAIL_FROM`, `RDA_INGEST_SECRET`, `SAP_MODE`/`SAP_ENDPOINT`, `DOC_AI_PROVIDER`/`ANTHROPIC_API_KEY`.

Hosting attuale: Vercel (funzioni in regione `iad1`, Stati Uniti est) e Neon (Postgres). **La regione del database va verificata e confermata prima dell'uso con dati reali.**

## 8. Test e qualità

- `npm run lint`, `tsc` e la build passano senza errori; la stessa verifica gira in CI (`.github/workflows/ci.yml`).
- **36 suite di integrazione, oltre 720 controlli**, che chiamano le funzioni reali contro un Postgres vero (`npm run test:api`, vedi `tests/run.sh`). Coprono permessi per ruolo, flussi dei task, fornitori, budget e spesa, CLM, riservatezza.
- Upload su Blob, email e controlli esterni sono simulati nei test. Cinque suite (budget, purchase, sourcing, spend, tasks) usano export SAP reali che **non** sono nel repository per riservatezza: partono solo se si fornisce la cartella `SAP_SAMPLES`.
- `npm run test:i18n` controlla che ogni testo dell'interfaccia e ogni messaggio del server abbia la versione inglese (oltre 2.300 testi).
- `npm audit` sulle dipendenze di produzione: 0 vulnerabilità note.
- Non ci sono test automatici dell'interfaccia; le schermate sono state verificate a mano su computer e telefono, per ruolo.

## 9. Cosa non c'è (limiti dichiarati)

Il dettaglio dei controlli è in `SECURITY.md`; operatività e ripristino in `OPERATIONS.md`; dati personali in `DATA-PROTECTION.md`; elenco delle dipendenze in `SBOM.cdx.json`.

| Tema | Stato |
|---|---|
| **SSO** | Realizzato (OpenID Connect, flusso authorization code con PKCE, firma RS256 verificata, ruoli dai gruppi del provider, account di emergenza), spento finché non si impostano le variabili `OIDC_*`. Provato con un provider simulato; **non ancora collegato al tenant aziendale** (servono i dati dell'IT) |
| **Autenticazione a due fattori** | Assente (arriverebbe con l'SSO) |
| **Test di penetrazione / revisione di sicurezza indipendente** | Non eseguiti. È stata fatta una verifica interna automatica e ripetibile (`SECURITY.md` §1 bis) |
| **Separazione dei ruoli** | Quattro occhi su clausole ed eccezioni al confronto; non su altre approvazioni (vedi `SECURITY.md` §3) |
| **Firma elettronica** | Non realizzata (prevista come fase successiva) |
| **Integrazione SAP in tempo reale** | Assente: oggi basata su file |
| **Backup e ripristino** | Script di copia e ripristino con prova riuscita su database locale; da ripetere su Neon. I file in Blob non hanno copia versionata. Procedura in `OPERATIONS.md` |
| **Regione dei dati** | Funzioni in USA est; regione del database da confermare |
| **Volumi** | Provato con dati di simulazione; non con volumi reali |
| **Uso in produzione** | Non ancora con utenti reali su larga scala |
| **Testi legali** (clausole e modelli) | Esempi da validare dal Legal |
| **Test automatici dell'interfaccia** | Assenti; schermate verificate a mano |
| **Collegamento al database** | Una sola connessione per funzione (`max: 1`): adatto a carichi modesti |

Chiusi di recente: blocco di avvio concorrente dello schema, indici sulle tabelle principali, strumenti di prova disattivabili, operazioni distruttive registrate, intestazioni di sicurezza (CSP e altre), revoca delle sessioni, politica password, limitazione dei tentativi per email e per indirizzo, registro degli eventi di sicurezza, controllo `Origin`, quattro occhi su clausole ed eccezioni, controllo di configurazione per il Manager, controllo di salute, CI e SBOM.

## 10. Come avviare e provare

```
npm install
npm run dev                # senza server: modalità demo locale con dati fittizi
npm run lint && npm run build
npm run test:api           # richiede Postgres locale e psql (vedi tests/run.sh)
```

## 11. Roadmap proposta

1. Interruttore per **attivare moduli uno alla volta**.
2. **Collegamento dell'SSO** al tenant aziendale (il codice c'è) e obbligo per il personale interno; password solo per i fornitori.
3. Revisione di sicurezza dell'IT e correzione di quanto emerge.
4. Aggancio al budget del CIO (import dal suo sistema e restituzione degli impegni futuri).
5. Pilota con pochi utenti su un modulo; poi Task e Fornitori; poi CLM.
6. Firma elettronica; poi eventuali funzioni AI (previa approvazione di IT Security e Legal).
