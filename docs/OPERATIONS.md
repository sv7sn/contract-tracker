# Procurement Lab — Operatività

Come si pubblica, si controlla, si ripristina e si ruota. Dove una procedura dipende dal piano del fornitore, è indicato.

## 1. Ambienti e rilascio
- **Produzione:** Vercel (funzioni Node.js), database Postgres su Neon, archivio file Vercel Blob (privato).
- **Rilascio:** ogni modifica passa da una pull request su `main`; la CI (`.github/workflows/ci.yml`) esegue lint, build, test e audit. Il deploy parte da `main`.
- **Ritorno indietro:** da Vercel si può riportare in produzione un deploy precedente. Lo schema del database è solo additivo (colonne e tabelle nuove), quindi una versione precedente continua a funzionare.
- **Schema:** si aggiorna da solo all'avvio (`ensureSchema`); non ci sono migrazioni da lanciare.

## 2. Configurazione
Variabili in `.env.example`. Il **Manager** vede in *Configurazione → Sicurezza e configurazione* cosa manca (chiave delle sessioni, controlli giornalieri, email, archivio file, codici SAP, credenziali iniziali ancora presenti, un solo Manager).

### Prima dell'uso reale
- Impostare `DISABLE_DEMO_TOOLS=1` (spegne gli strumenti di prova) e togliere `ADMIN_*` dall'ambiente.
- Verificare in *Configurazione → Sicurezza e configurazione* che non resti nulla in giallo.
- Svuotare i dati di simulazione dalla stessa pagina di Configurazione, se presenti.
- Impostare `SESSION_SECRET` (valore lungo e casuale) e l'invio email (`RESEND_API_KEY`, `MAIL_FROM`, oppure il server di posta aziendale).
- Dati in UE: l'ambiente di prova attuale (Vercel, Neon e Blob) è in regione `iad1` (USA). Per l'uso reale: database e archivio in UE (`fra1`) oppure sui server aziendali; funzioni nella stessa regione del database (`"regions"` in `vercel.json`).
- Account di servizio intestati all'azienda (oggi Vercel e Neon sono su un account personale, piano gratuito; il piano Hobby di Vercel non è previsto per uso aziendale).
- Togliere dall'ambiente Vercel le variabili non usate dal codice (es. `VITE_SUPABASE_*`, `TSC_COMPILE_ON_ERROR`).

### Archivio documenti su Google Cloud Storage (GKE)
Con `STORAGE_PROVIDER=gcs` e `GCS_BUCKET=<nome>` l'app usa Google Cloud Storage invece di Vercel Blob (codice in `api/_blob.ts` e `api/_storage-gcs.ts`). Il browser carica i file con URL firmati V4 (validi 10 minuti, un solo percorso, tipo di file e dimensione massima vincolati dalla firma); la lettura passa sempre dal server, dopo il controllo dei permessi.

Da preparare su Google Cloud:
- **Bucket privato**: accesso uniforme a livello di bucket, *public access prevention* attivo, regione UE. Consigliato il versioning degli oggetti.
- **Identità dell'app** (Workload Identity, nessuna chiave): sul bucket il ruolo `roles/storage.objectAdmin` (lettura, scrittura, eliminazione); sull'account di servizio stesso il ruolo `roles/iam.serviceAccountTokenCreator`, necessario per firmare gli URL senza chiave privata.
- **CORS del bucket**, per il caricamento dal browser (sostituire il dominio):
  ```json
  [{ "origin": ["https://procurement.example.com"], "method": ["PUT"], "responseHeader": ["Content-Type", "x-goog-content-length-range"], "maxAgeSeconds": 3600 }]
  ```
  (`gcloud storage buckets update gs://<bucket> --cors-file=cors.json`)
- **Content-Security-Policy** del server che serve l'app: in `connect-src` va aggiunto `https://storage.googleapis.com` (su Vercel le intestazioni sono in `vercel.json` e restano quelle di Vercel Blob).
- Il **controllo di configurazione** del Manager mostra quale archivio è attivo e se manca `GCS_BUCKET`.

Configurazione su Kubernetes: tutte le impostazioni sono variabili d'ambiente; valori normali in una ConfigMap, riservati in un Secret (o Secret Manager), passati al container con `env`/`envFrom`. Nessun file di configurazione da montare; i segreti non vanno montati come file.

## 3. Monitoraggio
- `GET /api/portal?op=health` risponde `{"ok":true}` se il database è raggiungibile (503 altrimenti): adatto a un controllo di disponibilità esterno.
- Log delle funzioni: pannello Vercel. Eventi di accesso: registro di sicurezza nell'applicazione.
- Un job giornaliero (06:00 UTC) esegue promemoria, conservazione dei dati, aggiornamento liste sanzioni, avvisi e solleciti. Se non parte, il Manager lo vede dal controllo "CRON_SECRET".

## 4. Backup e ripristino
| Dato | Dove | Come si ripristina |
|---|---|---|
| Database | Neon | Ripristino a un istante passato (point-in-time) e rami del database: la finestra dipende dal piano Neon in uso. **Da confermare con il piano reale e da provare** |
| File | Vercel Blob | Non c'è una copia versionata. I file eliminati non si recuperano: valutare una copia periodica verso un altro archivio |
| Codice | GitHub | Cronologia completa |

### Copia e ripristino con gli script del repository
```
DATABASE_URL=postgres://… scripts/backup.sh [cartella]            # copia compressa + impronta SHA-256
TARGET_URL=postgres://…/db_vuoto scripts/restore.sh file.dump      # ripristina in un database VUOTO (rifiuta se non lo è)
TARGET_URL=postgres://… scripts/verify-restore.sh                  # conta le righe delle tabelle principali
SOURCE_URL=… ADMIN_URL=… scripts/restore-drill.sh                  # prova completa: copia, ripristino, confronto di tutte le tabelle
```
**Prova eseguita** (database locale con i dati dei test): 49 tabelle, 120 righe, identiche dopo il ripristino. La prova va **ripetuta sul database reale** (da un ramo o da un database di prova su Neon) prima dell'uso: i volumi reali e la finestra di ripristino del piano Neon non sono stati provati.

**Obiettivi di ripristino** (RPO/RTO): non ancora definiti; vanno fissati con l'IT in base al piano Neon. Nota: le copie contengono dati personali e vanno conservate con le stesse protezioni del database.

## 5. Rotazione dei segreti
- **Chiave delle sessioni (`SESSION_SECRET`):** cambiarla chiude tutte le sessioni. Farlo se si sospetta una fuga.
- **Password dell'amministratore iniziale:** dopo il primo avvio togliere `ADMIN_*` dall'ambiente.
- **Chiavi dei servizi** (Resend, Anthropic, segreti di ricezione SAP e dei job): rigenerarle dal pannello del servizio e aggiornare la variabile.
- **Collegamento al database:** dal pannello Neon; aggiornare `DATABASE_URL`.

## 6. Incidenti
1. **Contenere:** disattivare l'utente interessato (effetto immediato) e, se serve, chiudere le sessioni cambiando `SESSION_SECRET`.
2. **Capire:** registro di sicurezza (accessi, indirizzi, orari), registro modifiche di configurazione, registro delle bozze, log Vercel.
3. **Comunicare:** DPO e IT Security; se ci sono dati personali coinvolti, valutare la notifica entro 72 ore.
4. **Ripristinare** dal punto 4 e **correggere**.

## 7. Dati e uscita
- **Esportazione:** dati di un fornitore (JSON), registro bozze e registro di sicurezza (CSV).
- **Uscita dal servizio:** il database è Postgres standard (`pg_dump`); i file stanno in un archivio a oggetti.
- **Anonimizzazione e conservazione:** vedi `DATA-PROTECTION.md`.
