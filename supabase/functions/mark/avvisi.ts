// Due avvisi che non devono passare dal modello: budget dell'API finito e mail truffa.
// Funzioni pure: le prova tests/avvisi.test.mjs.

export const LINK_LIMITI_API = "https://console.anthropic.com/settings/limits";

// Errore dell'API Anthropic per budget o credito finito → frase fissa con il link per sistemarlo, altrimenti null.
export function budgetFinito(messaggio: string): string | null {
  const m = messaggio.toLowerCase();
  if (!(m.includes("usage limit") || m.includes("credit balance") || m.includes("billing"))) return null;
  const quando = messaggio.match(/regain access on (\d{4})-(\d{2})-(\d{2})/);
  const fino = quando ? ` Da solo riparto il ${Number(quando[3])}/${Number(quando[2])}.` : "";
  return `⚠️ Ho finito il budget dell'API Claude: finché non lo alzi non posso rispondere né controllare la posta.${fino} Alza il limite qui: ${LINK_LIMITI_API}`;
}

// Marchi dei conti personali di Alessio e di quelli che i truffatori imitano più spesso.
// Il dominio ufficiale contiene sempre il nome del marchio (flippa.com, paypal.it, intesasanpaolo.com…).
const MARCHI = ["flippa", "etsy", "gumroad", "paypal", "satispay", "revolut", "fideuram", "intesa", "sanpaolo", "poste", "amazon", "apple", "icloud", "google", "netflix", "nexi", "unicredit", "aruba", "register"];
const URGENZA = /(24 ?ore|48 ?ore|verifica|verify|conferma (il|i tuoi|l'account|i dati)|sospes|bloccat|limitat|password|accesso insolito|pagamento (non riuscito|rifiutato|in sospeso)|rimborso|prodotto acquistato|acquisto completato|azione richiesta|action required|urgent)/i;

// Dominio "registrabile" alla buona: le ultime due parti (item-step.com da flippa.item-step.com)
export function dominioBase(host: string): string {
  const parti = host.toLowerCase().replace(/\.$/, "").split(".").filter(Boolean);
  return parti.slice(-2).join(".");
}

const marchiIn = (testo: string) => MARCHI.filter((m) => testo.toLowerCase().includes(m));

// Vale la pena aprire la mail per controllare mittente e link?
export function daControllare(oggetto: string, nome: string, indirizzo: string): boolean {
  return URGENZA.test(oggetto) || marchiIn(`${nome} ${indirizzo} ${oggetto}`).length > 0;
}

// Segnali concreti di truffa. Ogni voce è una frase breve; nessuna voce = niente di sospetto.
export function segnaliTruffa(i: {
  oggetto: string;
  nome: string;
  indirizzo: string;
  spf?: string;
  dkim?: string;
  dmarc?: string;
  rispondiA?: string[];
  linkHost?: string[];
}): string[] {
  const segnali: string[] = [];
  const dominio = dominioBase(i.indirizzo.split("@")[1] ?? "");
  const ko = (v?: string) => !!v && /^(fail|softfail|permerror)$/.test(v);
  const falliti = [["SPF", i.spf], ["DKIM", i.dkim], ["DMARC", i.dmarc]].filter(([, v]) => ko(v as string)).map(([n]) => n);
  if (falliti.length) segnali.push(`controlli del mittente falliti (${falliti.join(", ")})`);

  const altri = (i.rispondiA ?? []).map((a) => dominioBase(a.split("@")[1] ?? "")).filter((d) => d && d !== dominio);
  if (altri.length) segnali.push(`le risposte vanno a un altro dominio (${[...new Set(altri)].join(", ")})`);

  // Il nome dice un marchio, l'indirizzo no (es. "PayPal" <avviso@qualcosa.top>)
  const marchiNome = marchiIn(i.nome);
  const finto = marchiNome.filter((m) => !dominio.includes(m) && !i.indirizzo.toLowerCase().includes(m));
  if (finto.length && dominio) segnali.push(`si presenta come ${finto[0]} ma scrive da ${dominio}`);

  // Link che usano il nome del marchio su un dominio che non è il suo (es. flippa.item-step.com)
  const trappole = new Set<string>();
  for (const host of i.linkHost ?? []) {
    const base = dominioBase(host);
    const sotto = host.toLowerCase().slice(0, Math.max(0, host.length - base.length));
    for (const m of MARCHI) if (sotto.includes(m) && !base.includes(m)) trappole.add(host.toLowerCase());
  }
  if (trappole.size) segnali.push(`link che imitano il sito vero: ${[...trappole].slice(0, 2).join(", ")}`);

  // L'urgenza da sola non basta: conta solo insieme a un altro segnale
  if (segnali.length && URGENZA.test(i.oggetto)) segnali.push("mette fretta");
  return segnali;
}
