// Regole del "nutrizionista": frequenze CREA 2018, porzioni per età, stagione.
// Modulo puro (niente DOM, niente rete): lo usa l'app e lo provano i test.
//
// Fonti: Linee guida per una sana alimentazione, CREA 2018 (frequenze per età);
// Standard quantitativi delle porzioni, SINU (grammature).

export const PROTEINS = ["pesce", "legumi", "uova", "carne_bianca", "carne_rossa", "salumi", "formaggio", "nessuna"];

export const PROTEIN_LABEL = {
  pesce: "Pesce",
  legumi: "Legumi",
  uova: "Uova",
  carne_bianca: "Carne bianca",
  carne_rossa: "Carne rossa",
  salumi: "Salumi",
  formaggio: "Formaggio",
  nessuna: "Solo vegetale",
};

// Frequenze settimanali. min/max = volte a settimana (pasti principali).
// Bambine: valgono su TUTTA la settimana, mensa compresa.
// max 99 = nessun tetto (troppi legumi o troppo pesce non sono un problema)
export const KID_TARGETS = {
  pesce: { min: 3, max: 99 },
  legumi: { min: 3, max: 99 },
  uova: { min: 1, max: 3 },
  carne: { min: 1, max: 4 }, // carne bianca + rossa
  carne_rossa: { min: 0, max: 1 },
  salumi: { min: 0, max: 1 },
  formaggio: { min: 0, max: 2 },
};
export const ADULT_TARGETS = {
  pesce: { min: 2, max: 99 },
  legumi: { min: 3, max: 99 },
  uova: { min: 1, max: 4 },
  carne_bianca: { min: 0, max: 3 },
  carne_rossa: { min: 0, max: 1 },
  salumi: { min: 0, max: 1 },
  formaggio: { min: 0, max: 2 },
};

// Porzione rispetto a un adulto (CREA/SINU, media tra carne, pasta e legumi).
export function portionFactor(age) {
  const a = Number(age);
  if (!Number.isFinite(a) || a >= 15) return 1;
  if (a <= 3) return 0.4;
  if (a <= 6) return 0.5;
  if (a <= 10) return 0.8;
  return 1;
}

export function kidsPortion(kidsInfo = []) {
  return kidsInfo.reduce((s, k) => s + portionFactor(k.age), 0);
}

// "2 adulti + Margherita (4 anni, ½) + Rebecca (10 anni, 0,8) = 3,3 porzioni"
export function portionsText(adults, kidsInfo = []) {
  const tot = adults + kidsPortion(kidsInfo);
  const kids = kidsInfo.map((k) => `${k.name} (${k.age} anni, ${String(portionFactor(k.age)).replace(".", ",")} porzione)`);
  return `${[`${adults} adulti`, ...kids].join(" + ")} = circa ${String(Math.round(tot * 10) / 10).replace(".", ",")} porzioni da adulto`;
}

// ---------- Stagione (Italia) ----------
const VEG = {
  1: "broccoli, cavolfiore, cavolo nero, cavolo verza, carciofi, finocchi, radicchio, spinaci, porri, zucca, cardi, bietole",
  2: "broccoli, cavolfiore, cavolo nero, verza, carciofi, finocchi, radicchio, spinaci, porri, bietole, cime di rapa",
  3: "carciofi, asparagi, finocchi, spinaci, bietole, cime di rapa, piselli, cipollotti, lattuga, broccoli",
  4: "asparagi, carciofi, piselli, fave, spinaci, bietole, lattuga, rucola, cipollotti, ravanelli",
  5: "asparagi, piselli, fave, zucchine, fagiolini, lattuga, rucola, carote, cetrioli, bietole",
  6: "zucchine, fagiolini, pomodori, melanzane, peperoni, cetrioli, lattuga, carote, fiori di zucca",
  7: "pomodori, zucchine, melanzane, peperoni, fagiolini, cetrioli, lattuga, carote, fiori di zucca",
  8: "pomodori, zucchine, melanzane, peperoni, fagiolini, cetrioli, lattuga, carote",
  9: "pomodori, peperoni, melanzane, zucchine, fagiolini, zucca, funghi, spinaci, lattuga",
  10: "zucca, broccoli, cavolfiore, spinaci, bietole, funghi, porri, finocchi, radicchio, cavolo nero",
  11: "zucca, broccoli, cavolfiore, cavolo nero, verza, finocchi, radicchio, spinaci, porri, carciofi, bietole",
  12: "broccoli, cavolfiore, cavolo nero, verza, carciofi, finocchi, radicchio, spinaci, porri, zucca, cardi",
};
const FRUIT = {
  1: ["arance", "mandarini", "kiwi", "mele", "pere"],
  2: ["arance", "mandarini", "kiwi", "mele", "pere"],
  3: ["arance", "kiwi", "mele", "pere", "limoni"],
  4: ["mele", "kiwi", "arance", "fragole", "pere"],
  5: ["fragole", "ciliegie", "nespole", "mele", "albicocche"],
  6: ["albicocche", "ciliegie", "pesche", "fragole", "meloni"],
  7: ["pesche", "albicocche", "meloni", "anguria", "susine"],
  8: ["pesche", "susine", "meloni", "anguria", "fichi"],
  9: ["uva", "fichi", "mele", "pere", "susine"],
  10: ["mele", "pere", "uva", "cachi", "kiwi"],
  11: ["mele", "pere", "cachi", "kiwi", "mandarini"],
  12: ["mandarini", "arance", "kiwi", "mele", "pere"],
};
export function seasonVeg(month) { return VEG[month] || VEG[1]; }
export function seasonFruit(month) { return FRUIT[month] || FRUIT[1]; }

// Frutta di casa per la settimana: adulti 3 al giorno; bambine 2 nei giorni di scuola
// (a mensa ne mangiano già una) e 3 nel weekend. Divisa sui primi 3 frutti di stagione.
export function fruitPlan(month, adults, kids, schoolDays = 5) {
  const total = adults * 3 * 7 + kids * (2 * schoolDays + 3 * (7 - schoolDays));
  const kinds = seasonFruit(month).slice(0, 3);
  const base = Math.floor(total / kinds.length);
  return {
    total,
    kg: Math.round(total * 0.15),
    items: kinds.map((name, i) => ({ name, portions: base + (i < total - base * kinds.length ? 1 : 0) })),
  };
}

// ---------- Classificazione dei piatti della mensa (testo libero) ----------
const RULES = [
  ["pesce", /\b(pesce|merluzz|nasell|platess|tonno|salmon|sgombr|alic[ie]|acciug|orata|spigola|branzin|seppi|calamar|gamber|cozz|vongol|halibut|limanda|trota|baccal|sogliol|filetto di (merluzzo|nasello|platessa|halibut|limanda)|bastoncin)/],
  ["carne_rossa", /\b(manzo|bovin|vitell|maiale|suin|lonza|arrosto di vitello|polpett[ae] di (carne|manzo|vitello)|hamburger(?! di (pollo|tacchino|legumi|pesce))|rag[uù](?!'? (di|con) (soia|lenticchie|legumi|verdure|tonno|pesce|pollo|tacchino))|bollito|spezzatino|cotechino|salsiccia|stinco)/],
  ["carne_bianca", /\b(pollo|tacchino|coniglio|petto di|cosce di pollo|fesa)/],
  ["salumi", /\b(prosciutto|mortadella|bresaola|salame|speck|wurstel|würstel)/],
  ["legumi", /\b(ceci|fagiol(?!ini)|lenticch|piselli|legum|cicerchi|fave|soia|hummus|farinata|tofu|lupin)/],
  ["uova", /\b(uov[ao]|frittat|omelette|tortino|uova sode)/],
  ["formaggio", /\b(formagg|mozzarell|stracchin|crescenz|ricotta|parmigian|grana|caciott|scamorz|fontina|asiago|primo sale|squacquerone)/],
];

// Restituisce la proteina principale di un testo (titolo + ingredienti).
export function classifyText(text) {
  const t = String(text || "").toLowerCase();
  for (const [p, re] of RULES) if (re.test(t)) return p;
  return "nessuna";
}

// Giorno di mensa: { courses: [{course, name, ingredients}] } -> proteine del giorno
export function classifySchoolDay(day) {
  const courses = day?.courses || [];
  const found = new Set();
  const second = courses.find((c) => /second/i.test(c.course));
  const firsts = courses.filter((c) => /prim|piatto unico/i.test(c.course));
  if (second) found.add(classifyText(`${second.name} ${second.ingredients}`));
  for (const c of firsts) {
    // dal primo contano solo legumi, pesce e carne (es. pasta e fagioli, ragù)
    const p = classifyText(`${c.name}`);
    if (["legumi", "pesce", "carne_rossa", "carne_bianca"].includes(p)) found.add(p);
  }
  found.delete("nessuna");
  return [...found];
}

// ---------- Bilancio della settimana ----------
// plan.days[].{lunch,dinner}.tags.protein ; school: { "YYYY-MM-DD": ["pesce", ...] }
// adultsLunch(date) -> numero di adulti che pranzano a casa o portano (giorni feriali)
export function weekBalance(plan, { school = {}, isWeekend, adultsLunch = () => 0 } = {}) {
  const kids = {}, adults = {};
  const add = (o, p) => { if (p && p !== "nessuna") o[p] = (o[p] || 0) + 1; };
  let meals = 0, withVeg = 0, wholegrain = 0, untagged = 0;
  for (const d of plan?.days || []) {
    const we = isWeekend ? isWeekend(d.date) : false;
    const family = [d.dinner];
    if (we) family.push(d.lunch);
    for (const m of family) {
      if (!m || m.takeaway) continue;
      meals++;
      if (!m.tags) { untagged++; continue; }
      add(kids, m.tags.protein);
      add(adults, m.tags.protein);
      if (m.tags.verdura) withVeg++;
      if (m.tags.integrale) wholegrain++;
    }
    if (!we) {
      for (const p of school[d.date] || []) add(kids, p);
      if (d.lunch && !d.lunch.takeaway && adultsLunch(d.date) > 0) {
        if (d.lunch.tags) add(adults, d.lunch.tags.protein);
      }
    }
  }
  kids.carne = (kids.carne_bianca || 0) + (kids.carne_rossa || 0);
  const check = (counts, targets, who) => Object.entries(targets).map(([k, t]) => {
    const n = counts[k] || 0;
    const status = n < t.min ? "poco" : n > t.max ? "troppo" : "ok";
    return { who, key: k, n, min: t.min, max: t.max, status };
  });
  const rows = [...check(kids, KID_TARGETS, "bambine"), ...check(adults, ADULT_TARGETS, "adulti")];
  const hasSchool = Object.keys(school).length > 0;
  const problems = rows.filter((r) => r.status !== "ok" && (r.who === "adulti" || hasSchool));
  if (meals && withVeg < meals - untagged) {
    problems.push({ who: "tutti", key: "verdura", n: withVeg, min: meals - untagged, max: meals, status: "poco" });
  }
  return { kids, adults, rows, problems, meals, withVeg, wholegrain, untagged, hasSchool };
}

const KEY_LABEL = { ...PROTEIN_LABEL, carne: "Carne", verdura: "Verdura a ogni pasto" };
export function keyLabel(k) { return KEY_LABEL[k] || k; }

// Frase per il modello: "Bambine: pesce 1 volta (minimo 3)…"
export function problemsText(problems) {
  return problems.map((p) => {
    const who = p.who === "tutti" ? "Tutti" : p.who === "bambine" ? "Bambine (mensa compresa)" : "Adulti";
    if (p.key === "verdura") return `${who}: la verdura c'è in ${p.n} pasti su ${p.min}, deve esserci in tutti`;
    const lim = p.status === "poco" ? `minimo ${p.min}` : `massimo ${p.max}`;
    return `${who}: ${keyLabel(p.key).toLowerCase()} ${p.n} ${p.n === 1 ? "volta" : "volte"} (${lim})`;
  }).join("\n");
}

// Voti: piatti bocciati (almeno 2 no e più no che sì) e promossi
export function votesSummary(recipes = []) {
  const disliked = [], liked = [];
  for (const r of recipes) {
    const v = r.data?.votes || {};
    const up = v.up || 0, down = v.down || 0;
    if (down >= 2 && down > up) disliked.push(r.title);
    else if (up >= 2 && up > down) liked.push(r.title);
  }
  return { disliked, liked };
}
