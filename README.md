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
- **Persistenza locale**: i dati vengono salvati nel `localStorage` del browser. Dalla schermata di login
  è possibile ripristinare i dati demo.

## Sviluppo

```bash
npm install
npm run dev      # server di sviluppo
npm run build    # typecheck + build di produzione
npm run lint     # ESLint
```
