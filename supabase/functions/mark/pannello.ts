// Dati del pannello "Jarvis" di Mark: agenda di oggi e casa, già pronti da mostrare.
// Funzioni pure: le prova tests/pannello.test.mjs.

export type VoceAgenda = { ora: string; inizio: string; titolo: string; dove: string; tipo: "evento" | "famiglia" | "promemoria" | "attivita"; nota: string };
export type VoceCasa = { nome: string; stanza: string; online: boolean; stato: string; acceso: boolean | null };

const ROMA = "Europe/Rome";
const oraRoma = (iso: string) => new Date(iso).toLocaleTimeString("it-IT", { timeZone: ROMA, hour: "2-digit", minute: "2-digit" });

// Eventi, accompagnamenti, promemoria e attività di oggi in un'unica lista in ordine di orario.
// nome: id persona → nome, per dire chi porta e chi prende le bambine.
export function agendaPannello(
  ev: any[], occ: any[], rem: any[], tk: any[], nome: Map<string, string>,
): VoceAgenda[] {
  const voci: VoceAgenda[] = [];
  for (const e of ev ?? []) {
    voci.push({
      ora: e.all_day ? "tutto il giorno" : oraRoma(e.start_at),
      inizio: e.all_day ? String(e.start_at).slice(0, 10) + "T00:00:00Z" : e.start_at,
      titolo: String(e.title ?? "Evento"),
      dove: String(e.location ?? ""),
      tipo: "evento",
      nota: e.scope === "lavoro" ? "lavoro" : "",
    });
  }
  for (const o of occ ?? []) {
    if (o.status === "saltato") continue;
    const acc = o.needs_escort
      ? `porta ${nome.get(o.drop_off_by) ?? "da decidere"}, prende ${nome.get(o.pick_up_by) ?? "da decidere"}`
      : "";
    voci.push({
      ora: oraRoma(o.start_at),
      inizio: o.start_at,
      titolo: [o.who, o.title].filter(Boolean).join(" · ") || "Impegno di famiglia",
      dove: String(o.location ?? ""),
      tipo: "famiglia",
      nota: acc,
    });
  }
  for (const r of rem ?? []) {
    voci.push({ ora: oraRoma(r.at), inizio: r.at, titolo: String(r.text ?? ""), dove: "", tipo: "promemoria", nota: "" });
  }
  for (const t of tk ?? []) {
    if (!t.due) continue;
    voci.push({ ora: oraRoma(t.due), inizio: t.due, titolo: String(t.title ?? ""), dove: "", tipo: "attivita", nota: t.priority ? String(t.priority) : "" });
  }
  // "tutto il giorno" in cima, poi per orario
  return voci.sort((a, b) => {
    const ta = a.ora === "tutto il giorno" ? -1 : new Date(a.inizio).getTime();
    const tb = b.ora === "tutto il giorno" ? -1 : new Date(b.inizio).getTime();
    return ta - tb;
  });
}

// Dispositivi di casa per il pannello: accesi prima, poi per stanza; niente id interni.
export function casaPannello(list: any[]): VoceCasa[] {
  return (list ?? [])
    .map((d) => {
      const stato = String(d.stato ?? "");
      const acceso = /\bacces[oa]\b/.test(stato) ? true : /\bspent[oa]\b/.test(stato) ? false : null;
      return { nome: String(d.nome ?? ""), stanza: String(d.stanza ?? ""), online: Boolean(d.online), stato, acceso };
    })
    .sort((a, b) => Number(b.acceso === true) - Number(a.acceso === true) || a.stanza.localeCompare(b.stanza) || a.nome.localeCompare(b.nome));
}
