// node --test tests/avvisi.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { budgetFinito, daControllare, dominioBase, segnaliTruffa } from "../supabase/functions/mark/avvisi.ts";

test("budget finito: frase fissa con data e link", () => {
  const t = budgetFinito('400 {"type":"error","error":{"type":"invalid_request_error","message":"You have reached your specified API usage limits. You will regain access on 2026-12-01 at 00:00 UTC."}}');
  assert.match(t, /budget dell'API Claude/);
  assert.match(t, /riparto il 1\/12/);
  assert.match(t, /https:\/\/console\.anthropic\.com\/settings\/limits/);
  assert.equal(budgetFinito("Too many strict tools (21)"), null);
  assert.match(budgetFinito("Your credit balance is too low"), /Alza il limite/);
});

test("truffa Flippa del 15/11: link che imita il sito vero", () => {
  assert.ok(daControllare("Prodotto acquistato: verifica entro 24 ore", "Flippa", "noreply@flippa.com"));
  const s = segnaliTruffa({
    oggetto: "Prodotto acquistato: verifica entro 24 ore",
    nome: "Flippa",
    indirizzo: "noreply@flippa.com",
    spf: "pass", dkim: "pass", dmarc: "pass",
    linkHost: ["flippa.com", "flippa.item-step.com"],
  });
  assert.ok(s.some((x) => x.includes("flippa.item-step.com")), s.join(" | "));
  assert.ok(s.includes("mette fretta"));
});

test("finto PayPal da un altro dominio, con controlli falliti", () => {
  const s = segnaliTruffa({ oggetto: "Il tuo conto è limitato", nome: "PayPal", indirizzo: "servizio@paypa1-sicurezza.top", spf: "fail", rispondiA: ["help@altro.ru"] });
  assert.ok(s.some((x) => x.startsWith("controlli del mittente falliti (SPF")));
  assert.ok(s.some((x) => x.includes("altro.ru")));
  assert.ok(s.some((x) => x.includes("si presenta come paypal")));
});

test("mail vere: nessun segnale", () => {
  assert.deepEqual(segnaliTruffa({ oggetto: "Hai ricevuto un pagamento", nome: "PayPal", indirizzo: "service@paypal.it", spf: "pass", dkim: "pass", dmarc: "pass", linkHost: ["www.paypal.com", "paypal.it"] }), []);
  assert.deepEqual(segnaliTruffa({ oggetto: "Nuovo accesso", nome: "Google", indirizzo: "no-reply@accounts.google.com", linkHost: ["myaccount.google.com", "support.google.com"] }), []);
  assert.deepEqual(segnaliTruffa({ oggetto: "Verifica il tuo indirizzo", nome: "Etsy", indirizzo: "transaction@etsy.com", linkHost: ["www.etsy.com"] }), []);
  assert.equal(daControllare("Menu della settimana", "Mensa Ribò", "info@ribo.it"), false);
  assert.equal(dominioBase("a.b.item-step.com"), "item-step.com");
});

test("ricevuta PayPal vera con Reply-To = Alessio troncato: nessun segnale (falso allarme del 20/11)", () => {
  const vera = {
    oggetto: "Ricevuta del tuo pagamento a favore di Apple Services", nome: "PayPal", indirizzo: "assistenza@paypal.it",
    spf: "pass", dkim: "pass", dmarc: "pass", rispondiA: ["ventura.alessio@gmai"],
    linkHost: ["www.paypal.com", "www.paypalobjects.com", "t.paypal.com"],
  };
  assert.deepEqual(segnaliTruffa({ ...vera, destinatari: ["ventura.alessio@gmail.com"] }), []);
  // Anche senza destinatari: "gmai" non è un dominio, non conta
  assert.deepEqual(segnaliTruffa(vera), []);
  // Un Reply-To vero verso un altro dominio resta un segnale
  assert.match(segnaliTruffa({ ...vera, rispondiA: ["rimborsi@paypal-help.top"], destinatari: ["ventura.alessio@gmail.com"] })[0], /altro dominio \(paypal-help\.top\)/);
});
