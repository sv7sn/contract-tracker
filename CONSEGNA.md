# Procurement Lab — Nota di consegna

**Cosa si chiede:** approvazione del progetto e di un'**installazione pilota sui server aziendali**.
Non si chiede l'approvazione per la produzione: le condizioni per arrivarci sono elencate qui sotto e sono già pianificate.

## 1. Cos'è e in che stato è
Applicazione web per l'ufficio acquisti (procurement indiretto): segue una pratica dalla richiesta d'acquisto SAP (RDA) al fornitore, al contratto e al rinnovo. Moduli: Task, Contratti, Fornitori (con portale per i fornitori), Budget, Spesa, CLM (bozze e revisioni), Indicatori.

**Stato: prototipo funzionante**, provato dall'ufficio acquisti in un **ambiente di prova** con dati fittizi o non significativi. Nessun dato aziendale rilevante è presente nell'ambiente di prova; verrà comunque cancellato al passaggio sui server aziendali.

| Dove guardare | Contenuto |
|---|---|
| `README.md` | Funzioni, ruoli e permessi, configurazione, sviluppo |
| `docs/ARCHITECTURE.md` | Architettura, scelte di fondo, integrazioni, **limiti dichiarati** (§9) |
| `docs/SECURITY.md` | Controlli di sicurezza, minacce considerate, separazione dei compiti, limiti noti |
| `docs/OPERATIONS.md` | Rilascio, configurazione, monitoraggio, backup e ripristino, segreti, incidenti |
| `docs/DATA-PROTECTION.md` | Dati personali trattati, fornitori di servizi, conservazione, punti aperti per il DPO |
| `docs/SBOM.cdx.json` | Elenco delle dipendenze di produzione (CycloneDX) |
| `AGENTS.md` | Regole del progetto per chi modifica il codice, anche con un assistente di programmazione (OpenCode) |

## 2. Come si verifica
```bash
npm ci
npm run format:check  # formattazione uniforme (Prettier)
npm run lint          # ESLint
npm run test:i18n     # traduzioni complete (italiano / inglese)
npm run build         # controllo dei tipi TypeScript (interfaccia e API) e build
npm run test:api      # 36 suite, 725 controlli sulle API (serve PostgreSQL locale, vedi tests/run.sh)
npm audit --omit=dev  # vulnerabilità note delle dipendenze di produzione
```
Gli stessi controlli girano in automatico a ogni modifica (`.github/workflows/ci.yml`). Alla consegna: **tutti superati, 0 vulnerabilità note**.

## 3. Punti aperti e come si chiudono
| # | Punto | Stato oggi | Come si chiude | Quando |
|---|---|---|---|---|
| 1 | **Dove stanno i dati** | Ambiente di prova su Vercel e Neon, regione USA (`iad1`) | Database e archivio file sui server aziendali (o cloud aziendale in UE) | Fase 1 |
| 2 | **Account dei servizi** | Account personali, piani gratuiti, usati solo per il prototipo | Nessun account personale in produzione: tutto su infrastruttura e account aziendali | Fase 1 |
| 3 | **Dipendenza da Vercel** | Funzioni, archivio file e job giornaliero sono servizi Vercel | Pacchetto Docker: server Node.js autonomo, archivio file configurabile (cartella o S3), job giornaliero interno. Il database è già PostgreSQL standard | Fase 1 |
| 4 | **Accesso e due fattori** | Email e password (hash scrypt, blocco dopo tentativi falliti) | Accesso con account aziendale (OpenID Connect) già realizzato e spento: si attiva con i dati dell'applicazione registrata dall'IT; i due fattori arrivano dal sistema aziendale | Fase 2 |
| 5 | **Verifica di sicurezza indipendente** | Verifica interna automatica e ripetibile (`SECURITY.md` §1 bis) | Test di penetrazione prima dell'apertura del portale fornitori | Fase 3 |
| 6 | **Componenti scritti in proprio** | Accesso aziendale (OpenID Connect), sessioni firmate e generazione dei file Word senza librerie esterne, per tenere le dipendenze al minimo (sei in produzione) | Revisione mirata nel test di sicurezza; sostituibili con librerie standard se la sicurezza IT lo preferisce | Fase 3 |
| 7 | **Stile del codice** | Formattazione uniforme con Prettier, verificata a ogni modifica insieme a ESLint | Fatto | Fatto |
| 8 | **Test dell'interfaccia** | Test automatici sulle API e sulle regole; interfaccia provata a mano su PC e telefono | Test automatici dei percorsi principali nel browser | Fase 2 |
| 9 | **Aggiornamenti del database** | Schema aggiornato all'avvio con istruzioni idempotenti, senza versioni numerate | Accettabile per il pilota; migrazioni numerate se richieste dalle regole IT | Da concordare |
| 10 | **Firma elettronica, SAP in tempo reale, revisione in Word** | Non realizzati (SAP oggi tramite file) | Fasi successive, da concordare con IT e Legal | Dopo il pilota |

## 4. Piano proposto
- **Fase 1 — Pilota sui server aziendali:** pacchetto Docker, database e file in azienda, email dal server di posta aziendale, strumenti di prova spenti, ambiente di prova cancellato.
- **Fase 2 — Accesso aziendale:** accesso con account aziendale e due fattori, test automatici dell'interfaccia.
- **Fase 3 — Apertura ai fornitori:** test di sicurezza indipendente, poi apertura del portale fornitori.

## 5. Manutenzione
Il codice è stato sviluppato con il supporto di un assistente di programmazione AI, sotto la responsabilità dell'ufficio acquisti, che ha definito requisiti e regole e ha provato le funzioni. Ogni modifica passa dagli stessi controlli automatici del punto 2. La manutenzione futura e le regole per le modifiche (chi approva, dove sta il codice) sono da concordare con l'IT nel passaggio alla Fase 1.
