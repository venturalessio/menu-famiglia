// Web-app "Mark": leggere quello che fanno gli agenti e parlare con Mark, anche a voce.
// I dati stanno in Notion e passano dalla funzione Supabase "mark", protetta da una chiave personale.
import { SUPABASE_URL, SUPABASE_KEY } from "../config.js";

const FN_URL = `${SUPABASE_URL}/functions/v1/mark`;
const AGENTI = ["Capo-squadra", "Chiusura serale", "Architetto", "Preparatore riunioni", "Caccia migrazioni", "Dossier Sales Leader"];

const $ = (sel) => document.querySelector(sel);
const app = $("#app");

const store = {
  get(k, fallback) {
    try { const v = localStorage.getItem(k); return v === null ? fallback : JSON.parse(v); } catch { return fallback; }
  },
  set(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* memoria non disponibile */ }
  },
};

const state = {
  key: store.get("mark.key", ""),
  tab: store.get("mark.tab", "parla"),
  chat: store.get("mark.chat", []),
  voce: store.get("mark.voce", true),
  data: null,
  loading: false,
  error: "",
  sending: false,
};

// ---------- utilità ----------

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function quando(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const oggi = new Date();
  const ieri = new Date(Date.now() - 864e5);
  const ora = d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === oggi.toDateString()) return `oggi ${ora}`;
  if (d.toDateString() === ieri.toDateString()) return `ieri ${ora}`;
  return `${d.toLocaleDateString("it-IT", { weekday: "short", day: "numeric", month: "short" })} ${ora}`;
}

// Testo sicuro con i link https cliccabili
const linkify = (s) => esc(s).replace(/https:\/\/[^\s<>"']+/g, (u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u.length > 48 ? u.slice(0, 45) + "…" : u}</a>`);
const esitoPill = (e) => `<span class="pill ${e === "Ok" ? "ok" : e === "Parziale" ? "warn" : e === "Errore" ? "err" : ""}">${esc(e || "—")}</span>`;

async function api(body) {
  const res = await fetch(FN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SUPABASE_KEY}`,
      apikey: SUPABASE_KEY,
      "x-mark-key": state.key,
    },
    body: JSON.stringify(body),
  });
  let data = {};
  try { data = await res.json(); } catch { /* risposta vuota */ }
  if (res.status === 401) {
    state.key = "";
    store.set("mark.key", "");
    render();
    throw new Error(data.error || "Chiave non valida");
  }
  if (!res.ok) throw new Error(data.error || `Errore ${res.status}`);
  return data;
}

// Markdown semplice delle pagine Notion → HTML sicuro
function md(text) {
  const out = [];
  let list = false;
  let table = false;
  const close = () => {
    if (list) { out.push("</ul>"); list = false; }
    if (table) { out.push("</table>"); table = false; }
  };
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    const t = line.trim();
    if (/^\|.*\|$/.test(t)) {
      if (list) { out.push("</ul>"); list = false; }
      if (!table) { out.push("<table>"); table = true; }
      out.push(`<tr>${t.slice(1, -1).split("|").map((c) => `<td>${inline(c.trim())}</td>`).join("")}</tr>`);
      continue;
    }
    if (/^(- |1\. )/.test(t)) {
      if (table) { out.push("</table>"); table = false; }
      if (!list) { out.push("<ul>"); list = true; }
      out.push(`<li>${inline(t.replace(/^(- \[[ x]\] |- |1\. )/, (m) => (m.includes("[x]") ? "✓ " : m.includes("[ ]") ? "○ " : "")))}</li>`);
      continue;
    }
    close();
    if (!t) continue;
    if (t.startsWith("### ")) out.push(`<h3>${inline(t.slice(4))}</h3>`);
    else if (t.startsWith("## ")) out.push(`<h2>${inline(t.slice(3))}</h2>`);
    else if (t.startsWith("# ")) out.push(`<h1>${inline(t.slice(2))}</h1>`);
    else if (t.startsWith("> ")) out.push(`<blockquote>${inline(t.slice(2))}</blockquote>`);
    else if (t === "---") out.push("<hr>");
    else if (t !== "```") out.push(`<p>${inline(t)}</p>`);
  }
  close();
  return out.join("");
}

// ---------- dati ----------

async function carica() {
  state.loading = true;
  state.error = "";
  if (state.tab !== "parla") render();
  try {
    state.data = await api({ action: "panoramica" });
  } catch (e) {
    state.error = e.message;
  }
  state.loading = false;
  if (state.tab !== "parla") render();
}

// ---------- voce ----------

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null;

function ascolta(btn, input) {
  if (!Recognition) {
    input.focus();
    aggiungi("note", "Il riconoscimento vocale di Safari qui non è disponibile: usa il microfono della tastiera dell'iPhone.");
    return;
  }
  if (rec) { rec.stop(); return; }
  speechSynthesis.cancel();
  rec = new Recognition();
  rec.lang = "it-IT";
  rec.interimResults = true;
  rec.continuous = false;
  let finale = "";
  btn.classList.add("listening");
  rec.onresult = (e) => {
    let testo = "";
    for (const r of e.results) testo += r[0].transcript;
    input.value = testo;
    if (e.results[e.results.length - 1].isFinal) finale = testo;
  };
  rec.onerror = (e) => {
    if (e.error === "not-allowed") aggiungi("note", "Serve il permesso per il microfono: Impostazioni › Safari › Microfono.");
  };
  rec.onend = () => {
    btn.classList.remove("listening");
    rec = null;
    const testo = (finale || input.value).trim();
    if (testo) invia(testo);
  };
  rec.start();
}

function parla(testo, forza = false) {
  if (!("speechSynthesis" in window)) {
    if (forza) aggiungi("note", "Questo browser non ha la sintesi vocale.");
    return;
  }
  if (!state.voce && !forza) return;
  speechSynthesis.cancel();
  speechSynthesis.resume();
  const u = new SpeechSynthesisUtterance(testo);
  u.lang = "it-IT";
  const voce = speechSynthesis.getVoices().find((v) => v.lang?.startsWith("it"));
  if (voce) u.voice = voce;
  speechSynthesis.speak(u);
}

// ---------- chat ----------

function aggiungi(role, content) {
  state.chat.push({ role, content, at: Date.now() });
  state.chat = state.chat.slice(-40);
  store.set("mark.chat", state.chat);
  if (state.tab === "parla") disegnaChat();
}

async function invia(testo) {
  if (state.sending || !testo.trim()) return;
  const input = $("#msg");
  if (input) input.value = "";
  aggiungi("user", testo.trim());
  state.sending = true;
  disegnaChat();
  try {
    const messages = state.chat.filter((m) => m.role === "user" || m.role === "assistant").map(({ role, content }) => ({ role, content }));
    const r = await api({ action: "chat", messages });
    state.sending = false;
    aggiungi("assistant", r.risposta);
    for (const q of r.richieste ?? []) aggiungi("note", `Richiesta passata a ${q.a}: ${q.messaggio}`);
    for (const a of r.azioni ?? []) aggiungi("note", a);
    parla(r.risposta);
    if ((r.richieste ?? []).length) state.data = null;
  } catch (e) {
    state.sending = false;
    aggiungi("note", `Non sono riuscito a rispondere: ${e.message}`);
  }
}

function disegnaChat() {
  const box = $("#chat");
  if (!box) return;
  const items = state.chat.map((m, i) => {
    const cls = m.role === "user" ? "me" : m.role === "assistant" ? "mark" : "note";
    const ascolta = cls === "mark" ? `<button class="ascolta" data-i="${i}" aria-label="Ascolta la risposta"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 9a4 4 0 0 1 0 6"/></svg>Ascolta</button>` : "";
    return `<div class="bubble ${cls}">${linkify(m.content)}${ascolta}</div>`;
  });
  if (state.sending) items.push(`<div class="bubble mark typing">Mark ci sta pensando…</div>`);
  box.innerHTML = items.length
    ? items.join("")
    : `<div class="hint"><p>Tocca il microfono e parla, oppure scrivi. Per esempio:</p>
       <ul><li>"Cosa ho in agenda oggi secondo il brief?"</li>
       <li>"Chi sono i clienti da lavorare questa settimana?"</li>
       <li>"Chiedi al Preparatore di preparare la riunione di domani con Rossi."</li>
       <li>"Che dispositivi di casa vedi?"</li>
       <li>"Quanto costa un robot aspirapolvere Roborock Q7?"</li></ul></div>`;
  box.querySelectorAll(".ascolta").forEach((b) => {
    b.onclick = () => parla(state.chat[Number(b.dataset.i)].content, true);
  });
  requestAnimationFrame(() => window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" }));
}

// ---------- viste ----------

function vistaChiave() {
  $("#tabbar").classList.add("hidden");
  $("#refresh").classList.add("hidden");
  app.innerHTML = `
    <div class="card" style="margin-top:24px">
      <p class="title">Chiave di accesso</p>
      <p class="muted small">Mark legge dati di lavoro: entra solo chi ha la chiave. Si inserisce una volta sola su questo telefono.</p>
      <form id="key-form">
        <label class="field"><span>Chiave</span><input id="key" type="password" autocomplete="current-password" required></label>
        <button class="btn" type="submit">Entra</button>
        <p id="key-err" class="error small"></p>
      </form>
    </div>`;
  $("#key-form").onsubmit = async (e) => {
    e.preventDefault();
    state.key = $("#key").value.trim();
    try {
      state.data = await api({ action: "panoramica" });
      store.set("mark.key", state.key);
      render();
    } catch (err) {
      $("#key-err").textContent = err.message;
    }
  };
}

function vistaParla() {
  app.innerHTML = `<div id="chat" class="chat"></div>
    <form class="composer" id="composer">
      <button type="button" class="round ${state.voce ? "on" : ""}" id="voce" aria-label="Leggi le risposte ad alta voce" aria-pressed="${state.voce}">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z"/>${state.voce ? '<path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/>' : '<path d="M17 9l4 6M21 9l-4 6"/>'}</svg>
      </button>
      <textarea id="msg" rows="1" placeholder="Scrivi a Mark…" enterkeyhint="send"></textarea>
      <button type="button" class="round primary" id="mic" aria-label="Parla"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg></button>
    </form>`;
  const input = $("#msg");
  const mic = $("#mic");
  const setMic = () => {
    const hasText = input.value.trim().length > 0;
    mic.setAttribute("aria-label", hasText ? "Invia" : "Parla");
    mic.innerHTML = hasText
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6"/></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';
  };
  input.oninput = () => {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
    if (!rec) setMic();
  };
  input.onkeydown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); invia(input.value); setMic(); }
  };
  mic.onclick = () => {
    if (!rec && input.value.trim()) { invia(input.value); setMic(); input.style.height = "auto"; }
    else ascolta(mic, input);
  };
  $("#voce").onclick = () => {
    state.voce = !state.voce;
    store.set("mark.voce", state.voce);
    if (!state.voce) speechSynthesis.cancel();
    vistaParla();
  };
  disegnaChat();
}

function attesa() {
  if (state.error) return `<div class="card"><p class="error">${esc(state.error)}</p><button class="btn secondary" id="retry">Riprova</button></div>`;
  return `<p class="muted center" style="margin-top:32px">Leggo Notion…</p>`;
}

function vistaOggi() {
  const d = state.data;
  if (!d) { app.innerHTML = attesa(); return; }
  const perMe = d.bacheca.filter((m) => m.a === "Alessio" && m.stato === "Aperto");
  const ultimi = AGENTI.map((a) => d.diario.find((r) => r.agente === a)).filter(Boolean);
  app.innerHTML = `
    <h2 class="section">Per te</h2>
    ${perMe.length ? perMe.map((m) => `<div class="card"><div class="meta"><span class="pill">${esc(m.da)}</span>${esc(quando(m.creato))}</div><p class="title">${esc(m.messaggio)}</p>${m.dettagli ? `<p class="body muted small">${linkify(m.dettagli)}</p>` : ""}</div>`).join("") : `<div class="card muted">Nessun messaggio aperto per te.</div>`}
    <h2 class="section">Ultimo giro di ogni agente</h2>
    ${ultimi.length ? ultimi.map((r) => `<div class="card"><div class="meta"><strong style="color:var(--text)">${esc(r.agente)}</strong>${esitoPill(r.esito)}${esc(quando(r.creato))}</div><p class="body">${esc(r.riepilogo)}</p>${r.problemi ? `<p class="body small muted">Problemi: ${esc(r.problemi)}</p>` : ""}</div>`).join("") : `<div class="card muted">Il Diario è ancora vuoto.</div>`}
    <h2 class="section">Pagine aggiornate di recente</h2>
    ${d.pagine.slice(0, 3).map(pageCard).join("") || `<div class="card muted">Nessuna pagina.</div>`}`;
  collegaPagine();
}

function vistaBacheca() {
  const d = state.data;
  if (!d) { app.innerHTML = attesa(); return; }
  app.innerHTML = `
    <button class="btn" id="nuova" style="width:100%;margin:8px 0 4px">Nuova richiesta a un agente</button>
    <h2 class="section">Messaggi</h2>
    ${d.bacheca.map((m) => `<div class="card"><div class="meta"><span>${esc(m.da)} → ${esc(m.a)}</span><span class="pill ${m.stato === "Fatto" ? "ok" : "warn"}">${esc(m.stato)}</span>${esc(quando(m.creato))}</div><p class="title">${esc(m.messaggio)}</p>${m.dettagli ? `<p class="body muted small">${linkify(m.dettagli)}</p>` : ""}</div>`).join("") || `<div class="card muted">La Bacheca è vuota.</div>`}`;
  $("#nuova").onclick = nuovaRichiesta;
}

function nuovaRichiesta() {
  apriSheet("Nuova richiesta", `
    <form id="req">
      <label class="field"><span>A chi</span><select id="req-a">${[...AGENTI, "Tutti"].map((a) => `<option>${a}</option>`).join("")}</select></label>
      <label class="field"><span>Richiesta in una riga</span><input id="req-m" required maxlength="200"></label>
      <label class="field"><span>Dettagli (facoltativi)</span><textarea id="req-d"></textarea></label>
      <button class="btn" type="submit" style="width:100%">Metti in Bacheca</button>
      <p class="muted small">L'agente la legge al suo prossimo giro.</p>
      <p id="req-err" class="error small"></p>
    </form>`);
  $("#req").onsubmit = async (e) => {
    e.preventDefault();
    const btn = e.submitter;
    btn.disabled = true;
    try {
      await api({ action: "scrivi", a: $("#req-a").value, messaggio: $("#req-m").value, dettagli: $("#req-d").value });
      chiudiSheet();
      await carica();
    } catch (err) {
      $("#req-err").textContent = err.message;
      btn.disabled = false;
    }
  };
}

const pageCard = (p) => `<button class="card tap" data-page="${esc(p.id)}"><div class="meta">${p.padre ? `${esc(p.padre)} · ` : ""}${esc(quando(p.modificata))}</div><p class="title">${esc(p.titolo)}</p></button>`;

function vistaPagine() {
  const d = state.data;
  if (!d) { app.innerHTML = attesa(); return; }
  app.innerHTML = `<h2 class="section">Pagine del quartier generale</h2>${d.pagine.map(pageCard).join("") || `<div class="card muted">Nessuna pagina.</div>`}`;
  collegaPagine();
}

function collegaPagine() {
  app.querySelectorAll("[data-page]").forEach((b) => {
    b.onclick = async () => {
      apriSheet(b.querySelector(".title").textContent, `<p class="muted">Leggo la pagina…</p>`);
      try {
        const r = await api({ action: "pagina", id: b.dataset.page });
        $("#sheet-body").innerHTML = `<div class="doc">${md(r.testo) || '<p class="muted">Pagina vuota.</p>'}</div>`;
      } catch (e) {
        $("#sheet-body").innerHTML = `<p class="error">${esc(e.message)}</p>`;
      }
    };
  });
}

// ---------- pannello ----------

function apriSheet(titolo, html) {
  $("#sheet-title").textContent = titolo;
  $("#sheet-body").innerHTML = html;
  $("#sheet").classList.remove("hidden");
  $("#sheet-body").scrollTop = 0;
}
function chiudiSheet() { $("#sheet").classList.add("hidden"); }
document.querySelectorAll("#sheet [data-close]").forEach((el) => (el.onclick = chiudiSheet));

// ---------- navigazione ----------

function render() {
  if (!state.key) { vistaChiave(); return; }
  $("#tabbar").classList.remove("hidden");
  $("#refresh").classList.toggle("hidden", state.tab === "parla");
  document.querySelectorAll("#tabbar button").forEach((b) => b.classList.toggle("active", b.dataset.tab === state.tab));
  $("#title").textContent = { parla: "Mark", oggi: "Oggi", bacheca: "Bacheca", pagine: "Pagine" }[state.tab];
  if (state.tab === "parla") vistaParla();
  else if (state.tab === "oggi") vistaOggi();
  else if (state.tab === "bacheca") vistaBacheca();
  else vistaPagine();
  const retry = $("#retry");
  if (retry) retry.onclick = carica;
  if (state.tab !== "parla" && !state.data && !state.loading && !state.error) carica();
}

document.querySelectorAll("#tabbar button").forEach((b) => {
  b.onpointerdown = () => b.classList.add("active");
  b.onclick = () => {
    state.tab = b.dataset.tab;
    state.error = "";
    store.set("mark.tab", state.tab);
    window.scrollTo(0, 0);
    render();
  };
});
$("#refresh").onclick = () => { state.data = null; carica(); };

// Al ritorno sull'app dopo un po', ricarica i dati
let nascosta = 0;
document.addEventListener("visibilitychange", () => {
  if (document.hidden) nascosta = Date.now();
  else if (nascosta && Date.now() - nascosta > 5 * 60_000) { state.data = null; if (state.tab !== "parla") carica(); }
});

if ("speechSynthesis" in window) speechSynthesis.getVoices();

// Su iPhone la voce parte solo se è stata "sbloccata" da un tocco vero (touchend o click, non pointerdown)
function sbloccaVoce() {
  if (!("speechSynthesis" in window)) return;
  const u = new SpeechSynthesisUtterance(" ");
  u.volume = 0;
  u.lang = "it-IT";
  speechSynthesis.speak(u);
  document.removeEventListener("touchend", sbloccaVoce, true);
  document.removeEventListener("click", sbloccaVoce, true);
}
document.addEventListener("touchend", sbloccaVoce, true);
document.addEventListener("click", sbloccaVoce, true);
render();
