// Mail di "evento aggiornato": legge l'invito .ics e lo confronta con l'agenda di Filo.
// Funzioni pure: le prova tests/eventi.test.mjs.

export type EventoIcs = {
  uid: string;
  titolo: string;
  inizio: Date | null;
  fine: Date | null;
  tuttoIlGiorno: boolean;
  metodo: string; // REQUEST, CANCEL, PUBLISH…
  annullato: boolean;
};

export type EventoFilo = { id: string; title: string | null; start_at: string; end_at: string | null; all_day?: boolean | null; source?: string | null; link?: string | null };

export type Spostamento = {
  id: string;
  titolo: string;
  vecchioInizio: Date;
  nuovoInizio: Date;
  nuovaFine: Date | null;
  fonte: string;
  link: string | null;
};

// Outlook scrive i fusi con i nomi di Windows: quelli dell'Europa centrale valgono come Roma
const FUSI_WINDOWS: Record<string, string> = {
  "w. europe standard time": "Europe/Rome",
  "romance standard time": "Europe/Paris",
  "central europe standard time": "Europe/Budapest",
  "central european standard time": "Europe/Warsaw",
  "gmt standard time": "Europe/London",
  "utc": "UTC",
};

function fusoValido(tz: string): string {
  const t = tz.replace(/^"|"$/g, "").trim();
  const w = FUSI_WINDOWS[t.toLowerCase()];
  if (w) return w;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: t });
    return t;
  } catch {
    return "Europe/Rome";
  }
}

// Ora "da parete" in un fuso → istante esatto, con l'ora legale giusta
export function daFuso(tz: string, y: number, m: number, d: number, h: number, mi: number, s = 0): Date {
  const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  let t = Date.UTC(y, m - 1, d, h, mi, s);
  for (let i = 0; i < 2; i++) {
    const p = Object.fromEntries(fmt.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
    const diff = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Date.UTC(y, m - 1, d, h, mi, s);
    t -= diff;
  }
  return new Date(t);
}

function leggiData(parametri: string, valore: string): { data: Date | null; giorno: boolean } {
  const v = valore.trim();
  const g = v.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (g || /VALUE=DATE(?!-)/i.test(parametri)) {
    const x = g ?? v.match(/^(\d{4})(\d{2})(\d{2})/);
    return x ? { data: new Date(Date.UTC(+x[1], +x[2] - 1, +x[3])), giorno: true } : { data: null, giorno: true };
  }
  const m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z?)$/);
  if (!m) return { data: null, giorno: false };
  const [y, mo, d, h, mi, s] = [+m[1], +m[2], +m[3], +m[4], +m[5], +(m[6] ?? 0)];
  if (m[7] === "Z") return { data: new Date(Date.UTC(y, mo - 1, d, h, mi, s)), giorno: false };
  const tz = parametri.match(/TZID=([^;:]+)/i)?.[1];
  return { data: daFuso(fusoValido(tz ?? "Europe/Rome"), y, mo, d, h, mi, s), giorno: false };
}

function testoIcs(v: string): string {
  return v.replace(/\\n/gi, " ").replace(/\\([,;\\])/g, "$1").trim();
}

// Legge gli eventi di un file .ics (solo i campi che servono a capire se l'orario è cambiato)
export function leggiIcs(ics: string): EventoIcs[] {
  // Le righe lunghe continuano sulla riga dopo con uno spazio o un tab davanti
  const righe = ics.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
  const metodo = (righe.find((r) => /^METHOD:/i.test(r)) ?? "").split(":")[1]?.trim().toUpperCase() ?? "";
  const eventi: EventoIcs[] = [];
  let ev: EventoIcs | null = null;
  for (const r of righe) {
    if (/^BEGIN:VEVENT/i.test(r)) {
      ev = { uid: "", titolo: "", inizio: null, fine: null, tuttoIlGiorno: false, metodo, annullato: metodo === "CANCEL" };
      continue;
    }
    if (!ev) continue;
    if (/^END:VEVENT/i.test(r)) {
      eventi.push(ev);
      ev = null;
      continue;
    }
    const i = r.indexOf(":");
    if (i < 0) continue;
    const testa = r.slice(0, i);
    const valore = r.slice(i + 1);
    const nome = testa.split(";")[0].toUpperCase();
    const parametri = testa.slice(nome.length);
    if (nome === "UID") ev.uid = valore.trim();
    else if (nome === "SUMMARY") ev.titolo = testoIcs(valore);
    else if (nome === "STATUS" && /CANCELLED/i.test(valore)) ev.annullato = true;
    else if (nome === "DTSTART") {
      const d = leggiData(parametri, valore);
      ev.inizio = d.data;
      ev.tuttoIlGiorno = d.giorno;
    } else if (nome === "DTEND") ev.fine = leggiData(parametri, valore).data;
  }
  return eventi;
}

// "Aggiornato: Coaching Call Titany @ lun 23 nov" → parole che contano per il confronto
const PREFISSI = /^(aggiornat[oa]|aggiornamento|updated|update|modificat[oa]|spostat[oa]|nuovo orario|invito( aggiornato)?|updated invitation|invitation|accepted|accettato|rescheduled|fw|fwd|r|re|i)\s*:\s*/i;
const VUOTE = new Set(["con", "per", "del", "della", "dei", "the", "with", "and", "una", "uno", "call", "meeting", "riunione", "evento"]);

export function paroleTitolo(t: string): string[] {
  let s = t.toLowerCase();
  for (let i = 0; i < 4 && PREFISSI.test(s); i++) s = s.replace(PREFISSI, "");
  s = s.split(/\s@\s|\s-\s\d|\(\s*\d/)[0];
  return [...new Set(s.normalize("NFD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !VUOTE.has(w)))];
}

export function titoliSimili(a: string, b: string): boolean {
  const pa = paroleTitolo(a), pb = paroleTitolo(b);
  if (!pa.length || !pb.length) return false;
  const comuni = pa.filter((w) => pb.includes(w)).length;
  return comuni / Math.min(pa.length, pb.length) >= 0.6;
}

// Evento della mail vs Filo: se in Filo c'è lo stesso evento (titolo simile, entro 7 giorni) con un altro orario, è uno spostamento.
// Se in Filo c'è già uno con l'orario nuovo, non c'è niente da correggere.
export function trovaSpostamento(ev: EventoIcs, filo: EventoFilo[]): Spostamento | null {
  if (!ev.inizio || ev.annullato || ev.tuttoIlGiorno || !ev.titolo) return null;
  const nuovo = ev.inizio.getTime();
  const simili = filo.filter((f) => !f.all_day && f.title && titoliSimili(ev.titolo, f.title) && Math.abs(new Date(f.start_at).getTime() - nuovo) <= 7 * 864e5);
  if (!simili.length || simili.some((f) => Math.abs(new Date(f.start_at).getTime() - nuovo) < 60_000)) return null;
  // Il più vicino all'orario nuovo
  const f = simili.sort((x, y) => Math.abs(new Date(x.start_at).getTime() - nuovo) - Math.abs(new Date(y.start_at).getTime() - nuovo))[0];
  const durata = f.end_at ? new Date(f.end_at).getTime() - new Date(f.start_at).getTime() : null;
  return {
    id: f.id,
    titolo: f.title ?? ev.titolo,
    vecchioInizio: new Date(f.start_at),
    nuovoInizio: ev.inizio,
    nuovaFine: ev.fine ?? (durata !== null ? new Date(nuovo + durata) : null),
    fonte: f.source ?? "",
    link: f.link ?? null,
  };
}
