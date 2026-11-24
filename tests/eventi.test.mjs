// node --test tests/eventi.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { leggiIcs, titoliSimili, trovaSpostamento } from "../supabase/functions/mark/eventi.ts";

// Il caso vero del 22/11: Titany sposta la Coaching Call di lunedì dalle 19 alle 20 con un .ics in Gmail
const ICS_TITANY = [
  "BEGIN:VCALENDAR",
  "METHOD:REQUEST",
  "BEGIN:VTIMEZONE",
  "TZID:Europe/Rome",
  "END:VTIMEZONE",
  "BEGIN:VEVENT",
  "UID:abc123@titany",
  "SEQUENCE:2",
  "SUMMARY:Coaching Call Titany",
  "DTSTART;TZID=Europe/Rome:20261123T200000",
  "DTEND;TZID=Europe/Rome:20261123T210000",
  "DESCRIPTION:Ci vediamo alle 20\\, link\\n https://meet.example",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

const FILO = [
  { id: "m365_x", title: "Coaching Call Titany", start_at: "2026-11-23T18:00:00+00:00", end_at: "2026-11-23T19:00:00+00:00", source: "m365", link: "https://outlook.office365.com/x" },
  { id: "m365_y", title: "Demo cliente", start_at: "2026-11-23T09:00:00+00:00", end_at: "2026-11-23T10:00:00+00:00", source: "m365" },
];

test("legge l'ics con fuso di Roma", () => {
  const [ev] = leggiIcs(ICS_TITANY);
  assert.equal(ev.titolo, "Coaching Call Titany");
  assert.equal(ev.metodo, "REQUEST");
  assert.equal(ev.inizio.toISOString(), "2026-11-23T19:00:00.000Z");
  assert.equal(ev.fine.toISOString(), "2026-11-23T20:00:00.000Z");
});

test("righe spezzate, UTC, fuso Windows e ora legale", () => {
  const ics = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:Riunione con\r\n  Stefano\r\nDTSTART:20260710T080000Z\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nSUMMARY:Altro\r\nDTSTART;TZID=W. Europe Standard Time:20260710T100000\r\nEND:VEVENT\r\nEND:VCALENDAR";
  const [a, b] = leggiIcs(ics);
  assert.equal(a.titolo, "Riunione con Stefano");
  assert.equal(a.inizio.toISOString(), "2026-07-10T08:00:00.000Z");
  assert.equal(b.inizio.toISOString(), "2026-07-10T08:00:00.000Z"); // 10:00 di Roma in estate = 8:00 UTC
});

test("annullato con METHOD:CANCEL", () => {
  const [ev] = leggiIcs(ICS_TITANY.replace("METHOD:REQUEST", "METHOD:CANCEL"));
  assert.ok(ev.annullato);
  assert.equal(trovaSpostamento(ev, FILO), null);
});

test("titoli simili anche con prefissi di aggiornamento", () => {
  assert.ok(titoliSimili("Aggiornato: Coaching Call Titany @ lun 23 nov 2026 20:00", "Coaching Call Titany"));
  assert.ok(titoliSimili("Updated invitation: Coaching Call Titany", "Coaching Call Titany"));
  assert.ok(!titoliSimili("Demo cliente", "Coaching Call Titany"));
  assert.ok(!titoliSimili("Call", "Coaching Call Titany"));
});

test("trova lo spostamento 19 → 20 e tiene la durata", () => {
  const s = trovaSpostamento(leggiIcs(ICS_TITANY)[0], FILO);
  assert.equal(s.id, "m365_x");
  assert.equal(s.vecchioInizio.toISOString(), "2026-11-23T18:00:00.000Z");
  assert.equal(s.nuovoInizio.toISOString(), "2026-11-23T19:00:00.000Z");
  assert.equal(s.nuovaFine.toISOString(), "2026-11-23T20:00:00.000Z");
  assert.equal(s.fonte, "m365");
});

test("niente da correggere se Filo ha già l'orario nuovo", () => {
  const giusto = [{ ...FILO[0], start_at: "2026-11-23T19:00:00+00:00", end_at: "2026-11-23T20:00:00+00:00" }];
  assert.equal(trovaSpostamento(leggiIcs(ICS_TITANY)[0], giusto), null);
});

test("niente se in Filo non c'è un evento simile vicino", () => {
  const lontano = [{ ...FILO[0], start_at: "2026-12-10T18:00:00+00:00" }];
  assert.equal(trovaSpostamento(leggiIcs(ICS_TITANY)[0], lontano), null);
  assert.equal(trovaSpostamento(leggiIcs(ICS_TITANY)[0], [FILO[1]]), null);
});
