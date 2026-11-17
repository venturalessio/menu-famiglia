// Pezzi puri della skill Alexa "Mark": controllo della firma di Amazon, testo per la voce, risposte Alexa.
// Niente rete qui dentro, così si provano con node --test.
import * as x509 from "npm:@peculiar/x509@1.12.3";

// Amazon: il certificato deve stare su https://s3.amazonaws.com/echo.api/ (porta 443, percorso sensibile alle maiuscole)
export function urlCertificatoValido(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol.toLowerCase() !== "https:") return false;
  if (u.hostname.toLowerCase() !== "s3.amazonaws.com") return false;
  if (u.port && u.port !== "443") return false;
  // new URL normalizza "/echo.api/../" quindi un percorso che esce dalla cartella non passa
  return u.pathname.startsWith("/echo.api/");
}

export function certificatiDaPem(pem: string): string[] {
  return pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? [];
}

const daBase64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

// Controlla catena, scadenza, nome echo-api.amazon.com e firma del corpo. Restituisce il motivo del rifiuto, o null se va bene.
export async function controllaFirma(pem: string, firmaB64: string, corpo: string, ora = new Date()): Promise<string | null> {
  const pezzi = certificatiDaPem(pem);
  if (!pezzi.length) return "certificato vuoto";
  let certs: x509.X509Certificate[];
  try {
    certs = pezzi.map((p) => new x509.X509Certificate(p));
  } catch {
    return "certificato illeggibile";
  }
  const foglia = certs[0];
  for (const c of certs) {
    if (ora < c.notBefore || ora > c.notAfter) return "certificato scaduto";
  }
  const san = foglia.getExtension(x509.SubjectAlternativeNameExtension);
  const nomi = san ? san.names.items.filter((n) => n.type === "dns").map((n) => n.value.toLowerCase()) : [];
  if (!nomi.includes("echo-api.amazon.com")) return "certificato non di Alexa";
  // Ogni certificato della catena deve essere firmato dal successivo
  for (let i = 0; i < certs.length - 1; i++) {
    const ok = await certs[i].verify({ publicKey: certs[i + 1].publicKey, signatureOnly: true }).catch(() => false);
    if (!ok) return "catena non valida";
  }
  if (!firmaB64) return "firma mancante";
  try {
    const chiave = await foglia.publicKey.export({ name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, ["verify"]);
    const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", chiave, daBase64(firmaB64), new TextEncoder().encode(corpo));
    return ok ? null : "firma sbagliata";
  } catch {
    return "firma sbagliata";
  }
}

// Amazon chiede di rifiutare le richieste più vecchie di 150 secondi
export function orarioValido(timestamp: unknown, ora = new Date()): boolean {
  const t = new Date(String(timestamp ?? "")).getTime();
  return !isNaN(t) && Math.abs(ora.getTime() - t) <= 150_000;
}

// Il testo di Mark diventa parlabile: niente link, markdown, emoji, elenchi
export function perLaVoce(testo: string): string {
  return String(testo ?? "")
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "il link")
    .replace(/[*_`#>|~]+/g, "")
    .replace(/^\s*[-•]\s+/gm, "")
    .replace(/\p{Extended_Pictographic}|️/gu, "")
    .replace(/([.!?:;,])\s*\n+\s*/g, "$1 ")
    .replace(/\s*\n+\s*/g, ". ")
    .replace(/\.\s*\.+/g, ".")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// Taglia sul punto più vicino, per gli annunci di Voice Monkey (max 500 caratteri)
export function taglia(testo: string, max: number): { pezzo: string; tagliato: boolean } {
  const t = testo.trim();
  if (t.length <= max) return { pezzo: t, tagliato: false };
  const p = t.slice(0, max);
  const fine = Math.max(p.lastIndexOf(". "), p.lastIndexOf("? "), p.lastIndexOf("! "));
  return { pezzo: (fine > max / 2 ? p.slice(0, fine + 1) : p).trimEnd(), tagliato: true };
}

const ssml = (t: string) => t.replace(/&/g, " e ").replace(/[<>]/g, " ");

export function risposta(frase: string, apri = false, riprova?: string) {
  const r: any = {
    version: "1.0",
    response: {
      outputSpeech: { type: "SSML", ssml: `<speak>${ssml(frase).slice(0, 7900)}</speak>` },
      shouldEndSession: !apri,
    },
  };
  if (apri) r.response.reprompt = { outputSpeech: { type: "PlainText", text: riprova ?? "Ti ascolto." } };
  return r;
}

// Cosa ha detto Alessio, o quale caso speciale gestire
export type Richiesta =
  | { tipo: "apertura" }
  | { tipo: "fine" }
  | { tipo: "stop" }
  | { tipo: "aiuto" }
  | { tipo: "non capito" }
  | { tipo: "domanda"; testo: string };

export function leggiRichiesta(r: any): Richiesta {
  const tipo = r?.request?.type;
  if (tipo === "LaunchRequest") return { tipo: "apertura" };
  if (tipo === "SessionEndedRequest") return { tipo: "fine" };
  if (tipo !== "IntentRequest") return { tipo: "fine" };
  const intent = r.request.intent ?? {};
  const nome = String(intent.name ?? "");
  if (nome === "AMAZON.StopIntent" || nome === "AMAZON.CancelIntent" || nome === "AMAZON.NavigateHomeIntent") return { tipo: "stop" };
  if (nome === "AMAZON.HelpIntent") return { tipo: "aiuto" };
  if (nome === "AMAZON.YesIntent") return { tipo: "domanda", testo: "sì" };
  if (nome === "AMAZON.NoIntent") return { tipo: "domanda", testo: "no" };
  if (nome === "DomandaIntent") {
    const testo = String(intent.slots?.testo?.value ?? "").trim();
    return testo ? { tipo: "domanda", testo } : { tipo: "non capito" };
  }
  return { tipo: "non capito" };
}
