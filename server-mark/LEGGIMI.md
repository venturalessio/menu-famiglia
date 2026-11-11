# Mark su Telegram (tappa 1)

Mark risponde su Telegram, a testo e a note vocali, con lo stesso cervello della web-app
(funzione `mark` su Supabase, azione `chat`). Gira su un server Hetzner tutto suo, separato
da `filo-whatsapp`.

## Come funziona

- `mark_telegram.py` chiede a Telegram i messaggi nuovi (nessuna porta aperta sul server).
- Le note vocali si trascrivono sul server con faster-whisper (modello `small`, italiano):
  l'audio non esce dal server.
- Il testo va alla funzione `mark` con la chiave di Mark, come fa la web-app. Mark ricorda
  la conversazione per 15 minuti; `/nuova` ricomincia da capo.
- Risponde solo alla chat che ha scritto per prima la parola di abbinamento. Chiunque altro
  viene ignorato. I messaggi più vecchi di 10 minuti (servizio spento) non si eseguono.
- Regole di casa, serrature e allarmi: sono quelle della web-app, decise dalla funzione.

## Avvisi da evento (tappa 3)

- Ogni 10 minuti, dalle 7 alle 22, il bot chiama l'azione `sentinella` della funzione `mark`.
- La funzione guarda le mail Gmail arrivate dopo l'ultima vista e i cambiamenti di oggi e domani
  (calendari iCloud + eventi e accompagnamenti di Filo). Senza novità non chiama Claude.
- Con novità, Claude Haiku decide cosa merita un avviso (persone, scuola, scadenze, eventi spostati;
  niente newsletter o pubblicità) e il bot lo manda con 🔔. Di notte le novità aspettano il mattino.
- Stato in `public.mark_sentinella`; ogni giro con avvisi finisce in `mark_log` (canale `sentinella`).
- Lavoro (Outlook, Teams, calendario di lavoro): un'attività programmata del progetto, "Mark · Sentinella lavoro (M365)", gira ogni ora dalle 8 alle 18, lunedì-giovedì. Mette gli avvisi, brevi e senza dati dei clienti, nella tabella `public.mark_avvisi_coda` con la funzione `public.mark_m365_avvisi`; la sentinella li inoltra al giro successivo.
- `/avvisi_off` mette in pausa, `/avvisi_on` riattiva.

## Sicurezza del server

- Firewall: nessuna connessione in entrata. Accesso con password da SSH spento: si entra solo
  dalla console web di Hetzner.
- Aggiornamenti di sicurezza automatici ogni giorno, riavvio se serve alle 4:30.
- Il servizio gira come utente `mark` senza privilegi; le chiavi stanno in
  `/etc/mark/mark.env` (leggibile solo da root e da `mark`).

## Creazione (dal telefono, circa mezz'ora)

1. **Telegram, il bot.** Cerca `@BotFather` (spunta blu) > Avvia > scrivi `/newbot` >
   nome `Mark` > nome utente che finisce in `bot` (es. `mark_alessio_bot`).
   BotFather ti manda il token: tocca per copiarlo.
2. **Il testo.** Apri `cloud-config.txt` e copialo tutto. Cambia solo le tre parole in
   MAIUSCOLO in alto: il token di BotFather, la chiave di Mark (quella della web-app) e una
   parola di abbinamento scelta da te.
3. **Hetzner.** console.hetzner.com > il tuo progetto > Crea server:
   posizione Germania o Finlandia, immagine **Ubuntu 24.04**, tipo **CX23** (vCPU condivisa
   x86, cost-optimized), IPv4 e IPv6 attivi, nessuna chiave SSH, niente volumi o backup.
   Nel riquadro **Cloud config** incolla il testo. Nome `mark`. Crea e acquista.
4. **Attesa.** Il server si prepara da solo in 10-15 minuti (scarica il modello per le note
   vocali).
5. **Abbinamento.** Su Telegram apri il tuo bot e scrivi la parola di abbinamento.
   Mark risponde "Ciao Alessio, sono Mark".

Se dopo 20 minuti non risponde: Hetzner > server `mark` > Console (`>_`), entra come `root`
con la password arrivata per mail e scrivi `systemctl status mark-telegram`; manda una foto
dello schermo nel thread.

## Modifiche

`mark_telegram.py` è il bot, `installa.sh` prepara il server. `cloud-config.yaml` contiene
solo le chiavi e scarica `installa.sh` e il bot da GitHub a un commit fisso (un testo lungo si
rovinava copiandolo dal telefono). Dopo una modifica, aggiornare il commit in `cloud-config.yaml`.
Il registro dell'installazione è in `/var/log/mark-installa.log`. Per un server già acceso: dalla console di Hetzner `aggiorna-mark <versione>` (es. `aggiorna-mark mark-v3`); le versioni sono rami del repository.

Costo: CX23 5,49 € + IVA al mese più l'IPv4 (prezzi dopo il 15 giugno 2026), più il
consumo di Claude della funzione `mark`, come per la web-app.

## Biblioteca (dal 11/11/2026)

Il bot controlla ogni minuto se c'è un link da studiare (tabella `mark_biblioteca`, lo mette in coda lo strumento `impara_da_link` della chat).
- YouTube: sottotitoli con yt-dlp; se mancano, audio trascritto qui (primi 30 minuti); se YouTube blocca il server, sottotitoli da Apify (`pintostudio~youtube-transcript-scraper`, circa 0,01 $ a video).
- Instagram: post e reel da Apify (`apify~instagram-post-scraper`), audio trascritto qui, 6 fotogrammi o le slide del carosello.
- Pagine web: le legge la funzione con web_fetch.
Serve `APIFY_TOKEN=...` in /etc/mark/mark.env. La scheda va nella tabella e come pagina figlia di "Biblioteca di Mark" su Notion; l'avviso arriva su Telegram (silenzioso di notte).
