/* =========================================================================
   simuladores.js — Animaciones 2D (canvas) y simuladores interactivos
   -------------------------------------------------------------------------
   Cada simulador se registra para una diapositiva (id). Solo se animan los
   simuladores de la diapositiva activa, con un único requestAnimationFrame.
   Los sliders solo cambian el estado y marcan "dirty"; el cálculo y el
   dibujo ocurren dentro del frame → sin lag.
   API pública: Sims.activate(slideEl), Sims.deactivate()
   ========================================================================= */
window.Sims = (() => {
  'use strict';

  /* ---------------------------------------------------------------------
     Constantes y utilidades
     --------------------------------------------------------------------- */
  const C = {
    cyan: '#00e5ff', orange: '#ff8a1f', violet: '#b36bff',
    text: '#e8f1ff', muted: '#8ea3c9', grid: 'rgba(140,180,255,0.14)',
    green: '#3dff9e', red: '#ff4d6d',
  };
  const TAU = Math.PI * 2;
  const DEG = 180 / Math.PI;
  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, k) => a + (b - a) * k;

  const registry = {};   // id de diapositiva → lista de simuladores
  let active = [];
  let rafId = null;

  function register(slideId, sim) { (registry[slideId] = registry[slideId] || []).push(sim); }

  /** Ajusta el canvas al tamaño CSS × devicePixelRatio y devuelve el contexto. */
  function fit(canvas) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const W = Math.round(w * dpr), H = Math.round(h * dpr);
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    const ctx = canvas._ctx || (canvas._ctx = canvas.getContext('2d'));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx, w, h };
  }

  /** Dibuja una flecha de (x1,y1) a (x2,y2). */
  function arrow(ctx, x1, y1, x2, y2, head = 7) {
    const a = Math.atan2(y2 - y1, x2 - x1);
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - head * Math.cos(a - 0.45), y2 - head * Math.sin(a - 0.45));
    ctx.lineTo(x2 - head * Math.cos(a + 0.45), y2 - head * Math.sin(a + 0.45));
    ctx.closePath(); ctx.fill();
  }

  function label(ctx, txt, x, y, color = C.muted, size = 13, align = 'left', weight = 500) {
    ctx.fillStyle = color;
    ctx.font = `${weight} ${size}px Inter, sans-serif`;
    ctx.textAlign = align; ctx.textBaseline = 'middle';
    ctx.fillText(txt, x, y);
  }

  /** Actualiza el relleno visual de un slider (variable CSS --fill). */
  function paintRange(input) {
    const p = ((input.value - input.min) / (input.max - input.min)) * 100;
    input.style.setProperty('--fill', p + '%');
  }

  /** Enlaza un slider: llama onInput(valor) y pinta el relleno. */
  function bindRange(id, onInput) {
    const el = $(id);
    if (!el) return null;
    const handler = () => { paintRange(el); onInput(parseFloat(el.value)); };
    el.addEventListener('input', handler);
    handler();
    return el;
  }

  /** Grupo de botones excluyentes (toggle). */
  function bindToggle(buttons, onSelect) {
    buttons.forEach((b) => b.addEventListener('click', () => {
      buttons.forEach((x) => x.classList.toggle('active', x === b));
      onSelect(b);
    }));
  }

  const fmt = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '—');

  /* ---------------------------------------------------------------------
     Funciones de Bessel (aprox. racionales, Numerical Recipes)
     --------------------------------------------------------------------- */
  function besselJ0(x) {
    const ax = Math.abs(x);
    if (ax < 8) {
      const y = x * x;
      const a1 = 57568490574.0 + y * (-13362590354.0 + y * (651619640.7 + y * (-11214424.18 + y * (77392.33017 + y * -184.9052456))));
      const a2 = 57568490411.0 + y * (1029532985.0 + y * (9494680.718 + y * (59272.64853 + y * (267.8532712 + y))));
      return a1 / a2;
    }
    const z = 8 / ax, y = z * z, xx = ax - 0.785398164;
    const p1 = 1 + y * (-0.1098628627e-2 + y * (0.2734510407e-4 + y * (-0.2073370639e-5 + y * 0.2093887211e-6)));
    const p2 = -0.1562499995e-1 + y * (0.1430488765e-3 + y * (-0.6911147651e-5 + y * (0.7621095161e-6 - y * 0.934935152e-7)));
    return Math.sqrt(0.636619772 / ax) * (Math.cos(xx) * p1 - z * Math.sin(xx) * p2);
  }
  function besselJ1(x) {
    const ax = Math.abs(x);
    if (ax < 8) {
      const y = x * x;
      const a1 = x * (72362614232.0 + y * (-7895059235.0 + y * (242396853.1 + y * (-2972611.439 + y * (15704.4826 + y * -30.16036606)))));
      const a2 = 144725228442.0 + y * (2300535178.0 + y * (18583304.74 + y * (99447.43394 + y * (376.9991397 + y))));
      return a1 / a2;
    }
    const z = 8 / ax, y = z * z, xx = ax - 2.356194491;
    const p1 = 1 + y * (0.183105e-2 + y * (-0.3516396496e-4 + y * (0.2457520174e-5 + y * -0.240337019e-6)));
    const p2 = 0.04687499995 + y * (-0.2002690873e-3 + y * (0.8449199096e-5 + y * (-0.88228987e-6 + y * 0.105787412e-6)));
    const ans = Math.sqrt(0.636619772 / ax) * (Math.cos(xx) * p1 - z * Math.sin(xx) * p2);
    return x < 0 ? -ans : ans;
  }

  /* =====================================================================
     S2 · ¿Qué es una antena? — onda guiada → dipolo → campos E y H
     ===================================================================== */
  register('s2', {
    init() { this.cv = $('cv-queEs'); },
    frame(t) {
      const { ctx, w, h } = fit(this.cv);
      const cy = h * 0.5;
      const gap = h * 0.055;
      const xs = w * 0.03, xa = w * 0.3;
      const omega = 3.2;
      const kG = TAU / (w * 0.12);

      // Generador
      ctx.strokeStyle = C.orange; ctx.lineWidth = 2;
      ctx.strokeRect(xs, cy - gap * 2, w * 0.05, gap * 4);
      label(ctx, 'Tx', xs + w * 0.025, cy, C.orange, 13, 'center', 700);

      // Línea bifilar (onda guiada)
      ctx.strokeStyle = 'rgba(220,230,255,0.75)'; ctx.lineWidth = 2;
      [cy - gap, cy + gap].forEach((y) => { ctx.beginPath(); ctx.moveTo(xs + w * 0.05, y); ctx.lineTo(xa, y); ctx.stroke(); });
      ctx.fillStyle = C.orange;
      for (let x = xs + w * 0.07; x < xa - 6; x += 12) {
        const a = Math.sin(kG * x - omega * t);
        ctx.globalAlpha = 0.25 + 0.75 * Math.abs(a);
        ctx.strokeStyle = C.orange; ctx.lineWidth = 1.5;
        const len = gap * 0.85 * a;
        if (Math.abs(len) > 2) arrow(ctx, x, cy - len, x, cy + len, 4);
      }
      ctx.globalAlpha = 1;
      label(ctx, 'Onda guiada', (xs + xa) / 2 + w * 0.02, cy + gap * 2.6, C.orange, 12, 'center');

      // Dipolo
      const armL = h * 0.3;
      ctx.save();
      ctx.shadowColor = C.cyan; ctx.shadowBlur = 14;
      ctx.strokeStyle = C.cyan; ctx.lineWidth = 5; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(xa, cy - gap); ctx.lineTo(xa, cy - armL); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(xa, cy + gap); ctx.lineTo(xa, cy + armL); ctx.stroke();
      ctx.restore();
      label(ctx, 'Antena', xa, cy - armL - 14, C.cyan, 12, 'center', 600);

      // Frentes de onda que se expanden desde la antena
      const lamPx = w * 0.13;
      for (let i = 0; i < 6; i++) {
        const r = ((t * 45) + i * lamPx) % (lamPx * 6);
        const alpha = 0.35 * (1 - r / (lamPx * 6));
        ctx.strokeStyle = `rgba(179,107,255,${alpha})`; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(xa, cy, r + 10, -1.0, 1.0); ctx.stroke();
      }

      // Onda radiada: E (vertical) y H (proyección oblicua)
      const x0 = xa + w * 0.07, x1 = w - w * 0.05;
      const A = h * 0.26;
      const kF = TAU / lamPx;
      const zx = -0.55, zy = 0.42; // eje z proyectado
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x0, cy); ctx.lineTo(x1, cy); ctx.stroke();

      const ePts = [], hPts = [];
      for (let x = x0; x <= x1; x += 3) {
        const env = Math.min(1, (x - x0) / (w * 0.06));
        const v = env * Math.sin(kF * (x - x0) - omega * t);
        ePts.push([x, cy - A * v]);
        hPts.push([x + zx * A * 0.8 * v, cy + zy * A * 0.8 * v]);
      }
      // Vectores (líneas finas)
      for (let i = 0; i < ePts.length; i += 4) {
        ctx.strokeStyle = 'rgba(0,229,255,0.35)';
        ctx.beginPath(); ctx.moveTo(ePts[i][0], cy); ctx.lineTo(ePts[i][0], ePts[i][1]); ctx.stroke();
        ctx.strokeStyle = 'rgba(179,107,255,0.35)';
        ctx.beginPath(); ctx.moveTo(ePts[i][0], cy); ctx.lineTo(hPts[i][0], hPts[i][1]); ctx.stroke();
      }
      const curve = (pts, col) => {
        ctx.save(); ctx.shadowColor = col; ctx.shadowBlur = 10;
        ctx.strokeStyle = col; ctx.lineWidth = 2.5;
        ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
        ctx.restore();
      };
      curve(hPts, C.violet);
      curve(ePts, C.cyan);

      // Etiquetas
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
      arrow(ctx, x1 - w * 0.08, cy + A * 1.1, x1, cy + A * 1.1, 9);
      label(ctx, 'propagación  k', x1 - w * 0.09, cy + A * 1.1, '#fff', 13, 'right', 600);
      label(ctx, 'E', x0 + 6, cy - A - 10, C.cyan, 18, 'left', 700);
      label(ctx, 'H', x1 + 8, cy + zy * A * 0.8, C.violet, 18, 'left', 700);
      label(ctx, 'Onda radiada (campo lejano)', (x0 + x1) / 2, h * 0.07, C.muted, 13, 'center');
    },
  });

  /* =====================================================================
     S5 · Distribución de corriente sobre el dipolo λ/2
     ===================================================================== */
  register('s5', {
    init() { this.cv = $('cv-corriente'); },
    frame(t) {
      const { ctx, w, h } = fit(this.cv);
      const cx = w * 0.36, cy = h * 0.5;
      const half = h * 0.4;          // L/2 en píxeles
      const W = Math.min(w * 0.2, h * 0.3);
      const gapPx = 6;
      const wt = t * TAU * 0.45;      // ωt
      const it = Math.cos(wt);        // factor temporal de la corriente
      const vt = Math.sin(wt);        // tensión desfasada 90°

      // Envolvente (amplitud máxima) punteada
      ctx.setLineDash([5, 5]); ctx.strokeStyle = 'rgba(0,229,255,0.45)'; ctx.lineWidth = 1.5;
      [1, -1].forEach((s) => {
        ctx.beginPath();
        for (let i = 0; i <= 100; i++) {
          const z = -1 + (2 * i) / 100;
          const x = cx + s * W * Math.cos((Math.PI / 2) * z);
          const y = cy - z * half;
          i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        }
        ctx.stroke();
      });
      ctx.setLineDash([]);

      // Corriente instantánea (área rellena)
      const grad = ctx.createLinearGradient(cx - W, 0, cx + W, 0);
      grad.addColorStop(0, 'rgba(0,229,255,0.05)');
      grad.addColorStop(0.5, 'rgba(0,229,255,0.55)');
      grad.addColorStop(1, 'rgba(0,229,255,0.05)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      for (let i = 0; i <= 100; i++) {
        const z = -1 + (2 * i) / 100;
        ctx.lineTo(cx + W * Math.cos((Math.PI / 2) * z) * Math.abs(it), cy - z * half);
      }
      for (let i = 100; i >= 0; i--) {
        const z = -1 + (2 * i) / 100;
        ctx.lineTo(cx - W * Math.cos((Math.PI / 2) * z) * Math.abs(it), cy - z * half);
      }
      ctx.closePath(); ctx.fill();

      // Brazos del dipolo
      ctx.save();
      ctx.shadowColor = C.cyan; ctx.shadowBlur = 12;
      ctx.strokeStyle = '#d8f9ff'; ctx.lineWidth = 6; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(cx, cy - gapPx); ctx.lineTo(cx, cy - half); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx, cy + gapPx); ctx.lineTo(cx, cy + half); ctx.stroke();
      ctx.restore();
      // Alimentación
      ctx.fillStyle = C.orange; ctx.beginPath(); ctx.arc(cx, cy, 6 + 2 * Math.abs(it), 0, TAU); ctx.fill();

      // Flechas de sentido de la corriente (mismo sentido en ambos brazos)
      ctx.fillStyle = C.cyan; ctx.strokeStyle = C.cyan; ctx.lineWidth = 2.5;
      [-0.75, -0.4, 0.4, 0.75].forEach((z) => {
        const mag = Math.cos((Math.PI / 2) * z) * it;
        const len = 26 * mag;
        if (Math.abs(len) < 3) return;
        const y = cy - z * half;
        arrow(ctx, cx + 16, y + len / 2, cx + 16, y - len / 2, 7);
      });

      // Cargas en las puntas (tensión máxima)
      const q = vt;
      label(ctx, q > 0 ? '+' : '−', cx, cy - half - 18, q > 0 ? C.orange : C.violet, 16 + 10 * Math.abs(q), 'center', 800);
      label(ctx, q > 0 ? '−' : '+', cx, cy + half + 18, q > 0 ? C.violet : C.orange, 16 + 10 * Math.abs(q), 'center', 800);

      // Gráfica V(z) (tensión, antisimétrica) a la derecha
      const bx = w * 0.78;
      ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(bx, cy - half); ctx.lineTo(bx, cy + half); ctx.stroke();
      ctx.save(); ctx.shadowColor = C.violet; ctx.shadowBlur = 8;
      ctx.strokeStyle = C.violet; ctx.lineWidth = 2.5;
      ctx.beginPath();
      for (let i = 0; i <= 100; i++) {
        const z = -1 + (2 * i) / 100;
        const v = Math.sin((Math.PI / 2) * z) * vt;
        const x = bx + v * w * 0.12, y = cy - z * half;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.stroke(); ctx.restore();
      label(ctx, 'V(z)', bx, cy - half - 18, C.violet, 14, 'center', 700);

      // Etiquetas
      label(ctx, 'I máx', cx + W + 10, cy, C.cyan, 14, 'left', 700);
      label(ctx, 'I = 0', cx + 14, cy - half + 4, C.muted, 12, 'left');
      label(ctx, 'I = 0', cx + 14, cy + half - 4, C.muted, 12, 'left');
      label(ctx, 'L = λ/2', cx - W - 10, cy - half * 0.5, '#fff', 14, 'right', 600);
      label(ctx, `cos(ωt) = ${it.toFixed(2)}`, w * 0.03, h * 0.05, C.muted, 12, 'left');
    },
  });

  /* =====================================================================
     S6 · SIMULADOR: patrón del dipolo de longitud arbitraria
     ===================================================================== */
  /** Campo E(θ) del dipolo de longitud L (en λ). */
  function dipoleE(L, th) {
    const kl2 = Math.PI * L;
    const s = Math.sin(th);
    if (Math.abs(s) < 1e-6) return 0;
    return (Math.cos(kl2 * Math.cos(th)) - Math.cos(kl2)) / s;
  }

  /** Directividad, HPBW, número de lóbulos y ángulo del máximo. */
  function analyzeDipole(L) {
    const N = 1800;
    const U = new Float64Array(N + 1);
    let umax = 0, imax = 0, integ = 0;
    const dth = Math.PI / N;
    for (let i = 0; i <= N; i++) {
      const th = i * dth;
      const e = dipoleE(L, th);
      U[i] = e * e;
      integ += U[i] * Math.sin(th) * dth;
      if (U[i] > umax + 1e-12) { umax = U[i]; imax = i; }
    }
    const D = (2 * umax) / integ;
    // Lóbulos: máximos locales significativos
    let lobes = 0;
    for (let i = 1; i < N; i++) if (U[i] > U[i - 1] && U[i] >= U[i + 1] && U[i] > umax * 1e-4) lobes++;
    // HPBW alrededor del máximo principal
    const half = umax / 2;
    let l = imax, r = imax;
    while (l > 0 && U[l] > half) l--;
    while (r < N && U[r] > half) r++;
    const interp = (i0, i1) => {
      const f = (half - U[i0]) / (U[i1] - U[i0] || 1e-12);
      return (i0 + f * (i1 - i0)) * dth;
    };
    const thL = l === 0 && U[0] > half ? 0 : interp(l, l + 1);
    const thR = r === N && U[N] > half ? Math.PI : interp(r, r - 1);
    return { D, lobes, hpbw: (thR - thL) * DEG, thMax: imax * dth * DEG, thL, thR };
  }

  register('s6', {
    init() {
      this.cv = $('cv-dipoloPolar');
      this.cv3d = $('cv-dipolo3d');
      this.L = 0.5; this.Ld = 0.5; this.dirty = true; this.mode = '2d';
      const rng = bindRange('rng-L', (v) => { this.L = v; this.dirty = true; });
      // Botones de valores predefinidos
      document.querySelectorAll('#s6 .chip').forEach((b) => b.addEventListener('click', () => {
        rng.value = b.dataset.L; rng.dispatchEvent(new Event('input'));
      }));
      // Alternar 2D / 3D
      bindToggle([$('btn-2d'), $('btn-3d')], (b) => {
        this.mode = b.id === 'btn-3d' ? '3d' : '2d';
        this.cv.classList.toggle('hidden', this.mode === '3d');
        this.cv3d.classList.toggle('hidden', this.mode === '2d');
        $('dip-badge').textContent = this.mode === '3d'
          ? 'Sólido de revolución · arrastra para girar'
          : 'Plano E · θ medido desde el eje del dipolo';
      });
    },
    frame(t) {
      // Suavizado del valor mostrado
      this.Ld = Math.abs(this.L - this.Ld) < 1e-3 ? this.L : lerp(this.Ld, this.L, 0.25);
      if (window.ThreeScenes) ThreeScenes.setDipoleL(this.Ld);

      if (this.dirty) {
        this.dirty = false;
        const a = analyzeDipole(this.L);
        this.an = a;
        $('out-L').textContent = this.L.toFixed(2);
        $('ro-D').textContent = a.D.toFixed(2);
        $('ro-DdB').textContent = `${(10 * Math.log10(a.D)).toFixed(2)} dBi`;
        $('ro-hpbw').textContent = a.hpbw.toFixed(1);
        $('ro-lobes').textContent = a.lobes;
        $('ro-tmax').textContent = a.thMax.toFixed(1);
      }
      if (this.mode === '3d') return;

      const { ctx, w, h } = fit(this.cv);
      const cx = w / 2, cy = h / 2;
      const R = Math.min(w, h) * 0.42;

      // Rejilla polar
      ctx.lineWidth = 1;
      [0.25, 0.5, 0.75, 1].forEach((k) => {
        ctx.strokeStyle = C.grid; ctx.beginPath(); ctx.arc(cx, cy, R * k, 0, TAU); ctx.stroke();
        label(ctx, k.toFixed(2), cx + 4, cy - R * k + 9, 'rgba(142,163,201,0.7)', 10);
      });
      for (let d = 0; d < 360; d += 30) {
        const a = d / DEG;
        ctx.strokeStyle = C.grid;
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + R * Math.sin(a), cy - R * Math.cos(a)); ctx.stroke();
        const th = d <= 180 ? d : 360 - d;
        label(ctx, `${th}°`, cx + (R + 18) * Math.sin(a), cy - (R + 18) * Math.cos(a), C.muted, 11, 'center');
      }
      // Círculo de −3 dB
      ctx.setLineDash([4, 6]); ctx.strokeStyle = 'rgba(255,138,31,0.5)';
      ctx.beginPath(); ctx.arc(cx, cy, R * Math.SQRT1_2, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
      label(ctx, '−3 dB', cx + R * 0.72, cy + R * 0.72 - 6, 'rgba(255,138,31,0.8)', 11);

      // Patrón normalizado |E|/|E|máx
      const N = 720;
      const vals = new Float64Array(N + 1);
      let mx = 1e-12;
      for (let i = 0; i <= N; i++) {
        const phi = (i / N) * TAU;
        const th = phi <= Math.PI ? phi : TAU - phi;
        vals[i] = Math.abs(dipoleE(this.Ld, th));
        if (vals[i] > mx) mx = vals[i];
      }
      const pulse = 1 + 0.015 * Math.sin(t * 4);
      ctx.beginPath();
      for (let i = 0; i <= N; i++) {
        const phi = (i / N) * TAU;
        const r = (vals[i] / mx) * R * pulse;
        const x = cx + r * Math.sin(phi), y = cy - r * Math.cos(phi);
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.closePath();
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
      g.addColorStop(0, 'rgba(0,229,255,0.05)'); g.addColorStop(1, 'rgba(0,229,255,0.35)');
      ctx.fillStyle = g; ctx.fill();
      ctx.save(); ctx.shadowColor = C.cyan; ctx.shadowBlur = 16;
      ctx.strokeStyle = C.cyan; ctx.lineWidth = 2.5; ctx.stroke(); ctx.restore();

      // Puntos de media potencia del lóbulo principal (ambos lados)
      if (this.an) {
        ctx.fillStyle = C.orange;
        [this.an.thL, this.an.thR].forEach((th) => {
          [1, -1].forEach((s) => {
            const r = R * Math.SQRT1_2;
            ctx.beginPath(); ctx.arc(cx + s * r * Math.sin(th), cy - r * Math.cos(th), 4, 0, TAU); ctx.fill();
          });
        });
      }

      // Dipolo dibujado a escala relativa
      const len = R * 0.42 * this.Ld;
      ctx.save(); ctx.shadowColor = C.orange; ctx.shadowBlur = 10;
      ctx.strokeStyle = C.orange; ctx.lineWidth = 4; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(cx, cy - len); ctx.lineTo(cx, cy - 3); ctx.moveTo(cx, cy + 3); ctx.lineTo(cx, cy + len); ctx.stroke();
      ctx.restore();
      label(ctx, `L = ${this.Ld.toFixed(2)} λ`, w - 12, 18, '#fff', 14, 'right', 700);
    },
  });

  /* =====================================================================
     S8 · Selector de tipos de bocina (sin canvas 2D, solo UI)
     ===================================================================== */
  const HORN_INFO = {
    E: ['Sectorial plano E', 'Se abre solo en la dimensión <strong>b</strong> (paralela al campo E). Haz angosto en el plano E y ancho en el plano H.'],
    H: ['Sectorial plano H', 'Se abre solo en la dimensión <strong>a</strong> (perpendicular a E). Haz angosto en el plano H y ancho en el plano E.'],
    P: ['Piramidal', 'Se abre en <strong>ambas</strong> dimensiones: haz angosto en los dos planos. Es la más usada como antena patrón de ganancia.'],
    C: ['Cónica', 'Se alimenta con una guía <strong>circular</strong> (modo TE<sub>11</sub>). Patrón casi simétrico; ideal como alimentador de reflectores.'],
  };
  register('s8', {
    init() {
      const btns = [...document.querySelectorAll('#horn-selector .btn')];
      bindToggle(btns, (b) => {
        const k = b.dataset.horn;
        if (window.ThreeScenes) ThreeScenes.setHorn(k);
        const box = $('horn-info');
        box.innerHTML = `<h4>${HORN_INFO[k][0]}</h4><p>${HORN_INFO[k][1]}</p>`;
        if (window.gsap) gsap.fromTo(box, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.4 });
      });
    },
    frame() {},
  });

  /* =====================================================================
     S9 · Onda saliendo de la guía y expandiéndose por la bocina
     ===================================================================== */
  register('s9', {
    init() { this.cv = $('cv-hornWave'); },
    frame(t) {
      const { ctx, w, h } = fit(this.cv);
      const cy = h * 0.5;
      const x0 = w * 0.04, x1 = w * 0.28, x2 = w * 0.6;
      const gh = h * 0.09, H = h * 0.36;
      const apexX = x1 - (gh * (x2 - x1)) / (H - gh);
      const r1 = x1 - apexX, r2 = Math.hypot(x2 - apexX, H);
      const alpha = Math.atan2(H, x2 - apexX);
      const lam = w * 0.06;              // λ en píxeles
      const guideLen = x1 - x0;
      const maxP = guideLen + (w * 1.05 - x1);
      const speed = 55;

      // Polígono interior (guía + bocina)
      const inside = () => {
        ctx.beginPath();
        ctx.moveTo(x0, cy - gh); ctx.lineTo(x1, cy - gh); ctx.lineTo(x2, cy - H);
        ctx.lineTo(x2, cy + H); ctx.lineTo(x1, cy + gh); ctx.lineTo(x0, cy + gh); ctx.closePath();
      };

      // Relleno tenue del interior
      inside(); ctx.fillStyle = 'rgba(255,138,31,0.05)'; ctx.fill();

      // Frentes de onda (cada λ/2, alternando cresta / valle)
      const fronts = [];
      const off = (t * speed) % lam;
      for (let p = off - lam; p < maxP; p += lam / 2) fronts.push(p);

      fronts.forEach((p, idx) => {
        if (p < 0) return;
        const crest = Math.round((p - off) / (lam / 2)) % 2 === 0;
        const col = crest ? '255,160,60' : '179,107,255';
        if (p < guideLen) {
          // Frente plano dentro de la guía
          const x = x0 + p;
          ctx.strokeStyle = `rgba(${col},${crest ? 0.95 : 0.5})`; ctx.lineWidth = crest ? 3 : 1.5;
          ctx.beginPath(); ctx.moveTo(x, cy - gh); ctx.lineTo(x, cy + gh); ctx.stroke();
        } else {
          const R = r1 + (p - guideLen);
          // Parte dentro de la bocina (recortada al polígono)
          ctx.save(); inside(); ctx.clip();
          ctx.strokeStyle = `rgba(${col},${crest ? 0.95 : 0.5})`; ctx.lineWidth = crest ? 3 : 1.5;
          ctx.beginPath(); ctx.arc(apexX, cy, R, -alpha * 1.1, alpha * 1.1); ctx.stroke();
          ctx.restore();
          // Parte fuera de la apertura: frente esférico que se abre y se desvanece
          if (R > x2 - apexX) {
            const out = (R - (x2 - apexX)) / (w - x2 + 40);
            const span = Math.min(alpha + out * 0.9, 1.25);
            ctx.save();
            ctx.beginPath(); ctx.rect(x2, 0, w - x2, h); ctx.clip();
            ctx.strokeStyle = `rgba(${col},${(crest ? 0.9 : 0.45) * Math.max(0, 1 - out)})`;
            ctx.lineWidth = crest ? 2.5 : 1.2;
            ctx.beginPath(); ctx.arc(apexX, cy, R, -span, span); ctx.stroke();
            ctx.restore();
          }
        }
      });

      // Paredes metálicas
      ctx.save(); ctx.shadowColor = C.orange; ctx.shadowBlur = 12;
      ctx.strokeStyle = C.orange; ctx.lineWidth = 4; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(x0, cy - gh); ctx.lineTo(x1, cy - gh); ctx.lineTo(x2, cy - H); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x0, cy + gh); ctx.lineTo(x1, cy + gh); ctx.lineTo(x2, cy + H); ctx.stroke();
      ctx.restore();
      ctx.strokeStyle = 'rgba(255,138,31,0.6)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x0, cy - gh); ctx.lineTo(x0, cy + gh); ctx.stroke();

      // Vértice virtual (líneas punteadas)
      ctx.setLineDash([3, 5]); ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x1, cy - gh); ctx.lineTo(apexX, cy); ctx.lineTo(x1, cy + gh); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.beginPath(); ctx.arc(apexX, cy, 3, 0, TAU); ctx.fill();

      // Etiquetas
      label(ctx, 'Guía de onda', (x0 + x1) / 2, cy - gh - 16, C.muted, 13, 'center', 600);
      label(ctx, 'Bocina', (x1 + x2) / 2, cy - H - 4, C.orange, 14, 'center', 700);
      label(ctx, 'Espacio libre', x2 + (w - x2) / 2, h * 0.06, C.muted, 13, 'center', 600);
      label(ctx, 'frente plano', (x0 + x1) / 2, cy + gh + 16, 'rgba(255,255,255,0.6)', 11, 'center');
      label(ctx, 'frente esférico', x2 + (w - x2) / 2, h * 0.94, 'rgba(255,255,255,0.6)', 11, 'center');
      label(ctx, 'apertura', x2, cy + H + 14, 'rgba(255,255,255,0.6)', 11, 'center');
    },
  });

  /* =====================================================================
     S10 · SIMULADOR: bocina piramidal con medidor tipo velocímetro
     ===================================================================== */
  register('s10', {
    init() {
      this.cv = $('cv-hornGauge');
      this.f = 10; this.a = 12; this.b = 9; this.dirty = true;
      this.gShown = 0;   // valor animado de la aguja (dBi)
      bindRange('rng-hf', (v) => { this.f = v; this.dirty = true; });
      bindRange('rng-ha', (v) => { this.a = v; this.dirty = true; });
      bindRange('rng-hb', (v) => { this.b = v; this.dirty = true; });
    },
    enter() { this.gShown = -10; }, // la aguja "arranca" al entrar
    frame(t) {
      if (this.dirty) {
        this.dirty = false;
        const lam = 30 / this.f;                             // cm
        const G = 0.51 * 4 * Math.PI * this.a * this.b / (lam * lam);
        this.lam = lam; this.G = G; this.gdb = 10 * Math.log10(G);
        this.hE = 56 * lam / this.b; this.hH = 67 * lam / this.a;
        $('out-hf').textContent = `${this.f.toFixed(1)} GHz`;
        $('out-ha').textContent = `${this.a.toFixed(1)} cm`;
        $('out-hb').textContent = `${this.b.toFixed(1)} cm`;
        $('ro-hl').textContent = lam.toFixed(2);
        $('ro-hG').textContent = G >= 1000 ? G.toFixed(0) : G >= 1 ? G.toFixed(1) : G.toFixed(3);
        $('ro-hE').textContent = this.hE > 180 ? '>180' : this.hE.toFixed(1);
        $('ro-hH').textContent = this.hH > 180 ? '>180' : this.hH.toFixed(1);
        $('horn-warn').textContent = (this.a < lam || this.b < lam)
          ? '⚠ La apertura es menor que λ: las fórmulas aproximadas pierden validez.' : '';
      }
      this.gShown = lerp(this.gShown, this.gdb, 0.08);

      const { ctx, w, h } = fit(this.cv);
      const cx = w / 2, cy = h * 0.4;
      const R = Math.min(w * 0.28, h * 0.3);
      const gMin = -10, gMax = 50;
      const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;   // barrido de 270°
      const angOf = (g) => a0 + ((clamp(g, gMin, gMax) - gMin) / (gMax - gMin)) * (a1 - a0);

      // Pista
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = R * 0.14;
      ctx.beginPath(); ctx.arc(cx, cy, R, a0, a1); ctx.stroke();
      // Arco de valor
      const grad = ctx.createLinearGradient(cx - R, 0, cx + R, 0);
      grad.addColorStop(0, '#ffd166'); grad.addColorStop(0.5, C.orange); grad.addColorStop(1, '#ff3d5a');
      ctx.save(); ctx.shadowColor = C.orange; ctx.shadowBlur = 22;
      ctx.strokeStyle = grad;
      ctx.beginPath(); ctx.arc(cx, cy, R, a0, angOf(this.gShown)); ctx.stroke();
      ctx.restore();

      // Marcas y números
      for (let g = gMin; g <= gMax; g += 5) {
        const a = angOf(g);
        const major = g % 10 === 0;
        const r0 = R * (major ? 0.74 : 0.79), r1 = R * 0.84;
        ctx.strokeStyle = major ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.3)';
        ctx.lineWidth = major ? 2 : 1; ctx.lineCap = 'butt';
        ctx.beginPath(); ctx.moveTo(cx + r0 * Math.cos(a), cy + r0 * Math.sin(a));
        ctx.lineTo(cx + r1 * Math.cos(a), cy + r1 * Math.sin(a)); ctx.stroke();
        if (major) label(ctx, `${g}`, cx + R * 0.63 * Math.cos(a), cy + R * 0.63 * Math.sin(a), C.muted, Math.max(10, R * 0.07), 'center', 600);
      }

      // Aguja
      const an = angOf(this.gShown);
      ctx.save(); ctx.shadowColor = '#fff'; ctx.shadowBlur = 10;
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(cx - R * 0.1 * Math.cos(an), cy - R * 0.1 * Math.sin(an));
      ctx.lineTo(cx + R * 0.9 * Math.cos(an), cy + R * 0.9 * Math.sin(an)); ctx.stroke();
      ctx.restore();
      ctx.fillStyle = C.orange; ctx.beginPath(); ctx.arc(cx, cy, R * 0.06, 0, TAU); ctx.fill();

      // Valor digital
      label(ctx, `${this.gShown.toFixed(1)}`, cx, cy + R * 0.42, '#fff', Math.max(22, R * 0.26), 'center', 800);
      label(ctx, 'dBi', cx, cy + R * 0.64, C.orange, Math.max(12, R * 0.1), 'center', 700);
      label(ctx, 'GANANCIA', cx, cy - R * 0.28, C.muted, Math.max(10, R * 0.07), 'center', 600);

      // --- Panel inferior izquierdo: apertura a×b frente a λ×λ
      const py = h * 0.84, ph = h * 0.24;
      const pw = w * 0.44;
      const lam = this.lam;
      const s = Math.min((pw * 0.9) / (this.a + lam * 1.4), (ph * 0.62) / Math.max(this.b, lam));
      const rx = w * 0.04, ry = py;
      ctx.strokeStyle = C.orange; ctx.lineWidth = 2; ctx.fillStyle = 'rgba(255,138,31,0.15)';
      ctx.fillRect(rx, ry - (this.b * s) / 2, this.a * s, this.b * s);
      ctx.strokeRect(rx, ry - (this.b * s) / 2, this.a * s, this.b * s);
      ctx.setLineDash([4, 4]); ctx.strokeStyle = C.cyan;
      const lx = rx + this.a * s + lam * 0.3 * s;
      ctx.strokeRect(lx, ry - (lam * s) / 2, lam * s, lam * s); ctx.setLineDash([]);
      label(ctx, 'a × b', rx, ry - (Math.max(this.b, lam) * s) / 2 - 12, C.orange, 12, 'left', 700);
      label(ctx, 'λ × λ', lx, ry - (Math.max(this.b, lam) * s) / 2 - 12, C.cyan, 12, 'left', 700);

      // --- Panel inferior derecho: abanicos de ancho de haz E y H
      const fans = [['Plano E', this.hE, C.cyan], ['Plano H', this.hH, C.violet]];
      fans.forEach(([name, deg, col], i) => {
        const fx = w * (0.62 + i * 0.2), fy = py + ph * 0.3, fr = Math.min(ph * 0.62, w * 0.09);
        const half = Math.min(deg, 180) / 2 / DEG;
        ctx.globalAlpha = 0.25; ctx.fillStyle = col;
        ctx.beginPath(); ctx.moveTo(fx, fy); ctx.arc(fx, fy, fr, -Math.PI / 2 - half, -Math.PI / 2 + half); ctx.closePath(); ctx.fill();
        ctx.globalAlpha = 1; ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.stroke();
        label(ctx, `${name}: ${deg > 180 ? '>180' : deg.toFixed(1)}°`, fx, fy + 14, col, 12, 'center', 700);
      });
    },
  });

  /* =====================================================================
     S12 · Propiedad del foco: recepción / transmisión con desenfoque
     ===================================================================== */
  register('s12', {
    init() {
      this.cv = $('cv-focus');
      this.dx = 0; this.dy = 0; this.mode = 'rx'; this.dirty = true;
      bindRange('rng-fx', (v) => { this.dx = v; this.dirty = true; });
      bindRange('rng-fy', (v) => { this.dy = v; this.dirty = true; });
      bindToggle([$('btn-rx'), $('btn-tx')], (b) => { this.mode = b.id === 'btn-tx' ? 'tx' : 'rx'; this.dirty = true; });
    },
    /** Reflexión de la dirección d en el punto (y²/4, y) del paraboloide (f = 1). */
    reflect(dx, dy, y) {
      let nx = 1, ny = -y / 2;
      const nl = Math.hypot(nx, ny); nx /= nl; ny /= nl;
      const dot = dx * nx + dy * ny;
      return [dx - 2 * dot * nx, dy - 2 * dot * ny];
    },
    compute() {
      const P = [1 + this.dx, this.dy];
      if (this.mode === 'rx') {
        // % de rayos reflejados que pasan cerca del alimentador
        let hit = 0; const N = 121, rf = 0.06;
        for (let i = 0; i < N; i++) {
          const y = -1.45 + (2.9 * i) / (N - 1);
          const Q = [y * y / 4, y];
          const d = [1 - Q[0], -Q[1]]; const dl = Math.hypot(d[0], d[1]);
          const ux = d[0] / dl, uy = d[1] / dl;
          const vx = P[0] - Q[0], vy = P[1] - Q[1];
          const along = vx * ux + vy * uy;
          const dist = along < 0 ? Math.hypot(vx, vy) : Math.abs(vx * uy - vy * ux);
          if (dist < rf) hit++;
        }
        const pct = (100 * hit) / N;
        $('ro-pf-l').textContent = 'Energía captada';
        $('ro-pf').textContent = pct.toFixed(0);
        $('ro-pf-u').textContent = '%';
        $('ro-pf-s').textContent = pct > 97 ? 'Enfocado ✓' : pct > 50 ? 'Desenfoque leve' : 'Desenfocado ✗';
        $('ro-pf-s').style.color = pct > 97 ? C.green : pct > 50 ? '#ffd166' : C.red;
      } else {
        // Dispersión angular de los rayos que salen del reflector
        let mn = Infinity, mx = -Infinity;
        for (let i = 0; i < 61; i++) {
          const y = -1.45 + (2.9 * i) / 60;
          const Q = [y * y / 4, y];
          let d = [Q[0] - P[0], Q[1] - P[1]]; const l = Math.hypot(d[0], d[1]); d = [d[0] / l, d[1] / l];
          const r = this.reflect(d[0], d[1], y);
          const ang = Math.atan2(r[1], r[0]) * DEG;
          mn = Math.min(mn, ang); mx = Math.max(mx, ang);
        }
        const spread = (mx - mn) / 2, squint = (mx + mn) / 2;
        $('ro-pf-l').textContent = 'Dispersión de rayos';
        $('ro-pf').textContent = `±${spread.toFixed(1)}`;
        $('ro-pf-u').textContent = `° (desvío ${squint.toFixed(1)}°)`;
        $('ro-pf-s').textContent = spread < 0.5 && Math.abs(squint) < 0.5 ? 'Haz colimado ✓' : 'Haz deformado ✗';
        $('ro-pf-s').style.color = spread < 0.5 && Math.abs(squint) < 0.5 ? C.green : C.red;
      }
      $('out-fx').textContent = `${this.dx >= 0 ? '+' : ''}${this.dx.toFixed(2)} f`;
      $('out-fy').textContent = `${this.dy >= 0 ? '+' : ''}${this.dy.toFixed(2)} f`;
    },
    frame(t) {
      if (this.dirty) { this.dirty = false; this.compute(); }
      const { ctx, w, h } = fit(this.cv);
      const sc = Math.min(w / 3.7, h / 3.5);
      const ox = (w - 3.5 * sc) / 2 + 0.3 * sc, cy = h / 2;
      const X = (x) => ox + x * sc, Y = (y) => cy - y * sc;
      const P = [1 + this.dx, this.dy];
      const xEnd = 3.15;

      // Eje óptico
      ctx.setLineDash([6, 6]); ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(X(-0.2), Y(0)); ctx.lineTo(X(xEnd), Y(0)); ctx.stroke(); ctx.setLineDash([]);

      // Rayos (animados con el desplazamiento del trazo)
      ctx.lineWidth = 1.6;
      ctx.setLineDash([10, 8]);
      ctx.lineDashOffset = -t * 40;
      const nR = 13;
      for (let i = 0; i < nR; i++) {
        const y = -1.4 + (2.8 * i) / (nR - 1);
        const Q = [y * y / 4, y];
        if (this.mode === 'rx') {
          ctx.strokeStyle = 'rgba(0,229,255,0.85)';
          ctx.beginPath(); ctx.moveTo(X(xEnd), Y(y)); ctx.lineTo(X(Q[0]), Y(Q[1])); ctx.stroke();
          const ex = 1 + (1 - Q[0]) * 0.25, ey = -Q[1] * 0.25;  // un poco más allá del foco
          ctx.strokeStyle = 'rgba(179,107,255,0.85)';
          ctx.beginPath(); ctx.moveTo(X(Q[0]), Y(Q[1])); ctx.lineTo(X(ex), Y(ey)); ctx.stroke();
        } else {
          let d = [Q[0] - P[0], Q[1] - P[1]]; const l = Math.hypot(d[0], d[1]); d = [d[0] / l, d[1] / l];
          const r = this.reflect(d[0], d[1], y);
          const k = r[0] > 0.05 ? (xEnd - Q[0]) / r[0] : 3;
          ctx.strokeStyle = 'rgba(179,107,255,0.85)';
          ctx.beginPath(); ctx.moveTo(X(P[0]), Y(P[1])); ctx.lineTo(X(Q[0]), Y(Q[1])); ctx.stroke();
          ctx.strokeStyle = 'rgba(0,229,255,0.85)';
          ctx.beginPath(); ctx.moveTo(X(Q[0]), Y(Q[1])); ctx.lineTo(X(Q[0] + r[0] * k), Y(Q[1] + r[1] * k)); ctx.stroke();
        }
      }
      ctx.setLineDash([]);

      // Reflector parabólico
      ctx.save(); ctx.shadowColor = C.violet; ctx.shadowBlur = 18;
      ctx.strokeStyle = C.violet; ctx.lineWidth = 5; ctx.lineCap = 'round';
      ctx.beginPath();
      for (let i = 0; i <= 80; i++) { const y = -1.5 + (3 * i) / 80; i ? ctx.lineTo(X(y * y / 4), Y(y)) : ctx.moveTo(X(y * y / 4), Y(y)); }
      ctx.stroke(); ctx.restore();

      // Foco
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(X(1), Y(0), 7, 0, TAU); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(X(1) - 10, Y(0)); ctx.lineTo(X(1) + 10, Y(0)); ctx.moveTo(X(1), Y(0) - 10); ctx.lineTo(X(1), Y(0) + 10); ctx.stroke();
      label(ctx, 'F', X(1) + 8, Y(0) - 16, '#fff', 14, 'left', 700);

      // Alimentador (bocina pequeña apuntando al reflector)
      const fx = X(P[0]), fy = Y(P[1]), s = sc * 0.09;
      ctx.save(); ctx.shadowColor = C.orange; ctx.shadowBlur = 14;
      ctx.fillStyle = C.orange;
      ctx.beginPath(); ctx.moveTo(fx, fy - s * 0.9); ctx.lineTo(fx + s * 1.3, fy - s * 0.35); ctx.lineTo(fx + s * 1.3, fy + s * 0.35); ctx.lineTo(fx, fy + s * 0.9); ctx.closePath(); ctx.fill();
      ctx.fillRect(fx + s * 1.3, fy - s * 0.35, s * 1.2, s * 0.7);
      ctx.restore();
      label(ctx, 'Alimentador', fx + s * 2.8, fy + s * 1.4, C.orange, 12, 'left', 700);
      label(ctx, this.mode === 'rx' ? 'Rayos incidentes paralelos (p. ej. desde un satélite)' : 'Rayos emitidos por el alimentador',
        w / 2, h * 0.05, C.muted, 13, 'center');
    },
  });

  /* =====================================================================
     S13 · Diagramas animados: frontal, offset, Cassegrain y Gregoriana
     ===================================================================== */
  function buildType(type) {
    const F = [1, 0], F2 = [0.05, 0];
    const paths = [], curves = [], feeds = [], extras = [];
    const dish = (y0, y1, dashed = false) => {
      const pts = [];
      for (let i = 0; i <= 60; i++) { const y = y0 + ((y1 - y0) * i) / 60; pts.push([y * y / 4, y]); }
      curves.push({ pts, color: C.violet, width: dashed ? 1.2 : 4, dashed, glow: !dashed });
    };
    const norm = (v) => { const l = Math.hypot(v[0], v[1]); return [v[0] / l, v[1] / l]; };
    let bounds;
    if (type === 'front' || type === 'offset') {
      const off = type === 'offset';
      if (off) { dish(-1.5, 2.0, true); dish(0.3, 2.0); } else dish(-1.45, 1.45);
      const ys = off ? [0.45, 0.75, 1.05, 1.35, 1.65, 1.9] : [-1.25, -0.8, -0.35, 0.35, 0.8, 1.25];
      ys.forEach((y) => paths.push([F, [y * y / 4, y], [2.7, y]]));
      const mid = off ? [1.15 * 1.15 / 4, 1.15] : [0, 0];
      feeds.push({ p: F, dir: Math.atan2(mid[1] - F[1], mid[0] - F[0]) });
      if (!off) extras.push([[1.45 * 1.45 / 4, 1.45], F], [[1.45 * 1.45 / 4, -1.45], F]);
      else extras.push([[F[0], F[1] - 0.05], [0.9, -0.7]]);
      bounds = off ? [-0.3, 2.8, -0.9, 2.2] : [-0.3, 2.8, -1.6, 1.6];
    } else {
      dish(-1.45, -0.12); dish(0.12, 1.45);
      const w = [F[0] - F2[0], F[1] - F2[1]], w2 = w[0] * w[0] + w[1] * w[1];
      const sub = (y) => {
        const Q = [y * y / 4, y];
        if (type === 'cass') {
          const a = 0.3, u = norm([Q[0] - F[0], Q[1] - F[1]]);
          const tt = (4 * a * a - w2) / (2 * (u[0] * w[0] + u[1] * w[1]) - 4 * a);
          return [F[0] + tt * u[0], F[1] + tt * u[1]];
        }
        const a = 0.7, v = norm([F[0] - Q[0], F[1] - Q[1]]);
        const tt = (4 * a * a - w2) / (2 * (v[0] * w[0] + v[1] * w[1]) + 4 * a);
        return [F[0] + tt * v[0], F[1] + tt * v[1]];
      };
      const sp = [];
      for (let i = 0; i <= 40; i++) sp.push(sub(-1.45 + (2.9 * i) / 40));
      curves.push({ pts: sp, color: '#ffd166', width: 3.5, glow: true });
      [-1.25, -0.85, -0.45, 0.45, 0.85, 1.25].forEach((y) => paths.push([F2, sub(y), [y * y / 4, y], [2.4, y]]));
      feeds.push({ p: F2, dir: 0 });
      extras.push([[F[0] - 0.04, F[1]], [F[0] + 0.04, F[1]]]); // marca del foco
      bounds = [-0.3, 2.5, -1.6, 1.6];
    }
    // Longitudes acumuladas de cada trayectoria
    const P = paths.map((pts) => {
      const segs = [0];
      for (let i = 1; i < pts.length; i++) segs.push(segs[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
      return { pts, segs, len: segs[segs.length - 1] };
    });
    return { paths: P, curves, feeds, extras, bounds, focus: F };
  }

  /** Punto a distancia s a lo largo de una trayectoria. */
  function pointAt(path, s) {
    s = clamp(s, 0, path.len);
    for (let i = 1; i < path.pts.length; i++) {
      if (s <= path.segs[i]) {
        const k = (s - path.segs[i - 1]) / (path.segs[i] - path.segs[i - 1] || 1);
        const a = path.pts[i - 1], b = path.pts[i];
        return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
      }
    }
    return path.pts[path.pts.length - 1];
  }

  register('s13', {
    init() {
      this.items = [...document.querySelectorAll('#s13 .type-cv')].map((cv) => ({ cv, model: buildType(cv.dataset.type) }));
    },
    frame(t) {
      this.items.forEach(({ cv, model }, idx) => {
        const { ctx, w, h } = fit(cv);
        const [x0, x1, y0, y1] = model.bounds;
        const sc = Math.min(w / (x1 - x0), h / (y1 - y0)) * 0.95;
        const ox = (w - (x1 - x0) * sc) / 2 - x0 * sc;
        const oy = (h + (y1 + y0) * sc) / 2;
        const X = (x) => ox + x * sc, Y = (y) => oy - y * sc;
        const poly = (pts) => { ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(X(p[0]), Y(p[1])) : ctx.moveTo(X(p[0]), Y(p[1])))); };

        // Trayectorias tenues
        ctx.strokeStyle = 'rgba(0,229,255,0.16)'; ctx.lineWidth = 1;
        model.paths.forEach((p) => { poly(p.pts); ctx.stroke(); });
        // Soportes / marcas
        ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 1.2;
        model.extras.forEach((e) => { poly(e); ctx.stroke(); });
        // Reflectores
        model.curves.forEach((c) => {
          ctx.save();
          if (c.glow) { ctx.shadowColor = c.color; ctx.shadowBlur = 12; }
          ctx.setLineDash(c.dashed ? [4, 6] : []);
          ctx.strokeStyle = c.dashed ? 'rgba(179,107,255,0.4)' : c.color; ctx.lineWidth = c.width; ctx.lineCap = 'round';
          poly(c.pts); ctx.stroke(); ctx.restore();
        });
        // Pulsos de energía viajando
        const speed = 0.9;
        model.paths.forEach((p, i) => {
          const period = p.len + 0.8;
          const s = ((t * speed + i * 0.11 + idx * 0.3) % period);
          const head = pointAt(p, s), tail = pointAt(p, s - 0.35);
          if (s > p.len + 0.35) return;
          const g = ctx.createLinearGradient(X(tail[0]), Y(tail[1]), X(head[0]), Y(head[1]));
          g.addColorStop(0, 'rgba(0,229,255,0)'); g.addColorStop(1, 'rgba(0,229,255,1)');
          ctx.strokeStyle = g; ctx.lineWidth = 2.5;
          ctx.beginPath();
          // seguir los vértices intermedios entre cola y cabeza
          const steps = 8;
          for (let k = 0; k <= steps; k++) {
            const q = pointAt(p, s - 0.35 + (0.35 * k) / steps);
            k ? ctx.lineTo(X(q[0]), Y(q[1])) : ctx.moveTo(X(q[0]), Y(q[1]));
          }
          ctx.stroke();
        });
        // Alimentadores
        model.feeds.forEach(({ p, dir }) => {
          const s = sc * 0.1;
          ctx.save(); ctx.translate(X(p[0]), Y(p[1])); ctx.rotate(-dir);
          ctx.shadowColor = C.orange; ctx.shadowBlur = 10; ctx.fillStyle = C.orange;
          ctx.beginPath(); ctx.moveTo(s * 0.8, -s * 0.7); ctx.lineTo(-s * 0.4, -s * 0.25); ctx.lineTo(-s * 0.4, s * 0.25); ctx.lineTo(s * 0.8, s * 0.7); ctx.closePath(); ctx.fill();
          ctx.fillRect(-s * 1.2, -s * 0.25, s * 0.8, s * 0.5);
          ctx.restore();
        });
        // Foco
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(X(model.focus[0]), Y(model.focus[1]), 2.5, 0, TAU); ctx.fill();
      });
    },
  });

  /* =====================================================================
     S14 · SIMULADOR: ganancia y lóbulo principal de la parabólica
     ===================================================================== */
  /** Patrón de apertura circular con iluminación (1 − r²): F = 8·J2(u)/u². */
  function dishPattern(Dl, thRad) {
    const u = Math.PI * Dl * Math.sin(thRad);
    if (Math.abs(u) < 0.05) return 1 - (u * u) / 12;
    const j2 = (2 * besselJ1(u)) / u - besselJ0(u);
    return (8 * j2) / (u * u);
  }

  register('s14', {
    init() {
      this.cv = $('cv-paraSim');
      this.D = 1.2; this.f = 12; this.eta = 0.65; this.dirty = true;
      this.DlShown = 48;
      bindRange('rng-pD', (v) => { this.D = v; this.dirty = true; });
      bindRange('rng-pf', (v) => { this.f = v; this.dirty = true; });
      bindRange('rng-pe', (v) => { this.eta = v; this.dirty = true; });
    },
    frame(t) {
      if (this.dirty) {
        this.dirty = false;
        const lam = 0.3 / this.f;          // m
        this.Dl = this.D / lam;
        this.G = this.eta * Math.pow(Math.PI * this.Dl, 2);
        this.gdb = 10 * Math.log10(this.G);
        this.hp = (70 * lam) / this.D;
        $('out-pD').textContent = `${this.D.toFixed(2)} m`;
        $('out-pf').textContent = `${this.f.toFixed(1)} GHz`;
        $('out-pe').textContent = this.eta.toFixed(2);
        $('ro-pG').textContent = this.gdb.toFixed(1);
        $('ro-pH').textContent = this.hp >= 10 ? this.hp.toFixed(1) : this.hp >= 1 ? this.hp.toFixed(2) : this.hp.toFixed(3);
        $('ro-pl').textContent = (lam * 100).toFixed(2);
        $('ro-pDl').textContent = this.Dl >= 100 ? this.Dl.toFixed(0) : this.Dl.toFixed(1);
      }
      // Interpolación logarítmica del tamaño eléctrico mostrado
      const target = Math.log(this.Dl), cur = Math.log(this.DlShown);
      this.DlShown = Math.abs(target - cur) < 1e-3 ? this.Dl : Math.exp(lerp(cur, target, 0.18));
      const Dl = this.DlShown;
      const hpShown = 70 / Dl;

      const { ctx, w, h } = fit(this.cv);
      const cx = w * 0.07, cy = h * 0.46;
      const R = Math.min(w * 0.5, h * 0.4);
      const dbMin = -40;

      // Rejilla semicircular (dB)
      ctx.lineWidth = 1;
      [0, -10, -20, -30].forEach((db) => {
        const r = R * (1 - db / dbMin);
        ctx.strokeStyle = C.grid; ctx.beginPath(); ctx.arc(cx, cy, r, -Math.PI / 2, Math.PI / 2); ctx.stroke();
        label(ctx, `${db} dB`, cx + r - 4, cy + 12, 'rgba(142,163,201,0.75)', 10, 'right');
      });
      for (let d = -90; d <= 90; d += 15) {
        const a = d / DEG;
        ctx.strokeStyle = C.grid;
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + R * Math.cos(a), cy - R * Math.sin(a)); ctx.stroke();
        if (d % 30 === 0) label(ctx, `${d}°`, cx + (R + 16) * Math.cos(a), cy - (R + 16) * Math.sin(a), C.muted, 10, 'center');
      }

      // Muestreo no uniforme: denso alrededor del lóbulo principal
      const angs = [];
      for (let i = 0; i <= 900; i++) angs.push(-90 + (180 * i) / 900);
      const span = Math.min(90, hpShown * 4);
      for (let i = 0; i <= 500; i++) angs.push(-span + (2 * span * i) / 500);
      angs.sort((a, b) => a - b);

      ctx.beginPath();
      ctx.moveTo(cx, cy);
      angs.forEach((d) => {
        const F = Math.abs(dishPattern(Dl, d / DEG));
        const db = Math.max(dbMin, 20 * Math.log10(F + 1e-12));
        const r = R * (1 - db / dbMin);
        ctx.lineTo(cx + r * Math.cos(d / DEG), cy - r * Math.sin(d / DEG));
      });
      ctx.closePath();
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
      g.addColorStop(0, 'rgba(179,107,255,0.1)'); g.addColorStop(1, 'rgba(179,107,255,0.45)');
      ctx.fillStyle = g; ctx.fill();
      ctx.save(); ctx.shadowColor = C.violet; ctx.shadowBlur = 16;
      ctx.strokeStyle = C.violet; ctx.lineWidth = 2; ctx.stroke(); ctx.restore();

      // Líneas del HPBW
      const hh = Math.min(hpShown, 180) / 2 / DEG;
      ctx.setLineDash([6, 5]); ctx.strokeStyle = C.orange; ctx.lineWidth = 1.5;
      [hh, -hh].forEach((a) => { ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + R * 1.02 * Math.cos(a), cy - R * 1.02 * Math.sin(a)); ctx.stroke(); });
      ctx.setLineDash([]);
      label(ctx, `HPBW ≈ ${hpShown < 1 ? hpShown.toFixed(3) : hpShown.toFixed(2)}°`, cx + R * 0.55, cy - Math.max(R * Math.sin(hh) * 0.55, 0) - 18, C.orange, 14, 'center', 700);

      // Reflector (icono)
      ctx.save(); ctx.shadowColor = C.violet; ctx.shadowBlur = 12;
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 3;
      ctx.beginPath();
      const ds = R * 0.09;
      for (let i = 0; i <= 20; i++) { const y = -1 + i / 10; const x = (y * y) / 2; i ? ctx.lineTo(cx - ds + x * ds, cy - y * ds) : ctx.moveTo(cx - ds + x * ds, cy - y * ds); }
      ctx.stroke(); ctx.restore();

      // Zoom del lóbulo principal (dB vs. ángulo, ±2.5·HPBW)
      const zx0 = cx + R + 70, zx1 = w - 24, zy0 = h * 0.12, zy1 = h * 0.74;
      if (zx1 - zx0 > 160) {
        const span2 = Math.min(90, hpShown * 2.5);
        const ZX = (d) => zx0 + ((d + span2) / (2 * span2)) * (zx1 - zx0);
        const ZY = (db) => zy0 + (db / dbMin) * (zy1 - zy0);
        label(ctx, 'Zoom del lóbulo principal', (zx0 + zx1) / 2, zy0 - 22, '#fff', 13, 'center', 700);
        ctx.strokeStyle = C.grid; ctx.lineWidth = 1;
        [0, -10, -20, -30, -40].forEach((db) => {
          ctx.beginPath(); ctx.moveTo(zx0, ZY(db)); ctx.lineTo(zx1, ZY(db)); ctx.stroke();
          label(ctx, `${db}`, zx0 - 6, ZY(db), C.muted, 10, 'right');
        });
        // Marcas del eje de ángulos
        for (let k = -2; k <= 2; k++) {
          const d = (k / 2) * span2;
          ctx.strokeStyle = C.grid; ctx.beginPath(); ctx.moveTo(ZX(d), zy0); ctx.lineTo(ZX(d), zy1); ctx.stroke();
          const txt = span2 < 1 ? d.toFixed(3) : span2 < 10 ? d.toFixed(2) : d.toFixed(1);
          label(ctx, `${txt}°`, ZX(d), zy1 + 14, C.muted, 10, 'center');
        }
        // Curva del patrón
        ctx.save(); ctx.shadowColor = C.violet; ctx.shadowBlur = 12;
        ctx.strokeStyle = C.violet; ctx.lineWidth = 2.5;
        ctx.beginPath();
        for (let i = 0; i <= 300; i++) {
          const d = -span2 + (2 * span2 * i) / 300;
          const F = Math.abs(dishPattern(Dl, d / DEG));
          const db = Math.max(dbMin, 20 * Math.log10(F + 1e-12));
          i ? ctx.lineTo(ZX(d), ZY(db)) : ctx.moveTo(ZX(d), ZY(db));
        }
        ctx.stroke(); ctx.restore();
        // Nivel de −3 dB y puntos de media potencia
        ctx.setLineDash([6, 5]); ctx.strokeStyle = C.orange; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(zx0, ZY(-3)); ctx.lineTo(zx1, ZY(-3)); ctx.stroke();
        [-hpShown / 2, hpShown / 2].forEach((d) => { ctx.beginPath(); ctx.moveTo(ZX(d), zy0); ctx.lineTo(ZX(d), zy1); ctx.stroke(); });
        ctx.setLineDash([]);
        label(ctx, '−3 dB', zx1, ZY(-3) - 10, C.orange, 11, 'right', 700);
        label(ctx, 'dB', zx0 - 6, zy0 - 22, C.muted, 10, 'right');
      }

      // Barra de ganancia
      const by = h * 0.93, bx0 = w * 0.08, bw = w * 0.84;
      ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fillRect(bx0, by - 6, bw, 12);
      const gfrac = clamp(this.gdb / 80, 0, 1);
      const gg = ctx.createLinearGradient(bx0, 0, bx0 + bw, 0);
      gg.addColorStop(0, C.cyan); gg.addColorStop(0.5, C.violet); gg.addColorStop(1, C.orange);
      ctx.save(); ctx.shadowColor = C.violet; ctx.shadowBlur = 12;
      ctx.fillStyle = gg; ctx.fillRect(bx0, by - 6, bw * gfrac, 12); ctx.restore();
      [0, 20, 40, 60, 80].forEach((v) => label(ctx, `${v}`, bx0 + (bw * v) / 80, by - 16, C.muted, 10, 'center'));
      label(ctx, `G = ${this.gdb.toFixed(1)} dBi`, bx0 + bw, by - 30, '#fff', 13, 'right', 700);
    },
  });

  /* =====================================================================
     S18 · Animación final: ondas de las tres antenas que interfieren
     ===================================================================== */
  register('s18', {
    init() { this.cv = $('cv-final'); },
    frame(t) {
      const { ctx, w, h } = fit(this.cv);
      const srcs = [[w * 0.12, h * 0.85, '0,229,255'], [w * 0.5, h * 1.02, '255,138,31'], [w * 0.88, h * 0.85, '179,107,255']];
      ctx.globalCompositeOperation = 'lighter';
      const maxR = Math.hypot(w, h) * 0.75;
      srcs.forEach(([x, y, col], k) => {
        for (let i = 0; i < 9; i++) {
          const r = ((t * 60 + i * (maxR / 9) + k * 30) % maxR);
          const a = 0.22 * (1 - r / maxR);
          ctx.strokeStyle = `rgba(${col},${a})`; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
        }
      });
      ctx.globalCompositeOperation = 'source-over';
    },
  });

  /* ---------------------------------------------------------------------
     Motor
     --------------------------------------------------------------------- */
  function loop(now) {
    rafId = requestAnimationFrame(loop);
    const t = now / 1000;
    for (const s of active) {
      try { s.frame(t); } catch (err) { console.error('Error en simulador', err); }
    }
  }

  function activate(slide) {
    active = registry[slide.id] || [];
    active.forEach((s) => {
      if (!s._ready) { s.init && s.init(); s._ready = true; }
      s.enter && s.enter();
    });
    if (active.length && !rafId) rafId = requestAnimationFrame(loop);
    if (!active.length) deactivate();
  }

  function deactivate() {
    active = [];
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
  }

  /** Inicializa todos los simuladores (enlaza los controles desde el inicio). */
  function initAll() {
    Object.values(registry).flat().forEach((s) => {
      if (!s._ready) { try { s.init && s.init(); s._ready = true; } catch (e) { console.error(e); } }
    });
  }

  return { activate, deactivate, initAll, paintRange };
})();
