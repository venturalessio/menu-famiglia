// Voce Gemini del pannello: Gemini Live fa da bocca e orecchie, Mark resta il cervello.
// Funzioni pure: le prova tests/voce.test.mjs. La chiave Gemini resta qui sul server:
// al pannello arriva solo un token temporaneo, già bloccato su questa configurazione.

export const MODELLO_VOCE = "gemini-3.8-live";
export const VOCE_PREDEFINITA = "Orus";
export const URL_TOKEN = "https://generativelanguage.googleapis.com/v1beta/auth_tokens";

// La regola che conta: Gemini non fa e non conferma nulla da solo, passa tutto a Mark.
export function istruzioniVoce(oggi: string): string {
  return [
    "Sei Mark, l'assistente personale di Alessio, ispirato a Jarvis di Iron Man.",
    "Parli sempre in italiano, con tono calmo, educato e un filo ironico. Risposte brevi: due o tre frasi, poi ti fermi.",
    `Oggi è ${oggi}, ora di Roma.`,
    "REGOLA PIÙ IMPORTANTE. Tu sei solo la voce: non hai accesso a niente della vita di Alessio e non puoi fare azioni.",
    "Per qualsiasi cosa che riguarda Alessio, la sua famiglia, la sua agenda, i promemoria, la casa (luci, prese, tapparelle, riscaldamento, Alexa), la posta, il lavoro, Filo, Notion, gli agenti, i prezzi da comprare, o qualsiasi azione da fare, chiami SEMPRE lo strumento chiedi_a_mark.",
    "Nella richiesta a Mark scrivi la frase di Alessio completa, con tutti i dettagli che ha detto: numeri di telefono, orari, date, nomi, importi. Non riassumere e non togliere niente.",
    "Mentre aspetti Mark di' solo una frase breve, per esempio: «Un attimo, chiedo.» Non anticipare la risposta.",
    "Non dire MAI «fatto», «impostato», «acceso», «spento», «segnato», «inviato» o simili se non è Mark ad averlo detto nella sua risposta. Se Mark non ha confermato, l'azione non è stata fatta.",
    "Quando arriva la risposta di Mark, riferiscila fedelmente: puoi accorciarla, ma numeri, orari e nomi restano identici. Se Mark dice che non è riuscito, lo dici.",
    "Se Mark fa una domanda o chiede una conferma, la fai ad Alessio e poi passi a Mark la sua risposta con chiedi_a_mark, parola per parola.",
    "Senza chiedere a Mark rispondi solo a domande di cultura generale, conti, curiosità, meteo e notizie (per meteo e notizie usa la ricerca Google).",
    "Se non sai una cosa lo dici, non inventi. Non leggere mai ad alta voce indirizzi web.",
  ].join("\n");
}

export function setupVoce(oggi: string, voce = VOCE_PREDEFINITA) {
  return {
    model: `models/${MODELLO_VOCE}`,
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voce } } },
    },
    systemInstruction: { parts: [{ text: istruzioniVoce(oggi) }] },
    tools: [
      {
        functionDeclarations: [{
          name: "chiedi_a_mark",
          description: "Passa a Mark (il cervello vero, con accesso ad agenda, promemoria, casa, posta, lavoro, Filo e Notion) la richiesta di Alessio. È l'unico modo per sapere cose su Alessio o per fare un'azione. Restituisce la risposta di Mark da riferire.",
          behavior: "NON_BLOCKING",
          parameters: {
            type: "OBJECT",
            properties: {
              richiesta: { type: "STRING", description: "La frase di Alessio completa, con tutti i numeri, orari, date e nomi che ha detto." },
            },
            required: ["richiesta"],
          },
        }],
      },
      { googleSearch: {} },
    ],
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    sessionResumption: {},
    contextWindowCompression: { slidingWindow: {} },
  };
}

// Corpo della richiesta del token: un solo avvio di sessione entro 1 minuto,
// messaggi validi per 30 minuti, configurazione bloccata (il pannello non può cambiarla).
export function corpoToken(oggi: string, adessoMs: number, voce = VOCE_PREDEFINITA) {
  return {
    uses: 1,
    expireTime: new Date(adessoMs + 30 * 60_000).toISOString(),
    newSessionExpireTime: new Date(adessoMs + 60_000).toISOString(),
    bidiGenerateContentSetup: setupVoce(oggi, voce),
  };
}

export function oggiRoma(adessoMs: number): string {
  return new Date(adessoMs).toLocaleString("it-IT", {
    timeZone: "Europe/Rome", weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

// Errore di Google → frase per Alessio (mai la chiave, mai il testo grezzo)
export function erroreToken(status: number): string {
  if (status === 400) return "Google ha rifiutato la configurazione della voce.";
  if (status === 401 || status === 403) return "La chiave Gemini su Supabase non è valida.";
  if (status === 429) return "Limite gratuito di Gemini raggiunto, riprova più tardi.";
  return `Gemini non risponde (errore ${status}).`;
}
