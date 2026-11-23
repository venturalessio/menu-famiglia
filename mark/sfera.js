// Sfera di particelle del pannello: gira piano a riposo, si allarga quando ascolta,
// vortica quando pensa, pulsa quando parla. Canvas 2D, nessuna libreria.

const COLORI = {
  riposo: [95, 225, 255],
  ascolto: [120, 235, 255],
  penso: [255, 181, 71],
  parlo: [92, 240, 166],
  errore: [255, 107, 107],
};

export function creaSfera(canvas) {
  const ctx = canvas.getContext("2d");
  const ridotto = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const N = 720;
  // Punti distribuiti in modo uniforme sulla sfera (spirale di Fibonacci)
  const punti = [];
  const oro = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < N; i++) {
    const y = 1 - (i / (N - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const t = oro * i;
    punti.push({ x: Math.cos(t) * r, y, z: Math.sin(t) * r, fase: Math.random() * Math.PI * 2 });
  }

  let stato = "riposo";
  let energia = 0; // 0..1: quanto "parla" in questo momento
  let colore = [...COLORI.riposo];
  let ang = 0;
  let w = 0, h = 0, dpr = 1;

  function misura() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = canvas.getBoundingClientRect();
    w = Math.max(1, r.width); h = Math.max(1, r.height);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  new ResizeObserver(misura).observe(canvas);
  misura();

  function frame(ms) {
    const t = ms / 1000;
    const target = COLORI[stato] ?? COLORI.riposo;
    colore = colore.map((c, i) => c + (target[i] - c) * 0.06);
    energia *= 0.9;

    const vel = { riposo: 0.12, ascolto: 0.25, penso: 0.9, parlo: 0.3, errore: 0.05 }[stato] ?? 0.12;
    ang += ridotto ? 0 : vel / 60;

    const cx = w / 2, cy = h / 2;
    const base = Math.min(w, h) * 0.34;
    const respiro = ridotto ? 0 : Math.sin(t * 1.3) * 0.015;
    const allarga = stato === "ascolto" ? 0.08 + Math.sin(t * 5) * 0.02 : 0;
    const R = base * (1 + respiro + allarga + energia * 0.12);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // alone
    const [r, g, b] = colore.map(Math.round);
    const alone = ctx.createRadialGradient(cx, cy, R * 0.1, cx, cy, R * 1.5);
    alone.addColorStop(0, `rgba(${r},${g},${b},${0.16 + energia * 0.2})`);
    alone.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.fillStyle = alone;
    ctx.fillRect(0, 0, w, h);

    const cosA = Math.cos(ang), sinA = Math.sin(ang);
    const incl = 0.35;
    const cosB = Math.cos(incl), sinB = Math.sin(incl);
    ctx.globalCompositeOperation = "lighter";
    for (const p of punti) {
      // vortice quando pensa, onda quando parla
      let k = 1;
      if (!ridotto && stato === "penso") k += Math.sin(t * 4 + p.y * 6) * 0.05;
      if (!ridotto && stato === "parlo") k += Math.sin(t * 9 + p.fase) * 0.04 * (0.4 + energia);
      const x1 = p.x * cosA - p.z * sinA;
      const z1 = p.x * sinA + p.z * cosA;
      const y2 = p.y * cosB - z1 * sinB;
      const z2 = p.y * sinB + z1 * cosB;
      const prof = (z2 + 1.6) / 2.6; // 0 dietro, 1 davanti
      const sx = cx + x1 * R * k;
      const sy = cy + y2 * R * k;
      const a = 0.12 + prof * 0.85;
      const s = (0.8 + prof * 1.8) * (Math.min(w, h) / 400);
      ctx.fillStyle = `rgba(${r},${g},${b},${a})`;
      ctx.fillRect(sx - s / 2, sy - s / 2, s, s);
    }
    ctx.globalCompositeOperation = "source-over";

    // nucleo
    const nucleo = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.35);
    nucleo.addColorStop(0, `rgba(255,255,255,${0.35 + energia * 0.4})`);
    nucleo.addColorStop(0.4, `rgba(${r},${g},${b},${0.25 + energia * 0.3})`);
    nucleo.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.fillStyle = nucleo;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.35, 0, Math.PI * 2);
    ctx.fill();

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return {
    stato(s) { stato = s in COLORI ? s : "riposo"; },
    // Un "colpo" di voce: lo chiamano gli eventi della sintesi vocale a ogni parola
    colpo(forza = 1) { energia = Math.min(1, energia + 0.5 * forza); },
  };
}
