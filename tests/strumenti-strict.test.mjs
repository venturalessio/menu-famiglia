// node --test tests/strumenti-strict.test.mjs
// L'API di Anthropic rifiuta ogni richiesta con più di 20 strumenti "strict: true":
// se succede, Mark non risponde più a nessuna domanda. Questo test lo ferma prima.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("al massimo 20 strumenti strict in Mark", () => {
  const codice = readFileSync(new URL("../supabase/functions/mark/index.ts", import.meta.url), "utf8");
  const strict = codice.match(/^\s*strict:\s*true\s*,/gm) ?? [];
  assert.ok(strict.length <= 20, `Gli strumenti strict sono ${strict.length}: il massimo è 20. Togli strict a uno strumento di sola lettura con input tollerante.`);
});
