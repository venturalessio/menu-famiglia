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

`mark_telegram.py` è la fonte. `python3 genera-cloud-config.py` rigenera `cloud-config.yaml`
con il bot dentro. Per un server già acceso il file va copiato in `/opt/mark/` e il servizio
riavviato (`systemctl restart mark-telegram`).

Costo: CX23 5,49 € + IVA al mese più l'IPv4 (prezzi dopo il 15 giugno 2026), più il
consumo di Claude della funzione `mark`, come per la web-app.
