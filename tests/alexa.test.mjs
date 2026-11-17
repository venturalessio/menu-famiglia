// deno test -A tests/alexa.test.mjs   (usa la stessa libreria npm:@peculiar/x509 della funzione)
// I certificati in fixtures-alexa sono finti, fatti apposta per questi test (CA di prova, nessun valore reale).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createSign } from "node:crypto";
import { controllaFirma, leggiRichiesta, orarioValido, perLaVoce, risposta, taglia, urlCertificatoValido } from "../supabase/functions/mark-alexa/alexa.ts";

const dir = new URL("./fixtures-alexa/", import.meta.url);
const chain = readFileSync(new URL("chain.pem", dir), "utf8");
const badchain = readFileSync(new URL("badchain.pem", dir), "utf8");
const chiave = readFileSync(new URL("leaf.key", dir), "utf8");
const firma = (corpo) => createSign("RSA-SHA256").update(corpo).sign(chiave, "base64");

test("url del certificato: solo s3.amazonaws.com/echo.api/ in https", () => {
  assert.ok(urlCertificatoValido("https://s3.amazonaws.com/echo.api/echo-api-cert.pem"));
  assert.ok(urlCertificatoValido("https://s3.amazonaws.com:443/echo.api/echo-api-cert.pem"));
  assert.ok(urlCertificatoValido("HTTPS://s3.AmazonAWS.com/echo.api/x.pem"));
  assert.ok(!urlCertificatoValido("http://s3.amazonaws.com/echo.api/x.pem"));
  assert.ok(!urlCertificatoValido("https://s3.amazonaws.com/EcHo.aPi/x.pem"));
  assert.ok(!urlCertificatoValido("https://s3.amazonaws.com/invalid.path/x.pem"));
  assert.ok(!urlCertificatoValido("https://s3.amazonaws.com:563/echo.api/x.pem"));
  assert.ok(!urlCertificatoValido("https://s3.amazonaws.com/echo.api/../invalid.path/x.pem"));
  assert.ok(!urlCertificatoValido("https://evil.com/echo.api/x.pem"));
  assert.ok(!urlCertificatoValido(""));
});

test("firma giusta passa, corpo cambiato no", async () => {
  const corpo = '{"request":{"type":"LaunchRequest"}}';
  assert.equal(await controllaFirma(chain, firma(corpo), corpo), null);
  assert.equal(await controllaFirma(chain, firma(corpo), corpo + " "), "firma sbagliata");
  assert.equal(await controllaFirma(chain, "", corpo), "firma mancante");
  assert.equal(await controllaFirma(chain, "abc", corpo), "firma sbagliata");
});

test("certificato non di Alexa, scaduto o vuoto: rifiutato", async () => {
  const corpo = "{}";
  assert.equal(await controllaFirma(badchain, firma(corpo), corpo), "certificato non di Alexa");
  assert.equal(await controllaFirma(chain, firma(corpo), corpo, new Date("2099-01-01")), "certificato scaduto");
  assert.equal(await controllaFirma("", firma(corpo), corpo), "certificato vuoto");
});

test("catena: la foglia deve essere firmata dal certificato dopo", async () => {
  const [foglia] = chain.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g);
  const [, altraCa] = badchain.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g);
  // badchain ha la stessa CA: costruisco una catena con la foglia seguita da sé stessa (non autofirmata)
  assert.equal(await controllaFirma(`${foglia}\n${foglia}`, firma("{}"), "{}"), "catena non valida");
  assert.ok(altraCa);
});

test("orario: massimo 150 secondi", () => {
  const ora = new Date("2026-11-17T22:00:00Z");
  assert.ok(orarioValido("2026-11-17T21:58:00Z", ora));
  assert.ok(!orarioValido("2026-11-17T21:57:00Z", ora));
  assert.ok(!orarioValido("ieri", ora));
});

test("testo per la voce: niente link, markdown, emoji", () => {
  assert.equal(perLaVoce("**Domani** hai:\n- dentista alle 9 🦷\n- [Filo](https://filo.app/x)"), "Domani hai: dentista alle 9. Filo");
  assert.equal(perLaVoce("Guarda https://x.it/a ok"), "Guarda il link ok");
});

test("taglio sul punto", () => {
  const t = "Prima frase lunga abbastanza. Seconda frase ancora più lunga di prima.";
  assert.deepEqual(taglia(t, 200), { pezzo: t, tagliato: false });
  assert.deepEqual(taglia(t, 50), { pezzo: "Prima frase lunga abbastanza.", tagliato: true });
});

test("risposta Alexa: sessione aperta solo se serve, SSML pulito", () => {
  const a = risposta("Luce & gas <ok>", true);
  assert.equal(a.response.shouldEndSession, false);
  assert.ok(a.response.reprompt);
  assert.ok(!a.response.outputSpeech.ssml.slice(7, -8).match(/[<>&]/));
  assert.equal(risposta("Fatto.").response.shouldEndSession, true);
});

test("lettura delle richieste", () => {
  assert.deepEqual(leggiRichiesta({ request: { type: "LaunchRequest" } }), { tipo: "apertura" });
  assert.deepEqual(leggiRichiesta({ request: { type: "IntentRequest", intent: { name: "DomandaIntent", slots: { testo: { value: "che impegni ho domani" } } } } }), { tipo: "domanda", testo: "che impegni ho domani" });
  assert.deepEqual(leggiRichiesta({ request: { type: "IntentRequest", intent: { name: "DomandaIntent", slots: { testo: {} } } } }), { tipo: "non capito" });
  assert.deepEqual(leggiRichiesta({ request: { type: "IntentRequest", intent: { name: "AMAZON.YesIntent" } } }), { tipo: "domanda", testo: "sì" });
  assert.deepEqual(leggiRichiesta({ request: { type: "IntentRequest", intent: { name: "AMAZON.StopIntent" } } }), { tipo: "stop" });
  assert.deepEqual(leggiRichiesta({ request: { type: "SessionEndedRequest" } }), { tipo: "fine" });
});
