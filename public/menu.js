/* Menu: finestre Info e Impostazioni, preferenze salvate sul dispositivo.
   Non tocca la logica di gioco: il login resta in game.js. */
(() => {
  'use strict';

  const KEY = 'climbrace.prefs';
  const $ = (id) => document.getElementById(id);

  /* ═══ Preferenze (localStorage) ═══ */
  function loadPrefs() {
    try {
      return { sound: true, music: true, nickname: '', color: '', skin: '', ...JSON.parse(localStorage.getItem(KEY) || '{}') };
    } catch {
      return { sound: true, music: true, nickname: '', color: '', skin: '' };
    }
  }

  function savePrefs() {
    try {
      localStorage.setItem(KEY, JSON.stringify(prefs));
    } catch {
      /* storage non disponibile: le preferenze valgono solo per questa sessione */
    }
  }

  const prefs = loadPrefs();
  // Esposte per il codice audio futuro: il gioco al momento non ha suoni né musica
  window.ClimbPrefs = prefs;

  const nicknameInput = $('nickname');
  const colorsEl = $('colors');

  // Ripristina nickname e colore dell'ultimo salvataggio
  if (prefs.color) {
    const btn = colorsEl.querySelector(`.swatch[data-color="${prefs.color}"]`);
    if (btn) btn.click();   // il click è gestito da game.js, che aggiorna il colore scelto
  }
  if (prefs.skin) {
    const slot = document.querySelector(`#login .slot[data-skin="${prefs.skin}"]`);
    if (slot) slot.click(); // indossa la skin salvata (gestito da game.js)
  }

  /* ═══ Finestre ═══ */
  const modal = $('modal');
  // Spostata fuori dalla schermata di login: così non viene ritagliata dallo scroll del menu
  document.body.appendChild(modal);

  function openModal(name) {
    modal.querySelectorAll('[data-modal]').forEach((sec) => {
      sec.hidden = sec.dataset.modal !== name;
    });
    modal.hidden = false;
    refreshSettings();
    modal.querySelector('.modal-close').focus({ preventScroll: true });
  }

  function closeModal() {
    modal.hidden = true;
  }

  document.querySelectorAll('[data-open]').forEach((btn) => {
    btn.addEventListener('click', () => openModal(btn.dataset.open));
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal || e.target.closest('[data-close]')) closeModal();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.hidden) closeModal();
  });

  /* ═══ Impostazioni ═══ */
  const toggles = document.querySelectorAll('[data-setting]');

  function refreshSettings() {
    toggles.forEach((t) => t.setAttribute('aria-checked', String(!!prefs[t.dataset.setting])));
  }

  toggles.forEach((t) => {
    t.addEventListener('click', () => {
      const key = t.dataset.setting;
      prefs[key] = !prefs[key];
      savePrefs();
      refreshSettings();
    });
  });

  /* ═══ Titolo: segue il mouse, si inclina e lancia scintille ═══ */
  const titleWrap = $('titleWrap');
  const titleImg = $('titleImg');
  const sparksEl = $('titleSparks');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const SPARK_COLORS = ['#ffd60a', '#ffffff', '#ff9f1c', '#8f85ff'];
  let lastSpark = 0;

  const clamp01 = (v) => Math.max(-1, Math.min(1, v));

  function spawnSpark(x, y, big) {
    const el = document.createElement('span');
    el.className = 'spark';
    const size = big ? 22 + Math.random() * 14 : 10 + Math.random() * 10;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.setProperty('--s', `${size}px`);
    el.style.setProperty('--sc', SPARK_COLORS[Math.floor(Math.random() * SPARK_COLORS.length)]);
    el.style.setProperty('--d', `${(0.5 + Math.random() * 0.4).toFixed(2)}s`);
    sparksEl.appendChild(el);
    setTimeout(() => el.remove(), 1000);
  }

  // Coordinate relative alla finestra degli effetti
  function sparkAt(clientX, clientY, big) {
    const r = sparksEl.getBoundingClientRect();
    spawnSpark(clientX - r.left, clientY - r.top, big);
  }

  function resetTitle() {
    titleImg.style.setProperty('--tx', '0px');
    titleImg.style.setProperty('--ty', '0px');
    titleImg.style.setProperty('--rot', '0deg');
  }

  document.addEventListener('mousemove', (e) => {
    if (!modal.hidden || $('login').hidden) return;
    const r = titleWrap.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    // Inclinazione: più il mouse è lontano dal centro del titolo, più si sposta
    const nx = clamp01((e.clientX - cx) / (window.innerWidth / 2));
    const ny = clamp01((e.clientY - cy) / (window.innerHeight / 2));
    if (!reduceMotion) {
      titleImg.style.setProperty('--tx', `${(nx * 14).toFixed(1)}px`);
      titleImg.style.setProperty('--ty', `${(ny * 9).toFixed(1)}px`);
      titleImg.style.setProperty('--rot', `${(nx * 3.5).toFixed(2)}deg`);
    }
    // Scintille vicino al titolo, seguendo il puntatore
    const near = e.clientX > r.left - 30 && e.clientX < r.right + 30 &&
                 e.clientY > r.top - 30 && e.clientY < r.bottom + 30;
    const now = performance.now();
    if (!reduceMotion && near && now - lastSpark > 90 && Math.random() < 0.7) {
      lastSpark = now;
      sparkAt(e.clientX, e.clientY, Math.random() < 0.25);
    }
  });

  // Quando il mouse esce dalla finestra, il titolo torna dritto
  document.addEventListener('mouseout', (e) => { if (!e.relatedTarget) resetTitle(); });

  // Scintille ambientali sul titolo
  setInterval(() => {
    if (reduceMotion || $('login').hidden || !modal.hidden) return;
    const r = titleWrap.getBoundingClientRect();
    const x = r.left + Math.random() * r.width;
    const y = r.top + Math.random() * r.height;
    sparkAt(x, y, false);
  }, 380);

  // Click sul titolo: esplosione di scintille
  titleImg.addEventListener('click', () => {
    if (reduceMotion) return;
    const r = titleWrap.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    for (let i = 0; i < 14; i++) {
      const a = (Math.PI * 2 * i) / 14 + Math.random() * 0.3;
      const d = 90 + Math.random() * 90;
      sparkAt(x + Math.cos(a) * d * 0.6, y + Math.sin(a) * d * 0.4, true);
    }
  });
})();
