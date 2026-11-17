# Mark sull'Echo: la skill Alexa privata

Dici **"Alexa, chiedi a Mark che impegni ho domani"** e risponde Mark (stessa memoria e stesse regole di Siri:
i comandi alla casa vogliono il tuo "sì"). Se Mark ci mette più di 6-7 secondi, l'Echo dice
"Ci sto pensando, te lo dico tra poco" e poco dopo ti dà la risposta con un annuncio. Se è lunga, il resto arriva su Telegram.

La skill resta in "Sviluppo": la vedi solo tu, sul tuo account Amazon, e non serve l'approvazione di Amazon.

## Cosa fai tu (15-20 minuti, dal browser)

1. Apri https://developer.amazon.com/alexa/console/ask ed entra con **lo stesso account Amazon dell'Echo Dot**
   (la prima volta chiede di creare il profilo sviluppatore: è gratis).
2. **Create Skill**
   - Name: `Mark` · Primary locale: **Italian (IT)**
   - Experience: **Other** · Model: **Custom** · Hosting: **Provision your own**
   - Template: **Start from Scratch** → **Create skill**
3. Nel menu a sinistra: **Interaction Model → JSON Editor**. Cancella tutto, incolla il contenuto di
   `modello-interazione.json`, poi **Save** e **Build skill**. Aspetta "Build successful" (1-2 minuti).
4. **Endpoint** (menu a sinistra)
   - Scegli **HTTPS**
   - Default Region: `https://eameewqpwdanexplsbcp.supabase.co/functions/v1/mark-alexa`
   - Certificato: **"My development endpoint is a sub-domain of a domain that has a wildcard certificate from a certificate authority"**
   - **Save**
5. In alto, copia lo **Skill ID** (inizia con `amzn1.ask.skill.`) e incollalo nel thread. Non è un segreto:
   lo metto io dentro Mark, così la funzione accetta solo la tua skill.
6. Scheda **Test** in alto: metti "Skill testing is enabled in" su **Development**.

Fatto. Prova: "Alexa, apri Mark" oppure "Alexa, chiedi a Mark che impegni ho domani".

## Da sapere

- Chiunque parli al tuo Echo può fare domande a Mark (come con Siri sul tuo iPhone): agenda, mail, casa.
  I comandi alla casa chiedono sempre conferma.
- Le risposte lente usano Voice Monkey (piano gratis: 200 annunci al mese, condivisi con gli altri annunci di Mark).
- Se hai più Echo in Voice Monkey, dimmi su quale vuoi le risposte lente (di base: il primo, come gli altri annunci).
- La memoria di 15 minuti è la stessa di Siri: puoi iniziare su Siri e continuare sull'Echo.
- "Alexa, chiedi a Mark nuova conversazione" azzera la memoria.

## Come funziona (per chi tocca il codice)

`supabase/functions/mark-alexa/` (deploy con verify_jwt **false**: Alexa non sa mandare il JWT).
1. Controlla la firma di Amazon (certificato su s3.amazonaws.com/echo.api, nome echo-api.amazon.com, catena,
   firma RSA-SHA256 del corpo, richiesta di meno di 150 secondi) e l'ID della skill (`ID_SKILL` o secret `ALEXA_SKILL_ID`).
   Senza ID configurato rifiuta tutto.
2. Gira la frase alla funzione `mark` (azione `siri`, con `MARK_ACCESS_KEY`), aspetta 6,5 s;
   oltre, risponde "ci penso" e consegna dopo con Voice Monkey + coda `mark_avvisi_coda` (fonte `alexa`).
Test: `deno test -A tests/alexa.test.mjs`.
