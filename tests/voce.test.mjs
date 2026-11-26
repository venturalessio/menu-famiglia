// node --test tests/voce.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { corpoToken, setupVoce, istruzioniVoce, erroreToken, MODELLO_VOCE } from "../supabase/functions/mark/voce.ts";
import { ricampiona, floatAPcm16, pcm16AFloat, bytesABase64, base64ABytes, azioneInventata, rispostaStrumento } from "../mark/voce-gemini.js";

test("token: un solo uso, avvio entro 1 minuto, scade in 30, configurazione bloccata", () => {
  const t0 = Date.parse("2026-11-26T15:00:00Z");
  const c = corpoToken("giovedì 26 novembre 2026", t0);
  assert.equal(c.uses, 1);
  assert.equal(c.newSessionExpireTime, "2026-11-26T15:01:00.000Z");
  assert.equal(c.expireTime, "2026-11-26T15:30:00.000Z");
  assert.equal(c.bidiGenerateContentSetup.model, `models/${MODELLO_VOCE}`);
});

test("setup: voce Orus, solo audio, strumento chiedi_a_mark asincrono, ricerca Google, trascrizioni", () => {
  const s = setupVoce("oggi");
  assert.equal(s.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName, "Orus");
  assert.deepEqual(s.generationConfig.responseModalities, ["AUDIO"]);
  const f = s.tools[0].functionDeclarations[0];
  assert.equal(f.name, "chiedi_a_mark");
  assert.equal(f.behavior, "NON_BLOCKING");
  assert.deepEqual(f.parameters.required, ["richiesta"]);
  assert.ok(s.tools.some((t) => "googleSearch" in t));
  assert.ok(s.inputAudioTranscription && s.outputAudioTranscription && s.sessionResumption);
});

test("istruzioni: la regola 'mai fatto da solo' e i dettagli completi a Mark", () => {
  const i = istruzioniVoce("giovedì");
  assert.match(i, /Non dire MAI «fatto»/);
  assert.match(i, /numeri di telefono, orari, date/);
  assert.match(i, /chiedi_a_mark/);
  assert.match(i, /giovedì/);
});

test("errori di Google diventano frasi, senza dettagli tecnici", () => {
  assert.match(erroreToken(403), /chiave Gemini/);
  assert.match(erroreToken(429), /Limite gratuito/);
  assert.match(erroreToken(500), /500/);
});

test("audio: da 48 kHz a 16 kHz, PCM 16 bit andata e ritorno, base64", () => {
  const f = new Float32Array(4800).fill(0.5);
  const r = ricampiona(f, 48000);
  assert.equal(r.length, 1600);
  assert.ok(Math.abs(r[100] - 0.5) < 1e-6);
  const pcm = floatAPcm16(Float32Array.from([1, -1, 0, 2]));
  assert.deepEqual([...pcm], [32767, -32768, 0, 32767]);
  const back = pcm16AFloat(pcm);
  assert.ok(Math.abs(back[0] - 1) < 0.001 && back[1] === -1);
  const u8 = new Uint8Array(pcm.buffer);
  assert.deepEqual([...base64ABytes(bytesABase64(u8))], [...u8]);
});

test("rete di sicurezza: 'promemoria impostato' senza Mark è un'azione inventata", () => {
  assert.equal(azioneInventata("Certamente, promemoria impostato per mercoledì 3 dicembre alle 9:45.", false), true);
  assert.equal(azioneInventata("Fatto, luce accesa.", false), true);
  assert.equal(azioneInventata("Fatto, luce accesa.", true), false);
  assert.equal(azioneInventata("18 per 23 fa 414.", false), false);
  assert.equal(azioneInventata("Domani a Bologna nuvoloso, massima 9 gradi.", false), false);
});

test("risposta allo strumento: id e nome della chiamata, interrompe per riferire subito", () => {
  const c = { id: "abc", name: "chiedi_a_mark" };
  const ok = rispostaStrumento(c, "Promemoria segnato in Filo.");
  assert.deepEqual(ok.toolResponse.functionResponses[0], { id: "abc", name: "chiedi_a_mark", response: { risposta_di_mark: "Promemoria segnato in Filo.", scheduling: "INTERRUPT" } });
  const ko = rispostaStrumento(c, null, "timeout");
  assert.match(ko.toolResponse.functionResponses[0].response.errore, /non dire che è fatto/);
});
