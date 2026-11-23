// Pannello "Jarvis" di Mark: agenda, casa, promemoria e meteo a colpo d'occhio,
// e una sfera che ascolta e risponde a voce. Gratis: voce del browser, meteo Open-Meteo.
// Usa la stessa chiave della web-app di Mark (stessa memoria del browser).
import { SUPABASE_URL, SUPABASE_KEY } from "../config.js";
import { creaSfera } from "./sfera.js";

const FN_URL = `${SUPABASE_URL}/functions/v1/mark`;
const BOLOGNA = { lat: 44.4949, lon: 11.3426 };
const OGNI_DATI = 5 * 60_000;
const OGNI_METEO = 30 * 60_000;

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const linkify = (s) => esc(s).replace(/https:\/\/[^\s<>"']+/g, (u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u.length > 40 ? u.slice(0, 37) + "…" : u}</a>`);

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* memoria non disponibile */ } },
};

let chiave = store.get("mark.key", "");
let sfera = null;

async function api(body) {
  const res = await fetch(FN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY, "x-mark-key": chiave },
    body: JSON.stringify(body),
  });
  let data = {};
  try { data = await res.json(); } catch { /* vuota */ }
  if (res.status === 401) {
    chiave = "";
    store.set("mark.key", "");
    mostraChiave();
    throw new Error(data.error || "Chiave non valida");
  }
  if (!res.ok) throw new Error(data.error || `Errore ${res.status}`);
  return data;
}

// ---------- stato della sfera ----------

const ETICHETTE = { riposo: "Tocca la sfera e parla", ascolto: "Ti ascolto", penso: "Ci penso", parlo: "Mark", errore: "Qualcosa non va" };
function stato(s, testo) {
  document.body.dataset.stato = s;
  sfera?.stato(s);
  $("#stato").textContent = testo ?? ETICHETTE[s] ?? "";
}

// ---------- orologio e meteo ----------

function orologio() {
  const d = new Date();
  $("#ora").textContent = d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
  $("#data").textContent = d.toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" });
  segnaOraAgenda();
}

// Codici meteo WMO → parole
function cielo(c) {
  if (c === 0) return "sereno";
  if (c <= 2) return "poco nuvoloso";
  if (c === 3) return "coperto";
  if (c === 45 || c === 48) return "nebbia";
  if (c >= 51 && c <= 57) return "pioviggine";
  if (c >= 61 && c <= 67) return "pioggia";
  if (c >= 71 && c <= 77) return "neve";
  if (c >= 80 && c <= 82) return "rovesci";
  if (c === 85 || c === 86) return "rovesci di neve";
  if (c >= 95) return "temporale";
  return "";
}

async function meteo() {
  try {
    const u = `https://api.open-meteo.com/v1/forecast?latitude=${BOLOGNA.lat}&longitude=${BOLOGNA.lon}&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=Europe%2FRome&forecast_days=1`;
    const r = await (await fetch(u)).json();
    const t = Math.round(r.current.temperature_2m);
    const c = cielo(r.current.weather_code);
    const max = Math.round(r.daily.temperature_2m_max[0]);
    const min = Math.round(r.daily.temperature_2m_min[0]);
    const pioggia = r.daily.precipitation_probability_max[0];
    $("#meteo").innerHTML = `<strong>${t}° · ${esc(c)}</strong>Bologna · min ${min}° max ${max}°${pioggia >= 30 ? ` · pioggia ${pioggia}%` : ""}`;
  } catch {
    $("#meteo").innerHTML = `<span class="dim">Meteo non disponibile</span>`;
  }
}

// ---------- dati di Mark ----------

function vuoto(testo) { return `<li class="vuoto">${esc(testo)}</li>`; }

function disegnaAgenda(d) {
  const piano = d.piano;
  $("#piano").innerHTML = piano
    ? `<p class="piano">${esc(piano.titolo)}${piano.attenzione.map((a) => `<span class="att">⚠ ${esc(a)}</span>`).join("")}</p>`
    : "";
  $("#agenda").innerHTML = d.agenda.length
    ? d.agenda.map((v) => `<li data-inizio="${esc(v.ora === "tutto il giorno" ? "" : v.inizio)}">
        <span class="t">${esc(v.ora === "tutto il giorno" ? "giorno" : v.ora)}</span>
        <span class="cosa">${esc(v.titolo)}${v.dove || v.nota ? `<span class="sub">${esc([v.dove, v.nota].filter(Boolean).join(" · "))}</span>` : ""}</span>
      </li>`).join("")
    : vuoto("Niente in agenda oggi.");
  segnaOraAgenda();
}

// Le voci passate si spengono, la prossima si accende
function segnaOraAgenda() {
  const adesso = Date.now();
  let prossima = null;
  document.querySelectorAll("#agenda li[data-inizio]").forEach((li) => {
    const t = Date.parse(li.dataset.inizio);
    li.classList.remove("ora-adesso");
    if (!t) return;
    li.querySelector(".t")?.classList.toggle("passato", t < adesso - 30 * 60_000);
    if (!prossima && t >= adesso - 30 * 60_000) prossima = li;
  });
  prossima?.classList.add("ora-adesso");
}

function disegnaCasa(c) {
  if (!c.ok) { $("#casa").innerHTML = vuoto(c.errore || "Casa non raggiungibile."); return; }
  const lista = c.dispositivi.slice(0, 10);
  $("#casa").innerHTML = lista.length
    ? lista.map((x) => `<li><span class="led ${!x.online ? "off-line" : x.acceso ? "on" : ""}" aria-hidden="true"></span>
        <span class="cosa">${esc(x.nome)}<span class="sub">${esc([x.stanza, x.online ? x.stato : "non in linea"].filter(Boolean).join(" · "))}</span></span></li>`).join("")
    : vuoto("Nessun dispositivo.");
}

function quandoBreve(iso) {
  const d = new Date(iso);
  const ora = d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === new Date().toDateString()) return ora;
  return `${d.toLocaleDateString("it-IT", { day: "numeric", month: "short" })}`;
}

function disegnaPromemoria(lista) {
  const l = (lista || []).slice(0, 6);
  $("#promemoria").innerHTML = l.length
    ? l.map((r) => `<li><span class="t">${esc(r.quando ? quandoBreve(r.quando) : "da fare")}</span><span class="cosa">${esc(r.testo)}</span></li>`).join("")
    : vuoto("Niente in lista.");
}

function disegnaPerTe(lista) {
  $("#perte").innerHTML = lista.length
    ? lista.map((m) => `<li><span class="t">${esc(quandoBreve(m.creato))}</span><span class="cosa">${linkify(m.messaggio)}<span class="sub">${esc(m.da)}</span></span></li>`).join("")
    : vuoto("Nessun messaggio aperto.");
}

let datiInCorso = false;
async function dati() {
  if (datiInCorso || !chiave) return;
  datiInCorso = true;
  try {
    const d = await api({ action: "pannello" });
    disegnaAgenda(d);
    disegnaCasa(d.casa);
    disegnaPromemoria(d.promemoria);
    disegnaPerTe(d.perTe);
    $("#aggiornato").textContent = `Aggiornato alle ${new Date(d.aggiornato).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}`;
  } catch (e) {
    $("#aggiornato").textContent = `Non aggiornato: ${e.message}`;
  } finally {
    datiInCorso = false;
  }
}

// ---------- voce ----------

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null;
let parlando = false;

function ascolta() {
  if (rec) { rec.stop(); return; }
  if (!Recognition) {
    $("#testo").focus();
    stato("riposo", "Qui la voce non c'è: scrivi o usa il microfono della tastiera");
    return;
  }
  speechSynthesis.cancel();
  rec = new Recognition();
  rec.lang = "it-IT";
  rec.interimResults = true;
  rec.continuous = false;
  let testo = "";
  const questo = rec;
  stato("ascolto");
  $("#io").textContent = "";
  rec.onresult = (e) => {
    testo = [...e.results].map((r) => r[0].transcript).join("");
    $("#io").textContent = testo;
  };
  rec.onerror = (e) => {
    if (e.error === "not-allowed" || e.error === "service-not-allowed") stato("errore", "Serve il permesso per il microfono");
  };
  rec.onend = () => {
    rec = null;
    if (questo.annullato) { stato("riposo"); return; }
    if (testo.trim()) chiedi(testo.trim());
    else if (document.body.dataset.stato === "ascolto") stato("riposo");
  };
  rec.start();
}

function vocePreferita() {
  const voci = speechSynthesis.getVoices().filter((v) => v.lang?.toLowerCase().startsWith("it"));
  // Voci maschili italiane note (Apple, Google, Microsoft), altrimenti la prima italiana
  return voci.find((v) => /luca|diego|cosimo|giorgio|google italiano/i.test(v.name)) ?? voci[0];
}

function parla(testo, poi) {
  if (!("speechSynthesis" in window)) { stato("riposo"); poi?.(); return; }
  speechSynthesis.cancel();
  // Niente link letti ad alta voce
  const pulito = testo.replace(/https?:\/\/\S+/g, "").replace(/[*_#`]/g, "").trim();
  const u = new SpeechSynthesisUtterance(pulito);
  u.lang = "it-IT";
  const v = vocePreferita();
  if (v) u.voice = v;
  u.rate = 1.02;
  u.pitch = 0.9;
  // Alcuni browser non mandano gli eventi delle parole: la sfera pulsa comunque
  let battito = null;
  u.onstart = () => {
    parlando = true;
    stato("parlo");
    battito = setInterval(() => sfera?.colpo(0.35 + Math.random() * 0.4), 140);
  };
  u.onboundary = () => sfera?.colpo(0.6);
  const fine = () => {
    if (!parlando) return;
    parlando = false;
    clearInterval(battito);
    stato("riposo");
    poi?.();
  };
  u.onend = fine;
  u.onerror = fine;
  speechSynthesis.speak(u);
  // Se la voce non parte (nessuna voce installata, audio bloccato) la sfera non resta su "Ci penso"
  setTimeout(() => {
    if (parlando || document.body.dataset.stato !== "penso") return;
    speechSynthesis.cancel();
    stato("riposo");
    poi?.();
  }, 2500);
}

let inAttesa = false;
async function chiedi(testo) {
  if (inAttesa) return;
  inAttesa = true;
  $("#io").textContent = testo;
  $("#risposta").textContent = "";
  stato("penso");
  try {
    // L'azione "siri" risponde in modo adatto alla voce e ricorda gli ultimi 15 minuti
    const r = await api({ action: "siri", testo });
    $("#risposta").innerHTML = linkify(r.risposta);
    // Se Mark fa una domanda, riapre il microfono da solo: conversazione a mani libere
    parla(r.risposta, r.continua && Recognition ? () => setTimeout(ascolta, 250) : null);
    if (/accend|spegn|ricord|promemoria|tapparell|luce|luci/i.test(testo)) setTimeout(dati, 2500);
  } catch (e) {
    $("#risposta").textContent = e.message;
    stato("errore", "Mark non ha risposto");
    setTimeout(() => stato("riposo"), 4000);
  } finally {
    inAttesa = false;
  }
}

// Su iPhone la voce parte solo dopo un tocco vero: la "sblocchiamo" al primo tocco
function sbloccaVoce() {
  if (!("speechSynthesis" in window)) return;
  const u = new SpeechSynthesisUtterance(" ");
  u.volume = 0;
  speechSynthesis.speak(u);
  document.removeEventListener("touchend", sbloccaVoce, true);
  document.removeEventListener("click", sbloccaVoce, true);
}

// ---------- schermo sempre acceso (tablet in casa) ----------

let lock = null;
async function schermo(on) {
  const btn = $("#schermo");
  try {
    if (on && "wakeLock" in navigator) {
      lock = await navigator.wakeLock.request("screen");
      lock.addEventListener("release", () => { lock = null; btn.setAttribute("aria-pressed", "false"); });
      btn.setAttribute("aria-pressed", "true");
      store.set("mark.pannello.schermo", true);
    } else {
      await lock?.release();
      lock = null;
      btn.setAttribute("aria-pressed", "false");
      store.set("mark.pannello.schermo", false);
    }
  } catch {
    btn.setAttribute("aria-pressed", "false");
  }
}

// ---------- avvio ----------

function mostraChiave() {
  $("#pannello").classList.add("hidden");
  $("#chiave").classList.remove("hidden");
}

let avviato = false;
function avvia() {
  $("#chiave").classList.add("hidden");
  $("#pannello").classList.remove("hidden");
  if (avviato) { dati(); return; }
  avviato = true;
  sfera = creaSfera($("#sfera"));
  stato("riposo");
  orologio();
  setInterval(orologio, 15_000);
  meteo();
  setInterval(meteo, OGNI_METEO);
  dati();
  setInterval(() => { if (!document.hidden) dati(); }, OGNI_DATI);

  $("#sfera-btn").onclick = () => {
    if (parlando) { speechSynthesis.cancel(); return; }
    if (!inAttesa) ascolta();
  };
  document.querySelectorAll("[data-chiedi]").forEach((b) => (b.onclick = () => chiedi(b.dataset.chiedi)));
  $("#scrivi").onsubmit = (e) => {
    e.preventDefault();
    const t = $("#testo").value.trim();
    if (!t) return;
    $("#testo").value = "";
    chiedi(t);
  };
  $("#aggiorna").onclick = () => { dati(); meteo(); };
  $("#schermo").onclick = () => schermo(!lock);
  if (store.get("mark.pannello.schermo", false)) schermo(true);

  // Barra spaziatrice = parla (sul computer)
  document.addEventListener("keydown", (e) => {
    if (e.code === "Space" && document.activeElement?.tagName !== "INPUT") { e.preventDefault(); $("#sfera-btn").click(); }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      if (rec) { rec.annullato = true; try { rec.abort(); } catch { /* fermo */ } }
    } else {
      dati();
      if (store.get("mark.pannello.schermo", false) && !lock) schermo(true);
    }
  });
  if ("speechSynthesis" in window) speechSynthesis.getVoices();
  document.addEventListener("touchend", sbloccaVoce, true);
  document.addEventListener("click", sbloccaVoce, true);
}

$("#key-form").onsubmit = async (e) => {
  e.preventDefault();
  chiave = $("#key").value.trim();
  try {
    await api({ action: "salute" });
    // salute risponde ok anche senza chiave giusta: la prova vera è il pannello
    await api({ action: "pannello" });
    store.set("mark.key", chiave);
    avvia();
  } catch (err) {
    $("#key-err").textContent = err.message;
  }
};

if (chiave) avvia();
else mostraChiave();
