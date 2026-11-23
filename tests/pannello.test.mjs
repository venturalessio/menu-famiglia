// node --test tests/pannello.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { agendaPannello, casaPannello } from "../supabase/functions/mark/pannello.ts";

test("agenda: tutto in ordine di orario, tutto il giorno in cima, ora di Roma", () => {
  const nome = new Map([["p1", "Elena"], ["p2", "Alessio"]]);
  const v = agendaPannello(
    [{ title: "Call Rossi", start_at: "2026-11-23T14:00:00Z", location: "Teams", scope: "lavoro" },
     { title: "Compleanno nonna", start_at: "2026-11-23T00:00:00Z", all_day: true }],
    [{ who: "Rebecca", title: "Nuoto", start_at: "2026-11-23T16:30:00Z", needs_escort: true, drop_off_by: "p1", pick_up_by: "p2" },
     { who: "Margherita", title: "Danza", start_at: "2026-11-23T17:00:00Z", status: "saltato" }],
    [{ text: "Chiamare il commercialista", at: "2026-11-23T08:00:00Z" }],
    [{ title: "Offerta Bianchi", due: "2026-11-23T11:00:00Z", priority: "alta" }],
    nome,
  );
  assert.deepEqual(v.map((x) => x.titolo), ["Compleanno nonna", "Chiamare il commercialista", "Offerta Bianchi", "Call Rossi", "Rebecca · Nuoto"]);
  assert.equal(v[0].ora, "tutto il giorno");
  assert.equal(v[1].ora, "09:00");
  assert.equal(v[3].nota, "lavoro");
  assert.equal(v[4].nota, "porta Elena, prende Alessio");
  assert.ok(!v.some((x) => x.titolo.includes("Danza")), "il saltato non si mostra");
});

test("agenda vuota se non c'è niente", () => {
  assert.deepEqual(agendaPannello([], [], [], [], new Map()), []);
  assert.deepEqual(agendaPannello(undefined, null, undefined, null, new Map()), []);
});

test("casa: accesi prima, poi per stanza, senza id", () => {
  const c = casaPannello([
    { id: "a1", nome: "Lampada", stanza: "Sala", online: true, stato: "luce 0 spenta" },
    { id: "a2", nome: "Stufetta", stanza: "Bagno", online: true, stato: "canale 0 acceso 1200 W" },
    { id: "a3", nome: "Termometro", stanza: "Camera", online: false, stato: "21.5 °C" },
  ]);
  assert.deepEqual(c.map((x) => x.nome), ["Stufetta", "Termometro", "Lampada"]);
  assert.equal(c[0].acceso, true);
  assert.equal(c[1].acceso, null);
  assert.equal(c[2].acceso, false);
  assert.ok(!("id" in c[0]));
});
