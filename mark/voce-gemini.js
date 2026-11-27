// Voce Gemini Live del pannello: conversazione a mani libere, interrompibile.
// Gemini parla e ascolta; ogni cosa che riguarda Alessio la chiede a Mark (azione "siri").
// Le funzioni pure in cima le prova tests/voce.test.mjs.

const WS = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained";
const IN_RATE = 16000;   // audio verso Gemini: PCM 16 bit, 16 kHz
const OUT_RATE = 24000;  // audio da Gemini: PCM 16 bit, 24 kHz
const SILENZIO_MS = 45_000; // dopo 45 s senza parlare la sessione si chiude (si paga anche il silenzio)
const RITARDO_ATTESA_MS = 2500; // la frase di attesa parte solo se Mark non ha risposto entro 2,5 s
const FRASI_ATTESA_N = 4;      // quante frasi di attesa diverse (FRASI_ATTESA in supabase/functions/mark/voce.ts)

// ---------- funzioni pure ----------

// Da float [-1,1] a frequenza più bassa (media sui campioni), per mandare 16 kHz
export function ricampiona(input, daRate, aRate = IN_RATE) {
  if (daRate === aRate) return Float32Array.from(input);
  const passo = daRate / aRate;
  const n = Math.floor(input.length / passo);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.floor(i * passo);
    const b = Math.min(input.length, Math.floor((i + 1) * passo));
    let s = 0;
    for (let j = a; j < b; j++) s += input[j];
    out[i] = b > a ? s / (b - a) : input[a] ?? 0;
  }
  return out;
}

export function floatAPcm16(f) {
  const out = new Int16Array(f.length);
  for (let i = 0; i < f.length; i++) {
    const v = Math.max(-1, Math.min(1, f[i]));
    out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
  }
  return out;
}

export function pcm16AFloat(i16) {
  const out = new Float32Array(i16.length);
  for (let i = 0; i < i16.length; i++) out[i] = i16[i] / 0x8000;
  return out;
}

export function bytesABase64(u8) {
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}

export function base64ABytes(b64) {
  const s = atob(b64);
  const u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
  return u8;
}

// Rete di sicurezza: Gemini dice di aver fatto qualcosa ma in questo turno non ha chiesto a Mark
const CONFERMA = /\b(fatto|impostat[oaie]|acces[oaie]|spent[oaie]|segnat[oaie]|salvat[oaie]|inviat[oaie]|mandat[oaie]|programmat[oaie]|aggiunt[oaie]|creat[oaie]|cancellat[oaie]|spostat[oaie]|promemoria (?:è )?(?:pronto|attivo))\b/i;
export function azioneInventata(testoDetto, haChiestoAMark) {
  if (haChiestoAMark) return false;
  return CONFERMA.test(String(testoDetto ?? ""));
}

// Messaggio di risposta allo strumento: Mark ha risposto, Gemini lo dice subito
export function rispostaStrumento(chiamata, risposta, errore) {
  return {
    toolResponse: {
      functionResponses: [{
        id: chiamata.id,
        name: chiamata.name,
        response: errore
          ? { errore: `Mark non ha risposto: ${errore}. Dillo ad Alessio, non dire che è fatto.`, scheduling: "INTERRUPT" }
          : { risposta_di_mark: risposta, scheduling: "INTERRUPT" },
      }],
    },
  };
}

export function conLimite(promessa, ms, messaggio) {
  let t;
  return Promise.race([promessa, new Promise((_, ko) => { t = setTimeout(() => ko(new Error(messaggio)), ms); })]).finally(() => clearTimeout(t));
}

// ---------- worklet del microfono (in linea: niente file in più) ----------

const WORKLET = `class Mic extends AudioWorkletProcessor {
  process(inputs) { const c = inputs[0] && inputs[0][0]; if (c) this.port.postMessage(c.slice(0)); return true; }
}
registerProcessor("mark-mic", Mic);`;

// ---------- sessione ----------

// opzioni: { token: () => Promise<string>, chiediAMark: (testo) => Promise<string>,
//            suStato(s), suIo(testo), suMark(testo), suAvviso(testo), suColpo(forza), suFine(motivo) }
export function creaVoceGemini(o) {
  let ws = null, ctxIn = null, ctxOut = null, stream = null, nodo = null, src = null;
  let prossimo = 0, sorgenti = new Set(), handle = null, chiusa = false, timerSilenzio = null;
  let buffer = [], bufferLen = 0;
  let detto = "", io = "", chiestoInQuestoTurno = false, inAttesaMark = 0, pronto = false;

  const silenzio = () => {
    clearTimeout(timerSilenzio);
    timerSilenzio = setTimeout(() => chiudi("silenzio"), SILENZIO_MS);
  };

  function svuotaAudio() {
    for (const s of sorgenti) { try { s.stop(); } catch { /* già ferma */ } }
    sorgenti.clear();
    prossimo = 0;
  }

  function suona(b64) {
    const i16 = new Int16Array(base64ABytes(b64).buffer);
    const f = pcm16AFloat(i16);
    const buf = ctxOut.createBuffer(1, f.length, OUT_RATE);
    buf.copyToChannel(f, 0);
    const s = ctxOut.createBufferSource();
    s.buffer = buf;
    s.connect(ctxOut.destination);
    const t = Math.max(ctxOut.currentTime + 0.02, prossimo);
    s.start(t);
    prossimo = t + buf.duration;
    sorgenti.add(s);
    s.onended = () => {
      sorgenti.delete(s);
      if (!sorgenti.size && !chiusa) o.suStato(inAttesaMark ? "penso" : "ascolto");
    };
    // la sfera pulsa con il volume
    let picco = 0;
    for (let k = 0; k < f.length; k += 64) picco = Math.max(picco, Math.abs(f[k]));
    o.suColpo(Math.min(1, picco * 1.6));
    o.suStato("parlo");
  }

  function manda(m) { if (ws?.readyState === 1) ws.send(JSON.stringify(m)); }

  function audioDalMic(f) {
    const r = ricampiona(f, ctxIn.sampleRate);
    buffer.push(r);
    bufferLen += r.length;
    if (bufferLen < IN_RATE / 10) return; // pacchetti da ~100 ms
    if (!pronto) { buffer = []; bufferLen = 0; return; } // prima della risposta al setup Gemini non accetta audio
    const tutto = new Float32Array(bufferLen);
    let p = 0;
    for (const b of buffer) { tutto.set(b, p); p += b.length; }
    buffer = []; bufferLen = 0;
    const pcm = floatAPcm16(tutto);
    manda({ realtimeInput: { audio: { data: bytesABase64(new Uint8Array(pcm.buffer)), mimeType: `audio/pcm;rate=${IN_RATE}` } } });
  }

  // Frase di attesa con la voce di Gemini, suonata qui solo se Mark tarda, a rotazione
  let attese = [], giro = 0, timerAttesa = null;
  function diciAttesa() {
    timerAttesa = null;
    const pronte = attese.filter(Boolean);
    if (!pronte.length || !ctxOut || chiusa) return;
    const attesa = pronte[giro++ % pronte.length];
    const f = pcm16AFloat(new Int16Array(base64ABytes(attesa.audio).buffer));
    const buf = ctxOut.createBuffer(1, f.length, attesa.rate || OUT_RATE);
    buf.copyToChannel(f, 0);
    const s = ctxOut.createBufferSource();
    s.buffer = buf;
    s.connect(ctxOut.destination);
    s.start(Math.max(ctxOut.currentTime + 0.02, prossimo));
    o.suColpo(0.7);
  }

  async function strumento(c) {
    chiestoInQuestoTurno = true;
    if (!inAttesaMark && !timerAttesa) timerAttesa = setTimeout(diciAttesa, RITARDO_ATTESA_MS);
    inAttesaMark++;
    o.suStato("penso", "Chiedo a Mark…");
    const richiesta = String(c.args?.richiesta ?? "").trim();
    try {
      const r = await o.chiediAMark(richiesta);
      o.suMark(r);
      manda(rispostaStrumento(c, r));
    } catch (e) {
      manda(rispostaStrumento(c, null, e.message || "errore"));
    } finally {
      inAttesaMark--;
      if (!inAttesaMark && timerAttesa) { clearTimeout(timerAttesa); timerAttesa = null; }
    }
  }

  function messaggio(m) {
    if (m.setupComplete) { pronto = true; inAttesaSetup?.(); inAttesaSetup = null; o.suStato("ascolto"); silenzio(); return; }
    if (m.sessionResumptionUpdate?.resumable && m.sessionResumptionUpdate.newHandle) handle = m.sessionResumptionUpdate.newHandle;
    if (m.goAway) { riconnetti(); return; }
    if (m.toolCall) { for (const c of m.toolCall.functionCalls ?? []) if (c.name === "chiedi_a_mark") strumento(c); return; }
    const sc = m.serverContent;
    if (!sc) return;
    if (sc.interrupted) { svuotaAudio(); o.suStato("ascolto"); }
    if (sc.inputTranscription?.text) {
      // nuovo turno di Alessio
      if (detto) { detto = ""; chiestoInQuestoTurno = false; }
      io += sc.inputTranscription.text;
      o.suIo(io);
      silenzio();
    }
    for (const p of sc.modelTurn?.parts ?? []) if (p.inlineData?.data) suona(p.inlineData.data);
    if (sc.outputTranscription?.text) {
      io = "";
      detto += sc.outputTranscription.text;
      o.suMark(detto);
    }
    if (sc.turnComplete) {
      if (azioneInventata(detto, chiestoInQuestoTurno || inAttesaMark > 0)) {
        o.suAvviso("⚠ Gemini ha parlato come se avesse fatto qualcosa, ma non l'ha chiesto a Mark: probabilmente non è stato fatto. Ripeti la richiesta o controlla.");
      }
      silenzio();
    }
  }

  // Si risolve solo quando Google conferma la sessione (setupComplete), con limiti di tempo per ogni passo
  let inAttesaSetup = null;
  function apri(token) {
    return new Promise((ok, ko) => {
      pronto = false;
      let fatto = false;
      const fine = (err) => { if (fatto) return; fatto = true; clearTimeout(t); inAttesaSetup = null; err ? ko(err) : ok(); };
      let t = setTimeout(() => fine(new Error("Non riesco a raggiungere Google: la rete potrebbe bloccare la voce")), 10_000);
      inAttesaSetup = () => fine();
      ws = new WebSocket(`${WS}?access_token=${encodeURIComponent(token)}`);
      ws.onopen = () => {
        clearTimeout(t);
        t = setTimeout(() => fine(new Error("Google non ha confermato la sessione")), 10_000);
        // La configurazione vera è bloccata nel token: qui basta il modello (e la sessione da riprendere)
        manda({ setup: { model: "models/gemini-3.8-live", ...(handle ? { sessionResumption: { handle } } : {}) } });
      };
      ws.onmessage = async (e) => {
        const testo = typeof e.data === "string" ? e.data : await e.data.text();
        try { messaggio(JSON.parse(testo)); } catch (err) { console.error("voce", err); }
      };
      ws.onerror = () => fine(new Error("Collegamento con Gemini non riuscito"));
      ws.onclose = (e) => {
        console.warn("voce chiusa", e.code, e.reason);
        if (!fatto) { fine(new Error(`Google ha chiuso la sessione (${e.code}${e.reason ? ": " + e.reason.slice(0, 80) : ""})`)); return; }
        if (chiusa || e.target !== ws) return;
        if (e.code !== 1000) console.warn("voce chiusa", e.code, e.reason);
        chiudi(e.reason || "chiusa");
      };
    });
  }

  let tokenAttuale = null;
  async function riconnetti() {
    if (chiusa) return;
    const vecchio = ws;
    vecchio.onclose = null;
    try { vecchio.close(); } catch { /* già chiuso */ }
    try {
      // Riprendere la sessione non consuma il token; se è scaduto ne chiedo un altro
      await apri(tokenAttuale).catch(async () => { tokenAttuale = await o.token(); await apri(tokenAttuale); });
    } catch (e) {
      chiudi(e.message);
    }
  }

  // Va chiamata dentro il tocco: su iPhone l'audio parte solo così
  async function avvia() {
    ctxOut = new (window.AudioContext || window.webkitAudioContext)();
    ctxIn = new (window.AudioContext || window.webkitAudioContext)();
    ctxOut.resume(); ctxIn.resume();
    o.suStato("penso", "Consenti il microfono…");
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    const url = URL.createObjectURL(new Blob([WORKLET], { type: "text/javascript" }));
    await ctxIn.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    o.suStato("penso", "Chiedo il permesso a Mark…");
    // la frase di attesa arriva in parallelo; se non arriva, pazienza
    if (!attese.length) for (let n = 0; n < FRASI_ATTESA_N; n++) o.attesa?.(n).then((a) => { attese[n] = a; }).catch(() => {});
    tokenAttuale = await conLimite(o.token(), 12_000, "Mark non ha risposto per la voce Gemini");
    o.suStato("penso", "Mi collego a Google…");
    await apri(tokenAttuale);
    src = ctxIn.createMediaStreamSource(stream);
    nodo = new AudioWorkletNode(ctxIn, "mark-mic");
    nodo.port.onmessage = (e) => audioDalMic(e.data);
    src.connect(nodo);
  }

  function chiudi(motivo = "fine") {
    if (chiusa) return;
    chiusa = true;
    clearTimeout(timerSilenzio);
    try { manda({ realtimeInput: { audioStreamEnd: true } }); } catch { /* niente */ }
    try { ws?.close(1000); } catch { /* già chiuso */ }
    svuotaAudio();
    try { src?.disconnect(); nodo?.disconnect(); } catch { /* già staccati */ }
    stream?.getTracks().forEach((t) => t.stop());
    ctxIn?.close().catch(() => {});
    ctxOut?.close().catch(() => {});
    o.suFine(motivo);
  }

  // Testo scritto durante la conversazione: arriva a Gemini come se l'avessi detto
  function scrivi(testo) {
    if (detto) { detto = ""; chiestoInQuestoTurno = false; }
    o.suIo(testo);
    manda({ realtimeInput: { text: testo } });
    silenzio();
  }

  return { avvia, chiudi, scrivi, get attiva() { return !chiusa; } };
}
