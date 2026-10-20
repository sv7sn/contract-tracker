# Procurement Lab — Protezione dei dati

Base per la valutazione del DPO. **Non è un parere legale**: finalità, basi giuridiche e valutazione d'impatto vanno decise dall'organizzazione.

## 1. Dati trattati

| Categoria | Esempi | Interessati | Dove |
|---|---|---|---|
| Utenti interni | nome, email, ruolo, codice utente SAP, hash della password, eventi di accesso e indirizzo IP | dipendenti | `users`, `security_events`, `login_attempts` |
| Referenti dei fornitori | nome, email, telefono, lingua | persone di aziende terze | `suppliers` (JSON), `users` |
| Dati societari e bancari dei fornitori | ragione sociale, partita IVA, indirizzo, IBAN, banca | aziende (e ditte individuali) | `suppliers` |
| Documenti dei fornitori | visura, certificazioni, polizze | aziende | archivio file |
| Contratti e bozze | testo, controparte, valori | aziende; nomi di firmatari | `contracts`, `contract_drafts`, archivio file |
| Registri | chi ha fatto cosa e quando | utenti | `audit_log`, `config_audit`, `draft_audit`, `supplier_events` |
| Email inviate | destinatario, oggetto, testo | utenti e referenti | `notifications` |

Non sono previsti dati particolari (art. 9 GDPR) né dati su minori. I documenti caricati dai fornitori potrebbero contenerne in modo accidentale.

## 2. Fornitori di servizi (responsabili o sub-responsabili)

| Servizio | Cosa riceve | Note |
|---|---|---|
| **Vercel** | Esecuzione dell'applicazione, archivio file (Blob) | Funzioni e archivio file in regione `iad1` (USA est): **trasferimento extra-UE**. Ambiente di prova; per l'uso reale vedi §5 |
| **Neon** | Database | Regione `iad1` (USA est): **trasferimento extra-UE**. La regione di un database Neon non si cambia: per l'uso reale serve un nuovo database in UE (`fra1`) o sui server aziendali |
| **Resend** | Destinatario, oggetto e testo delle email | Servizio di invio |
| **VIES, GLEIF, liste sanzioni, OpenSanctions, openapi.com** | Partita IVA e nome del fornitore | Solo dati di aziende, richieste in uscita |
| **Anthropic** (solo se attivato) | Documenti dei fornitori per il controllo automatico | **Disattivato di default**; da attivare solo dopo approvazione di IT Security e Legal |

## 3. Diritti e conservazione
- **Esportazione** dei dati di un fornitore (JSON) e **anonimizzazione** su richiesta, con motivazione registrata.
- **Conservazione:** configurabile dal Manager (default 24 mesi per i fornitori non completati o inattivi); un job giornaliero la applica.
- **Informativa:** il fornitore la vede e la accetta in registrazione; testo modificabile dal Manager.
- **Registri di sicurezza e di audit:** non hanno ancora un termine di conservazione definito (da decidere).
- **Backup:** vedi `OPERATIONS.md`; l'anonimizzazione non agisce sulle copie di backup.

## 4. Riservatezza interna
Le bozze di contratto sono visibili solo a chi serve (buyer del task, Manager, funzioni invitate); Controlling/CFO, Finance e fornitori non le vedono, salvo la versione condivisa con il fornitore.

## 5. Punti aperti per il DPO
1. Regione dei dati (Vercel e Neon) e basi per eventuali trasferimenti.
2. Accordi con i responsabili (Vercel, Neon, Resend).
3. Valutazione d'impatto (DPIA), se ritenuta necessaria.
4. Termini di conservazione dei registri.
5. Ruolo dei referenti dei fornitori come interessati.
