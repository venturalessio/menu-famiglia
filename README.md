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
