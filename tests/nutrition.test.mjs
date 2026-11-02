// node --test tests/nutrition.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import * as N from "../nutrition.js";

test("classifica i piatti della mensa", () => {
  assert.equal(N.classifyText("Gramigna con sugo al ragu' di soia"), "legumi");
  assert.equal(N.classifyText("Tagliatelle al ragù"), "carne_rossa");
  assert.equal(N.classifyText("Filetto di merluzzo gratinato"), "pesce");
  assert.equal(N.classifyText("Fagiolini all'olio"), "nessuna");
  assert.equal(N.classifyText("Petto di pollo al limone"), "carne_bianca");
  assert.deepEqual(N.classifySchoolDay({ courses: [
    { course: "Primi", name: "Riso al curry", ingredients: "" },
    { course: "Secondi", name: "Sformato di legumi e patate", ingredients: "piselli, patata" },
  ] }), ["legumi"]);
});

test("porzioni per età", () => {
  assert.equal(N.portionFactor(4), 0.5);
  assert.equal(N.portionFactor(10), 0.8);
  assert.match(N.portionsText(2, [{ name: "Rebecca", age: 10 }, { name: "Margherita", age: 4 }]), /3,3 porzioni/);
});

test("bilancio: conta la mensa per le bambine e segnala il pesce che manca", () => {
  const m = (protein, verdura = true) => ({ title: protein, tags: { protein, verdura, integrale: false } });
  const plan = { days: [
    { date: "2026-11-02", dinner: m("legumi") },
    { date: "2026-11-03", dinner: m("uova") },
    { date: "2026-11-04", dinner: m("pesce") },
    { date: "2026-11-05", dinner: m("legumi") },
    { date: "2026-11-06", dinner: m("carne_bianca") },
    { date: "2026-11-07", lunch: m("legumi"), dinner: m("carne_rossa", false) },
    { date: "2026-11-08", lunch: m("formaggio"), dinner: m("pesce") },
  ] };
  const isWeekend = (d) => ["2026-11-07", "2026-11-08"].includes(d);
  const b = N.weekBalance(plan, { isWeekend, school: { "2026-11-05": ["pesce"] } });
  assert.equal(b.kids.pesce, 3);
  assert.equal(b.adults.pesce, 2);
  assert.ok(b.problems.some((p) => p.key === "verdura"));
  assert.ok(!b.problems.some((p) => p.key === "pesce"));
});

test("frutta: 2-3 porzioni al giorno a testa", () => {
  const f = N.fruitPlan(11, 2, 2);
  assert.equal(f.total, 74);
  assert.equal(f.items.reduce((s, x) => s + x.portions, 0), 74);
  assert.deepEqual(f.items.map((x) => x.name), ["mele", "pere", "cachi"]);
});

test("voti: due no bocciano il piatto", () => {
  const v = N.votesSummary([{ title: "A", data: { votes: { up: 0, down: 2 } } }, { title: "B", data: { votes: { up: 2, down: 1 } } }]);
  assert.deepEqual(v, { disliked: ["A"], liked: ["B"] });
});
