# Contract Tracker

Applicazione React + TypeScript (Vite) per il monitoraggio delle scadenze contrattuali del procurement indiretto
e la pianificazione delle attività di rinnovo (analisi spend, coinvolgimento del Business Owner, negoziazione, firma).
Funziona da telefono e da computer (menu laterale e griglie a più colonne su schermi larghi).

## Accesso e permessi

L'accesso avviene con **email e password**. La sessione è un cookie `HttpOnly` firmato, valido 7 giorni.
I permessi sono **controllati dal server** (`api/_permissions.ts`, `api/_db.ts`): l'interfaccia nasconde i comandi non consentiti,
ma sono le API a rifiutare comunque le richieste non autorizzate.

| Ruolo | Cosa vede | Cosa può fare |
|---|---|---|
| **Manager** | tutti i contratti, vista Team, utenti | crea/modifica/elimina contratti, assegna gli owner, gestisce piani e utenti |
| **Buyer** | solo i contratti di cui è *contract owner* | crea contratti (assegnati a lui), modifica contratti e piani propri |
| **Business Owner** | solo i contratti con la sua email come BO | registra la propria decisione di rinnovo (nient'altro) |

Gli utenti si gestiscono da **Utenti** (solo manager): crea, modifica ruolo e funzione, reimposta la password, disattiva/riattiva, elimina.
Per non lasciare contratti senza responsabile, un utente **non si può eliminare** (né rendere Business Owner) finché è contract owner
o Business Owner di qualche contratto: riassegna prima i contratti, oppure disattivalo (perde l'accesso ma lo storico resta).

Altre protezioni: password con hash `scrypt`, blocco dopo 5 tentativi falliti in 15 minuti, utenti disattivabili con effetto immediato,
storico delle modifiche con autore stabilito dal server, impossibile disattivare o declassare l'ultimo manager.

## Onboarding fornitori

Il Buyer invita un fornitore (Fornitori → Invita fornitore): il fornitore riceve un link personale monouso, crea la password ed entra nella **sua area** dove compila anagrafica, indirizzo, coordinate bancarie, contatti e carica i documenti di qualifica (con scadenza). Flusso: *Buyer verifica e sceglie le condizioni di pagamento → Finance registra in SAP → il fornitore riceve il codice*. Buyer e Finance possono rifiutare o chiedere modifiche con motivo; un fornitore già registrato può aggiornare dati e documenti da solo, e la modifica torna in verifica.

- **SAP**: con `SAP_MODE=simulated` (default) il codice fornitore è fittizio, per provare il flusso. Per la creazione reale impostare `SAP_MODE=http`, `SAP_ENDPOINT` (e `SAP_TOKEN`); conti di riconciliazione e società vanno inseriti in *Configurazione* (solo Manager).
- **Email**: senza `RESEND_API_KEY` e `MAIL_FROM` i messaggi sono solo registrati; il link d'invito si può copiare e inviare a mano.
- Non ancora coperti: dati fiscali brasiliani, fornitore già esistente in SAP (estensione società), promemoria automatici di scadenza dei documenti.

## Architettura

```
src/            frontend React
  views/        una vista per schermata (Dashboard, Contratti, Piano, Team, Utenti, ...)
  components/   login, finestre di dialogo, elementi grafici condivisi
  lib/          formattazione, logica di pianificazione, dati demo (fittizi)
api/            Vercel Functions (Node.js) su PostgreSQL
  _permissions.ts  regole di accesso (usate anche dal frontend)
  _db.ts           schema (creato in automatico), query, validazione, controlli sui permessi
  _crypto.ts       hash password e token di sessione
  state | commit | login | logout | me | password | users | purge
  upload | document  caricamento e consegna dei documenti dei contratti (archivio Blob privato)
```

Se le API non sono raggiungibili (es. `npm run dev`) l'app parte in **modalità demo locale**: dati fittizi salvati nel browser
e account di prova (password `demo1234`, indicata nella schermata di accesso).

## Configurazione su Vercel

1. **Database**: nel progetto Vercel aggiungi un database Postgres (Neon dal Marketplace) e collegalo al progetto: imposta `DATABASE_URL`.
2. **Primo amministratore**: aggiungi in *Settings → Environment Variables*:
   - `ADMIN_EMAIL` – email del primo manager
   - `ADMIN_PASSWORD` – password iniziale (minimo 8 caratteri)
   - `ADMIN_NAME` – opzionale, nome mostrato (default "Amministratore")
3. Rifai il deploy. Al primo avvio vengono create le tabelle e, **solo se non esiste nessun utente**, l'amministratore.
   Poi entra e crea gli altri utenti da **Utenti → Nuovo utente**. Le variabili `ADMIN_*` non vengono più usate dopo il primo avvio:
   puoi rimuoverle.
4. **Documenti dei contratti**: nel progetto Vercel crea un archivio **Blob** e collegalo al progetto (Vercel imposta `BLOB_STORE_ID`
   e usa l'accesso OIDC; con archivi più vecchi funziona anche `BLOB_READ_WRITE_TOKEN`).
   **Deve essere PRIVATO** (la scelta Public/Private si fa alla creazione e non si può cambiare): i contratti non devono avere link pubblici.
   I file (PDF, DOC, DOCX, max 25 MB) vengono caricati direttamente dal browser nell'archivio e riletti solo tramite `/api/document`,
   che controlla i permessi dell'utente. Senza archivio l'app funziona ma non salva i documenti.
5. Opzionale: `SESSION_SECRET` (stringa casuale lunga) per firmare le sessioni. Se manca, la chiave deriva da `DATABASE_URL`.

Non esistono account predefiniti con password note: senza `ADMIN_*` il sito mostra "Nessun utente configurato".

## Sviluppo

```bash
npm install
npm run dev      # frontend in modalità demo locale (senza API)
npm run build    # typecheck (app + api) e build di produzione
npm run lint     # ESLint
```

Per provare anche le API in locale serve un PostgreSQL e `vercel dev` con `DATABASE_URL`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` impostate.

> Nota tecnica: i file in `api/` importano gli altri con estensione `.js` (`./_db.js`): Vercel compila i `.ts` in `.js`
> senza riscrivere gli import, quindi con `.ts` la funzione fallirebbe all'avvio.
