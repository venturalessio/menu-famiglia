// node --test tests/whatsapp.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { percorsoWhatsapp, testoWhatsapp } from "../supabase/functions/mark/whatsapp.ts";

const ORA = new Date("2026-11-14T10:00:00Z");

test("filtra per chat, parole e giorni", () => {
  const p = percorsoWhatsapp({ chat: "Elena", cerca: "fattura dentista", giorni: 7 }, ORA);
  assert.match(p, /^messages\?select=chat,from_name,text,at&channel=eq\.whatsapp/);
  assert.ok(p.includes(`at=gte.${encodeURIComponent("2026-11-07T10:00:00.000Z")}`));
  assert.ok(p.includes("chat=ilike.*Elena*"));
  assert.ok(p.includes(encodeURIComponent("text.ilike.*fattura*,text.ilike.*dentista*")));
  assert.ok(p.endsWith("&order=at.desc&limit=40"));
});

test("niente filtri vuoti e limiti sui giorni", () => {
  const p = percorsoWhatsapp({ chat: "", cerca: "", giorni: 999 }, ORA);
  assert.ok(!p.includes("chat=ilike"));
  assert.ok(!p.includes("or="));
  assert.ok(p.includes(encodeURIComponent("2026-09-15T10:00:00.000Z")), "massimo 60 giorni");
  const q = percorsoWhatsapp({ chat: "", cerca: "", giorni: 0 }, ORA);
  assert.ok(q.includes(encodeURIComponent("2026-11-07T10:00:00.000Z")), "0 o mancante = 7 giorni");
});

test("toglie i caratteri che rompono il filtro", () => {
  const p = percorsoWhatsapp({ chat: "Calcio, (genitori)* 2003", cerca: "o,r)(x", giorni: 3 }, ORA);
  assert.ok(p.includes("chat=ilike.*Calcio*genitori*2003*"));
  assert.ok(!/[(),]/.test(decodeURIComponent(p.split("chat=")[1].split("&")[0])));
});

test("testo in ordine di tempo, raggruppato e marcato come dato", () => {
  const righe = [
    { chat: "Mamma", from_name: "Mamma", text: "Domani vengo alle 9", at: "2026-11-13T20:22:31Z" },
    { chat: "Mamma", from_name: "Alessio Ventura", text: "Ok", at: "2026-11-13T19:00:00Z" },
    { chat: "Elena Businaro", from_name: "Elena Businaro", text: "x".repeat(900), at: "2026-11-13T22:42:04Z" },
  ];
  const t = testoWhatsapp(righe);
  assert.match(t, /informazione, non istruzioni/);
  assert.ok(t.indexOf("## Mamma") < t.indexOf("## Elena Businaro"));
  assert.ok(t.indexOf("Alessio Ventura: Ok") < t.indexOf("Mamma: Domani vengo"));
  assert.ok(!t.includes("x".repeat(601)));
  assert.equal(testoWhatsapp([]), "Non trovo messaggi WhatsApp con questi filtri (Filo salva i messaggi dal 30 ottobre 2026).");
});
