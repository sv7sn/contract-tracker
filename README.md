# Contract Tracker

Applicazione React + TypeScript (Vite) per il monitoraggio delle scadenze contrattuali del procurement indiretto
e la pianificazione delle attività di rinnovo (analisi spend, coinvolgimento del Business Owner, negoziazione, firma).

## Funzionalità

- **Ruoli demo**: Manager, Buyer e Business Owner, ognuno con viste e permessi dedicati.
- **Lista contratti** con ricerca, filtri per urgenza, ordinamento e archivio dei contratti cessati.
- **Piano attività** generato automaticamente a ritroso dalla data di scadenza (-90 → 0 giorni),
  con date modificabili, motivazione obbligatoria e audit trail.
- **Vista Team** (Manager): carico di lavoro mensile per buyer e suggerimenti di anticipo.
- **Richieste BO**: il Business Owner registra la decisione di rinnovo, che aggiorna lo stato del contratto.
- **Database condiviso**: contratti, piani e storico delle modifiche sono salvati su PostgreSQL tramite le API in `api/`
  (Vercel Functions). Se il database non è raggiungibile l'app passa in modalità locale (dati nel `localStorage`
  del browser, con avviso in alto).

## Architettura

- `src/` – frontend React. `src/api.ts` chiama le API; `src/types.ts` contiene i tipi condivisi.
- `api/state.ts` (GET) legge tutto lo stato, `api/commit.ts` (POST) salva una modifica in una transazione,
  `api/seed.ts` (POST) carica i dati demo **solo se il database è vuoto**.
- `api/_db.ts` – connessione, creazione automatica delle tabelle (`contracts`, `plan_steps`, `audit_log`) e validazione.

## Configurare il database su Vercel

1. Nel progetto Vercel: **Storage → Create Database → Neon (Postgres)** e collegalo al progetto.
2. Vercel imposta da solo la variabile `DATABASE_URL` (in alternativa `POSTGRES_URL`).
3. Rifai il deploy. Al primo avvio le tabelle vengono create e, se vuote, popolate con i dati demo.

> Attenzione: il login è ancora una demo (si sceglie un profilo senza password) e le API non sono protette.
> Prima di inserire dati reali serve un'autenticazione vera (es. Azure AD).

## Sviluppo

```bash
npm install
npm run dev      # frontend in modalità locale (senza API)
npx vercel dev   # frontend + API (richiede DATABASE_URL, es. con `vercel env pull`)
npm run build    # typecheck + build di produzione
npm run lint     # ESLint
```
