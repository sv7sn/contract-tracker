# Procurement Lab — Sicurezza

Controlli presenti nel codice, minacce considerate e limiti noti. Per l'architettura vedi `ARCHITECTURE.md`.

## 1. Controlli

| Area | Controllo |
|---|---|
| **Password** | Hash `scrypt` con sale casuale. Nuove password: almeno 12 caratteri, almeno tre tipi di caratteri, non banali, senza l'email. Valgono per staff e fornitori |
| **Sessioni** | Token firmato HMAC-SHA256 in cookie `HttpOnly`, `SameSite=Lax`, `Secure`; 7 giorni. Il token porta una **versione di sessione**: cambio password, reimpostazione da parte del Manager, cambio di ruolo e "Esci da tutti gli altri dispositivi" invalidano le sessioni aperte. L'utente è riletto dal database a ogni richiesta (disattivazione immediata) |
| **Accessi** | Blocco dopo 5 tentativi falliti in 15 minuti per email e dopo 30 per indirizzo IP. Confronto a tempo costante anche per utenti inesistenti |
| **Richieste da altri siti** | Le richieste con corpo JSON rifiutano `Origin` diverso e `Sec-Fetch-Site: cross-site`; richiedono `Content-Type: application/json`; cookie `SameSite=Lax` |
| **Intestazioni** (`vercel.json`) | `Content-Security-Policy` (script solo dal proprio dominio, nessun frame, nessun oggetto), `Strict-Transport-Security`, `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy` |
| **Autorizzazione** | Applicata dal server: ogni blocco di operazioni dichiara i ruoli ammessi; la visibilità per riga è nelle query. Le bozze di contratto sono riservate (buyer del task, Manager, funzioni invitate); il fornitore vede solo ciò che gli è stato condiviso |
| **Separazione dei compiti** | Vedi §3 |
| **Dati** | Query parametrizzate; dove un frammento SQL è costruito (ruoli e id), contiene solo interi dal database o testo codificato in esadecimale. Nessun `eval` né HTML iniettato; React esegue l'escape |
| **File** | Archivio privato; scarico solo tramite funzione che controlla i permessi; upload con URL firmato per un solo percorso, con limite di tipo e dimensione |
| **Registri** | `audit_log` (contratti), `config_audit` (configurazione), `supplier_events`, `draft_audit` (bozze, esportabile), `notifications` (email), **`security_events`** (accessi riusciti e falliti, blocchi, cambi password, sessioni chiuse; visibile al Manager, esportabile) |
| **Operazioni distruttive** | Svuotamento dei dati ed eliminazione di tutti i contratti: solo Manager, con parola di conferma, registrate nel registro di sicurezza |
| **Strumenti di prova** | Accessi di prova, simulazione del budget e fornitori di prova si spengono con `DISABLE_DEMO_TOOLS=1`; il controllo di configurazione segnala se sono ancora attivi |
| **Avvio concorrente** | La creazione dello schema è protetta da un blocco del database: più istanze che partono insieme non si ostacolano (provato con sei avvii contemporanei) |
| **Segreti** | Solo in variabili d'ambiente; nessun segreto nel repository. Il Manager vede in Configurazione un controllo che segnala quali mancano, senza mostrarne i valori |
| **Dipendenze** | Sei dipendenze di produzione; `npm audit` senza vulnerabilità note; elenco in `SBOM.cdx.json` (CycloneDX); controllo automatico nella CI |
| **Verifica continua** | CI su ogni modifica: lint, build, oltre 700 controlli di integrazione (34 suite), audit delle dipendenze |

## 1 bis. Verifica di sicurezza interna (automatica)

La suite `tests/api/authz.test.mjs` è una verifica ripetibile, eseguita in CI a ogni modifica. **Non è un test di penetrazione indipendente** e non lo sostituisce.

| Cosa controlla | Esito atteso |
|---|---|
| Tutte le operazioni del router (oltre 130, lette dal codice) con ogni ruolo e metodo | Senza accesso rispondono solo invito, attivazione, salute e i passaggi dell'accesso aziendale; il fornitore non raggiunge nulla dello staff; Controlling/CFO, Business Owner, Compliance e IT Security non scrivono; Legal e Finance solo dove previsto |
| Chiamate con dati vuoti, identificativi non validi (`abc`, `-1`, enormi) e testi ostili (SQL, script, percorsi, byte nulli, 5000 caratteri) | Mai un errore del server (500) |
| Un testo con SQL dentro | Salvato così com'è, le tabelle restano |
| Accesso a dati di altri (pratiche, bozze riservate, documenti e trattative di un altro fornitore) | Sempre rifiutato |

La prima esecuzione ha trovato quattro risposte 500 per dati non validi (nessuna falla di accesso), corrette: errori del database dovuti a input sbagliato ora diventano risposte 400/409.

**Non coperto:** analisi dinamica dell'interfaccia, prove su rete e infrastruttura (Vercel, Neon), social engineering, resistenza al sovraccarico, revisione manuale del codice da parte di terzi. Per questi serve un test indipendente.

## 2. Minacce considerate

| Minaccia | Come è mitigata |
|---|---|
| Furto di credenziali o password banali | Politica password, blocchi per email e per IP, registro degli accessi, revoca delle sessioni |
| Sessione rubata | Cookie `HttpOnly`/`Secure`, scadenza a 7 giorni, revoca da parte dell'utente o dopo cambio password |
| CSRF | `SameSite=Lax`, controllo `Origin`, solo JSON |
| XSS | Nessun HTML iniettato; CSP senza script esterni |
| Accesso a dati di altri ruoli | Autorizzazione lato server e per riga; test per ruolo nella suite |
| Fuga di documenti | Archivio privato, scarico tramite funzione con controllo permessi |
| Abuso interno (frodi) | Registri, quattro occhi su clausole ed eccezioni, bozze con pareri obbligatori prima della firma |
| Fornitore che vede dati interni | Condivisione esplicita e riservata; commenti esterni separati; titolo neutro |

## 3. Separazione dei compiti

| Azione | Chi la fa | Chi non può |
|---|---|---|
| Proporre una clausola | Legal, Manager | — |
| Approvare una clausola | Legal, Manager | **Chi l'ha proposta**, se c'è un altro approvatore attivo |
| Registrare un'eccezione al confronto fornitori | Buyer, Manager | — |
| Approvare l'eccezione | Manager | **Chi l'ha registrata**, se c'è un altro Manager attivo |
| Accettare una clausola non ammessa | Legal, Manager | Buyer |
| Dare il parere su una bozza | Funzioni invitate | Buyer e Manager |
| Cambiare ruolo o disattivare utenti | Manager | Sé stesso; l'ultimo Manager |

Se la persona è l'unica a poter decidere (un solo Manager o un solo Legal), la regola non si applica per non bloccare il lavoro: il caso è visibile nel controllo di configurazione ("Un solo Manager").

## 4. Limiti noti

- **SSO non ancora collegato** al provider aziendale: il codice è pronto e provato con un provider simulato, ma finché l'IT non fornisce tenant, client id e segreto si entra con email e password.
- **Nessun test di penetrazione indipendente** né revisione di sicurezza di terzi (vedi §1 bis per la verifica interna).
- **Nessuna autenticazione a due fattori.**
- **Nessun controllo del contenuto dei file** oltre a tipo dichiarato e dimensione.
- **Politica di conservazione dei registri** non definita (restano finché non si eliminano).
- **Il controllo AI dei documenti fornitore**, se attivato, invia i documenti a un servizio esterno (Anthropic).
- **CSP:** `style-src 'unsafe-inline'` è necessario perché l'interfaccia usa stili inline.
- **Upload dei file:** la CSP consente il collegamento ai domini di Vercel Blob; non è stato possibile provare un upload reale in ambiente di test.

## 5. Segnalazione e gestione degli incidenti

Vedi `OPERATIONS.md`.
