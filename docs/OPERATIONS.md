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
