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

const PROTEINS = ["pesce", "legumi", "uova", "carne_bianca", "carne_rossa", "salumi", "formaggio", "nessuna"];

const tags = {
  type: "object",
  additionalProperties: false,
  description: "etichette nutrizionali del piatto, usate per controllare l'equilibrio della settimana",
  properties: {
    protein: { type: "string", enum: PROTEINS, description: "fonte proteica principale del pasto" },
    verdura: { type: "boolean", description: "true se il pasto contiene una porzione di verdura (nel piatto o come contorno indicato negli ingredienti)" },
    integrale: { type: "boolean", description: "true se il cereale è integrale (pasta, riso, pane, farro, orzo integrali)" },
  },
  required: ["protein", "verdura", "integrale"],
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
    note: { type: "string", description: "es. 'fai doppia porzione: domani va nel pranzo da portare' o 'tira fuori il pesce dal congelatore la sera prima'" },
    tags,
  },
  required: ["title", "minutes", "servings", "ingredients", "steps", "note", "tags"],
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
    leftovers_used: { type: "array", items: { type: "string" }, description: "avanzi della lista che hai usato davvero" },
  },
  required: ["days", "leftovers_used"],
};

const mealsSchema = {
  type: "object",
  additionalProperties: false,
  properties: { meals: { type: "array", items: meal } },
  required: ["meals"],
};

const fixSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    changes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          date: { type: "string", format: "date" },
          slot: { type: "string", enum: ["lunch", "dinner"] },
          meal,
        },
        required: ["date", "slot", "meal"],
      },
    },
  },
  required: ["changes"],
};

const SYSTEM = `Sei il cuoco di casa e il nutrizionista di una famiglia italiana di Bologna: 2 adulti che lavorano e 2 bambine (10 e 4 anni, salvo diverse indicazioni).
Cucina:
- Cucina italiana di casa, semplice, con ingredienti da supermercato. Stesso piatto per adulti e bambine.
- Nessuna allergia o esclusione, salvo quelle indicate nelle preferenze.
- Cene dal lunedì al venerdì: massimo 30 minuti, e meno nelle sere segnate come strette. Sabato e domenica: piatti più elaborati.
- Si fa UNA spesa grande a settimana, a inizio settimana: pesce fresco e verdure delicate nei primi giorni, ingredienti che durano o surgelati verso la fine.
- Riusa gli stessi ingredienti freschi in più piatti (mezza zucca lunedì, l'altra metà giovedì): meno spreco, spesa più leggera.
- Usa SOLO verdura e frutta di stagione (elenco nelle preferenze).
- Se c'è un pranzo "da portare", la cena della sera prima ne prepara la porzione in più: aumenta le porzioni della cena e scrivilo nella nota. Il pranzo da portare allora riprende quel piatto (o una sua variante fredda) senza ingredienti nuovi.
- Se serve scongelare o mettere in ammollo, scrivilo nella nota del piatto ("la sera prima: sposta il merluzzo in frigo").
- servings = numero di persone che mangiano quel pasto (più eventuali porzioni da portare). Le QUANTITÀ invece seguono le porzioni per età indicate: una bambina di 4 anni mangia circa metà porzione da adulto, una di 10 circa 0,8.
- Non includere tra gli ingredienti i prodotti della "dispensa base": si danno per presenti, ma puoi usarli nelle ricette.
- Passaggi brevi e concreti, al massimo 6. Note brevi; stringa vuota se non serve.
- Usa i piatti preferiti della famiglia più spesso degli altri, senza ripeterli nella stessa settimana. Non proporre MAI i piatti bocciati.
Nutrizione (Linee guida CREA 2018, dieta mediterranea):
- Ogni pasto ha tre parti: verdura (circa metà piatto, nel piatto o come contorno negli ingredienti), un cereale o patate, una fonte proteica. tags.verdura deve essere true per ogni pasto.
- Cereali integrali almeno 3 volte a settimana.
- Frequenze per i pasti di famiglia (cene + pranzi del weekend): legumi 2-3, pesce 2, uova 1-2, carne bianca 1-2, carne rossa al massimo 1, salumi al massimo 1, formaggio come piatto principale al massimo 1.
- Le bambine pranzano alla mensa dal lunedì al venerdì: le frequenze per loro valgono sulla settimana intera, mensa compresa (pesce 3, legumi 3, carne 3, uova 2). Se ti do il menù della mensa, la cena dello stesso giorno NON ripete la proteina del pranzo e completa quello che manca nella settimana.
- Margherita ha 4 anni: poco sale, niente frutta secca intera, pomodorini e acini tagliati, lische tolte.
- Rebecca nuota tutti i giorni feriali: la cena ha sempre carboidrati e proteine.
- tags.protein = la fonte proteica principale del pasto. Sii onesto con le etichette: servono a controllare la settimana.`;

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
      const dinner = d.dinnerSkip ? "cena: fuori o asporto, prevedi comunque un piatto" : `cena per tutti`;
      const school = d.school ? `; a scuola le bambine mangiano: ${d.school}` : "";
      const extra = d.schedule ? `; sera: ${d.schedule}` : "";
      return `- ${d.date} (${d.weekday}): ${lunch}; ${dinner}${school}${extra}`;
    })
    .join("\n");
}

// ---------- Mensa Ribò (Bologna) ----------
// Il sito è una pagina ASP.NET: si cerca la scuola, poi si sposta la data con un postback.
const RIBO = "https://www.riboscuola.it/menu/ricerca-menu.aspx";
const RIBO_P = "Elior_Ribo_Module_182151$m5e0a362ea0b54e8284274914f25d95c4$";

function decode(s: string) {
  return s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/\s+/g, " ").trim();
}
function hidden(h: string) {
  const out: Record<string, string> = {};
  for (const m of h.matchAll(/<input type="hidden" name="(__[A-Z]+)" id="[^"]*" value="([^"]*)"/g)) out[m[1]] = decode(m[2]);
  return out;
}
async function riboPost(data: Record<string, string>) {
  const r = await fetch(RIBO, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "Mozilla/5.0 (menu-famiglia)" },
    body: new URLSearchParams(data).toString(),
    signal: AbortSignal.timeout(20_000),
  });
  return await r.text();
}
function riboCourses(h: string) {
  const i = h.indexOf('class="daily-menu"');
  if (i < 0) return [];
  const seg = h.slice(i, h.indexOf("<script", i));
  const out: { course: string; name: string; ingredients: string }[] = [];
  for (const li of seg.split("<li>").slice(1)) {
    const course = li.match(/<label>([\s\S]*?)<\/label>/)?.[1];
    const name = li.match(/<strong>([\s\S]*?)<\/strong>/)?.[1];
    const ingr = li.match(/pDescription_\d+">([\s\S]*?)<\/p>/)?.[1];
    if (course && name) out.push({ course: decode(course), name: decode(name).replace(/\*+/g, "").trim(), ingredients: decode(ingr || "") });
  }
  return out;
}
// dates: "YYYY-MM-DD"[] -> { date: courses[] }
async function riboWeek(schoolName: string, dates: string[]) {
  const first = await (await fetch(RIBO, { signal: AbortSignal.timeout(20_000) })).text();
  const want = schoolName.trim().toUpperCase();
  let code = "";
  for (const m of first.matchAll(/<option value="([^"]+)">([^<]+)<\/option>/g)) {
    if (decode(m[2]).toUpperCase() === want) { code = m[1]; break; }
  }
  if (!code) {
    for (const m of first.matchAll(/<option value="(\d+\|\d+\|\d+)">([^<]+)<\/option>/g)) {
      if (decode(m[2]).toUpperCase().includes(want)) { code = m[1]; break; }
    }
  }
  if (!code) throw new Error(`Scuola "${schoolName}" non trovata su Ribò`);
  let page = await riboPost({ ...hidden(first), [RIBO_P + "drpDestination"]: code, [RIBO_P + "drpDiet"]: "2", [RIBO_P + "btnSearch"]: "Visualizza" });
  const days: Record<string, { course: string; name: string; ingredients: string }[]> = {};
  for (const date of dates) {
    const [y, m, d] = date.split("-");
    page = await riboPost({ ...hidden(page), [RIBO_P + "drpDestination"]: code, [RIBO_P + "drpDiet"]: "2", [RIBO_P + "hdnDate"]: `${d}/${m}/${y}`, [RIBO_P + "btnMoveToDate"]: "" });
    days[date] = riboCourses(page);
  }
  return days;
}

// ---------- Ricetta da un link ----------
// Solo pagine pubbliche http/https: niente indirizzi interni (127.x, 10.x, 192.168.x, 169.254.x, ::1...)
export function indirizzoPubblico(u: URL) {
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  if (u.username || u.password) return false;
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!h.includes(".") && !h.includes(":")) return false;
  if (/(^|\.)(localhost|local|internal|localdomain)$/.test(h)) return false;
  if (h.includes(":")) return false; // indirizzi IPv6 scritti a mano: le ricette stanno su nomi di dominio
  const ip = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (ip) {
    const [a, b] = [Number(ip[1]), Number(ip[2])];
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
  }
  if (/^\d+$/.test(h) || /^0x/.test(h)) return false; // IP scritti come numero unico
  return true;
}

async function pageText(url: string) {
  let u = new URL(url);
  if (/instagram\.com|tiktok\.com|facebook\.com/.test(u.hostname)) {
    throw new Error("I social non si aprono da qui: copia e incolla il testo della ricetta.");
  }
  // I redirect si seguono a mano, controllando ogni indirizzo
  let r: Response | null = null;
  for (let salto = 0; salto < 4; salto++) {
    if (!indirizzoPubblico(u)) throw new Error("Questo indirizzo non si può aprire.");
    r = await fetch(u, { redirect: "manual", headers: { "User-Agent": "Mozilla/5.0 (menu-famiglia)", "Accept-Language": "it-IT,it" }, signal: AbortSignal.timeout(20_000) });
    const dove = r.status >= 300 && r.status < 400 ? r.headers.get("location") : null;
    if (!dove) break;
    await r.body?.cancel();
    u = new URL(dove, u);
    r = null;
  }
  if (!r) throw new Error("La pagina rimanda troppe volte altrove.");
  if (!r.ok) throw new Error(`La pagina non si apre (${r.status}).`);
  // Al massimo 2 MB di pagina
  const reader = r.body?.getReader();
  const parti: Uint8Array[] = [];
  let letti = 0;
  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;
    parti.push(value);
    letti += value.length;
    if (letti > 2_000_000) { await reader.cancel(); break; }
  }
  const h = new TextDecoder().decode(await new Blob(parti).arrayBuffer());
  // Prima i dati strutturati (quasi tutti i siti di ricette li hanno), poi il testo
  const ld = [...h.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).filter((x) => /Recipe/.test(x));
  const text = h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ");
  return (ld.join("\n") + "\n" + decode(text)).slice(0, 30000);
}

async function controllaAccesso(authorization: string): Promise<{ status: number; error: string } | null> {
  const token = authorization.replace(/^Bearer\s+/i, "").trim();
  if (!token) return { status: 401, error: "Accesso richiesto" };
  const servizio = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (servizio && token === servizio) return null;
  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const headers = { apikey: anon, Authorization: `Bearer ${token}` };
  const u = await fetch(`${url}/auth/v1/user`, { headers, signal: AbortSignal.timeout(10_000) }).catch(() => null);
  if (!u?.ok) return { status: 401, error: "Accesso richiesto" };
  // Le regole del database fanno vedere a ciascuno solo le proprie famiglie
  const m = await fetch(`${url}/rest/v1/household_members?select=household_id&limit=1`, { headers, signal: AbortSignal.timeout(10_000) }).catch(() => null);
  const righe = m?.ok ? await m.json().catch(() => []) : [];
  if (!Array.isArray(righe) || !righe.length) return { status: 403, error: "Serve far parte di una famiglia" };
  return null;
}

// Liste e testi con una misura massima, così una richiesta non può gonfiare il prompt
export function limitaCampi(b: any) {
  if (!b || typeof b !== "object") return {};
  const testo = (x: any, n: number) => typeof x === "string" ? x.slice(0, n) : x;
  for (const k of ["pantry", "favorites", "liked", "disliked", "recent", "leftovers", "weekTitles"]) {
    if (b[k] !== undefined) b[k] = (Array.isArray(b[k]) ? b[k] : []).slice(0, 80).map((x: any) => testo(String(x ?? ""), 120));
  }
  for (const k of ["days", "current"]) if (Array.isArray(b[k])) b[k] = b[k].slice(0, 21);
  for (const k of ["notes", "hint", "problems", "portions", "seasonVeg", "current", "school"]) b[k] = testo(b[k], 2000);
  return b;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Metodo non consentito" }, 405);

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    return json({ error: "Manca la chiave ANTHROPIC_API_KEY nei secret di Supabase." }, 500);
  }

  // Solo chi fa parte di una famiglia del Menù (o Mark, con la chiave di servizio): la chiave pubblica dell'app non basta
  const accesso = await controllaAccesso(req.headers.get("Authorization") ?? "");
  if (accesso) return json({ error: accesso.error }, accesso.status);

  let body: any;
  try {
    const raw = await req.text();
    if (raw.length > 100_000) return json({ error: "Richiesta troppo grande" }, 413);
    body = limitaCampi(JSON.parse(raw));
  } catch {
    return json({ error: "Richiesta non valida" }, 400);
  }

  // Menù della mensa: niente AI, solo lettura del sito Ribò
  if (body.mode === "school") {
    // Al massimo 4 scuole diverse per richiesta
    const schools: { name: string; school: string }[] = (Array.isArray(body.schools) ? body.schools : [])
      .filter((x: any, i: number, a: any[]) => x?.school && a.findIndex((y: any) => y?.school === x.school && y?.name === x.name) === i)
      .slice(0, 4);
    const dates: string[] = (body.dates ?? []).slice(0, 7);
    if (!schools.length || !dates.length) return json({ error: "Mancano scuole o date." }, 400);
    const result: Record<string, unknown> = {};
    const errors: string[] = [];
    await Promise.all(schools.map(async (s) => {
      try {
        result[s.name] = await riboWeek(s.school, dates);
      } catch (e) {
        errors.push(`${s.name}: ${(e as Error).message}`);
      }
    }));
    return json({ result: { schools: result, errors } });
  }

  const prefs = `Dispensa base (già in casa): ${(body.pantry ?? []).join(", ") || "nessuna"}
Piatti preferiti: ${(body.favorites ?? []).join(", ") || "nessuno ancora"}
Piatti piaciuti alle bambine: ${(body.liked ?? []).join(", ") || "nessuno segnato"}
Piatti BOCCIATI (non proporli): ${(body.disliked ?? []).join(", ") || "nessuno"}
Piatti recenti da non ripetere: ${(body.recent ?? []).join(", ") || "nessuno"}
Porzioni: ${body.portions || "2 adulti e 2 bambine (10 e 4 anni)"}
Verdura di stagione questo mese: ${body.seasonVeg || "scegli tu, solo di stagione"}
Avanzi in frigo da usare nei primi giorni: ${(body.leftovers ?? []).join(", ") || "nessuno"}
Note della famiglia: ${body.notes || "nessuna"}`;

  let prompt: string;
  let schema: object;
  if (body.mode === "week") {
    prompt = `${prefs}

Prepara il menù di questa settimana:
${describeWeek(body.days ?? [])}

Restituisci un elemento per ogni giorno, nello stesso ordine, con la stessa data.
In leftovers_used metti gli avanzi della lista che hai davvero usato.`;
    schema = weekSchema;
  } else if (body.mode === "fix") {
    prompt = `${prefs}

Questo è il menù della settimana (data, pasto, piatto, proteina):
${(body.current ?? []).map((x: any) => `- ${x.date} ${x.slot === "lunch" ? "pranzo" : "cena"}: ${x.title} [${x.protein}${x.verdura ? ", con verdura" : ", SENZA verdura"}]${x.school ? ` (a scuola: ${x.school})` : ""}`).join("\n")}

Il controllo nutrizionale ha trovato questi squilibri:
${body.problems || "nessuno"}

Cambia il minimo indispensabile (al massimo 3 pasti) per sistemarli. Puoi cambiare solo i pasti elencati sopra.
Per ogni pasto cambiato mantieni lo stesso numero di persone e gli stessi limiti di tempo (feriali entro 30 minuti).
Se un pasto è senza verdura, puoi anche solo rifarlo aggiungendo un contorno di stagione.`;
    schema = fixSchema;
  } else if (body.mode === "swap") {
    prompt = `${prefs}

Proponi 1 piatto alternativo per ${body.slot === "lunch" ? "il pranzo" : "la cena"} di ${body.date}, per ${body.servings} persone.
Piatto da sostituire: ${body.current || "nessuno"}${body.protein ? ` (proteina: ${body.protein}; mantieni la stessa fonte proteica, così la settimana resta equilibrata)` : ""}.
Altri piatti già in settimana: ${(body.weekTitles ?? []).join(", ")}.
${body.school ? `A scuola quel giorno le bambine mangiano: ${body.school}.` : ""}
${body.quick ? "Deve essere pronto in massimo 30 minuti." : "Può essere più elaborato."}
${body.hint ? `Richiesta: ${body.hint}` : ""}`;
    schema = mealsSchema;
  } else if (body.mode === "reserve") {
    prompt = `${prefs}

Proponi 3 "pranzi di riserva" per quando una bambina resta a casa malata: semplici, leggeri, pronti in massimo 20 minuti,
fatti SOLO con ingredienti a lunga conservazione (pasta, riso, legumi in scatola, tonno, passata, uova, formaggio stagionato, surgelati).
Per 2 persone (una bambina e un adulto). Qui gli ingredienti vanno elencati TUTTI, anche quelli della dispensa base.`;
    schema = mealsSchema;
  } else if (body.mode === "import") {
    let source = String(body.text || "").slice(0, 30000);
    if (body.url) {
      try {
        source = await pageText(String(body.url));
      } catch (e) {
        return json({ error: (e as Error).message }, 400);
      }
    }
    if (!source.trim()) return json({ error: "Incolla un link o il testo della ricetta." }, 400);
    prompt = `${prefs}

Trasforma questa ricetta in un piatto per la nostra famiglia (stesse porzioni per età).
Mantieni il piatto originale; adatta solo le quantità e semplifica i passaggi. Se manca la verdura, aggiungi un contorno di stagione negli ingredienti.
Restituisci 1 solo piatto.

Ricetta:
"""
${source}
"""`;
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
