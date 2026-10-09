import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";
import { SUPABASE_URL, SUPABASE_KEY } from "./config.js";

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

// ---------- Costanti ----------
const AISLES = [
  "Frutta e verdura", "Carne", "Pesce", "Latticini e uova", "Pane e forno",
  "Pasta, riso e cereali", "Scatolame e conserve", "Surgelati", "Condimenti e spezie",
  "Colazione", "Casa e igiene", "Altro",
];
const WEEKDAYS = ["Domenica", "Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato"];
const LUNCH_MODES = [
  { id: "casa", label: "Casa" },
  { id: "porta", label: "Porta" },
  { id: "fuori", label: "Fuori" },
];
const DEFAULT_SETTINGS = {
  adults: ["Alessio", "Compagna"],
  kids: ["Rebecca", "Margherita"],
  pantry: [
    "sale", "pepe", "olio extravergine", "aceto", "zucchero", "farina", "pasta", "riso",
    "passata di pomodoro", "tonno in scatola", "legumi in scatola", "dado", "parmigiano",
    "aglio", "cipolla", "uova",
  ],
  breakfast: ["latte", "biscotti", "fette biscottate", "marmellata", "cereali", "yogurt", "caffè", "frutta"],
  reserve: [],
  notes: "",
};

// ---------- Stato ----------
const S = {
  session: null,
  household: null,
  tab: "oggi",
  weekStart: mondayOf(new Date()),
  week: null,
  recipes: [],
  items: [],
  busy: null,
  channel: null,
};

// ---------- Utilità ----------
function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function iso(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function parseIso(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function mondayOf(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const wd = (x.getDay() + 6) % 7;
  return iso(addDays(x, -wd));
}
function weekDates(start) {
  const s = parseIso(start);
  return Array.from({ length: 7 }, (_, i) => iso(addDays(s, i)));
}
function isWeekend(dateStr) {
  const wd = parseIso(dateStr).getDay();
  return wd === 0 || wd === 6;
}
function dayLabel(dateStr) {
  const d = parseIso(dateStr);
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()}`;
}
function norm(s) {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
}
function inPantry(name, pantry) {
  const n = norm(name);
  return pantry.some((p) => {
    const q = norm(p);
    return q && (n === q || n.startsWith(q + " ") || q.startsWith(n + " ") || n === q.replace(/e$|i$|a$|o$/, "") );
  });
}
function fmtQty(qty, unit) {
  if (unit === "q.b.") return "q.b.";
  if (!qty) return "";
  if (unit === "g" && qty >= 1000) return `${+(qty / 1000).toFixed(2)} kg`;
  if (unit === "ml" && qty >= 1000) return `${+(qty / 1000).toFixed(2)} l`;
  const n = Number.isInteger(qty) ? qty : +qty.toFixed(1);
  return `${n} ${unit === "pz" ? "pz" : unit}`;
}
function toast(msg, ms = 2600) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add("hidden"), ms);
}
function settings() {
  return { ...DEFAULT_SETTINGS, ...(S.household?.settings || {}) };
}
const app = () => document.getElementById("app");

// ---------- Sheet (pannello dal basso) ----------
function openSheet(html, bind) {
  const sheet = document.getElementById("sheet");
  document.getElementById("sheet-body").innerHTML = html;
  sheet.classList.remove("hidden");
  bind?.(document.getElementById("sheet-body"));
}
function closeSheet() {
  document.getElementById("sheet").classList.add("hidden");
}
document.getElementById("sheet").addEventListener("click", (e) => {
  if (e.target.matches("[data-close]")) closeSheet();
});

// ---------- Avvio ----------
document.getElementById("tabbar").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-tab]");
  if (!b) return;
  S.tab = b.dataset.tab;
  render();
});

sb.auth.onAuthStateChange((ev, session) => {
  const changed = (session?.user?.id || null) !== (S.session?.user?.id || null);
  S.session = session;
  // Supabase sconsiglia chiamate al database dentro questo callback: le rimandiamo
  if (ev === "INITIAL_SESSION" || changed) setTimeout(boot, 0);
});

async function boot() {
  if (!S.session) {
    S.household = null;
    renderAuth();
    return;
  }
  const { data: mem, error } = await sb.from("household_members").select("household_id").limit(1);
  if (error) return renderError(error);
  if (!mem.length) return renderOnboarding();
  await loadHousehold(mem[0].household_id);
  subscribe();
  render();
}

async function loadHousehold(id) {
  const [h, r, i] = await Promise.all([
    sb.from("households").select("*").eq("id", id).single(),
    sb.from("recipes").select("*").eq("household_id", id).order("last_used", { ascending: false, nullsFirst: false }),
    sb.from("shopping_items").select("*").eq("household_id", id).order("created_at"),
  ]);
  if (h.error) throw h.error;
  S.household = h.data;
  S.recipes = r.data || [];
  S.items = i.data || [];
  await loadWeek();
}

async function loadWeek() {
  const { data } = await sb.from("weeks").select("*")
    .eq("household_id", S.household.id).eq("week_start", S.weekStart).maybeSingle();
  S.week = data || { household_id: S.household.id, week_start: S.weekStart, attendance: {}, plan: null };
}

function subscribe() {
  if (S.channel) sb.removeChannel(S.channel);
  const hid = S.household.id;
  S.channel = sb.channel(`famiglia-${hid}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "shopping_items", filter: `household_id=eq.${hid}` }, (p) => {
      if (p.eventType === "DELETE") S.items = S.items.filter((x) => x.id !== p.old.id);
      else {
        const i = S.items.findIndex((x) => x.id === p.new.id);
        if (i >= 0) S.items[i] = p.new; else S.items.push(p.new);
      }
      if (S.tab === "spesa") render();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "weeks", filter: `household_id=eq.${hid}` }, (p) => {
      if (p.new?.week_start === S.weekStart) {
        S.week = p.new;
        if (["oggi", "settimana"].includes(S.tab) && !S.busy) render();
      }
    })
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "households", filter: `id=eq.${hid}` }, (p) => {
      S.household = p.new;
    })
    .subscribe();
}

// Quando l'app torna in primo piano ricarica i dati (iPhone sospende le connessioni)
document.addEventListener("visibilitychange", async () => {
  if (document.visibilityState === "visible" && S.household) {
    await loadHousehold(S.household.id);
    render();
  }
});

// ---------- Accesso ----------
function renderAuth(mode = "login") {
  document.getElementById("tabbar").classList.add("hidden");
  document.getElementById("title").textContent = "Menù di famiglia";
  app().innerHTML = `
    <div class="card">
      <h3>${mode === "login" ? "Accedi" : "Crea il tuo account"}</h3>
      <p class="muted small">${mode === "login" ? "Usa la tua email e la password." : "Dopo la registrazione ti arriva una mail per confermare l'indirizzo."}</p>
      <form id="auth-form">
        <label>Email</label>
        <input type="email" name="email" autocomplete="email" required>
        <label>Password</label>
        <input type="password" name="password" autocomplete="${mode === "login" ? "current-password" : "new-password"}" minlength="6" required>
        <div class="actions"><button class="block" type="submit">${mode === "login" ? "Accedi" : "Registrati"}</button></div>
      </form>
      <div class="actions">
        <button class="ghost" id="switch">${mode === "login" ? "Non hai un account? Registrati" : "Hai già un account? Accedi"}</button>
      </div>
    </div>`;
  document.getElementById("switch").onclick = () => renderAuth(mode === "login" ? "signup" : "login");
  document.getElementById("auth-form").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const email = f.get("email").trim(), password = f.get("password");
    const btn = e.target.querySelector("button");
    btn.disabled = true;
    const { data, error } = mode === "login"
      ? await sb.auth.signInWithPassword({ email, password })
      : await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } });
    btn.disabled = false;
    if (error) return toast(traduciErrore(error.message));
    if (mode === "signup" && !data.session) {
      app().innerHTML = `<div class="card"><h3>Controlla la mail</h3><p>Ti ho mandato un link a <b>${esc(email)}</b>. Aprilo, poi torna qui e accedi.</p><button class="block" id="back">Vai all'accesso</button></div>`;
      document.getElementById("back").onclick = () => renderAuth("login");
    }
  };
}

function traduciErrore(m) {
  if (/Invalid login/i.test(m)) return "Email o password non corretti.";
  if (/Email not confirmed/i.test(m)) return "Conferma prima l'email con il link che ti è arrivato.";
  if (/already registered/i.test(m)) return "Questa email ha già un account: accedi.";
  if (/Password should/i.test(m)) return "La password deve avere almeno 6 caratteri.";
  return m;
}

function renderOnboarding() {
  document.getElementById("tabbar").classList.add("hidden");
  app().innerHTML = `
    <div class="card">
      <h3>Nuova famiglia</h3>
      <p class="muted small">Se sei il primo a usare l'app, crea la famiglia. Poi condividi il codice con l'altra persona.</p>
      <button class="block" id="create">Crea la famiglia</button>
    </div>
    <div class="card">
      <h3>Hai un codice?</h3>
      <p class="muted small">Se la famiglia esiste già, inserisci il codice di 6 caratteri.</p>
      <input id="code" placeholder="Es. A1B2C3" autocapitalize="characters" maxlength="6">
      <div class="actions"><button class="secondary block" id="join">Entra nella famiglia</button></div>
    </div>
    <div class="actions"><button class="ghost" id="logout">Esci</button></div>`;
  document.getElementById("create").onclick = async () => {
    const { error } = await sb.rpc("create_household", { p_name: "Famiglia Ventura" });
    if (error) return toast(error.message);
    const { data } = await sb.from("household_members").select("household_id").limit(1);
    await sb.from("households").update({ settings: DEFAULT_SETTINGS }).eq("id", data[0].household_id);
    boot();
  };
  document.getElementById("join").onclick = async () => {
    const code = document.getElementById("code").value.trim();
    if (!code) return;
    const { error } = await sb.rpc("join_household", { p_code: code });
    if (error) return toast(/codice/.test(error.message) ? "Codice non valido." : error.message);
    boot();
  };
  document.getElementById("logout").onclick = () => sb.auth.signOut();
}

function renderError(err) {
  app().innerHTML = `<div class="card"><h3>Qualcosa non va</h3><p class="muted">${esc(err.message || err)}</p><button class="block" onclick="location.reload()">Riprova</button></div>`;
}

// ---------- Render principale ----------
function render() {
  if (!S.household) return;
  document.getElementById("tabbar").classList.remove("hidden");
  document.querySelectorAll("#tabbar button").forEach((b) => b.classList.toggle("on", b.dataset.tab === S.tab));
  const titles = { oggi: "Oggi", settimana: "Settimana", spesa: "Spesa", ricette: "Ricette", impostazioni: "Famiglia" };
  document.getElementById("title").textContent = titles[S.tab];
  if (S.busy) return renderBusy();
  ({ oggi: renderToday, settimana: renderWeek, spesa: renderShopping, ricette: renderRecipes, impostazioni: renderSettings })[S.tab]();
}

function renderBusy() {
  app().innerHTML = `<div class="loading-box"><span class="spinner"></span><p>${esc(S.busy)}</p><p class="muted small">Può volerci fino a un minuto.</p></div>`;
}

// ---------- Settimana: dati ----------
function attendanceFor(date) {
  const a = S.week.attendance?.[date] || {};
  const st = settings();
  const lunch = {};
  st.adults.forEach((_, i) => { lunch[i] = a.lunch?.[i] || (isWeekend(date) ? "casa" : "fuori"); });
  return { lunch, dinnerOut: !!a.dinnerOut };
}

function lunchSummary(date) {
  const st = settings();
  const att = attendanceFor(date);
  if (isWeekend(date)) return { eaters: st.adults.length + st.kids.length, note: "tutta la famiglia a casa" };
  const casa = st.adults.filter((_, i) => att.lunch[i] === "casa");
  const porta = st.adults.filter((_, i) => att.lunch[i] === "porta");
  const parts = [];
  if (casa.length) parts.push(`a casa: ${casa.join(", ")}`);
  if (porta.length) parts.push(`da portare: ${porta.join(", ")} (preparato la sera prima)`);
  return { eaters: casa.length + porta.length, note: parts.join("; ") };
}

async function saveWeek(patch) {
  Object.assign(S.week, patch, { updated_at: new Date().toISOString() });
  const { error } = await sb.from("weeks").upsert({
    household_id: S.household.id,
    week_start: S.weekStart,
    attendance: S.week.attendance || {},
    plan: S.week.plan,
    updated_at: S.week.updated_at,
  });
  if (error) toast("Salvataggio non riuscito: " + error.message);
}

async function callAI(payload) {
  const { data, error } = await sb.functions.invoke("genera-menu", { body: payload });
  if (error) {
    let msg = error.message;
    try {
      const j = await error.context.json();
      if (j?.error) msg = j.error;
    } catch { /* nessun dettaglio */ }
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data.result;
}

function aiContext() {
  const st = settings();
  const since = iso(addDays(parseIso(S.weekStart), -14));
  return {
    pantry: st.pantry,
    favorites: S.recipes.filter((r) => r.favorite).map((r) => r.title).slice(0, 30),
    recent: S.recipes.filter((r) => r.last_used && r.last_used >= since && r.last_used < S.weekStart).map((r) => r.title).slice(0, 30),
    notes: st.notes,
  };
}

async function generateWeek() {
  const days = weekDates(S.weekStart).map((date) => {
    const l = lunchSummary(date);
    return {
      date,
      weekday: WEEKDAYS[parseIso(date).getDay()],
      lunchEaters: l.eaters,
      lunchNote: l.note,
      dinnerSkip: attendanceFor(date).dinnerOut,
    };
  });
  S.busy = "Sto preparando il menù della settimana…";
  render();
  try {
    const res = await callAI({ mode: "week", days, ...aiContext() });
    const plan = {
      days: weekDates(S.weekStart).map((date, i) => {
        const d = res.days.find((x) => x.date === date) || res.days[i] || {};
        const out = attendanceFor(date).dinnerOut;
        return {
          date,
          lunch: lunchSummary(date).eaters > 0 ? d.lunch || null : null,
          dinner: out ? { takeaway: true, title: "Cena fuori o asporto" } : d.dinner,
          spare: out && d.dinner ? d.dinner : null,
        };
      }),
      leftover: [],
      generated_at: new Date().toISOString(),
    };
    // Le cene "fuori" segnate in anticipo: il piatto proposto finisce tra i piatti avanzati
    plan.days.forEach((d) => { if (d.spare) plan.leftover.push(d.spare); delete d.spare; });
    S.busy = null;
    await saveWeek({ plan });
    await rememberRecipes(plan);
    toast("Menù pronto. Ora puoi creare la lista della spesa.");
  } catch (e) {
    S.busy = null;
    toast(e.message, 5000);
  }
  render();
}

async function rememberRecipes(plan) {
  const rows = [];
  for (const d of plan.days) {
    for (const slot of ["lunch", "dinner"]) {
      const m = d[slot];
      if (m && !m.takeaway && m.title) rows.push({ household_id: S.household.id, title: m.title, data: m, last_used: d.date });
    }
  }
  const unique = Object.values(Object.fromEntries(rows.map((r) => [r.title, r])));
  if (!unique.length) return;
  // Mantiene il "preferito" se il piatto esiste già
  const { data } = await sb.from("recipes").upsert(unique, { onConflict: "household_id,title", ignoreDuplicates: false }).select();
  if (data) {
    const map = new Map(S.recipes.map((r) => [r.title, r]));
    data.forEach((r) => map.set(r.title, r));
    S.recipes = [...map.values()].sort((a, b) => String(b.last_used).localeCompare(String(a.last_used)));
  }
}

// ---------- Schermata Settimana ----------
function weekNav() {
  const cur = mondayOf(new Date());
  const next = iso(addDays(parseIso(cur), 7));
  const s = parseIso(S.weekStart), e = addDays(s, 6);
  return `
    <div class="row between">
      <div class="seg">
        <button data-week="${cur}" class="${S.weekStart === cur ? "on" : ""}">Questa</button>
        <button data-week="${next}" class="${S.weekStart === next ? "on" : ""}">Prossima</button>
      </div>
      <span class="muted small">${s.getDate()}/${s.getMonth() + 1} – ${e.getDate()}/${e.getMonth() + 1}</span>
    </div>`;
}
function bindWeekNav(root) {
  root.querySelectorAll("[data-week]").forEach((b) => (b.onclick = async () => {
    S.weekStart = b.dataset.week;
    await loadWeek();
    render();
  }));
}

function renderWeek() {
  const plan = S.week.plan;
  app().innerHTML = weekNav() + (plan ? weekPlanHtml() : planningHtml());
  bindWeekNav(app());
  if (plan) bindWeekPlan(); else bindPlanning();
}

function planningHtml() {
  const st = settings();
  const dates = weekDates(S.weekStart);
  return `
    <p class="muted small">Segna dove pranzate. Le bambine mangiano a scuola dal lunedì al venerdì; nel weekend si pranza tutti a casa.</p>
    ${dates.map((date) => {
      const att = attendanceFor(date);
      return `<div class="card">
        <div class="row between"><h3>${dayLabel(date)}</h3>
          <button class="chip ${att.dinnerOut ? "on" : ""}" data-dout="${date}">${att.dinnerOut ? "Cena fuori ✓" : "Cena fuori?"}</button>
        </div>
        ${isWeekend(date) ? `<p class="muted small">Pranzo per tutti e ${st.adults.length + st.kids.length}.</p>` :
          st.adults.map((name, i) => `
            <div class="row between" style="margin-top:8px">
              <span>${esc(name)}</span>
              <div class="seg">${LUNCH_MODES.map((m) => `<button data-att="${date}|${i}|${m.id}" class="${att.lunch[i] === m.id ? "on" : ""}">${m.label}</button>`).join("")}</div>
            </div>`).join("")}
      </div>`;
    }).join("")}
    <div class="actions"><button class="block" id="gen">Genera il menù</button></div>
    <p class="muted small center">Casa = pranzo a casa · Porta = pranzo da portare · Fuori = mensa o ristorante</p>`;
}

function bindPlanning() {
  app().querySelectorAll("[data-att]").forEach((b) => (b.onclick = () => {
    const [date, i, mode] = b.dataset.att.split("|");
    const att = structuredClone(S.week.attendance || {});
    att[date] = att[date] || {};
    att[date].lunch = { ...attendanceFor(date).lunch, ...(att[date].lunch || {}), [i]: mode };
    saveWeek({ attendance: att });
    renderWeek();
  }));
  app().querySelectorAll("[data-dout]").forEach((b) => (b.onclick = () => {
    const date = b.dataset.dout;
    const att = structuredClone(S.week.attendance || {});
    att[date] = { ...(att[date] || {}), dinnerOut: !attendanceFor(date).dinnerOut };
    saveWeek({ attendance: att });
    renderWeek();
  }));
  document.getElementById("gen").onclick = generateWeek;
}

function mealRow(date, slot, m, extra = "") {
  if (!m) return "";
  const label = slot === "lunch" ? "Pranzo" : slot === "sick" ? "Pranzo di riserva" : "Cena";
  if (m.takeaway) {
    return `<div class="meal" data-meal="${date}|${slot}">
      <div class="label">${label}</div>
      <div class="title">🍕 ${esc(m.title)}</div>${extra}</div>`;
  }
  return `<div class="meal" data-meal="${date}|${slot}">
    <div class="label">${label} · ${m.minutes} min · ${m.servings} porz.</div>
    <div class="title">${esc(m.title)}</div>
    ${m.note ? `<div class="note">${esc(m.note)}</div>` : ""}${extra}
  </div>`;
}

function dayCardHtml(d, withSick = false) {
  const l = lunchSummary(d.date);
  const sickBtn = withSick && !d.sick && !isWeekend(d.date) && d.date >= iso(new Date())
    ? `<button class="chip" data-sick="${d.date}">🤒 Bimba a casa</button>` : "";
  return `<div class="card">
    <div class="row between"><h3>${dayLabel(d.date)}</h3>
      ${d.sick ? `<span class="badge warn">Bimba a casa</span>` : sickBtn}</div>
    ${d.lunch ? mealRow(d.date, "lunch", d.lunch, `<div class="muted small">${esc(l.note)}</div>`) :
      (!isWeekend(d.date) && !d.sick ? `<div class="meal muted small">Pranzo: tutti fuori</div>` : "")}
    ${d.sick ? mealRow(d.date, "sick", d.sick.meal) : ""}
    ${mealRow(d.date, "dinner", d.dinner)}
  </div>`;
}

function weekPlanHtml() {
  const plan = S.week.plan;
  return `
    ${plan.days.map((d) => dayCardHtml(d, true)).join("")}
    ${plan.leftover?.length ? `<h2>Piatti rimasti</h2><p class="muted small">Cene spostate fuori dalla settimana per pizza o asporto: gli ingredienti potrebbero essere già in casa.</p>
      <div class="card">${plan.leftover.map((m) => `<div class="meal"><div class="title">${esc(m.title)}</div></div>`).join("")}</div>` : ""}
    <div class="actions">
      <button class="secondary block" id="tolist">Crea la lista della spesa</button>
      <button class="ghost" id="replan">Ripianifica la settimana</button>
    </div>`;
}

function bindWeekPlan() {
  app().querySelectorAll("[data-meal]").forEach((el) => (el.onclick = () => {
    const [date, slot] = el.dataset.meal.split("|");
    openMeal(date, slot);
  }));
  app().querySelectorAll("[data-sick]").forEach((b) => (b.onclick = () => sickDay(b.dataset.sick)));
  document.getElementById("tolist").onclick = buildShoppingList;
  document.getElementById("replan").onclick = () => {
    if (!confirm("Ripianificare? Il menù attuale verrà sostituito.")) return;
    saveWeek({ plan: null });
    renderWeek();
  };
}

function findDay(date) {
  return S.week.plan?.days.find((d) => d.date === date);
}

// ---------- Dettaglio piatto ----------
function openMeal(date, slot) {
  const day = findDay(date);
  if (!day) return;
  const m = slot === "sick" ? day.sick?.meal : day[slot];
  if (!m) return;
  const recipe = S.recipes.find((r) => r.title === m.title);
  const weekday = !isWeekend(date);
  const today = iso(new Date());
  const actions = [];
  if (slot === "dinner") {
    if (m.takeaway) actions.push(`<button class="secondary block" data-act="undo-takeaway">Annulla: stasera si cucina</button>`);
    else actions.push(`<button class="secondary block" data-act="takeaway">🍕 Stasera pizza o asporto</button>`);
  }
  if (!m.takeaway) {
    actions.push(`<button class="secondary block" data-act="swap">Proponimi un'altra cosa</button>`);
    actions.push(`<button class="ghost" data-act="fav">${recipe?.favorite ? "★ Togli dai preferiti" : "☆ Salva tra i preferiti"}</button>`);
  }
  if (slot === "sick") actions.push(`<button class="danger" data-act="unsick">Togli il pranzo di riserva</button>`);
  openSheet(`
    <p class="muted small">${dayLabel(date)}${date === today ? " · oggi" : ""}</p>
    <h2 style="margin-top:0">${esc(m.title)}</h2>
    ${m.takeaway ? `<p>Serata libera. Il piatto previsto è stato spostato al giorno dopo.</p>` : `
      <p class="muted">${m.minutes} minuti · ${m.servings} porzioni</p>
      ${m.note ? `<p class="badge warn">${esc(m.note)}</p>` : ""}
      <h3>Ingredienti</h3>
      <ul>${(m.ingredients || []).map((i) => `<li>${esc(i.name)} <span class="muted">${esc(fmtQty(i.qty, i.unit))}</span></li>`).join("")}</ul>
      <h3>Come si fa</h3>
      <ol>${(m.steps || []).map((s) => `<li>${esc(s)}</li>`).join("")}</ol>`}
    <div class="actions">${actions.join("")}
      <button class="ghost" data-close>Chiudi</button></div>`, (root) => {
    root.querySelectorAll("[data-act]").forEach((b) => (b.onclick = async () => {
      const act = b.dataset.act;
      if (act === "takeaway") await takeaway(date);
      if (act === "undo-takeaway") await undoTakeaway(date);
      if (act === "swap") return swapMeal(date, slot, weekday);
      if (act === "fav") await toggleFavorite(m);
      if (act === "unsick") { delete day.sick; await saveWeek({ plan: S.week.plan }); }
      closeSheet();
      render();
    }));
  });
}

async function toggleFavorite(m) {
  const r = S.recipes.find((x) => x.title === m.title);
  const favorite = !r?.favorite;
  const { data, error } = await sb.from("recipes").upsert(
    { household_id: S.household.id, title: m.title, data: m, favorite, last_used: r?.last_used || null },
    { onConflict: "household_id,title" },
  ).select().single();
  if (error) return toast(error.message);
  S.recipes = [data, ...S.recipes.filter((x) => x.title !== m.title)];
  toast(favorite ? "Salvato tra i preferiti." : "Tolto dai preferiti.");
}

async function swapMeal(date, slot, weekday) {
  const day = findDay(date);
  const cur = slot === "sick" ? day.sick.meal : day[slot];
  openSheet(`<div class="loading-box"><span class="spinner"></span><p>Cerco un'alternativa…</p></div>`);
  try {
    const weekTitles = S.week.plan.days.flatMap((d) => [d.lunch?.title, d.dinner?.title]).filter(Boolean);
    const res = await callAI({
      mode: "swap", slot: slot === "dinner" ? "dinner" : "lunch", date, servings: cur.servings,
      current: cur.title, weekTitles, quick: weekday, ...aiContext(),
    });
    const m = res.meals?.[0];
    if (!m) throw new Error("Nessuna proposta, riprova.");
    if (slot === "sick") day.sick.meal = m; else day[slot] = m;
    await saveWeek({ plan: S.week.plan });
    await rememberRecipes({ days: [{ date, lunch: slot === "lunch" ? m : null, dinner: slot === "dinner" ? m : null }] });
    closeSheet();
    render();
    toast("Piatto cambiato. Ricordati di aggiornare la lista della spesa.");
  } catch (e) {
    closeSheet();
    toast(e.message, 5000);
  }
}

// ---------- Fase 4: asporto e pranzo di riserva ----------
async function takeaway(date) {
  const days = S.week.plan.days;
  const idx = days.findIndex((d) => d.date === date);
  // Le cene da qui in avanti scalano di un giorno; l'ultima finisce tra i piatti rimasti
  let carry = days[idx].dinner;
  days[idx].dinner = { takeaway: true, title: "Pizza o asporto" };
  for (let i = idx + 1; i < days.length && carry; i++) {
    if (days[i].dinner?.takeaway) continue;
    const next = days[i].dinner;
    days[i].dinner = carry;
    carry = next;
  }
  if (carry && !carry.takeaway) {
    S.week.plan.leftover = [...(S.week.plan.leftover || []), carry];
  }
  await saveWeek({ plan: S.week.plan });
  toast(carry ? `"${carry.title}" va tra i piatti rimasti.` : "Cene spostate di un giorno.");
}

async function undoTakeaway(date) {
  const days = S.week.plan.days;
  const idx = days.findIndex((d) => d.date === date);
  const slots = [];
  for (let i = idx; i < days.length; i++) if (i === idx || !days[i].dinner?.takeaway) slots.push(i);
  // Riporta indietro di un giorno le cene successive
  for (let k = 0; k < slots.length - 1; k++) days[slots[k]].dinner = days[slots[k + 1]].dinner;
  const back = (S.week.plan.leftover || []).pop();
  days[slots[slots.length - 1]].dinner = back || { takeaway: true, title: "Da decidere" };
  await saveWeek({ plan: S.week.plan });
}

async function ensureReserve() {
  const st = settings();
  if (st.reserve?.length) return st.reserve;
  const res = await callAI({ mode: "reserve", ...aiContext() });
  const reserve = res.meals || [];
  await saveSettings({ reserve });
  return reserve;
}

async function sickDay(date) {
  openSheet(`<div class="loading-box"><span class="spinner"></span><p>Preparo i pranzi di riserva…</p></div>`);
  try {
    const reserve = await ensureReserve();
    openSheet(`
      <h2 style="margin-top:0">Bimba a casa · ${dayLabel(date)}</h2>
      <p class="muted small">Pranzi veloci con quello che tenete sempre in dispensa.</p>
      ${reserve.map((m, i) => `<div class="card tap" data-pick="${i}"><h3>${esc(m.title)}</h3>
        <div class="muted small">${m.minutes} min · ${(m.ingredients || []).map((x) => esc(x.name)).join(", ")}</div></div>`).join("")}
      <div class="actions"><button class="ghost" data-close>Annulla</button></div>`, (root) => {
      root.querySelectorAll("[data-pick]").forEach((el) => (el.onclick = async () => {
        const m = reserve[+el.dataset.pick];
        const day = findDay(date);
        day.sick = { meal: m };
        await saveWeek({ plan: S.week.plan });
        closeSheet();
        render();
        toast("Pranzo di riserva aggiunto. Se finisce una scorta, segnala in Spesa.");
      }));
    });
  } catch (e) {
    closeSheet();
    toast(e.message, 5000);
  }
}

// ---------- Schermata Oggi ----------
function renderToday() {
  const today = iso(new Date());
  const cur = mondayOf(new Date());
  if (S.weekStart !== cur) {
    S.weekStart = cur;
    loadWeek().then(render);
    return;
  }
  const plan = S.week.plan;
  const day = plan?.days.find((d) => d.date === today);
  const tomorrow = iso(addDays(new Date(), 1));
  const tDay = plan?.days.find((d) => d.date === tomorrow);
  if (!plan || !day) {
    app().innerHTML = `<div class="card"><h3>Nessun menù per questa settimana</h3>
      <p class="muted">Pianifica la settimana: ci vogliono 2 minuti.</p>
      <button class="block" id="go">Pianifica ora</button></div>`;
    document.getElementById("go").onclick = () => { S.tab = "settimana"; render(); };
    return;
  }
  const tAtt = tDay && !isWeekend(tomorrow) ? attendanceFor(tomorrow) : null;
  const porta = tAtt ? settings().adults.filter((_, i) => tAtt.lunch[i] === "porta") : [];
  app().innerHTML = `
    ${dayCardHtml(day)}
    <div class="actions">
      ${day.dinner?.takeaway ? "" : `<button class="secondary block" id="tk">🍕 Stasera pizza o asporto</button>`}
      ${!isWeekend(today) && !day.sick ? `<button class="secondary block" id="sick">🤒 Bimba a casa oggi</button>` : ""}
    </div>
    ${tDay ? `<h2>Domani</h2>
      ${porta.length ? `<div class="card"><b>Pranzo da portare per ${esc(porta.join(", "))}</b>
        <p class="muted small">Preparalo stasera insieme alla cena.</p></div>` : ""}
      ${dayCardHtml(tDay)}` : ""}`;
  app().querySelectorAll("[data-meal]").forEach((el) => (el.onclick = () => {
    const [date, slot] = el.dataset.meal.split("|");
    openMeal(date, slot);
  }));
  document.getElementById("tk")?.addEventListener("click", async () => { await takeaway(today); render(); });
  document.getElementById("sick")?.addEventListener("click", () => sickDay(today));
}

// ---------- Fase 3: lista della spesa ----------
async function buildShoppingList() {
  const plan = S.week.plan;
  const st = settings();
  const acc = new Map();
  for (const d of plan.days) {
    for (const m of [d.lunch, d.dinner]) {
      if (!m || m.takeaway) continue;
      for (const ing of m.ingredients || []) {
        if (inPantry(ing.name, st.pantry)) continue;
        const key = `${norm(ing.name)}|${ing.unit}`;
        const cur = acc.get(key) || { name: ing.name, unit: ing.unit, qty: 0, aisle: ing.aisle };
        cur.qty += ing.unit === "q.b." ? 0 : Number(ing.qty) || 0;
        acc.set(key, cur);
      }
    }
  }
  // Unisce le stesse voci con unità diverse in un'unica riga
  const byName = new Map();
  for (const v of acc.values()) {
    const k = norm(v.name);
    const prev = byName.get(k);
    const q = fmtQty(v.qty, v.unit);
    if (prev) prev.qty = [prev.qty, q].filter(Boolean).join(" + ");
    else byName.set(k, { name: v.name, qty: q, aisle: v.aisle });
  }
  const checkedNames = new Set(S.items.filter((i) => i.checked && i.source === "menu").map((i) => norm(i.name)));
  const old = S.items.filter((i) => i.source === "menu").map((i) => i.id);
  if (old.length) await sb.from("shopping_items").delete().in("id", old);
  const rows = [...byName.values()].map((v) => ({
    household_id: S.household.id, name: v.name, qty: v.qty, aisle: v.aisle, source: "menu",
    checked: checkedNames.has(norm(v.name)),
  }));
  const { data, error } = rows.length ? await sb.from("shopping_items").insert(rows).select() : { data: [] };
  if (error) return toast(error.message);
  S.items = [...S.items.filter((i) => i.source !== "menu"), ...data];
  S.tab = "spesa";
  render();
  toast(`Lista pronta: ${rows.length} voci dal menù.`);
}

async function addItem(name, aisle, source, qty = null) {
  if (S.items.some((i) => !i.checked && norm(i.name) === norm(name))) return toast(`"${name}" è già in lista.`);
  const { data, error } = await sb.from("shopping_items")
    .insert({ household_id: S.household.id, name, aisle, source, qty }).select().single();
  if (error) return toast(error.message);
  if (!S.items.some((i) => i.id === data.id)) S.items.push(data);
  render();
}

function renderShopping() {
  const st = settings();
  const groups = AISLES.map((a) => ({ a, items: S.items.filter((i) => (AISLES.includes(i.aisle) ? i.aisle : "Altro") === a) }))
    .filter((g) => g.items.length);
  const todo = S.items.filter((i) => !i.checked).length;
  app().innerHTML = `
    <form id="add" class="row">
      <input name="name" class="grow" placeholder="Aggiungi qualcosa…" autocomplete="off">
      <button type="submit">+</button>
    </form>
    <h2>Lista ${todo ? `<span class="badge">${todo} da prendere</span>` : ""}</h2>
    ${groups.length ? groups.map((g) => `
      <div class="card"><div class="muted small">${esc(g.a)}</div>
        ${g.items.sort((x, y) => x.checked - y.checked || x.name.localeCompare(y.name)).map((i) => `
          <label class="list-item ${i.checked ? "done" : ""}">
            <input type="checkbox" data-check="${i.id}" ${i.checked ? "checked" : ""}>
            <span class="name grow">${esc(i.name)}</span>
            <span class="qty">${esc(i.qty || "")}</span>
          </label>`).join("")}
      </div>`).join("") : `<div class="card muted">La lista è vuota. Dalla Settimana tocca "Crea la lista della spesa".</div>`}
    ${S.items.some((i) => i.checked) ? `<div class="actions"><button class="secondary block" id="clear">Togli le voci spuntate</button></div>` : ""}
    <details class="card" ${S.lowOpen ? "open" : ""} id="low">
      <summary><b>Sta finendo qualcosa?</b> <span class="muted small">Colazione e dispensa</span></summary>
      <p class="muted small">Tocca cosa manca a casa: entra in lista.</p>
      <div class="chips">
        ${st.breakfast.map((b) => `<button class="chip" data-low="${esc(b)}|Colazione">☕ ${esc(b)}</button>`).join("")}
        ${st.pantry.map((p) => `<button class="chip" data-low="${esc(p)}|Altro">${esc(p)}</button>`).join("")}
      </div>
    </details>`;

  document.getElementById("low").ontoggle = (e) => { S.lowOpen = e.target.open; };
  document.getElementById("add").onsubmit = (e) => {
    e.preventDefault();
    const name = e.target.name.value.trim();
    if (!name) return;
    e.target.reset();
    addItem(name, "Altro", "manuale");
  };
  app().querySelectorAll("[data-low]").forEach((b) => (b.onclick = () => {
    const [name, aisle] = b.dataset.low.split("|");
    addItem(name, aisle, aisle === "Colazione" ? "colazione" : "dispensa");
  }));
  app().querySelectorAll("[data-check]").forEach((c) => (c.onchange = async () => {
    const it = S.items.find((i) => i.id === c.dataset.check);
    it.checked = c.checked;
    render();
    const { error } = await sb.from("shopping_items").update({ checked: c.checked }).eq("id", it.id);
    if (error) toast("Non salvato: controlla la connessione.");
  }));
  document.getElementById("clear")?.addEventListener("click", async () => {
    const ids = S.items.filter((i) => i.checked).map((i) => i.id);
    await sb.from("shopping_items").delete().in("id", ids);
    S.items = S.items.filter((i) => !ids.includes(i.id));
    render();
  });
}

// ---------- Ricette ----------
function renderRecipes() {
  const fav = S.recipes.filter((r) => r.favorite);
  const others = S.recipes.filter((r) => !r.favorite).slice(0, 40);
  const row = (r) => `<div class="card tap" data-recipe="${esc(r.id)}">
    <div class="row between"><b class="grow">${esc(r.title)}</b>${r.favorite ? "★" : ""}</div>
    <div class="muted small">${r.data?.minutes ? `${r.data.minutes} min · ` : ""}${r.last_used ? `ultima volta ${esc(r.last_used.split("-").reverse().join("/"))}` : ""}</div></div>`;
  app().innerHTML = `
    <h2>Preferiti</h2>
    ${fav.length ? fav.map(row).join("") : `<p class="muted small">Ancora nessuno. Apri un piatto del menù e tocca "Salva tra i preferiti": l'app lo riproporrà più spesso.</p>`}
    <h2>Fatti di recente</h2>
    ${others.length ? others.map(row).join("") : `<p class="muted small">Qui compaiono i piatti dei menù generati.</p>`}`;
  app().querySelectorAll("[data-recipe]").forEach((el) => (el.onclick = () => {
    const r = S.recipes.find((x) => x.id === el.dataset.recipe);
    const m = r.data || {};
    openSheet(`
      <h2 style="margin-top:0">${esc(r.title)}</h2>
      ${m.minutes ? `<p class="muted">${m.minutes} minuti · ${m.servings} porzioni</p>` : ""}
      <h3>Ingredienti</h3><ul>${(m.ingredients || []).map((i) => `<li>${esc(i.name)} <span class="muted">${esc(fmtQty(i.qty, i.unit))}</span></li>`).join("")}</ul>
      <h3>Come si fa</h3><ol>${(m.steps || []).map((s) => `<li>${esc(s)}</li>`).join("")}</ol>
      <div class="actions"><button class="secondary block" id="fav">${r.favorite ? "Togli dai preferiti" : "Salva tra i preferiti"}</button>
      <button class="ghost" data-close>Chiudi</button></div>`, (root) => {
      root.querySelector("#fav").onclick = async () => {
        await toggleFavorite({ ...m, title: r.title });
        closeSheet();
        render();
      };
    });
  }));
}

// ---------- Fase 1: impostazioni famiglia ----------
async function saveSettings(patch) {
  const next = { ...settings(), ...patch };
  const { error } = await sb.from("households").update({ settings: next }).eq("id", S.household.id);
  if (error) return toast(error.message);
  S.household.settings = next;
}

function chipEditor(key, title, hint) {
  const list = settings()[key];
  return `<h2>${title}</h2><p class="muted small">${hint}</p>
    <div class="chips">${list.map((x, i) => `<button class="chip" data-del="${key}|${i}">${esc(x)}<span class="x">✕</span></button>`).join("")}</div>
    <form class="row" data-addto="${key}" style="margin-top:8px">
      <input name="v" class="grow" placeholder="Aggiungi…" autocomplete="off"><button type="submit">+</button></form>`;
}

function renderSettings() {
  const st = settings();
  app().innerHTML = `
    <div class="card">
      <h3>${esc(S.household.name)}</h3>
      <p class="muted small">Codice per far entrare l'altra persona: <b style="font-size:18px;letter-spacing:2px">${esc(S.household.invite_code)}</b></p>
      <p class="muted small">Accesso come ${esc(S.session.user.email)}</p>
    </div>
    <h2>Chi pranza fuori</h2>
    <p class="muted small">Gli adulti di cui segnare il pranzo ogni settimana.</p>
    ${st.adults.map((n, i) => `<input data-adult="${i}" value="${esc(n)}" style="margin-bottom:8px">`).join("")}
    <h2>Bambine</h2>
    <p class="muted small">Pranzano a scuola dal lunedì al venerdì.</p>
    <input id="kids" value="${esc(st.kids.join(", "))}">
    ${chipEditor("pantry", "Dispensa base", "Sempre in casa: non entrano nella lista del menù. Quando finiscono, segnale in Spesa.")}
    ${chipEditor("breakfast", "Colazione", "Sempre gli stessi prodotti: li aggiungi alla spesa quando finiscono.")}
    <h2>Pranzi di riserva</h2>
    <p class="muted small">Per quando una bambina resta a casa malata.</p>
    ${st.reserve?.length ? st.reserve.map((m) => `<div class="card"><b>${esc(m.title)}</b><div class="muted small">${(m.ingredients || []).map((x) => esc(x.name)).join(", ")}</div></div>`).join("") :
      `<p class="muted small">Li preparo la prima volta che servono.</p>`}
    <div class="actions">
      ${st.reserve?.length ? `<button class="secondary block" id="stock">Metti in lista le scorte per i pranzi di riserva</button>
        <button class="ghost" id="newres">Proponi altri pranzi di riserva</button>` : `<button class="secondary block" id="newres">Prepara i pranzi di riserva</button>`}
    </div>
    <h2>Note per i menù</h2>
    <p class="muted small">Gusti e richieste, es. "Margherita non ama il pesce", "più verdure".</p>
    <textarea id="notes">${esc(st.notes)}</textarea>
    <div class="actions"><button class="block" id="save">Salva</button>
      <button class="ghost" id="logout">Esci</button></div>`;

  app().querySelectorAll("[data-del]").forEach((b) => (b.onclick = async () => {
    const [key, i] = b.dataset.del.split("|");
    const list = [...settings()[key]];
    list.splice(+i, 1);
    await saveSettings({ [key]: list });
    renderSettings();
  }));
  app().querySelectorAll("[data-addto]").forEach((f) => (f.onsubmit = async (e) => {
    e.preventDefault();
    const v = f.v.value.trim().toLowerCase();
    if (!v) return;
    const key = f.dataset.addto;
    await saveSettings({ [key]: [...settings()[key], v] });
    renderSettings();
  }));
  document.getElementById("save").onclick = async () => {
    const adults = [...app().querySelectorAll("[data-adult]")].map((i) => i.value.trim()).filter(Boolean);
    const kids = document.getElementById("kids").value.split(",").map((s) => s.trim()).filter(Boolean);
    await saveSettings({ adults, kids, notes: document.getElementById("notes").value.trim() });
    toast("Salvato.");
  };
  document.getElementById("newres").onclick = async () => {
    await saveSettings({ reserve: [] });
    S.busy = "Preparo i pranzi di riserva…";
    render();
    try { await ensureReserve(); } catch (e) { toast(e.message, 5000); }
    S.busy = null;
    render();
  };
  document.getElementById("stock")?.addEventListener("click", async () => {
    const names = new Map();
    for (const m of settings().reserve) for (const i of m.ingredients || []) names.set(norm(i.name), i);
    for (const i of names.values()) {
      if (!S.items.some((x) => !x.checked && norm(x.name) === norm(i.name))) {
        await sb.from("shopping_items").insert({ household_id: S.household.id, name: i.name, aisle: i.aisle || "Altro", source: "scorta" });
      }
    }
    const { data } = await sb.from("shopping_items").select("*").eq("household_id", S.household.id).order("created_at");
    S.items = data || S.items;
    toast("Scorte aggiunte alla spesa.");
  });
  document.getElementById("logout").onclick = async () => {
    if (S.channel) sb.removeChannel(S.channel);
    await sb.auth.signOut();
  };
}
