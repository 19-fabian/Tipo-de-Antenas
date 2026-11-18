/* =========================================================================
   three-scenes.js — Escenas 3D con Three.js (r128)
   -------------------------------------------------------------------------
   Cada <canvas data-scene="nombre"> tiene su propia escena. Las escenas se
   crean de forma perezosa la primera vez que su diapositiva se activa y
   SOLO se renderizan mientras esa diapositiva está activa.
   API pública: ThreeScenes.activate(slideEl), ThreeScenes.deactivate(),
                ThreeScenes.setDipoleL(L), ThreeScenes.setHorn(tipo)
   ========================================================================= */
window.ThreeScenes = (() => {
  'use strict';

  const hasThree = typeof THREE !== 'undefined';
  const factories = {};          // nombre → función constructora de escena
  const instances = new Map();   // canvas → instancia creada
  let active = [];               // instancias de la diapositiva actual
  let rafId = null;
  let lastT = 0;

  // Estado compartido controlado desde la interfaz
  const state = { dipoleL: 0.5, horn: 'E' };

  const COLORS = { cyan: 0x00e5ff, orange: 0xff8a1f, violet: 0xb36bff };

  /* ---------------------------------------------------------------------
     Utilidades
     --------------------------------------------------------------------- */

  /** Registra una fábrica de escenas. */
  function define(name, factory) { factories[name] = factory; }

  /** Rotación con arrastre del mouse/touch, con inercia y auto-giro. */
  function addDragRotate(canvas, target, { autoSpeed = 0.25, initX = 0.25 } = {}) {
    const st = { vx: 0, vy: 0, dragging: false, lx: 0, ly: 0, idle: 0 };
    target.rotation.x = initX;
    canvas.addEventListener('pointerdown', (e) => {
      st.dragging = true; st.lx = e.clientX; st.ly = e.clientY; st.idle = 0;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!st.dragging) return;
      const dx = e.clientX - st.lx, dy = e.clientY - st.ly;
      st.lx = e.clientX; st.ly = e.clientY;
      st.vy = dx * 0.008; st.vx = dy * 0.008;
      target.rotation.y += st.vy;
      target.rotation.x = THREE.MathUtils.clamp(target.rotation.x + st.vx, -1.3, 1.3);
    });
    const end = () => { st.dragging = false; };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.style.touchAction = 'none';

    // Se llama en cada fotograma
    return function step(dt) {
      if (st.dragging) return;
      st.vx *= 0.92; st.vy *= 0.92;
      target.rotation.y += st.vy;
      target.rotation.x = THREE.MathUtils.clamp(target.rotation.x + st.vx, -1.3, 1.3);
      st.idle += dt;
      if (st.idle > 1.5) target.rotation.y += autoSpeed * dt; // giro automático en reposo
    };
  }

  /** Luces estándar para modelos metálicos. */
  function addLights(scene, accent = 0xffffff) {
    scene.add(new THREE.AmbientLight(0x6070a0, 0.7));
    const d1 = new THREE.DirectionalLight(0xffffff, 1.0); d1.position.set(4, 6, 5); scene.add(d1);
    const d2 = new THREE.DirectionalLight(accent, 0.8); d2.position.set(-5, -2, -4); scene.add(d2);
    const p = new THREE.PointLight(accent, 1.2, 20); p.position.set(0, 0, 4); scene.add(p);
  }

  /** Perfil de radiación del dipolo: F(θ) normalizado (θ en [0, π]). */
  function dipolePattern(L, n = 180) {
    const kl2 = Math.PI * L; // kL/2 = πL/λ
    const vals = [];
    let max = 1e-12;
    for (let i = 0; i <= n; i++) {
      const th = Math.min(Math.max((i / n) * Math.PI, 1e-4), Math.PI - 1e-4);
      const v = Math.abs((Math.cos(kl2 * Math.cos(th)) - Math.cos(kl2)) / Math.sin(th));
      vals.push(v); if (v > max) max = v;
    }
    return vals.map((v) => v / max);
  }

  /** Geometría lateral (4 caras) de un tronco de pirámide rectangular abierto. */
  function frustumGeometry(w1, h1, w2, h2, z1, z2) {
    const a = [[-w1/2,-h1/2,z1],[ w1/2,-h1/2,z1],[ w1/2, h1/2,z1],[-w1/2, h1/2,z1]];
    const b = [[-w2/2,-h2/2,z2],[ w2/2,-h2/2,z2],[ w2/2, h2/2,z2],[-w2/2, h2/2,z2]];
    const pos = [];
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      pos.push(...a[i], ...a[j], ...b[j], ...a[i], ...b[j], ...b[i]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    return g;
  }

  /** Textura con la distribución cos(πx/a) del modo TE10 en la apertura. */
  function apertureTexture(circular = false) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const img = g.createImageData(128, 128);
    for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
      const u = (x / 127) * 2 - 1, v = (y / 127) * 2 - 1;
      let a = circular ? Math.max(0, Math.cos(Math.min(1, Math.hypot(u, v)) * Math.PI / 2))
                       : Math.cos(u * Math.PI / 2);
      if (circular && Math.hypot(u, v) > 1) a = 0;
      const i = (y * 128 + x) * 4;
      img.data[i] = 255; img.data[i + 1] = 140 + 80 * a; img.data[i + 2] = 40 * a;
      img.data[i + 3] = 220 * a * a;
    }
    g.putImageData(img, 0, 0);
    return new THREE.CanvasTexture(c);
  }

  /** Material metálico con brillo del color de acento. */
  function metal(color, emissive = 0.15) {
    return new THREE.MeshStandardMaterial({
      color, metalness: 0.75, roughness: 0.28,
      emissive: color, emissiveIntensity: emissive, side: THREE.DoubleSide,
    });
  }

  /** Lathe del patrón sin(θ) usado para "conchas" de radiación. */
  function donutGeometry(scale = 1, segs = 48) {
    const pts = [];
    for (let i = 0; i <= 40; i++) {
      const th = (i / 40) * Math.PI;
      const r = Math.sin(th) * scale;
      pts.push(new THREE.Vector2(r * Math.sin(th), r * Math.cos(th)));
    }
    return new THREE.LatheGeometry(pts, segs);
  }

  /* ---------------------------------------------------------------------
     ESCENA 1: Portada — dipolo emitiendo conchas de radiación
     --------------------------------------------------------------------- */
  define('portada', ({ scene, camera }) => {
    camera.position.set(0, 1.2, 10.5);
    addLights(scene, COLORS.cyan);

    const root = new THREE.Group(); scene.add(root);
    const antenna = new THREE.Group(); root.add(antenna);

    // Mástil
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 4, 16), metal(0x5a6a8c, 0.05));
    mast.position.y = -2.2; antenna.add(mast);
    // Brazos del dipolo
    const armMat = metal(COLORS.cyan, 0.6);
    [1, -1].forEach((s) => {
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1.25, 16), armMat);
      arm.position.y = s * 0.7; antenna.add(arm);
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.07, 16, 16), armMat);
      tip.position.y = s * 1.33; antenna.add(tip);
    });
    // Punto de alimentación brillante
    const feed = new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 16),
      new THREE.MeshBasicMaterial({ color: COLORS.orange }));
    antenna.add(feed);
    const glow = new THREE.PointLight(COLORS.orange, 2, 6); antenna.add(glow);

    // Conchas de radiación que se expanden (patrón tipo dona)
    const shellGeo = donutGeometry(1, 40);
    const palette = [COLORS.cyan, COLORS.violet, COLORS.cyan, COLORS.orange, COLORS.violet, COLORS.cyan];
    const shells = palette.map((c, i) => {
      const m = new THREE.Mesh(shellGeo, new THREE.MeshBasicMaterial({
        color: c, wireframe: true, transparent: true, opacity: 0.5, depthWrite: false,
      }));
      m.userData.phase = i / palette.length;
      root.add(m);
      return m;
    });

    // Anillos en el plano horizontal (frentes de onda)
    const ringGeo = new THREE.RingGeometry(0.98, 1, 96);
    const rings = [0, 1, 2, 3].map((i) => {
      const r = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
        color: COLORS.cyan, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false,
      }));
      r.rotation.x = -Math.PI / 2; r.position.y = -0.0; r.userData.phase = i / 4;
      root.add(r); return r;
    });

    // Campo de estrellas
    const starGeo = new THREE.BufferGeometry();
    const sp = [];
    for (let i = 0; i < 900; i++) sp.push((Math.random() - 0.5) * 40, (Math.random() - 0.5) * 24, -Math.random() * 25 - 2);
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0x9fc6ff, size: 0.04, transparent: true, opacity: 0.7 })));

    return {
      update(t, dt, aspect) {
        // Ubicar la antena a la derecha en pantallas anchas
        root.position.x = aspect > 1.2 ? 3.6 : 0;
        root.position.y = aspect > 1.2 ? 0.2 : 2.6;
        root.scale.setScalar(aspect > 1.2 ? 1 : 0.75);
        root.rotation.y = t * 0.15;
        root.rotation.z = Math.sin(t * 0.3) * 0.05;
        feed.scale.setScalar(1 + 0.3 * Math.sin(t * 8));
        glow.intensity = 1.5 + Math.sin(t * 8);
        shells.forEach((m) => {
          const p = (t * 0.22 + m.userData.phase) % 1;
          m.scale.setScalar(0.3 + p * 3.4);
          m.material.opacity = 0.45 * (1 - p) * Math.min(1, p * 6);
        });
        rings.forEach((r) => {
          const p = (t * 0.3 + r.userData.phase) % 1;
          r.scale.setScalar(0.3 + p * 4.2);
          r.material.opacity = 0.6 * (1 - p);
        });
        camera.position.x = Math.sin(t * 0.1) * 0.6;
        camera.lookAt(root.position.x * 0.6, 0, 0);
      },
    };
  });

  /* ---------------------------------------------------------------------
     ESCENA 2: Modelo del dipolo λ/2 (girable)
     --------------------------------------------------------------------- */
  define('dipoloModel', ({ scene, camera, canvas }) => {
    camera.position.set(0, 0.5, 7.5);
    addLights(scene, COLORS.cyan);
    const g = new THREE.Group(); scene.add(g);

    const armMat = metal(COLORS.cyan, 0.35);
    [1, -1].forEach((s) => {
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.9, 24), armMat);
      arm.position.y = s * 1.03; g.add(arm);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.07, 16, 16), armMat);
      cap.position.y = s * 1.98; g.add(cap);
    });
    // Alimentación y línea bifilar
    const feed = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.12, 0.22),
      new THREE.MeshStandardMaterial({ color: COLORS.orange, emissive: COLORS.orange, emissiveIntensity: 0.8 }));
    g.add(feed);
    const wireMat = metal(0xcfd8ea, 0.1);
    [0.045, -0.045].forEach((y) => {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 2.6, 8), wireMat);
      w.rotation.z = Math.PI / 2; w.position.set(-1.35, y, 0); g.add(w);
    });

    // Diagrama de radiación (dona) semitransparente
    const donut = new THREE.Mesh(donutGeometry(2.3, 64), new THREE.MeshBasicMaterial({
      color: COLORS.violet, wireframe: true, transparent: true, opacity: 0.22, depthWrite: false,
    }));
    g.add(donut);
    const donutSolid = new THREE.Mesh(donutGeometry(2.28, 64), new THREE.MeshPhongMaterial({
      color: COLORS.violet, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false,
    }));
    g.add(donutSolid);

    // Rejilla de referencia
    const grid = new THREE.GridHelper(8, 16, 0x1f3b6b, 0x13264a);
    grid.position.y = -2.6; scene.add(grid);

    const step = addDragRotate(canvas, g, { initX: 0.2 });
    return {
      update(t, dt) {
        step(dt);
        donut.material.opacity = 0.18 + 0.08 * Math.sin(t * 2);
        feed.material.emissiveIntensity = 0.6 + 0.4 * Math.sin(t * 6);
      },
    };
  });

  /* ---------------------------------------------------------------------
     ESCENA 3: Sólido de revolución del patrón del dipolo (simulador)
     --------------------------------------------------------------------- */
  define('dipolePattern', ({ scene, camera, canvas }) => {
    camera.position.set(0, 0.6, 8.2);
    addLights(scene, COLORS.cyan);
    const g = new THREE.Group(); scene.add(g);

    const mat = new THREE.MeshPhongMaterial({
      vertexColors: true, side: THREE.DoubleSide, shininess: 70,
      transparent: true, opacity: 0.92,
    });
    const wireMat = new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.08 });
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
    const wire = new THREE.Mesh(mesh.geometry, wireMat);
    g.add(mesh, wire);

    // Eje del dipolo
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1, 12),
      new THREE.MeshBasicMaterial({ color: COLORS.orange }));
    g.add(rod);
    const axes = new THREE.AxesHelper(2.6); axes.material.transparent = true; axes.material.opacity = 0.35; g.add(axes);

    let builtL = -1;
    const cLow = new THREE.Color(0x0a1b6b), cMid = new THREE.Color(COLORS.cyan), cHigh = new THREE.Color(0xffffff);

    function rebuild(L) {
      const F = dipolePattern(L, 160);
      const pts = F.map((r, i) => {
        const th = (i / 160) * Math.PI;
        return new THREE.Vector2(2.2 * r * Math.sin(th), 2.2 * r * Math.cos(th));
      });
      const geo = new THREE.LatheGeometry(pts, 72);
      // Color por vértice según el radio (intensidad)
      const pos = geo.attributes.position;
      const cols = new Float32Array(pos.count * 3);
      const c = new THREE.Color();
      for (let i = 0; i < pos.count; i++) {
        const r = Math.min(1, Math.hypot(pos.getX(i), pos.getY(i), pos.getZ(i)) / 2.2);
        if (r < 0.6) c.copy(cLow).lerp(cMid, r / 0.6); else c.copy(cMid).lerp(cHigh, (r - 0.6) / 0.4);
        cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b;
      }
      geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
      mesh.geometry.dispose();
      mesh.geometry = geo; wire.geometry = geo;
      rod.scale.y = Math.max(0.2, L * 1.6);
      builtL = L;
    }

    const step = addDragRotate(canvas, g, { initX: 0.35 });
    return {
      update(t, dt) {
        if (Math.abs(builtL - state.dipoleL) > 1e-4) rebuild(state.dipoleL);
        step(dt);
      },
    };
  });

  /* ---------------------------------------------------------------------
     ESCENA 4: Bocinas — sectorial E, sectorial H, piramidal y cónica
     --------------------------------------------------------------------- */
  define('horn', ({ scene, camera, canvas }) => {
    camera.position.set(3.2, 1.6, 5.4);
    camera.lookAt(0, 0, 0);
    addLights(scene, COLORS.orange);
    const holder = new THREE.Group(); scene.add(holder);
    const cache = {};
    const texRect = apertureTexture(false), texCirc = apertureTexture(true);

    function edges(geo, color = 0xffd2a8) {
      return new THREE.LineSegments(new THREE.EdgesGeometry(geo, 1),
        new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.8 }));
    }

    /** Construye el modelo según el tipo. */
    function build(type) {
      const grp = new THREE.Group();
      const m = metal(COLORS.orange, 0.12);
      const a = 0.9, b = 0.45;   // guía rectangular
      const z0 = -2.2, z1 = -0.5, z2 = 1.6;
      let aperture;
      if (type === 'C') {
        const guide = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, z1 - z0, 40, 1, true), m);
        guide.rotation.x = Math.PI / 2; guide.position.z = (z0 + z1) / 2; grp.add(guide);
        const cone = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 0.32, z2 - z1, 48, 1, true), m);
        cone.rotation.x = Math.PI / 2; cone.position.z = (z1 + z2) / 2; grp.add(cone);
        const e = edges(new THREE.CylinderGeometry(1.15, 0.32, z2 - z1, 24, 1, true), 0xffd2a8);
        e.rotation.x = Math.PI / 2; e.position.z = (z1 + z2) / 2; grp.add(e);
        aperture = new THREE.Mesh(new THREE.CircleGeometry(1.14, 48),
          new THREE.MeshBasicMaterial({ map: texCirc, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
      } else {
        const A = type === 'H' || type === 'P' ? 2.2 : a;
        const B = type === 'E' || type === 'P' ? 1.7 : b;
        const gGeo = frustumGeometry(a, b, a, b, z0, z1);
        const hGeo = frustumGeometry(a, b, A, B, z1, z2);
        grp.add(new THREE.Mesh(gGeo, m), new THREE.Mesh(hGeo, m), edges(gGeo), edges(hGeo));
        // Brida al final de la guía
        const fl = new THREE.Mesh(new THREE.BoxGeometry(a + 0.35, b + 0.35, 0.06), metal(0x8a5a2a, 0.05));
        fl.position.z = z0; grp.add(fl);
        aperture = new THREE.Mesh(new THREE.PlaneGeometry(A * 0.99, B * 0.99),
          new THREE.MeshBasicMaterial({ map: texRect, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
      }
      aperture.position.z = z2 + 0.001;
      grp.userData.aperture = aperture;
      grp.add(aperture);
      // Flecha del campo E (vertical) en la apertura
      const arrow = new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -0.45, z2 + 0.05), 0.9, COLORS.cyan, 0.2, 0.12);
      grp.add(arrow);
      return grp;
    }

    let current = null, currentType = null;
    function show(type) {
      if (current) holder.remove(current);
      cache[type] = cache[type] || build(type);
      current = cache[type]; currentType = type;
      holder.add(current);
      current.scale.setScalar(0.01);
    }

    const step = addDragRotate(canvas, holder, { initX: 0.15, autoSpeed: 0.3 });
    holder.rotation.y = -0.6;
    return {
      update(t, dt) {
        if (currentType !== state.horn) show(state.horn);
        // Animación de aparición al cambiar de tipo
        const s = current.scale.x; current.scale.setScalar(s + (1 - s) * Math.min(1, dt * 8));
        current.userData.aperture.material.opacity = 0.55 + 0.45 * Math.sin(t * 5);
        step(dt);
      },
    };
  });

  /* ---------------------------------------------------------------------
     Motor: creación, redimensionado y bucle de render
     --------------------------------------------------------------------- */
  function create(canvas) {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
    const ctx = { renderer, scene, camera, canvas };
    const api = factories[canvas.dataset.scene](ctx) || {};
    return { ...ctx, api, w: 0, h: 0 };
  }

  function resize(inst) {
    const w = inst.canvas.clientWidth, h = inst.canvas.clientHeight;
    if (w && h && (w !== inst.w || h !== inst.h)) {
      inst.w = w; inst.h = h;
      inst.renderer.setSize(w, h, false);
      inst.camera.aspect = w / h;
      inst.camera.updateProjectionMatrix();
    }
  }

  function loop(now) {
    rafId = requestAnimationFrame(loop);
    const t = now / 1000;
    const dt = Math.min(0.05, t - (lastT || t));
    lastT = t;
    for (const inst of active) {
      if (inst.canvas.offsetParent === null && inst.canvas.getClientRects().length === 0) continue; // oculto
      resize(inst);
      if (!inst.w) continue;
      inst.api.update && inst.api.update(t, dt, inst.w / inst.h);
      inst.renderer.render(inst.scene, inst.camera);
    }
  }

  /** Activa las escenas contenidas en la diapositiva dada. */
  function activate(slide) {
    if (!hasThree) return;
    active = [];
    slide.querySelectorAll('canvas[data-scene]').forEach((c) => {
      if (!factories[c.dataset.scene]) return;
      let inst = instances.get(c);
      if (!inst) {
        try { inst = create(c); instances.set(c, inst); }
        catch (err) { console.warn('No se pudo crear la escena 3D', c.dataset.scene, err); return; }
      }
      active.push(inst);
    });
    if (active.length && !rafId) { lastT = 0; rafId = requestAnimationFrame(loop); }
    if (!active.length) deactivate();
  }

  function deactivate() {
    active = [];
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
  }

  return {
    activate,
    deactivate,
    setDipoleL(L) { state.dipoleL = L; },
    setHorn(type) { state.horn = type; },
  };
})();
