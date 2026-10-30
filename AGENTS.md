# Istruzioni per gli assistenti di programmazione (OpenCode e simili)

Leggi questo file prima di modificare il codice. Per il contesto: `CONSEGNA.md` (stato e piano), `docs/ARCHITECTURE.md` (architettura), `docs/SECURITY.md` (controlli di sicurezza).

## Il progetto in breve
Procurement Lab: app web per il procurement indiretto (task e RDA da SAP, fornitori con portale esterno, contratti e rinnovi, bozze e revisioni, budget, spesa, indicatori).
Un solo linguaggio (TypeScript), un solo database (PostgreSQL), nessun framework lato server e nessun ORM.

```
src/            interfaccia React 19 (Vite): views/ pagine, components/ componenti, lib/ logica dell'interfaccia
  i18n/         traduzioni: il testo italiano sta nel codice, l'inglese in i18n/en/*.ts
api/            server: un file senza "_" = una funzione HTTP; con "_" = modulo
  portal.ts     router unico: /api/portal?op=<operazione>, con i controlli di ruolo per blocco di operazioni
  _db.ts        schema del database, connessione, query comuni
  _permissions.ts, _auth.ts, _crypto.ts    permessi, sessioni, hash
  _tasks.ts, _task-steps.ts                task e passaggi
  _portal.ts, _governance.ts, _risk.ts …   fornitori
  _clm*.ts                                 bozze e revisioni
tests/api/      test delle API (uno per area), eseguiti contro un PostgreSQL vero
scripts/        backup, ripristino, controllo delle traduzioni
docs/           documenti per IT e design authority
```

## Comandi
```bash
npm ci                # installa
npm run dev           # interfaccia in modalità demo locale (senza API)
npm run build         # controllo dei tipi (interfaccia e API) + build
npm run lint          # ESLint
npm run format        # formatta il codice (Prettier); npm run format:check per verificare
npm run test:i18n     # ogni testo dell'interfaccia ha la traduzione inglese
npm run test:api      # test delle API (serve PostgreSQL: vedi tests/run.sh, variabile PGADMIN_URL)
```
Prima di considerare finita una modifica devono passare tutti: `format:check`, `lint`, `test:i18n`, `build`, `test:api`. Sono gli stessi controlli della CI (`.github/workflows/ci.yml`).

## Regole da rispettare

### Permessi e sicurezza
- **Ogni controllo di permesso sta nel server** (`api/`). Nascondere un pulsante nell'interfaccia non basta e non sostituisce il controllo.
- Una nuova operazione in `api/portal.ts` va messa nel blocco del ruolo giusto e aggiunta alle liste attese di `tests/api/authz.test.mjs`.
- L'autore di una modifica lo decide il server (dall'utente della sessione), mai il dato inviato dal browser.
- Nessun segreto nel codice: le impostazioni sono variabili d'ambiente, elencate (vuote) in `.env.example`.
- Gli strumenti di prova passano da `demoOnly()` in `api/portal.ts`, così si spengono con `DISABLE_DEMO_TOOLS=1`.

### Database
- Lo schema è in `api/_db.ts` (`ensureSchema`): solo istruzioni idempotenti (`create table if not exists`, `alter table … add column if not exists`, `create index if not exists`). Mai `drop` o cambi distruttivi su dati esistenti.
- Lo schema si riapplica solo quando cambia (impronta salvata in `settings.schema_hash`), con un blocco che evita due avvii contemporanei.
- SQL scritto a mano con parametri (`$1`, `$2`): mai concatenare valori dell'utente nella query.
- Più scritture che devono riuscire insieme: `inTransaction(...)`.

### Codice condiviso tra server e interfaccia
- Le regole usate da entrambi (passaggi dei task, regole dei fornitori, permessi, CLM) stanno in `api/` e l'interfaccia le importa (es. `src/supplierRules.ts` riesporta `api/_supplier-rules.ts`). Non duplicarle.
- Nei file di `api/` gli import locali usano l'estensione `.js` (`./_db.js`), non `.ts`: su Vercel la funzione altrimenti non parte.

### Testi e traduzioni
- I testi dell'interfaccia si scrivono in italiano dentro `t("...")` (o `tc("contesto", "...")` quando la stessa parola ha due significati). Valori variabili con `{nome}`: `t("{n} giorni", { n })`. Mai template literal dentro `t()`.
- Ogni nuovo testo va aggiunto in inglese in `src/i18n/en/<area>.ts` con il testo italiano come chiave. I dizionari devono restare JSON valido (chiavi tra virgolette doppie): sono esclusi dalla formattazione automatica.
- Messaggi d'errore del server: `new HttpError(codice, "testo")` o `HttpError.t(codice, "testo {x}", { x })`; anche questi vanno tradotti.
- Non chiamare `t` una variabile locale: nasconderebbe la funzione di traduzione.
- Commenti nel codice e messaggi di commit in italiano.

### Interfaccia
- Stili con i valori del tema (`C`, `sans`, `font`, `radius` in `src/theme.ts`) e i componenti di `src/components/ui.tsx`.
- Le pagine elenco (Task, Contratti, Fornitori) usano la stessa intestazione `src/components/ListHeader.tsx`: numeri che filtrano, poi ricerca, filtri e "+ Nuovo". Una nuova pagina elenco segue lo stesso schema.
- L'app deve funzionare anche dal telefono: classi `mobile-only`, `desktop-only`, `desktop-only-flex` in `src/index.css`. Verificare sempre entrambe le larghezze.
- Colori di stato con parsimonia: in una riga un solo segnale (bordo o giorni di ritardo), non tutto rosso.

### Test
- Una nuova funzione del server ha i suoi controlli in `tests/api/<area>.test.mjs` (permessi compresi: chi può e chi no).
- Cinque suite usano export SAP reali che non sono nel repository: senza `SAP_SAMPLES` vengono saltate.

### Documentazione
- Una modifica che cambia comportamento, configurazione o sicurezza aggiorna anche `README.md` e il documento giusto in `docs/` (e `.env.example` per una nuova variabile).

## Cosa non fare
- Non aggiungere dipendenze di produzione senza motivo: oggi sono sei, ed è una scelta (elenco in `docs/SBOM.cdx.json`).
- Non disattivare test o controlli per far passare una modifica.
- Non modificare dati di produzione con script: le correzioni passano dal codice e dai test.
- Non rimuovere i controlli di quattro occhi (eccezioni al confronto, clausole) né il blocco della firma senza i pareri richiesti.
