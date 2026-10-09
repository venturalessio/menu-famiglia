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
