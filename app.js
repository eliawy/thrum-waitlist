import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const CFG = window.THRUM_CONFIG || {};
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const SOURCE = (new URLSearchParams(location.search).get('src') || 'web').slice(0, 40);
const FONT = '"Archivo", "Helvetica Neue", Arial, sans-serif';

/* Cartridges: cap node number in the CAD model -> ingredient, dose and reason */
const CARTS = {
  57: { name: 'Caffeine', dose: '40 mg', why: '5 h 40 of sleep, so a small dose of caffeine. Early enough to sleep well tonight.' },
  56: { name: 'Electrolytes', dose: '500 mg', why: 'A 45 min run this morning, so you replace what you sweated out.' },
  54: { name: 'Magnesium', dose: '300 mg', why: 'Short sleep and a hard run: magnesium is in your daily plan.' },
  53: { name: 'Creatine', dose: '3 g', why: 'Your daily 3 g, the same every day. It goes into the shot so you never forget it.' }
};

const state = { step: 0, cart: 57 };
let api = null;
const canvas = document.getElementById('machine');
const visual = document.querySelector('.stage__visual');

try { api = initMachine(); } catch (e) { console.warn('3D unavailable', e); visual.classList.add('failed'); }

function initMachine() {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.4;

  const scene = new THREE.Scene();
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(renderer), 0.04).texture;
  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);

  // studio light: warm key from above front, cool rim behind, a little ambient
  const key = new THREE.SpotLight(0xfff1e6, 120, 20, Math.PI / 5, 0.7, 1.2);
  key.position.set(1.6, 6.5, 4.2); scene.add(key, key.target); key.target.position.set(0, 1.4, 0);
  scene.add(new THREE.AmbientLight(0xfff0e8, 0.6));
  const rim = new THREE.DirectionalLight(0xbfd2ff, 1.4); rim.position.set(-4, 4, -5); scene.add(rim);
  const fill = new THREE.DirectionalLight(0xffd9c2, 0.35); fill.position.set(-3, 1.5, 4); scene.add(fill);

  const radial = (stops, size = 256) => {
    const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d');
    const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    stops.forEach(([o, col]) => gr.addColorStop(o, col)); g.fillStyle = gr; g.fillRect(0, 0, size, size);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  };
  const floor = (w, map) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w), new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false })); m.rotation.x = -Math.PI / 2; scene.add(m); return m; };
  floor(4, radial([[0, 'rgba(255,255,255,.16)'], [.5, 'rgba(255,255,255,.05)'], [1, 'rgba(255,255,255,0)']])).position.y = 0.001;
  floor(2.3, radial([[0, 'rgba(0,0,0,.75)'], [.55, 'rgba(0,0,0,.35)'], [1, 'rgba(0,0,0,0)']], 128)).position.y = 0.002;

  const machine = new THREE.Group(); scene.add(machine);
  const drum = new THREE.Group(); machine.add(drum);

  // machine screen, drawn in the brand type
  const scr = document.createElement('canvas'); scr.width = 1160; scr.height = 680;
  const scrTex = new THREE.CanvasTexture(scr); scrTex.colorSpace = THREE.SRGBColorSpace; scrTex.anisotropy = 4;

  const pour = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1, 12, 1, true),
    new THREE.MeshStandardMaterial({ color: 0xe2955f, emissive: 0xc8693a, emissiveIntensity: 0.9, transparent: true, opacity: 0 }));
  machine.add(pour);

  const M = {
    body: new THREE.MeshPhysicalMaterial({ color: 0x9a3036, roughness: 0.38, clearcoat: 0.8, clearcoatRoughness: 0.22 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x1b1a1c, roughness: 0.5, metalness: 0.15 }),
    holder: new THREE.MeshStandardMaterial({ color: 0x2e2d30, roughness: 0.45, metalness: 0.2 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0xe9f1f6, roughness: 0.04, transparent: true, opacity: 0.2, depthWrite: false, envMapIntensity: 2.2, clearcoat: 1, clearcoatRoughness: 0.05 }),
    cup: new THREE.MeshStandardMaterial({ color: 0x29292c, roughness: 0.55, metalness: 0.25 }),
    copper: new THREE.MeshStandardMaterial({ color: 0xc8794a, roughness: 0.28, metalness: 1 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x5e5e62, roughness: 0.3, metalness: 0.9 }),
    screen: new THREE.MeshBasicMaterial({ map: scrTex, toneMapped: false })
  };
  const capAngle = {}; // cart number -> angle around the drum axis

  new GLTFLoader().load('machine.glb', (gltf) => {
    const root = gltf.scene; const toDrum = [], caps = [];
    root.traverse((o) => {
      if (!o.isMesh) return;
      const full = o.name || o.parent?.name || '';
      const role = full.split('__')[0].toLowerCase().replace(/[._]?obj$/, '');
      const nm = full.toLowerCase();
      if (role === 'body') o.material = M.body;
      else if (role === 'tube' || role === 'reservoir') { o.material = M.glass; if (role === 'tube') toDrum.push(o); }
      else if (role === 'drum') { o.material = /revolver/.test(nm) ? M.dark : M.holder; toDrum.push(o); }
      else if (role === 'cap') {
        o.material = new THREE.MeshStandardMaterial({ color: o.material.color.clone().lerp(new THREE.Color(0xffffff), 0.25), roughness: 0.35 });
        toDrum.push(o);
        const n = Number((full.match(/(\d+)$/) || [])[1]); if (n) caps.push([n, o]);
      }
      else if (role === 'powder') { o.material = new THREE.MeshStandardMaterial({ color: o.material.color, roughness: 0.95 }); o.renderOrder = -1; toDrum.push(o); }
      else if (role === 'cup') o.material = M.cup;
      else if (role === 'copper') o.material = M.copper;
      else if (role === 'drain_cover') o.material = M.steel;
      else if (role === 'drain') o.material = M.dark;
      else if (role === 'screen') { o.material = M.dark; placeScreen(o); }
    });
    machine.add(root); root.updateMatrixWorld(true);
    caps.forEach(([n, o]) => { const c = new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3()); capAngle[n] = Math.atan2(c.x, c.z); });
    toDrum.forEach((o) => drum.attach(o));
    pour.scale.y = 1.21; pour.position.set(0, 0.99 + 0.605, 0.03);
    resize(); setStep(state.step, true);
    canvas.classList.add('ready'); visual.classList.add('loaded');
  }, undefined, (err) => { console.warn(err); visual.classList.add('failed'); });

  function placeScreen(mesh) {
    mesh.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(mesh), size = b.getSize(new THREE.Vector3()), c = b.getCenter(new THREE.Vector3());
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(size.x * 0.96, size.y * 0.94), M.screen);
    plane.position.set(c.x, c.y, b.max.z + 0.002); machine.add(plane);
  }

  function drawScreen() {
    const g = scr.getContext('2d'), W = scr.width, s = 2, step = state.step;
    g.fillStyle = '#0e0f11'; g.fillRect(0, 0, W, scr.height);
    g.textBaseline = 'alphabetic';
    g.fillStyle = '#8c8c94'; g.font = `600 ${13 * s}px ${FONT}`;
    g.fillText('15:30', 24 * s, 34 * s);
    g.textAlign = 'right'; g.fillText('T H R U M', W - 24 * s, 34 * s); g.textAlign = 'left';
    const title = (t) => { g.fillStyle = '#f3f2ef'; g.font = `700 ${30 * s}px ${FONT}`; g.fillText(t, 24 * s, 84 * s); };
    const row = (label, val, y, hi) => {
      g.fillStyle = hi ? '#f3f2ef' : '#a9a9b0'; g.font = `${hi ? 600 : 400} ${19 * s}px ${FONT}`; g.fillText(label, 24 * s, y * s);
      g.textAlign = 'right'; g.fillStyle = hi ? '#e08a4f' : '#f3f2ef'; g.font = `700 ${21 * s}px ${FONT}`; g.fillText(val, W - 24 * s, y * s); g.textAlign = 'left';
    };
    const bar = (p) => { g.fillStyle = '#2c2c31'; g.fillRect(24 * s, 292 * s, 532 * s, 6 * s); g.fillStyle = '#e08a4f'; g.fillRect(24 * s, 292 * s, 532 * s * p, 6 * s); };
    if (step === 0) { title('Today’s dose'); g.fillStyle = '#a9a9b0'; g.font = `400 ${19 * s}px ${FONT}`; g.fillText('Tap to mix your afternoon shot', 24 * s, 120 * s);
      g.fillStyle = '#e08a4f'; g.fillRect(24 * s, 248 * s, 150 * s, 44 * s); g.fillStyle = '#1a0c05'; g.font = `600 ${18 * s}px ${FONT}`; g.fillText('Mix now', 50 * s, 277 * s); }
    if (step === 1) { title('Last night'); row('Sleep', '5 h 40', 150); row('HRV', '58 ms', 192); row('Training', '45 min run', 234); }
    if (step === 2) { title('Your 15:30 shot'); [57, 56, 54, 53].forEach((n, i) => row(CARTS[n].name, CARTS[n].dose, 136 + i * 40, n === state.cart)); }
    if (step === 3) { title('Ready.'); g.fillStyle = '#a9a9b0'; g.font = `400 ${22 * s}px ${FONT}`; g.fillText('Take it with you.', 24 * s, 124 * s); bar(1); }
    scrTex.needsUpdate = true;
  }
  document.fonts?.ready.then(drawScreen);

  const presets = [
    { ty: 1.8, dist: 8.6, el: 0.12 },
    { ty: 2.75, dist: 5.2, el: 0.32 },
    { ty: 2.3, dist: 5.0, el: 0.2 },
    { ty: 1.25, dist: 5.6, el: 0.1 }
  ];
  const cam = { ...presets[0] };

  // springs: critically damped by default (Apple: damping 1.0, response ~0.35 s)
  const spring = (x, v, target, dt, response = 0.35, damping = 1) => {
    const k = Math.pow(2 * Math.PI / response, 2), c = 4 * Math.PI * damping / response;
    v += (-k * (x - target) - c * v) * dt; return [x + v * dt, v];
  };
  let drumA = 0, drumV = 0, drumTarget = 0;
  let yaw = 0.5, yawV = 0, yawTarget = null, dragging = false, lastX = 0, lastT = 0, hist = [], pourT = 0;
  const TAU = Math.PI * 2;

  function nearest(from, target) { return target + Math.round((from - target) / TAU) * TAU; }
  function aimDrum() {
    const a = capAngle[state.cart];
    const base = state.step === 3 ? (capAngle[57] ?? 0) : (a ?? 0);
    drumTarget = nearest(drumA, -base);
  }
  function setStep(i, instant) {
    state.step = i; drawScreen();
    if (i >= 2) aimDrum();
    if (instant || reduceMotion) { Object.assign(cam, presets[i]); drumA = drumTarget; }
  }
  function setCart(n) { state.cart = n; drawScreen(); aimDrum(); }

  // drag with velocity handoff and momentum projection
  canvas.addEventListener('pointerdown', (e) => { dragging = true; lastX = e.clientX; lastT = performance.now(); hist = []; yawV = 0; canvas.setPointerCapture(e.pointerId); canvas.classList.add('grabbing'); });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return; const now = performance.now();
    const dx = (e.clientX - lastX) * 0.0075; yaw += dx; hist.push([now, dx]); hist = hist.filter((h) => now - h[0] < 100);
    lastX = e.clientX; lastT = now;
  });
  const release = () => {
    if (!dragging) return; dragging = false; canvas.classList.remove('grabbing');
    const span = hist.length > 1 ? (hist[hist.length - 1][0] - hist[0][0]) / 1000 : 0;
    const v = span > 0 ? hist.reduce((a, h) => a + h[1], 0) / span : 0; // rad/s
    yawV = v;
    if (state.step !== 0) { // snap to the front, projected from where the flick is heading
      const projected = yaw + (v / 1000) * 0.998 / (1 - 0.998); // Apple's projection, d = 0.998
      yawTarget = Math.round(projected / TAU) * TAU;
    }
  };
  canvas.addEventListener('pointerup', release); canvas.addEventListener('pointercancel', release);

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight; if (!w || !h) return;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.fov = w / h < 0.9 ? 34 : 28; camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(canvas);

  let visible = true, last = performance.now();
  new IntersectionObserver(([en]) => { visible = en.isIntersecting; }).observe(visual);

  function tick(now) {
    requestAnimationFrame(tick);
    if (!visible) { last = now; return; }
    const dt = Math.min(1 / 30, (now - last) / 1000); last = now;
    const k = reduceMotion ? 1 : 1 - Math.pow(0.0015, dt);
    const p = presets[state.step];
    cam.ty += (p.ty - cam.ty) * k; cam.dist += (p.dist - cam.dist) * k; cam.el += (p.el - cam.el) * k;
    const narrow = camera.aspect < 0.9 || canvas.clientHeight < 520;
    const dist = cam.dist * (narrow ? (state.step === 0 ? 1.1 : 1.45) : 1);
    camera.position.set(0, cam.ty + Math.sin(cam.el) * dist, Math.cos(cam.el) * dist); camera.lookAt(0, cam.ty, 0);

    if (!dragging) {
      if (state.step === 0) {
        if (!reduceMotion) { yawV += (0.18 - yawV) * Math.min(1, dt * 1.2); } else yawV = 0; // free spin, momentum decays into a slow idle turn
        yaw += yawV * dt; yawTarget = null;
      } else {
        if (yawTarget === null) yawTarget = Math.round(yaw / TAU) * TAU;
        if (reduceMotion) { yaw = yawTarget; yawV = 0; } else [yaw, yawV] = spring(yaw, yawV, yawTarget, dt, 0.5, 0.85);
      }
    }
    machine.rotation.y = yaw;

    if (reduceMotion) drumA = drumTarget; else [drumA, drumV] = spring(drumA, drumV, drumTarget, dt, 0.55, 0.8);
    drum.rotation.y = drumA;

    pourT += ((state.step === 3 ? 1 : 0) - pourT) * k;
    pour.material.opacity = pourT * 0.9; pour.scale.x = pour.scale.z = 0.4 + pourT * 0.6;
    renderer.render(scene, camera);
  }
  requestAnimationFrame(tick);
  return { setStep, setCart };
}

/* ---------- scroll story ---------- */
const steps = [...document.querySelectorAll('.step')];
const phone = matchMedia('(max-width: 899px)').matches;
const stepObserver = new IntersectionObserver((entries) => {
  entries.forEach((en) => {
    if (!en.isIntersecting) return;
    steps.forEach((s) => s.classList.toggle('is-active', s === en.target));
    const i = Number(en.target.dataset.step);
    if (i !== state.step) { state.step = i; api?.setStep(i); }
  });
}, { rootMargin: phone ? '-58% 0px -32% 0px' : '-45% 0px -45% 0px' });
steps.forEach((s) => stepObserver.observe(s));

/* cartridge picker: turns the drum to the chosen powder */
const why = document.getElementById('why');
document.querySelectorAll('.cartridges button').forEach((b) => {
  b.addEventListener('pointerdown', () => select(b));
  b.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(b); } });
});
function select(b) {
  document.querySelectorAll('.cartridges button').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
  const n = Number(b.dataset.cart); state.cart = n;
  why.innerHTML = `<b>Why:</b> ${CARTS[n].why}`;
  api?.setCart(n);
}

/* ---------- top bar colour follows the chapter under it ---------- */
const bar = document.getElementById('bar');
const red = document.querySelector('.chapter--red'), day = document.querySelector('.chapter--day');
function barTone() {
  const y = bar.getBoundingClientRect().bottom;
  const inside = (el) => { const r = el.getBoundingClientRect(); return r.top <= y && r.bottom >= y; };
  bar.classList.toggle('on-red', inside(red)); bar.classList.toggle('on-day', inside(day));
}

/* ---------- dock: shows once the hero form is gone, hides near the final form ---------- */
const dock = document.getElementById('dock');
const heroForm = document.getElementById('join'), finalForm = document.getElementById('join-2');
function dockState() {
  const h = heroForm.getBoundingClientRect(), f = finalForm.getBoundingClientRect();
  const show = h.bottom < 0 && f.top > innerHeight;
  dock.classList.toggle('show', show); dock.setAttribute('aria-hidden', String(!show));
}
addEventListener('scroll', () => { barTone(); dockState(); }, { passive: true });
barTone(); dockState();

/* ---------- sheet ---------- */
const sheet = document.getElementById('sheet'), card = sheet.querySelector('.sheet__card');
let lastEmail = '', opener = null;
function view(name) { sheet.querySelectorAll('.sheet__view').forEach((v) => { v.hidden = v.dataset.view !== name; }); }
function openSheet(from, which = 'join') {
  opener = from || null;
  if (from) { const r = from.getBoundingClientRect(), c = Math.min(560, innerWidth); card.style.setProperty('--ox', `${Math.max(0, Math.min(100, ((r.left + r.width / 2) - (innerWidth - c) / 2) / c * 100))}%`); }
  view(which); sheet.hidden = false; card.style.transform = '';
  requestAnimationFrame(() => requestAnimationFrame(() => sheet.classList.add('open')));
  setTimeout(() => sheet.querySelector(which === 'join' ? 'input[type=email]' : 'input')?.focus({ preventScroll: true }), 120);
}
function closeSheet() {
  sheet.classList.remove('open'); card.style.transform = '';
  setTimeout(() => { sheet.hidden = true; opener?.focus?.({ preventScroll: true }); }, reduceMotion ? 0 : 320);
}
document.querySelectorAll('[data-open-sheet]').forEach((b) => b.addEventListener('click', (e) => { e.preventDefault(); openSheet(b); }));
sheet.querySelectorAll('[data-close-sheet]').forEach((b) => b.addEventListener('click', closeSheet));
addEventListener('keydown', (e) => { if (e.key === 'Escape' && !sheet.hidden) closeSheet(); });

// drag the sheet down to dismiss: 1:1 tracking, rubber band upwards, velocity decides
(() => {
  let y0 = 0, dy = 0, t0 = 0, active = false;
  const grab = sheet.querySelector('.sheet__grab');
  const start = (e) => { if (e.target.closest('input,button,label,summary,a')) return; active = true; y0 = e.clientY; t0 = performance.now(); dy = 0; card.setPointerCapture(e.pointerId); card.style.transition = 'none'; };
  card.addEventListener('pointerdown', start);
  card.addEventListener('pointermove', (e) => {
    if (!active) return; dy = e.clientY - y0;
    const shown = dy < 0 ? -(Math.abs(dy) * 60) / (60 + Math.abs(dy)) : dy;
    card.style.transform = `translateY(${shown}px)`;
  });
  const end = () => {
    if (!active) return; active = false; card.style.transition = '';
    const v = dy / Math.max(1, performance.now() - t0) * 1000;
    if (dy > 120 || v > 700) closeSheet(); else card.style.transform = '';
  };
  card.addEventListener('pointerup', end); card.addEventListener('pointercancel', end);
  grab.addEventListener('click', closeSheet);
})();

/* ---------- waitlist ---------- */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const fmt = new Intl.NumberFormat('de-CH');
function showCount(n) { const el = document.getElementById('count'); if (n >= 5) { el.innerHTML = `<b>${fmt.format(n)}</b> people are already on the list.`; el.hidden = false; } }
if (CFG.endpoint) fetch(CFG.endpoint).then((r) => r.json()).then((j) => j.ok && showCount(j.count)).catch(() => {});

async function send(data) {
  const body = new URLSearchParams({ ...data, source: SOURCE });
  try { const r = await fetch(CFG.endpoint, { method: 'POST', body }); return await r.json(); }
  catch (e) { await fetch(CFG.endpoint, { method: 'POST', body, mode: 'no-cors' }); return { ok: true }; }
}

document.querySelectorAll('form.capture').forEach((form) => {
  const status = form.querySelector('.capture__status'), barEl = form.querySelector('.capture__bar'), btn = form.querySelector('button[type=submit]');
  const setStatus = (kind, text) => { status.className = 'capture__status' + (kind ? ' is-' + kind : ''); status.textContent = text || ''; barEl.classList.toggle('is-invalid', kind === 'error'); };
  form.email.addEventListener('input', () => { if (barEl.classList.contains('is-invalid')) setStatus(); });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = form.email.value.trim();
    if (!EMAIL.test(email)) { setStatus('error', 'Enter an email like name@example.ch.'); form.email.focus(); return; }
    if (!form.consent.checked) { setStatus('error', 'Tick the box so we can email you.'); return; }
    if (form.website.value) return;
    if (!CFG.endpoint) { setStatus('error', 'The waitlist opens in a moment. Please try again later.'); return; }
    btn.setAttribute('aria-busy', 'true'); const label = btn.textContent; btn.textContent = 'Joining…';
    try {
      const res = await send({ email, consent: 'yes' });
      if (!res.ok) throw new Error(res.error || 'failed');
      lastEmail = email; form.reset(); if (res.count) showCount(res.count);
      navigator.vibrate?.(12);
      if (res.duplicate) { setStatus('ok', '✓ You were already on the list.'); return; }
      setStatus('ok', '✓ You’re on the list.');
      if (form.id === 'join-sheet') view('more'); else openSheet(btn, 'more');
    } catch (err) { setStatus('error', 'That did not go through. Check your connection and try again.'); }
    finally { btn.removeAttribute('aria-busy'); btn.textContent = label; }
  });
});

document.getElementById('more').addEventListener('submit', async (e) => {
  e.preventDefault(); const f = e.target; const data = { email: lastEmail, consent: 'yes' };
  if (f.moment.value) data.moment = f.moment.value;
  if (f.test.value) data.test = f.test.value;
  if (f.name.value.trim()) data.name = f.name.value.trim();
  closeSheet(); f.reset();
  if (lastEmail && (data.moment || data.test || data.name)) { try { await send(data); } catch (_) {} }
});

/* prototype link, once it exists */
if (CFG.prototypeUrl) { const a = document.getElementById('proto-link'); a.href = CFG.prototypeUrl; a.hidden = false; }

/* pause the film off screen */
const film = document.querySelector('.film video');
if (reduceMotion) film.removeAttribute('autoplay');
new IntersectionObserver(([en]) => { if (en.isIntersecting && !reduceMotion) film.play().catch(() => {}); else film.pause(); }).observe(film);
