// node --test tests/posti.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { posizioneValida, nomeZona, testoPosizione, urlPubblico, immagineDaHtml, didascaliaLocale, coordinateDaRicerca, linkMappa } from "../supabase/functions/mark/posti.ts";

const ADESSO = Date.parse("2026-11-18T19:00:00Z");
const S = ADESSO / 1000;

test("posizione valida, arrotondata, e scartata se vecchia o fuori dal mondo", () => {
  assert.deepEqual(posizioneValida({ lat: 35.9234567, lon: 14.4890123, quando: S - 60 }, ADESSO), { lat: 35.92346, lon: 14.48901, quando: S - 60 });
  assert.equal(posizioneValida({ lat: 35.9, lon: 14.4, quando: S - 4 * 3600 }, ADESSO), null, "più di 3 ore");
  assert.equal(posizioneValida({ lat: 95, lon: 14, quando: S }, ADESSO), null);
  assert.equal(posizioneValida({ lat: "x", lon: 14, quando: S }, ADESSO), null);
  assert.equal(posizioneValida(null, ADESSO), null);
  assert.equal(posizioneValida({ lat: 1, lon: 1, quando: S + 3600 }, ADESSO), null, "dal futuro");
});

test("nome della zona da Nominatim, senza doppioni", () => {
  const z = nomeZona({ address: { road: "Portomaso", suburb: "St. Julian's", town: "St. Julian's", country: "Malta" } });
  assert.equal(z, "Portomaso, St. Julian's, Malta");
  assert.equal(nomeZona({}), "");
});

test("testo della posizione per Mark", () => {
  const t = testoPosizione({ lat: 35.92, lon: 14.49, quando: S - 600 }, "Portomaso, Malta", ADESSO);
  assert.match(t, /10 minuti fa/);
  assert.match(t, /35\.92, 14\.49, zona Portomaso, Malta/);
  assert.match(testoPosizione({ lat: 1, lon: 2, quando: S }, "", ADESSO), /condivisa adesso da Telegram: 1, 2\./);
});

test("solo url https pubblici", () => {
  assert.equal(urlPubblico("https://www.thefork.it/ristorante/x"), "https://www.thefork.it/ristorante/x");
  for (const u of ["http://a.it", "https://localhost/x", "https://127.0.0.1/x", "https://[::1]/", "https://intranet/x", "https://u:p@a.it/", "javascript:alert(1)", "", null]) {
    assert.equal(urlPubblico(u), null, String(u));
  }
});

test("immagine di anteprima dalla pagina", () => {
  const html = `<head><meta name="description" content="x"><meta content="/img/sala.jpg?a=1&amp;b=2" property="og:image"></head>`;
  assert.equal(immagineDaHtml(html, "https://caviarandbull.com/menu"), "https://caviarandbull.com/img/sala.jpg?a=1&b=2");
  assert.equal(immagineDaHtml(`<meta name="twitter:image" content="https://cdn.x.com/a.png">`, "https://x.com"), "https://cdn.x.com/a.png");
  assert.equal(immagineDaHtml(`<link rel="image_src" href="https://cdn.x.com/b.jpg">`, "https://x.com"), "https://cdn.x.com/b.jpg");
  assert.equal(immagineDaHtml(`<meta property="og:image" content="http://insicuro.it/a.jpg">`, "https://x.com"), null);
  assert.equal(immagineDaHtml("<p>niente</p>", "https://x.com"), null);
});

test("didascalia con il link per prenotare, entro 1024 caratteri", () => {
  const d = didascaliaLocale("Caviar & Bull", "Carne e caviale, vista porto. 4,6 su Google.", "https://www.sevenrooms.com/x", "https://caviarandbull.com");
  assert.equal(d, "Caviar & Bull\nCarne e caviale, vista porto. 4,6 su Google.\nPrenota: https://www.sevenrooms.com/x");
  assert.match(didascaliaLocale("A", "", null, "https://a.it"), /^A\nhttps:\/\/a\.it$/);
  assert.ok(didascaliaLocale("A", "x".repeat(2000), "https://a.it", null).length <= 1024);
});

test("coordinate dalla ricerca di Nominatim", () => {
  assert.deepEqual(coordinateDaRicerca([{ lat: "35.9221", lon: "14.4896" }]), { lat: 35.9221, lon: 14.4896 });
  assert.equal(coordinateDaRicerca([]), null);
  assert.equal(coordinateDaRicerca({ error: "x" }), null);
});

test("link di Google Maps e mappa nella didascalia", () => {
  const m = linkMappa("Calzavecchio", "via Calzavecchio 1, Casalecchio di Reno");
  assert.equal(m, "https://www.google.com/maps/search/?api=1&query=Calzavecchio%2C%20via%20Calzavecchio%201%2C%20Casalecchio%20di%20Reno");
  assert.match(didascaliaLocale("A", "b", null, "https://a.it", m), /\nMappa: https:\/\/www\.google\.com\/maps/);
});
