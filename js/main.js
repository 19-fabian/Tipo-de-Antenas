/* =========================================================================
   main.js — Navegación, transiciones, fondo animado, cursor y extras
   -------------------------------------------------------------------------
   Depende de: GSAP (opcional, con respaldo), KaTeX auto-render,
               Sims (simuladores.js) y ThreeScenes (three-scenes.js)
   ========================================================================= */
(() => {
  'use strict';

  const hasGsap = typeof window.gsap !== 'undefined';
  const slides = [...document.querySelectorAll('.slide')];
  const N = slides.length;
  const $ = (id) => document.getElementById(id);
  let current = 0;
  let animating = false;

  /* =====================================================================
     1. Fórmulas con KaTeX
     ===================================================================== */
  function renderMath() {
    if (typeof window.renderMathInElement !== 'function') return;
    renderMathInElement(document.body, {
      delimiters: [
        { left: '$$', right: '$$', display: true },
        { left: '\\(', right: '\\)', display: false },
      ],
      throwOnError: false,
      strict: false, // permite tildes (máx) dentro de las fórmulas sin avisos
    });
  }

  /* =====================================================================
     2. Índice, contador, progreso y notas
     ===================================================================== */
  const indexList = $('index-list');
  slides.forEach((s, i) => {
    const li = document.createElement('li');
    li.textContent = s.dataset.title || `Diapositiva ${i + 1}`;
    li.addEventListener('click', () => { go(i); toggleIndex(false); });
    indexList.appendChild(li);
  });

  function toggleIndex(force) {
    $('index-menu').classList.toggle('open', force);
  }
  function toggleNotes(force) {
    $('notes-panel').classList.toggle('open', force);
  }
  function toggleFullscreen() {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
    else document.exitFullscreen?.();
  }

  function updateChrome() {
    $('counter').textContent = `${current + 1} / ${N}`;
    $('progress-bar').style.width = `${((current + 1) / N) * 100}%`;
    [...indexList.children].forEach((li, i) => li.classList.toggle('current', i === current));
    const notes = slides[current].querySelector('.notes');
    $('notes-speaker').textContent = notes ? notes.dataset.speaker : '—';
    $('notes-body').innerHTML = notes ? notes.innerHTML : '<p>Sin notas.</p>';
    // Color del cursor según la sección
    const accent = getComputedStyle(slides[current]).getPropertyValue('--accent').trim() || '#00e5ff';
    document.documentElement.style.setProperty('--cursor', accent);
    $('cursor-dot').style.background = accent;
    $('cursor-dot').style.boxShadow = `0 0 10px ${accent}, 0 0 20px ${accent}`;
    history.replaceState(null, '', `#${current + 1}`);
  }

  /* =====================================================================
     3. Transiciones entre diapositivas (GSAP)
     ===================================================================== */
  function transition(from, to, dir, type) {
    const tl = gsap.timeline({
      defaults: { duration: 0.8, ease: 'power3.inOut' },
      onComplete() {
        from.classList.remove('active');
        gsap.set(from, { clearProps: 'all' });
        gsap.set(to, { clearProps: 'transform,filter,zIndex' });
        animating = false;
      },
    });
    gsap.set(to, { zIndex: 2 });
    gsap.set(from, { zIndex: 1 });

    switch (type) {
      case 'zoom':
        tl.to(from, { scale: 1.3, opacity: 0, duration: 0.6 }, 0)
          .fromTo(to, { scale: 0.7, opacity: 0 }, { scale: 1, opacity: 1, ease: 'power3.out' }, 0.1);
        break;
      case 'rotate':
        tl.to(from, { rotationY: -75 * dir, z: -500, opacity: 0, transformPerspective: 1800 }, 0)
          .fromTo(to, { rotationY: 75 * dir, z: -500, opacity: 0, transformPerspective: 1800 },
            { rotationY: 0, z: 0, opacity: 1 }, 0.05);
        break;
      case 'dissolve':
        tl.to(from, { opacity: 0, filter: 'blur(14px)', duration: 0.6 }, 0)
          .fromTo(to, { opacity: 0, filter: 'blur(14px)', scale: 1.04 },
            { opacity: 1, filter: 'blur(0px)', scale: 1, duration: 0.8 }, 0.15);
        break;
      default: // 'slide'
        tl.to(from, { xPercent: -100 * dir, opacity: 0.2 }, 0)
          .fromTo(to, { xPercent: 100 * dir, opacity: 0.2 }, { xPercent: 0, opacity: 1 }, 0);
    }
  }

  /** Navega a la diapositiva n. */
  function go(n) {
    if (n < 0 || n >= N || n === current || animating) return;
    const from = slides[current], to = slides[n];
    const dir = n > current ? 1 : -1;
    to.classList.add('active');
    to.scrollTop = 0;
    current = n;
    if (hasGsap) {
      animating = true;
      transition(from, to, dir, to.dataset.transition || 'slide');
    } else {
      from.classList.remove('active');
    }
    enterSlide(n);
  }
  const next = () => go(current + 1);
  const prev = () => go(current - 1);

  /** Acciones al entrar a una diapositiva: animaciones, simuladores, escenas 3D. */
  function enterSlide(i) {
    const s = slides[i];
    updateChrome();
    window.Sims && Sims.activate(s);
    window.ThreeScenes && ThreeScenes.activate(s);
    if (!hasGsap) return;

    // Entrada escalonada de textos
    gsap.fromTo(s.querySelectorAll('.reveal'),
      { opacity: 0, y: 40 },
      { opacity: 1, y: 0, duration: 0.7, stagger: 0.08, ease: 'power3.out', delay: 0.3 });

    // Animaciones especiales por diapositiva
    if (s.id === 's1') animateTeam(s);
    if (s.id === 's7') countUp(s);
  }

  /* --- Portada: cada integrante entra con una animación distinta --- */
  function animateTeam(s) {
    const [m1, m2, m3] = s.querySelectorAll('.member');
    gsap.fromTo(m1, { opacity: 0, x: -220, rotationY: 90, transformPerspective: 600 },
      { opacity: 1, x: 0, rotationY: 0, duration: 1.1, ease: 'power4.out', delay: 0.9 });
    gsap.fromTo(m2, { opacity: 0, scale: 0, rotation: -25 },
      { opacity: 1, scale: 1, rotation: 0, duration: 1, ease: 'back.out(2.2)', delay: 1.25 });
    // Tercer nombre: letra por letra
    if (!m3.dataset.split) {
      const dot = m3.querySelector('.mdot');
      const text = m3.textContent.trim();
      m3.textContent = '';
      m3.appendChild(dot);
      const wrap = document.createElement('span');
      [...text].forEach((ch) => {
        const sp = document.createElement('span');
        sp.className = 'ch'; sp.textContent = ch;
        wrap.appendChild(sp);
      });
      m3.appendChild(wrap);
      m3.dataset.split = '1';
    }
    gsap.fromTo(m3, { opacity: 0 }, { opacity: 1, duration: 0.3, delay: 1.6 });
    gsap.fromTo(m3.querySelectorAll('.ch'), { y: -50, opacity: 0 },
      { y: 0, opacity: 1, stagger: 0.035, duration: 0.8, ease: 'bounce.out', delay: 1.6 });
  }

  /* --- Contadores numéricos animados --- */
  function countUp(s) {
    s.querySelectorAll('.stat-num').forEach((el) => {
      const target = parseFloat(el.dataset.count), dec = parseInt(el.dataset.dec || '0', 10);
      const o = { v: 0 };
      gsap.to(o, { v: target, duration: 1.8, ease: 'power2.out', delay: 0.5,
        onUpdate: () => { el.textContent = o.v.toFixed(dec); } });
    });
  }

  /* =====================================================================
     4. Entradas: teclado, clic, rueda y swipe
     ===================================================================== */
  const INTERACTIVE = 'button, input, label, a, select, textarea, canvas[data-interactive], .flip-card, .sim-controls, .selector, .chips, #index-menu, #notes-panel, #topbar, #nav-arrows';

  document.addEventListener('keydown', (e) => {
    const tag = e.target.tagName;
    const inRange = tag === 'INPUT' && e.target.type === 'range';
    switch (e.key) {
      case 'ArrowRight': case 'ArrowDown': case 'PageDown':
        if (inRange) return; e.preventDefault(); next(); break;
      case 'ArrowLeft': case 'ArrowUp': case 'PageUp':
        if (inRange) return; e.preventDefault(); prev(); break;
      case ' ':
        if (tag === 'BUTTON') return; e.preventDefault(); e.shiftKey ? prev() : next(); break;
      case 'Home': go(0); break;
      case 'End': go(N - 1); break;
      case 'f': case 'F': toggleFullscreen(); break;
      case 'n': case 'N': toggleNotes(); break;
      case 'i': case 'I': toggleIndex(); break;
      case 'Escape': toggleIndex(false); toggleNotes(false); break;
      default: break;
    }
  });

  // Clic en zonas vacías → siguiente diapositiva
  $('deck').addEventListener('click', (e) => {
    if (e.target.closest(INTERACTIVE)) return;
    if (window.getSelection && String(window.getSelection()).length) return;
    toggleIndex(false);
    next();
  });

  // Rueda del mouse (con umbral para trackpads)
  let wheelAcc = 0, wheelLock = 0;
  window.addEventListener('wheel', (e) => {
    if (e.target.closest('#index-menu, #notes-panel')) return;
    const s = slides[current];
    // Si la diapositiva tiene scroll (móvil), solo navegar en los bordes
    if (s.scrollHeight > s.clientHeight + 4) {
      const atTop = s.scrollTop <= 0, atBottom = s.scrollTop + s.clientHeight >= s.scrollHeight - 2;
      if ((e.deltaY > 0 && !atBottom) || (e.deltaY < 0 && !atTop)) return;
    }
    const now = performance.now();
    if (now < wheelLock) return;
    wheelAcc += e.deltaY;
    if (Math.abs(wheelAcc) > 60) {
      wheelAcc > 0 ? next() : prev();
      wheelAcc = 0; wheelLock = now + 900;
    }
  }, { passive: true });

  // Swipe en pantallas táctiles
  let tStart = null;
  window.addEventListener('touchstart', (e) => {
    const tch = e.touches[0];
    tStart = { x: tch.clientX, y: tch.clientY, ok: !e.target.closest('input, canvas[data-interactive]') };
  }, { passive: true });
  window.addEventListener('touchend', (e) => {
    if (!tStart || !tStart.ok) return;
    const tch = e.changedTouches[0];
    const dx = tch.clientX - tStart.x, dy = tch.clientY - tStart.y;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.4) (dx < 0 ? next : prev)();
    tStart = null;
  }, { passive: true });

  // Botones de la interfaz
  $('nav-next').addEventListener('click', next);
  $('nav-prev').addEventListener('click', prev);
  $('btn-index').addEventListener('click', (e) => { e.stopPropagation(); toggleIndex(); });
  $('btn-notes').addEventListener('click', () => toggleNotes());
  $('notes-close').addEventListener('click', () => toggleNotes(false));
  $('btn-fs').addEventListener('click', toggleFullscreen);
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#index-menu, #btn-index')) toggleIndex(false);
  });

  /* =====================================================================
     5. Fondo animado: partículas que siguen ondas electromagnéticas
     ===================================================================== */
  const bg = $('bg-canvas');
  const bgx = bg.getContext('2d');
  const COLS = ['0,229,255', '255,138,31', '179,107,255'];
  let particles = [], rings = [];

  // Sprite de brillo pre-renderizado (más rápido que shadowBlur)
  const sprites = COLS.map((c) => {
    const cv = document.createElement('canvas'); cv.width = cv.height = 32;
    const g = cv.getContext('2d');
    const rg = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    rg.addColorStop(0, `rgba(${c},1)`); rg.addColorStop(0.25, `rgba(${c},0.6)`); rg.addColorStop(1, `rgba(${c},0)`);
    g.fillStyle = rg; g.fillRect(0, 0, 32, 32);
    return cv;
  });

  function resizeBg() {
    bg.width = innerWidth; bg.height = innerHeight;
    const count = Math.round(Math.min(110, (innerWidth * innerHeight) / 16000));
    particles = Array.from({ length: count }, () => ({
      x: Math.random() * innerWidth,
      base: Math.random() * innerHeight,
      amp: 10 + Math.random() * 40,
      k: 0.004 + Math.random() * 0.01,
      ph: Math.random() * Math.PI * 2,
      v: 0.2 + Math.random() * 0.8,
      s: 6 + Math.random() * 12,
      c: Math.floor(Math.random() * 3),
    }));
  }
  resizeBg();
  addEventListener('resize', resizeBg);

  function drawBg(now) {
    const t = now / 1000;
    const w = bg.width, h = bg.height;
    bgx.clearRect(0, 0, w, h);

    // Ondas sinusoidales tenues
    for (let i = 0; i < 3; i++) {
      bgx.strokeStyle = `rgba(${COLS[i]},0.06)`;
      bgx.lineWidth = 1.5;
      bgx.beginPath();
      const yb = h * (0.25 + i * 0.25);
      for (let x = 0; x <= w; x += 12) {
        const y = yb + Math.sin(x * 0.006 + t * (0.6 + i * 0.2) + i) * (30 + i * 12);
        x ? bgx.lineTo(x, y) : bgx.moveTo(x, y);
      }
      bgx.stroke();
    }

    // Partículas
    bgx.globalCompositeOperation = 'lighter';
    particles.forEach((p) => {
      p.x += p.v;
      if (p.x > w + 20) p.x = -20;
      const y = p.base + Math.sin(p.x * p.k + p.ph + t) * p.amp;
      bgx.globalAlpha = 0.35 + 0.25 * Math.sin(t * 2 + p.ph);
      bgx.drawImage(sprites[p.c], p.x - p.s / 2, y - p.s / 2, p.s, p.s);
    });
    bgx.globalAlpha = 1;

    // Pulsos circulares ocasionales
    if (Math.random() < 0.012) rings.push({ x: Math.random() * w, y: Math.random() * h, r: 0, c: COLS[Math.floor(Math.random() * 3)] });
    rings = rings.filter((r) => r.r < 260);
    rings.forEach((r) => {
      r.r += 1.6;
      bgx.strokeStyle = `rgba(${r.c},${0.25 * (1 - r.r / 260)})`;
      bgx.lineWidth = 1.2;
      bgx.beginPath(); bgx.arc(r.x, r.y, r.r, 0, Math.PI * 2); bgx.stroke();
    });
    bgx.globalCompositeOperation = 'source-over';
    requestAnimationFrame(drawBg);
  }
  requestAnimationFrame(drawBg);

  /* =====================================================================
     6. Cursor personalizado
     ===================================================================== */
  const dot = $('cursor-dot'), ring = $('cursor-ring');
  let mx = innerWidth / 2, my = innerHeight / 2, rx = mx, ry = my;
  addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    mx = e.clientX; my = e.clientY;
    dot.style.transform = `translate(${mx}px, ${my}px) translate(-50%, -50%)`;
  });
  document.addEventListener('mouseover', (e) => {
    ring.classList.toggle('hover', !!e.target.closest('button, input, .flip-card, .tilt, canvas[data-interactive], #index-list li'));
  });
  (function followRing() {
    rx += (mx - rx) * 0.18; ry += (my - ry) * 0.18;
    ring.style.transform = `translate(${rx}px, ${ry}px) translate(-50%, -50%)`;
    requestAnimationFrame(followRing);
  })();

  /* =====================================================================
     7. Tarjetas: inclinación 3D (tilt) y volteo (flip)
     ===================================================================== */
  document.querySelectorAll('.tilt').forEach((el) => {
    el.addEventListener('pointermove', (e) => {
      if (!hasGsap || e.pointerType !== 'mouse') return;
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5, py = (e.clientY - r.top) / r.height - 0.5;
      gsap.to(el, { rotationY: px * 16, rotationX: -py * 16, transformPerspective: 800, duration: 0.4, ease: 'power2.out' });
    });
    el.addEventListener('pointerleave', () => {
      if (hasGsap) gsap.to(el, { rotationY: 0, rotationX: 0, duration: 0.6, ease: 'power3.out' });
    });
  });

  document.querySelectorAll('.flip-card').forEach((c) => c.addEventListener('click', () => c.classList.toggle('flipped')));

  /* =====================================================================
     8. Arranque
     ===================================================================== */
  renderMath();
  window.Sims && Sims.initAll();

  const fromHash = parseInt((location.hash || '').slice(1), 10);
  current = Number.isFinite(fromHash) && fromHash >= 1 && fromHash <= N ? fromHash - 1 : 0;
  slides[current].classList.add('active');
  enterSlide(current);
})();
