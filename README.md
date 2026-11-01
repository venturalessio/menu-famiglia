# Menù di famiglia

Web-app per iPhone che pianifica colazioni, pranzi e cene della settimana e prepara la lista della spesa condivisa.

## Cosa fa
- **Famiglia condivisa:** due account, una sola famiglia (si entra con un codice di 6 caratteri).
- **Settimana:** per ogni giorno feriale si segna se gli adulti pranzano a casa, portano il pranzo o mangiano fuori; l'AI propone tutti i pasti (cene feriali entro 30 minuti, weekend più elaborato).
- **Piatti:** ingredienti, passaggi, "proponimi un'altra cosa", preferiti che vengono riproposti più spesso.
- **Spesa:** lista generata dal menù, raggruppata per reparto, senza i prodotti della dispensa base; si spunta in tempo reale da due telefoni.
- **Imprevisti:** "Stasera pizza o asporto" sposta le cene in avanti di un giorno; "Bimba a casa" aggiunge un pranzo di riserva fatto con ingredienti a lunga conservazione.

## Come è fatta
- HTML, CSS e JavaScript senza build: `index.html`, `style.css`, `app.js`, `config.js`.
- Dati e accessi: Supabase (progetto `menu-famiglia`), con regole di accesso per famiglia (`supabase/migrations`).
- AI: funzione Supabase `genera-menu` (`supabase/functions/genera-menu`) che chiama Claude Sonnet 5.5. La chiave Anthropic è un secret di Supabase e non è mai nell'app.
- Pubblicazione: GitHub Pages.

## Configurazione (una volta sola)
1. **Chiave Anthropic:** crea una chiave su console.anthropic.com e imposta un tetto di spesa mensile. In Supabase: *Edge Functions → Secrets* → aggiungi `ANTHROPIC_API_KEY`.
2. **Indirizzo dell'app per le mail di conferma:** in Supabase: *Authentication → URL Configuration* → *Site URL* = indirizzo GitHub Pages dell'app.
3. **Su iPhone:** apri l'indirizzo in Safari → Condividi → *Aggiungi alla schermata Home*.
4. Il primo che entra tocca *Crea la famiglia*; l'altra persona si registra e usa il codice mostrato in *Famiglia*.

## Mark (cartella `mark/`)
Web-app per iPhone che fa da faccia al sistema di agenti "Mark": mostra Bacheca, Diario e pagine del quartier generale in Notion, e permette di parlare con Mark a voce o per iscritto.
- Indirizzo: `https://venturalessio.github.io/menu-famiglia/mark/`
- Funzione Supabase `mark` (`supabase/functions/mark`): legge Notion, risponde con Claude Sonnet 5.5 e scrive le richieste in Bacheca.
- Secret in Supabase (*Edge Functions → Secrets*): `ANTHROPIC_API_KEY` (già presente), `NOTION_TOKEN` (integrazione interna Notion collegata alla pagina "Mark – quartier generale"), `MARK_ACCESS_KEY` (chiave personale chiesta dall'app al primo accesso).

### Casa (Shelly e Alexa)

La chat di Mark comanda la casa se su Supabase ci sono i secret facoltativi:
`SHELLY_AUTH_KEY` e `SHELLY_SERVER` (app Shelly → Impostazioni utente → Chiave cloud di autorizzazione)
e `VOICEMONKEY_TOKEN` (console Voice Monkey → API Tokens). Shelly: luci, prese, relè e tapparelle.
Alexa: routine create con Voice Monkey (per esempio Tado) e annunci sugli Echo.
Serrature, allarmi e cancelli chiedono sempre conferma. L'azione `casa` verifica i collegamenti senza comandare nulla.

### Siri

Azione `siri` della funzione: riceve `{ action: "siri", testo }` e risponde `{ risposta, continua }`.
La conversazione resta 15 minuti nella tabella `mark_siri` (solo service role, RLS senza policy).
I comandi alla casa da Siri partono solo se l'ultimo messaggio è una conferma ("sì", "ok", "confermo"...).
Il comando dell'app Comandi è descritto in `/mnt/project-files/mark/siri-comando.md` (cartella del progetto Claude).

### Prezzi e Pensatore

Per i prezzi Mark cerca online (Amazon.it più almeno un altro negozio) e, se Alessio vuole comprare, salva il link in Bacheca con `manda_link`. Mark non compra mai e non chiede dati di pagamento.
Le domande difficili (account di Alessio, più fonti, ragionamenti in più passi) passano con `chiedi_al_pensatore` all'attività Claude Code "Mark – Pensatore", avviata dall'API delle attività programmate. L'attività va creata dal sito claude.ai/code/routines: quelle create da un progetto Claude rifiutano l'avvio via API (403 "this project is paused"). Se l'avvio non riesce, la domanda resta in Bacheca (A = Pensatore). Il Pensatore usa i connettori del progetto, le skill e più agenti, poi risponde in Bacheca e nella pagina Notion "Risposte del Pensatore".
Secret facoltativi: `PENSATORE_ID` (l'ID `trig_...` dell'attività) e `PENSATORE_TOKEN` (il suo token API). Limiti: 30 avvii all'ora per l'attività.

### Link, fonti e diario (1/11/2026)

- Mark apre le pagine web con `web_fetch` (i link che Alessio gli dà, o la pagina giusta trovata con `web_search` su un sito).
- Fonte principale: la pagina Notion "Stato di oggi", riscritta ogni giorno da Capo-squadra e Chiusura serale e aggiornata dal Pensatore. Vale più delle note vecchie in Bacheca.
- Orari degli agenti: letti dal database Agenti (campo Quando), non più scritti nel codice.
- Velocità: la parte fissa del prompt è in cache da Anthropic (`cache_control`); su Siri il contesto è corto (Stato di oggi, messaggi aperti, agenti).
- "Ricordati che…": strumento `ricorda`, salva i fatti detti da Alessio nello Stato di oggi o in Chi è Alessio.
- Bacheca: stato `Letto`, pulsante "Letto" in Oggi (azione `letto`).
- Diario delle conversazioni: tabella `mark_log` (solo service role, RLS senza policy) con domanda, risposta, strumenti, tempo, errori e voto 👍/👎 (azione `voto`). L'Architetto la legge ogni sera.

### Promemoria, calendario e posta (1/11/2026)

- **Promemoria e cose da fare**: "ricordami alle 18 di…" crea una riga in `mark_promemoria`. Il job `mark-promemoria` di pg_cron controlla ogni minuto e, solo se c'è qualcosa di scaduto, chiama la funzione con `action: "scadenze"`, che manda l'avviso sul telefono (Web Push), su Alexa (annuncio sul primo Echo di Voice Monkey) o su entrambi. Ripetizioni: giorno, feriali, settimana, mese. Nella web-app la lista è in Oggi, con il bottone Fatto.
- **Notifiche sul telefono**: servono i secret `MARK_VAPID_PUBLIC` e `MARK_VAPID_PRIVATE`. Si generano nella web-app (Oggi → Genera le chiavi, nel browser) e si incollano su Supabase. Poi sull'iPhone, con Mark aperto dalla schermata Home: Oggi → Attiva notifiche. Le iscrizioni stanno in `mark_push`.
- **Calendario**: lo strumento `calendario` legge in diretta i calendari iCloud. I link privati restano nella scheda Notion del Capo-squadra e la funzione li legge da lì.
- **Posta**: `posta_cerca` e `posta_leggi` leggono Gmail in sola lettura via IMAP. Servono i secret `GMAIL_INDIRIZZO` e `GMAIL_PASSWORD_APP` (password per le app di Google).
- **Controllo**: `action: "salute"` (senza chiave personale) dice solo se calendario, Gmail, notifiche e promemoria funzionano, senza mostrare dati.
