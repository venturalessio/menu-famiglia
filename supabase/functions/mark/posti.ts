// Posizione di Alessio e schede dei locali (foto + link per prenotare).
// Funzioni pure: le prova tests/posti.test.mjs.

export const POSIZIONE_VALIDA_MINUTI = 180; // dopo 3 ore la posizione è vecchia e non si usa
export const MAX_FOTO = 4;

export type Posizione = { lat: number; lon: number; quando: number };

/** Posizione mandata dal bot: numeri veri, nel mondo, non più vecchia di 3 ore. Altrimenti null. */
export function posizioneValida(p: unknown, adesso = Date.now()): Posizione | null {
  if (!p || typeof p !== "object") return null;
  const o = p as Record<string, unknown>;
  const lat = Number(o.lat), lon = Number(o.lon), quando = Number(o.quando);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(quando)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  // quando è in secondi (Telegram); un orologio un po' avanti è tollerato
  const eta = adesso / 1000 - quando;
  if (eta > POSIZIONE_VALIDA_MINUTI * 60 || eta < -300) return null;
  return { lat: Math.round(lat * 1e5) / 1e5, lon: Math.round(lon * 1e5) / 1e5, quando };
}

/** Nome leggibile della zona dalla risposta di Nominatim (reverse). */
export function nomeZona(nominatim: unknown): string {
  const a = (nominatim as any)?.address;
  if (!a || typeof a !== "object") return "";
  const parti = [
    a.road && a.house_number ? `${a.road} ${a.house_number}` : a.road,
    a.neighbourhood ?? a.suburb ?? a.quarter,
    a.city ?? a.town ?? a.village ?? a.municipality,
    a.country,
  ].filter((x) => typeof x === "string" && x.trim());
  return [...new Set(parti as string[])].join(", ").slice(0, 160);
}

/** Riga da aggiungere alla domanda di Alessio quando ha condiviso la posizione. */
export function testoPosizione(p: Posizione, zona: string, adesso = Date.now()): string {
  const minuti = Math.max(0, Math.round((adesso / 1000 - p.quando) / 60));
  const quando = minuti < 2 ? "adesso" : `${minuti} minuti fa`;
  return `(Posizione di Alessio, condivisa ${quando} da Telegram: ${p.lat}, ${p.lon}${zona ? `, zona ${zona}` : ""}. ` +
    `Vale per "qui", "in zona", "vicino a me": cerca intorno a questo punto, non a Bologna.)`;
}

const HOST_VIETATI = /^(localhost|.*\.local|.*\.internal|metadata\.google\.internal)$/i;

/** Solo https verso un nome pubblico: niente indirizzi IP, localhost o reti interne. */
export function urlPubblico(u: unknown): string | null {
  let url: URL;
  try {
    url = new URL(String(u ?? "").trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  if (!host.includes(".") || HOST_VIETATI.test(host)) return null;
  if (/^[\d.]+$/.test(host) || host.startsWith("[") || host.includes(":")) return null;
  return url.toString();
}

function decodifica(s: string) {
  return s.replace(/&amp;/g, "&").replace(/&#0*38;/g, "&").replace(/&quot;/g, '"').replace(/&#x2F;/gi, "/").trim();
}

/** Immagine di anteprima di una pagina (og:image, twitter:image, image_src), come URL https assoluto. */
export function immagineDaHtml(html: string, base: string): string | null {
  const meta = html.match(/<meta\b[^>]*>/gi) ?? [];
  const cerca = (nomi: string[]) => {
    for (const tag of meta) {
      const chiave = tag.match(/\b(?:property|name|itemprop)\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase();
      if (!chiave || !nomi.includes(chiave)) continue;
      const valore = tag.match(/\bcontent\s*=\s*["']([^"']+)["']/i)?.[1];
      if (valore) return valore;
    }
    return null;
  };
  const link = html.match(/<link\b[^>]*rel\s*=\s*["']image_src["'][^>]*>/i)?.[0]?.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1];
  const trovato = cerca(["og:image:secure_url", "og:image", "og:image:url", "twitter:image", "twitter:image:src", "image"]) ?? link;
  if (!trovato) return null;
  try {
    return urlPubblico(new URL(decodifica(trovato), base).toString());
  } catch {
    return null;
  }
}

/** Didascalia della foto su Telegram (massimo 1024 caratteri): nome, nota, link per prenotare. */
export function didascaliaLocale(nome: string, nota: string, prenota: string | null, pagina: string | null, mappa = ""): string {
  const righe = [nome.trim().slice(0, 120), nota.trim().slice(0, 500)];
  if (prenota) righe.push(`Prenota: ${prenota}`);
  else if (pagina) righe.push(pagina);
  if (mappa) righe.push(`Mappa: ${mappa}`);
  return righe.filter(Boolean).join("\n").slice(0, 1024);
}

/** Link di Google Maps che cerca il locale: apre la scheda con foto, recensioni e, dove c'è, il tasto per prenotare. */
export function linkMappa(nome: string, indirizzo: string): string {
  const q = [nome.trim(), indirizzo.trim()].filter(Boolean).join(", ").slice(0, 200);
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

/** Coordinate del primo risultato di una ricerca Nominatim, oppure null. */
export function coordinateDaRicerca(risultati: unknown): { lat: number; lon: number } | null {
  const r = Array.isArray(risultati) ? risultati[0] : null;
  const lat = Number(r?.lat), lon = Number(r?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

/** Pagina che elenca tanti locali (classifiche, ricerche): la sua foto non è del locale scelto. */
export function paginaElenco(u: string): boolean {
  let url: URL;
  try {
    url = new URL(u);
  } catch {
    return false;
  }
  const host = url.hostname.replace(/^www\./, "");
  const p = url.pathname;
  if (/(^|\.)tripadvisor\./.test(host)) return !/Restaurant_Review|Hotel_Review|Attraction_Review/.test(p);
  if (/(^|\.)thefork\./.test(host)) return !/^\/ristorante\/|^\/restaurant\//.test(p);
  if (host.startsWith("google.") && p.startsWith("/search")) return true;
  return /\/(search|ricerca|cerca)(\/|$)|migliori|classifica|\btop-?\d+/i.test(p);
}

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Didascalia per Telegram in HTML: nome in grassetto, nota, e i link come parole corte. */
export function didascaliaHtml(nome: string, nota: string, prenota: string | null, pagina: string | null, mappa = ""): string {
  const link = [
    prenota ? `<a href="${esc(prenota)}">Prenota</a>` : pagina ? `<a href="${esc(pagina)}">Pagina del locale</a>` : "",
    mappa ? `<a href="${esc(mappa)}">Apri in Maps</a>` : "",
  ].filter(Boolean).join(" · ");
  const testo = [`<b>${esc(nome.trim().slice(0, 120))}</b>`, esc(nota.trim().slice(0, 500)), link].filter(Boolean).join("\n");
  return testo.length <= 1024 ? testo : [`<b>${esc(nome.trim().slice(0, 120))}</b>`, link].join("\n");
}
