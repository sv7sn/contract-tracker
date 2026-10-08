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

Altre protezioni: password con hash `scrypt`, blocco dopo 5 tentativi falliti in 15 minuti, utenti disattivabili con effetto immediato,
storico delle modifiche con autore stabilito dal server, impossibile disattivare o declassare l'ultimo manager.

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
4. Opzionale: `SESSION_SECRET` (stringa casuale lunga) per firmare le sessioni. Se manca, la chiave deriva da `DATABASE_URL`.

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
