// Genera il menù settimanale (o un singolo piatto) con Claude.
// La chiave ANTHROPIC_API_KEY sta nei secret del progetto Supabase, mai nell'app.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Anthropic from "npm:@anthropic-ai/sdk";

const MODEL = "claude-sonnet-5-5";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const AISLES = [
  "Frutta e verdura",
  "Carne",
  "Pesce",
  "Latticini e uova",
  "Pane e forno",
  "Pasta, riso e cereali",
  "Scatolame e conserve",
  "Surgelati",
  "Condimenti e spezie",
  "Altro",
];

const ingredient = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: { type: "string", description: "nome semplice al singolare, es. 'zucchina'" },
    qty: { type: "number" },
    unit: { type: "string", enum: ["g", "ml", "pz", "q.b."] },
    aisle: { type: "string", enum: AISLES },
  },
  required: ["name", "qty", "unit", "aisle"],
};

const meal = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string" },
    minutes: { type: "integer" },
    servings: { type: "integer" },
    ingredients: { type: "array", items: ingredient },
    steps: { type: "array", items: { type: "string" } },
    note: { type: "string", description: "es. 'fai doppia porzione: domani va nel pranzo da portare'" },
  },
  required: ["title", "minutes", "servings", "ingredients", "steps", "note"],
};

const weekSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    days: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          date: { type: "string", format: "date" },
          lunch: { anyOf: [meal, { type: "null" }] },
          dinner: meal,
        },
        required: ["date", "lunch", "dinner"],
      },
    },
  },
  required: ["days"],
};

const mealsSchema = {
  type: "object",
  additionalProperties: false,
  properties: { meals: { type: "array", items: meal } },
  required: ["meals"],
};

const SYSTEM = `Sei il cuoco di casa di una famiglia italiana di 4 persone: 2 adulti che lavorano e 2 bambine (10 e 4 anni).
Regole:
- Cucina italiana di casa, semplice, con ingredienti da supermercato. Stesso piatto per adulti e bambine.
- Nessuna allergia o esclusione, salvo quelle indicate nelle preferenze.
- Cene dal lunedì al venerdì: massimo 30 minuti. Sabato e domenica: piatti più elaborati.
- Si fa UNA spesa grande a settimana, a inizio settimana: pesce e verdure delicate nei primi giorni, ingredienti che durano o surgelati verso la fine.
- Varia proteine (legumi, uova, pesce, carne bianca, carne rossa al massimo 1-2 volte) e verdure; evita di ripetere un piatto nella stessa settimana o tra i "piatti recenti".
- Se c'è un pranzo "da portare", la cena della sera prima ne prepara la porzione in più: aumenta le porzioni della cena e scrivilo nella nota. Il pranzo da portare allora riprende quel piatto (o una sua variante fredda) senza ingredienti nuovi.
- servings = numero di persone che mangiano quel pasto (più eventuali porzioni da portare). Le quantità degli ingredienti sono per tutte le porzioni.
- Non includere tra gli ingredienti i prodotti della "dispensa base": si danno per presenti, ma puoi usarli nelle ricette.
- Passaggi brevi e concreti, al massimo 6. Note brevi; stringa vuota se non serve.
- Usa i piatti preferiti della famiglia più spesso degli altri, senza ripeterli nella stessa settimana.`;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function describeWeek(days: any[]) {
  return days
    .map((d) => {
      const lunch = d.lunchEaters > 0
        ? `pranzo per ${d.lunchEaters} (${d.lunchNote})`
        : "pranzo: nessuno a casa, niente da preparare (lunch = null)";
      const dinner = d.dinnerSkip ? "cena: fuori o asporto, prevedi comunque un piatto" : `cena per 4`;
      return `- ${d.date} (${d.weekday}): ${lunch}; ${dinner}`;
    })
    .join("\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Metodo non consentito" }, 405);

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    return json({ error: "Manca la chiave ANTHROPIC_API_KEY nei secret di Supabase." }, 500);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Richiesta non valida" }, 400);
  }

  const prefs = `Dispensa base (già in casa): ${(body.pantry ?? []).join(", ") || "nessuna"}
Piatti preferiti: ${(body.favorites ?? []).join(", ") || "nessuno ancora"}
Piatti recenti da non ripetere: ${(body.recent ?? []).join(", ") || "nessuno"}
Note della famiglia: ${body.notes || "nessuna"}`;

  let prompt: string;
  let schema: object;
  if (body.mode === "week") {
    prompt = `${prefs}

Prepara il menù di questa settimana:
${describeWeek(body.days ?? [])}

Restituisci un elemento per ogni giorno, nello stesso ordine, con la stessa data.`;
    schema = weekSchema;
  } else if (body.mode === "swap") {
    prompt = `${prefs}

Proponi 1 piatto alternativo per ${body.slot === "lunch" ? "il pranzo" : "la cena"} di ${body.date}, per ${body.servings} persone.
Piatto da sostituire: ${body.current || "nessuno"}. Altri piatti già in settimana: ${(body.weekTitles ?? []).join(", ")}.
${body.quick ? "Deve essere pronto in massimo 30 minuti." : "Può essere più elaborato."}
${body.hint ? `Richiesta: ${body.hint}` : ""}`;
    schema = mealsSchema;
  } else if (body.mode === "reserve") {
    prompt = `${prefs}

Proponi 3 "pranzi di riserva" per quando una bambina resta a casa malata: semplici, leggeri, pronti in massimo 20 minuti,
fatti SOLO con ingredienti a lunga conservazione (pasta, riso, legumi in scatola, tonno, passata, uova, formaggio stagionato, surgelati).
Per 2 persone (una bambina e un adulto). Qui gli ingredienti vanno elencati TUTTI, anche quelli della dispensa base.`;
    schema = mealsSchema;
  } else {
    return json({ error: "Modalità sconosciuta" }, 400);
  }

  const client = new Anthropic({ apiKey });
  try {
    const response: any = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: { type: "json_schema", schema } },
      system: SYSTEM,
      messages: [{ role: "user", content: prompt }],
    } as any);

    if (response.stop_reason === "refusal") {
      return json({ error: "La richiesta non è stata accettata dal modello. Riprova." }, 502);
    }
    if (response.stop_reason === "max_tokens") {
      return json({ error: "Risposta troppo lunga, riprova." }, 502);
    }
    const text = response.content
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("");
    return json({ result: JSON.parse(text), usage: response.usage });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      return json({ error: "Chiave Anthropic non valida." }, 500);
    }
    if (err instanceof Anthropic.RateLimitError) {
      return json({ error: "Troppe richieste ravvicinate, riprova tra un minuto." }, 429);
    }
    if (err instanceof Anthropic.APIError) {
      return json({ error: `Errore del servizio AI (${err.status}).` }, 502);
    }
    if (err instanceof SyntaxError) {
      return json({ error: "Risposta AI non leggibile, riprova." }, 502);
    }
    return json({ error: "Errore imprevisto." }, 500);
  }
});
