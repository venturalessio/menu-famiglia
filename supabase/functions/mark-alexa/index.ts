// Skill Alexa privata "Mark": "Alexa, chiedi a Mark ...".
// Alexa chiama questa funzione (senza JWT, perché Alexa non sa mandarlo): qui si controlla che la richiesta
// venga davvero da Amazon e dalla skill di Alessio, poi si gira la frase a Mark (azione "siri", stessa memoria
// di 15 minuti e stesse regole: i comandi alla casa vogliono il sì).
// Alexa aspetta al massimo 8 secondi: se Mark ci mette di più, l'Echo dice "ci penso" e la risposta arriva
// dopo con un annuncio Voice Monkey (e su Telegram se è lunga o se l'annuncio non va).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { controllaFirma, leggiRichiesta, orarioValido, perLaVoce, risposta, taglia, urlCertificatoValido } from "./alexa.ts";

// L'ID della skill non è un segreto: lo si può mettere qui o nel secret ALEXA_SKILL_ID
const ID_SKILL = "";
// Nome o id dell'Echo di Voice Monkey per le risposte lente (vuoto = il primo, come gli altri annunci di Mark)
const ECHO = "";
const ATTESA_MS = 6500;

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json;charset=UTF-8" } });

const certificati = new Map<string, { at: number; pem: string }>();
async function certificato(url: string) {
  const c = certificati.get(url);
  if (c && Date.now() - c.at < 3600_000) return c.pem;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`certificato ${res.status}`);
  const pem = await res.text();
  certificati.set(url, { at: Date.now(), pem });
  return pem;
}

async function chiediMark(testo: string): Promise<{ risposta: string; continua: boolean }> {
  const url = Deno.env.get("SUPABASE_URL");
  const jwt = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const res = await fetch(`${url}/functions/v1/mark`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${jwt}`,
      apikey: jwt,
      "x-mark-key": Deno.env.get("MARK_ACCESS_KEY") ?? "",
    },
    body: JSON.stringify({ action: "siri", testo }),
    signal: AbortSignal.timeout(140_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || typeof data.risposta !== "string") {
    console.error("mark", res.status, JSON.stringify(data).slice(0, 200));
    return { risposta: "Ho avuto un problema, riprova tra poco.", continua: false };
  }
  return { risposta: data.risposta, continua: Boolean(data.continua) };
}

async function voiceMonkey(path: string, body: Record<string, unknown> = {}) {
  const token = Deno.env.get("VOICEMONKEY_TOKEN") ?? "";
  if (!token) throw new Error("manca VOICEMONKEY_TOKEN");
  const res = await fetch(`https://api-v3.voicemonkey.io${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) throw new Error(`voice monkey ${String(data.error ?? res.status)}`);
  return data;
}

// Come gli altri annunci di Mark: il primo altoparlante di Voice Monkey, oppure quello scelto con ALEXA_ECHO
async function annuncia(testo: string) {
  const casse = ((await voiceMonkey("/devices")).data ?? []).filter((d: any) => d.capability === "speakers");
  const scelto = Deno.env.get("ALEXA_ECHO") ?? ECHO;
  const cassa = casse.find((d: any) => d.id === scelto || d.name === scelto) ?? casse[0];
  if (!cassa) throw new Error("nessun Echo in Voice Monkey");
  await voiceMonkey("/announce", { device: cassa.id, speech: testo, language: "it-IT" });
}

async function suTelegram(testo: string) {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const res = await fetch(`${url}/rest/v1/mark_avvisi_coda`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify([{ fonte: "alexa", testo: testo.slice(0, 1500) }]),
  });
  if (!res.ok) throw new Error(`coda ${res.status}`);
}

// Risposta arrivata dopo gli 8 secondi di Alexa
async function consegna(r: { risposta: string }) {
  const { pezzo, tagliato } = taglia(perLaVoce(r.risposta), 440);
  let annunciato = false;
  try {
    await annuncia(`Alessio, ${pezzo}${tagliato ? " Il resto te l'ho scritto su Telegram." : ""}`);
    annunciato = true;
  } catch (err) {
    console.error("annuncio", String(err));
  }
  if (tagliato || !annunciato) await suTelegram(`Risposta di Mark dall'Echo:\n${r.risposta}`);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Metodo non consentito" }, 405);
  const corpo = await req.text();
  let r: any;
  try {
    r = JSON.parse(corpo);
  } catch {
    return json({ error: "Richiesta non valida" }, 400);
  }

  // 1. Viene davvero da Alexa? (firma di Amazon sul corpo, certificato di Amazon, richiesta recente)
  const certUrl = req.headers.get("SignatureCertChainUrl") ?? "";
  if (!urlCertificatoValido(certUrl)) return json({ error: "Firma non valida" }, 400);
  try {
    const motivo = await controllaFirma(await certificato(certUrl), req.headers.get("Signature-256") ?? "", corpo);
    if (motivo) {
      console.error("firma", motivo);
      return json({ error: "Firma non valida" }, 400);
    }
  } catch (err) {
    console.error("certificato", String(err));
    return json({ error: "Firma non valida" }, 400);
  }
  if (!orarioValido(r?.request?.timestamp)) return json({ error: "Richiesta scaduta" }, 400);

  // 2. Viene dalla skill di Alessio?
  const idSkill = (Deno.env.get("ALEXA_SKILL_ID") ?? ID_SKILL).trim();
  const appId = r?.session?.application?.applicationId ?? r?.context?.System?.application?.applicationId;
  if (!idSkill) {
    console.log("skill da collegare", appId);
    return json(risposta("Mark non è ancora collegato a questa skill: manca l'ID della skill."));
  }
  if (appId !== idSkill) return json({ error: "Skill non riconosciuta" }, 400);

  // 3. Cosa vuole
  const q = leggiRichiesta(r);
  switch (q.tipo) {
    case "fine":
      return json({ version: "1.0", response: {} });
    case "apertura":
      return json(risposta("Ciao Alessio, dimmi.", true));
    case "aiuto":
      return json(risposta("Chiedimi quello che mi chiederesti su Telegram, per esempio: che impegni ho domani. Per chiudere di' stop.", true));
    case "stop":
      return json(risposta("A dopo."));
    case "non capito":
      return json(risposta("Non ho capito, ripeti?", true));
  }

  const inizio = Date.now();
  const lavoro = chiediMark(q.testo);
  const presto = await Promise.race([lavoro, new Promise<null>((ok) => setTimeout(() => ok(null), ATTESA_MS))]);
  if (presto) {
    console.log("alexa", Date.now() - inizio, "ms");
    const frase = perLaVoce(presto.risposta) || "Fatto.";
    return json(risposta(frase, presto.continua, "Ti ascolto."));
  }
  // Troppo lento per Alexa: la risposta arriva dopo, dall'Echo stesso
  const dopo = lavoro.then(consegna).catch((err) => console.error("consegna", String(err)));
  (globalThis as any).EdgeRuntime?.waitUntil(dopo);
  return json(risposta("Ci sto pensando, te lo dico tra poco."));
});
