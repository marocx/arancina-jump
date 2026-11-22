# Account: nome utente e password

## Come funziona

- In alto a destra ci sono i pulsanti **Accedi / Registrati**. Per giocare serve un account.
- **Nome utente**: 3–14 caratteri (lettere, numeri, `_`). È unico anche senza distinguere maiuscole e minuscole, non può contenere parolacce e non si può cambiare. È anche il nome che vedono gli altri giocatori.
- **Password**: 6–72 caratteri. Viene salvata solo come hash (scrypt), mai in chiaro.
- Dopo 20 tentativi di accesso o registrazione dallo stesso indirizzo, il server blocca i tentativi per 15 minuti.
- Il tasto **Esci** chiude la sessione.

## Configurazione sul server

| Variabile | Cosa è |
|---|---|
| `SESSION_SECRET` | Stringa lunga e casuale che firma le sessioni (es. `openssl rand -hex 32`). Senza, le sessioni si azzerano a ogni riavvio. |

Esempio: `SESSION_SECRET=... npm start`

## Dati

- Account e progressi: `data/accounts.json` (creato automaticamente).
- Su piattaforme con disco temporaneo (Heroku, Render free, ecc.) il file si perde a ogni deploy: serve un disco persistente o un database.
- Fai una copia di `data/` per non perdere gli account.

## Profili

- Premi **E** vicino a un giocatore per vedere la sua mini scheda: nome, altezza migliore, pestate, checkpoint e oggetti equipaggiati.
- Il nome sopra il personaggio degli altri appare solo quando sei vicino.
