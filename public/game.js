(() => {
  'use strict';

  const S = window.Shared;
  const { TICK, PLAYER_W, PLAYER_H, SPEED, PX_PER_METER } = S;

  /* ═══ Impostazioni visive e di rete (solo client) ═══ */
  const SPRITE_SCALE = 4;
  const CELL_W = 16;                   // cella comune degli sprite dell'arancino
  const CELL_H = 20;
  const CLOUD_H = 40;
  const NUVOLA_SRC = { x: 6, y: 13, w: 17, h: 10 };
  const NUVOLA_CAP = 5;
  const VIEW_H = 720;
  const INTERP_DELAY = 110;
  const BUFFER_MS = 1200;
  const HISTORY_MAX = 120;
  const RECONCILE_SNAP = 150;
  const ERR_DECAY = 14;
  const CAM_FOLLOW = 7;
  const CAM_LOOKAHEAD = 70;
  const WALK_FRAME_MS = 120;
  const LAND_FRAME_MS = 100;
  const TAKEOFF_S = 0.04;
  const TINT_PLAYER = true;
  const DECOR_COUNT = 12;
  const STAR_COUNT = 140;
  const MAX_PARTICLES = 420;
  const BUBBLE_MS = 4500;
  const EMOTE_MS = 1700;
  const CHAT_LOG_MAX = 8;
  const FX_SCALE = 3;                  // effetti pixel ingranditi ×3
  const FX_SLASH_MS = 180;
  const FX_HIT_MS = 240;
  const FX_STOMP_MS = 260;
  // Emote in pixel art (9×9), stesso stile degli oggetti. Indice = tasto 1–4.
  const EMOTE_PAL = { k: '#2b1a0c', y: '#ffd60a', w: '#ffffff', b: '#3a86ff', c: '#73d2de', r: '#d7262e', p: '#ff006e', g: '#b8860b' };
  const EMOTE_PIX = 3;
  const EMOTE_SPRITES = [
    ['..kk.kk..', '.kwwkwwk.', '.kwwkwwkk', 'kkwwwwwwk', 'kwwwwwwwk', '.kwwwwwwk', '..kwwwwk.', '..kwwwk..', '...kkk...'],  // 👋
    ['...kkk...', '.kkyyykk.', 'kyyyyyyyk', 'kykyykyyk', 'kyyyyyyyk', 'kykkkkkyk', '.kyyyyyk.', '..kkkkk..', '.........'],  // 😂
    ['.........', '.r.y.c...', '..r.kkk..', '...kyyyk.', '..kyyyybk', '.kyygyyyk', '.kyyyyyk.', '..kkkkk..', '.........'],  // 🎉
    ['...kkk...', '.kkyyykk.', 'kyyyyyyyk', 'kykyyykyk', 'kyyyyyyyk', 'kyykkkyyk', 'kyyyyyyyk', '.kbyyybk.', '..kkkkk..'],  // 😭
  ];
  function drawEmoteSprite(c, idx, cx, cy, alpha) {
    const rows = EMOTE_SPRITES[idx];
    if (!rows) return;
    const x0 = Math.round(cx - (9 * EMOTE_PIX) / 2);
    const y0 = Math.round(cy - (9 * EMOTE_PIX) / 2);
    c.save();
    c.globalAlpha = alpha;
    rows.forEach((row, ry) => {
      for (let col = 0; col < row.length; col++) {
        const ch = row[col];
        if (ch === '.') continue;
        c.fillStyle = EMOTE_PAL[ch];
        c.fillRect(x0 + col * EMOTE_PIX, y0 + ry * EMOTE_PIX, EMOTE_PIX, EMOTE_PIX);
      }
    });
    c.restore();
  }
  // Skin: canvas 32×32 alla stessa scala dello sprite (1 px skin = 1 px sprite).
  // Lo sprite nel canvas parte da (8, 4): così la testa (riga 10 dello sprite) cade sulla riga 14 del canvas,
  // esattamente dove finiscono cappello e orecchie del gatto, e il cavaliere copre la parte alta della testa.
  // Se una skin risulta fuori posto, si corregge SKIN_OFF_X / SKIN_OFF_Y (negativi = spostamento a sinistra/in alto).
  // Skin disattivate per ora: per riattivarle basta impostare SKINS_ENABLED a true.
  const SKINS_ENABLED = false;
  const SKIN_FILES = { cat: 'assets/skins/skin-cat.png', hat: 'assets/skins/skin-hat.png', knight: 'assets/skins/skin-knight.png' };
  const SKIN_SIZE = 32;
  const SKIN_OFF_X = -8;
  const SKIN_OFF_Y = -2;
  const INK = '#2b1a0c';
  const FONT = "'Press Start 2P', monospace";

  // Colori del cielo in funzione dell'altezza (metri)
  const SKY_STOPS = [
    { m: 0,    top: [95, 189, 245],  bot: [217, 243, 255], hill: [127, 211, 138], hill2: [96, 180, 120] },
    { m: 350,  top: [247, 160, 114], bot: [255, 217, 168], hill: [201, 123, 99],  hill2: [170, 96, 88] },
    { m: 1000, top: [61, 59, 142],   bot: [179, 92, 155],  hill: [74, 58, 107],   hill2: [58, 44, 88] },
    { m: 2200, top: [11, 16, 48],    bot: [43, 35, 102],   hill: [27, 23, 64],    hill2: [20, 17, 50] },
    { m: 4500, top: [2, 3, 10],      bot: [20, 13, 43],    hill: [13, 10, 31],    hill2: [9, 7, 22] },
  ];

  /* ═══ Utilità ═══ */
  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const $ = (id) => document.getElementById(id);

  /* ═══ Elementi DOM ═══ */
  const loginScreen = $('login');
  const gameScreen = $('game');
  const loginForm = $('loginForm');
  const nicknameInput = $('nickname');
  const colorsEl = $('colors');
  const loginError = $('loginError');
  const playBtn = $('playBtn');
  const previewCanvas = $('preview');
  const previewCtx = previewCanvas.getContext('2d');
  const canvas = $('gameCanvas');
  const ctx = canvas.getContext('2d');
  const leaderboardEl = $('leaderboard');
  const hallEl = $('hallList');
  const recordEl = $('record');
  const altitudeEl = $('altitude');
  const bannerEl = $('banner');
  const chatLogEl = $('chatLog');
  const chatInput = $('chatInput');

  /* ═══ Stato di connessione e partita ═══ */
  const socket = io();
  let gen = null;
  let myId = null;
  let joined = false;
  let gameStarted = false;
  let assetsReady = false;
  let selectedColor = colorsEl.querySelector('.swatch.selected').dataset.color;
  let selectedSkin = '';

  /* ═══ Progressi e oggetti estetici (salvati sul dispositivo) ═══ */
  const STATS_KEY = 'climbrace.stats';
  const COS_KEY = 'climbrace.cos';
  const Cos = window.Cosmetics;

  function loadJSON(key, def) {
    try {
      return { ...def, ...JSON.parse(localStorage.getItem(key) || '{}') };
    } catch {
      return { ...def };
    }
  }
  function saveJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage non disponibile */ }
  }

  const stats = loadJSON(STATS_KEY, { best: 0, stomps: 0, checkpoints: 0, unlocked: [] });

  let selCos = loadJSON(COS_KEY, { v: [] }).v;
  selCos = Cos.SLOTS.map((_, i) => {
    const id = selCos[i] || '';
    const ok = Cos.SLOTS[i].ids.includes(id) && Cos.isUnlocked(id, stats);
    return ok ? id : '';
  });

  // Oggetti appena sbloccati: avviso in partita, poi la UI si aggiorna
  function checkUnlocks() {
    let changed = false;
    for (const id of Object.keys(Cos.ITEMS)) {
      if (Cos.ITEMS[id].need.type === 'none') continue; // sempre disponibili: nessun avviso
      if (stats.unlocked.includes(id) || !Cos.isUnlocked(id, stats)) continue;
      stats.unlocked.push(id);
      changed = true;
      if (joined) {
        showBanner(`SBLOCCATO: ${Cos.ITEMS[id].name}!`, 3200);
        window.ClimbAudio.sfx('unlock');
      }
    }
    return changed;
  }

  function progressChanged() {
    checkUnlocks();
    saveJSON(STATS_KEY, stats);
    refreshEquipUI();
  }

  // Disegna i tre slot dell'equipaggiamento e la didascalia
  function refreshEquipUI() {
    const slots = document.querySelectorAll('#login .slot-cos');
    const captionEl = $('cosCaption');
    if (!slots.length) return;
    slots.forEach((btn, i) => {
      const cv = btn.querySelector('canvas');
      const c = cv.getContext('2d');
      c.imageSmoothingEnabled = false;
      c.clearRect(0, 0, cv.width, cv.height);
      const id = selCos[i];
      const options = Cos.SLOTS[i].ids;
      // Anteprima dello slot: lo sprite dell'arancino (colore scelto) con l'oggetto
      // equipaggiato, o con la sagoma del primo oggetto ancora da sbloccare
      const show = id || options.find((o) => o) || '';
      const locked = !!show && !id && !Cos.isUnlocked(show, stats);
      if (locked) {
        // Oggetto ancora bloccato: solo il punto interrogativo al centro
        Cos.drawUnknown(c, 22, 20, 3);
      } else {
        const sheet = getTinted('idle', selectedColor);
        if (sheet) {
          c.drawImage(sheet, 0, 0, CELL_W, CELL_H, 8, 2, CELL_W * 3, CELL_H * 3);
        }
        if (show) Cos.drawItem(c, show, 8, 2, 3);
      }
      btn.classList.toggle('selected', !!id);
    });
    const worn = selCos.filter((x) => x).map((x) => Cos.ITEMS[x].name);
    if (captionEl) {
      // Prossimo oggetto da sbloccare: quello con la soglia più bassa
      const firstLocked = Object.keys(Cos.ITEMS)
        .filter((o) => !Cos.isUnlocked(o, stats))
        .sort((a, b) => Cos.ITEMS[a].need.value - Cos.ITEMS[b].need.value)[0];
      captionEl.textContent = worn.length
        ? `Equipaggiato: ${worn.join(' + ')}`
        : (firstLocked ? `Da sbloccare: ${Cos.ITEMS[firstLocked].name} (${Cos.ITEMS[firstLocked].needText})` : 'Clicca uno slot per cambiare');
    }
  }

  // Click sullo slot: cambia oggetto tra quelli sbloccati (e "nessuno")
  document.querySelectorAll('#login .slot-cos').forEach((btn) => {
    btn.addEventListener('click', () => {
      const i = +btn.dataset.cos;
      const options = Cos.SLOTS[i].ids.filter((o) => !o || Cos.isUnlocked(o, stats));
      const idx = options.indexOf(selCos[i]);
      selCos[i] = options[(idx + 1) % options.length] || '';
      saveJSON(COS_KEY, { v: selCos });
      if (account.loggedIn && account.nickname) {
        fetch('/api/cos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cos: selCos }),
          credentials: 'same-origin',
        }).catch(() => {});
      }
      refreshEquipUI();
    });
  });

  let chatOpen = false;

  // Stato locale (predizione). Uno step = un input.
  const me = { x: 0, y: 0, vx: 0, vy: 0, onGround: true, onIce: false, cp: 0, stun: 0, atkCd: 0, face: 1, attacked: false };
  let prevPos = { x: 0, y: 0 };
  let inputSeq = 0;
  const history = [];                  // { seq, input, s: stato dopo lo step }
  let myMaxH = 0;
  let renderX = 0;
  let renderY = 0;
  const NAME_NEAR = 170;   // entro questa distanza il nome è pieno
  const NAME_FAR = 320;    // oltre questa distanza il nome non si vede
  let errX = 0;
  let errY = 0;

  const keys = { left: false, right: false };
  const touchKeys = { left: false, right: false };
  let jumpQueued = false;
  let attackQueued = false;

  // Remoti e dati condivisi
  const roster = new Map();
  const snapshots = [];
  const remoteState = new Map();       // id -> ultimo stato noto (animazioni, classifica, stordimento)
  let clockOffset = null;
  let hall = [];
  let record = { name: '', meters: 0 };

  // Effetti
  const visuals = new Map();
  const bubbles = new Map();
  const emotes = new Map();
  const particles = [];
  const fxList = [];                   // effetti pixel: { type, x, y, face, t0, dur }
  let shake = 0;
  let flash = 0;
  let leaving = false;
  let bannerTimer = null;

  let dpr = 1;
  let camX = 0;
  let camY = 0;
  let camScale = 1;
  let camInit = false;
  let frameDt = 1 / 60;

  const decor = Array.from({ length: DECOR_COUNT }, () => ({
    x: Math.random(), y: Math.random(), s: 0.6 + Math.random() * 0.8,
  }));
  const stars = Array.from({ length: STAR_COUNT }, () => ({
    x: Math.random(), y: Math.random() * 0.85, r: 0.4 + Math.random() * 1.4, ph: Math.random() * 6.28,
  }));

  /* ═══════════════════════════════════════════════════════════
     ASSET
     ═══════════════════════════════════════════════════════════ */
  const sprites = {};
  const tintCache = new Map();
  const skinImgs = {};

  /* Disegna la skin sopra lo sprite. (x0, y0) è l'angolo in alto a sinistra del fotogramma, s la scala. */
  function drawSkin(c, key, x0, y0, s) {
    if (!SKINS_ENABLED) return;
    const img = skinImgs[key];
    if (!img || !key) return;
    c.imageSmoothingEnabled = false;
    c.drawImage(img, x0 + SKIN_OFF_X * s, y0 + SKIN_OFF_Y * s, SKIN_SIZE * s, SKIN_SIZE * s);
  }

  playBtn.disabled = true;

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Impossibile caricare ${src}`));
      img.src = src;
    });
  }

  Promise.all([
    loadImage('assets/arancino_idle.png').then((img) => { sprites.idle = img; }),
    loadImage('assets/arancino_corsa.png').then((img) => { sprites.corsa = img; }),
    loadImage('assets/arancino_salto.png').then((img) => { sprites.salto = img; }),
    loadImage('assets/nuvola.png').then((img) => { sprites.nuvola = img; }),
    loadImage('assets/fx_slash.png').then((img) => { sprites.fxSlash = img; }),
    loadImage('assets/fx_hit.png').then((img) => { sprites.fxHit = img; }),
    loadImage('assets/fx_stomp.png').then((img) => { sprites.fxStomp = img; }),
    loadImage('assets/fx_star.png').then((img) => { sprites.fxStar = img; }),
    ...Object.entries(SKIN_FILES).map(([key, src]) =>
      loadImage(src).then((img) => { skinImgs[key] = img; })),
  ])
    .then(() => {
      ['idle', 'corsa', 'salto'].forEach(measureFrames);
      assetsReady = true;
      refreshPlayEnabled();
      refreshEquipUI();
    })
    .catch((err) => {
      loginError.textContent = 'Errore nel caricamento della grafica.';
      console.error(err);
    });

  /* Ricolora un'immagine mantenendo ombre e contorno originali (blend "color"). */
  function getTinted(key, color) {
    const img = sprites[key];
    if (!img) return null;
    if (!color) return img;
    const cacheKey = `${key}|${color}`;
    if (tintCache.has(cacheKey)) return tintCache.get(cacheKey);

    const cv = document.createElement('canvas');
    cv.width = img.naturalWidth;
    cv.height = img.naturalHeight;
    const c = cv.getContext('2d');
    c.drawImage(img, 0, 0);
    c.globalCompositeOperation = 'color';
    c.fillStyle = color;
    c.fillRect(0, 0, cv.width, cv.height);
    c.globalCompositeOperation = 'destination-in';
    c.drawImage(img, 0, 0);
    c.globalCompositeOperation = 'source-over';

    tintCache.set(cacheKey, cv);
    return cv;
  }

  /* Disegna una cella di uno sheet (celle affiancate di cw×ch). */
  /* Misura, per ogni fotogramma degli sprite, la fascia occupata dal corpo (righe con pixel visibili).
     Serve a far seguire le skin al corpo quando lo sprite si allunga o si schiaccia. */
  const frameMetrics = {};
  function measureFrames(key) {
    const img = sprites[key];
    if (!img) return;
    const n = Math.floor(img.naturalWidth / CELL_W);
    const cv = document.createElement('canvas');
    cv.width = img.naturalWidth;
    cv.height = img.naturalHeight;
    const c = cv.getContext('2d', { willReadFrequently: true });
    c.drawImage(img, 0, 0);
    const out = [];
    for (let i = 0; i < n; i++) {
      const d = c.getImageData(i * CELL_W, 0, CELL_W, CELL_H).data;
      let top = CELL_H;
      let bot = -1;
      for (let y = 0; y < CELL_H; y++) {
        for (let x = 0; x < CELL_W; x++) {
          if (d[(y * CELL_W + x) * 4 + 3] > 0) {
            if (y < top) top = y;
            if (y > bot) bot = y;
          }
        }
      }
      out.push(bot >= 0 ? { top, h: bot - top + 1 } : { top: 0, h: CELL_H });
    }
    frameMetrics[key] = out;
  }

  // Trasformazione delle skin per il fotogramma mostrato (null = nessuna deformazione)
  function itemWarp(key, frame) {
    const m = frameMetrics[key] && frameMetrics[key][frame];
    const ref = frameMetrics.idle && frameMetrics.idle[0];
    if (!m || !ref) return null;
    return { top: m.top, refTop: ref.top, k: m.h / ref.h };
  }

  function drawFrame(c, sheet, frame, x, y, w, h, cw = CELL_W, ch = CELL_H) {
    c.imageSmoothingEnabled = false;
    c.drawImage(sheet, frame * cw, 0, cw, ch, x, y, w, h);
  }

  /* ═══ Selezione colore ═══ */
  colorsEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.swatch');
    if (!btn) return;
    colorsEl.querySelectorAll('.swatch').forEach((b) => {
      const on = b === btn;
      b.classList.toggle('selected', on);
      b.setAttribute('aria-checked', String(on));
    });
    selectedColor = btn.dataset.color;
  });

  /* ═══ Selezione skin: un click la indossa, un secondo click la toglie ═══ */
  document.querySelectorAll('#login .slot[data-skin]').forEach((btn) => {
    if (!SKINS_ENABLED) return;
    btn.addEventListener('click', () => {
      const key = btn.dataset.skin;
      selectedSkin = selectedSkin === key ? '' : key;
      document.querySelectorAll('#login .slot[data-skin]').forEach((b) => {
        b.setAttribute('aria-pressed', String(b.dataset.skin === selectedSkin));
      });
    });
  });

  /* ═══ Anteprima personaggio nel menu (idle) ═══ */
  function drawPreview(t) {
    const W = previewCanvas.width;
    const H = previewCanvas.height;
    const scale = 5;
    const w = CELL_W * scale;
    const h = CELL_H * scale;
    const bob = Math.sin(t / 380) * 5;
    const x = (W - w) / 2;
    const y = (H - h) / 2 + bob;
    const sheet = getTinted('idle', selectedColor);

    previewCtx.clearRect(0, 0, W, H);
    const sShadow = 1 - bob / 30;
    previewCtx.fillStyle = 'rgba(43, 26, 12, 0.22)';
    previewCtx.beginPath();
    previewCtx.ellipse(W / 2, y + h - 2, 28 * sShadow, 5 * sShadow, 0, 0, Math.PI * 2);
    previewCtx.fill();

    if (sheet) drawFrame(previewCtx, sheet, 0, x, y, w, h);
    drawSkin(previewCtx, selectedSkin, x, y, scale);
    Cos.drawEquipped(previewCtx, selCos, x, y, scale);
  }

  function previewLoop(t) {
    if (assetsReady && !loginScreen.hidden) drawPreview(t);
    requestAnimationFrame(previewLoop);
  }
  requestAnimationFrame(previewLoop);

  /* ═══ Login ═══ */
  /* ═══ Account (nome utente + password): stato, accesso, GIOCA ═══ */
  let account = { loggedIn: false };
  window.ClimbAccount = account;

  const authBar = { user: $('authUser'), open: $('authOpenBtn'), logout: $('logoutBtn') };
  const authModal = $('authModal');
  const authForm = $('authForm');
  const authName = $('authName');
  const authPass = $('authPass');
  const authTitle = $('authTitle');
  const authHint = $('authHint');
  const authError = $('authError');
  const authSubmit = $('authSubmit');
  const authSwitch = $('authSwitch');
  let authMode = 'login';

  function refreshPlayEnabled() {
    playBtn.disabled = !(assetsReady && account.loggedIn);
  }

  function applyAccountUI() {
    if (account.loggedIn) {
      authBar.user.textContent = `Ciao, ${account.nickname}`;
      authBar.user.hidden = false;
      authBar.open.hidden = true;
      authBar.logout.hidden = false;
      nicknameInput.value = account.nickname;
      nicknameInput.readOnly = true;
      $('accountNote').textContent = `Nome utente: ${account.nickname} · non modificabile`;
    } else {
      authBar.user.hidden = true;
      authBar.open.hidden = false;
      authBar.logout.hidden = true;
      nicknameInput.value = '';
      nicknameInput.readOnly = true;
      $('accountNote').textContent = 'Accedi o registrati per giocare';
    }
    refreshPlayEnabled();
  }

  async function loadAccount() {
    try {
      const r = await fetch('/api/me', { credentials: 'same-origin' });
      account = await r.json();
    } catch {
      account = { loggedIn: false };
    }
    window.ClimbAccount = account;
    if (account.loggedIn) {
      Object.assign(stats, account.stats);
      selCos = [0, 1, 2].map((i) => (account.cos && account.cos[i]) || '');
    }
    applyAccountUI();
    refreshEquipUI();
  }

  /* Finestra di accesso / registrazione */
  function setAuthMode(mode) {
    authMode = mode;
    const reg = mode === 'register';
    authTitle.textContent = reg ? 'Registrati' : 'Accedi';
    authSubmit.textContent = reg ? 'Crea account' : 'Accedi';
    authSwitch.textContent = reg ? 'Hai già un account? Accedi' : 'Non hai un account? Registrati';
    authHint.textContent = reg
      ? 'Nome utente 3–14 caratteri (lettere, numeri, _): unico e non modificabile. Password 6–72 caratteri.'
      : '';
    authPass.autocomplete = reg ? 'new-password' : 'current-password';
    authError.textContent = '';
  }

  function openAuth(mode) {
    setAuthMode(mode);
    authName.value = '';
    authPass.value = '';
    authModal.hidden = false;
    authName.focus();
  }

  function closeAuth() {
    authModal.hidden = true;
    authPass.value = '';
  }

  authBar.open.addEventListener('click', () => openAuth('login'));
  $('authClose').addEventListener('click', closeAuth);
  authSwitch.addEventListener('click', () => setAuthMode(authMode === 'login' ? 'register' : 'login'));
  authModal.addEventListener('click', (e) => { if (e.target === authModal) closeAuth(); });

  authForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    authError.textContent = '';
    authSubmit.disabled = true;
    try {
      const r = await fetch(authMode === 'register' ? '/api/register' : '/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: authName.value.trim(), password: authPass.value }),
        credentials: 'same-origin',
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        authError.textContent = j.error || 'Operazione non riuscita.';
        return;
      }
      closeAuth();
      await loadAccount();
      // Il cookie di sessione viene letto solo quando si apre la connessione: la riapro
      socket.disconnect();
      socket.connect();
    } catch {
      authError.textContent = 'Impossibile contattare il server.';
    } finally {
      authSubmit.disabled = false;
    }
  });

  authBar.logout.addEventListener('click', async () => {
    try {
      await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' });
    } catch { /* ignora */ }
    location.reload();
  });

  loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!assetsReady) return;
    if (!account.loggedIn) {
      loginError.textContent = 'Accedi o registrati per giocare.';
      openAuth('login');
      return;
    }
    loginError.textContent = '';
    playBtn.disabled = true;
    socket.emit('join', { color: selectedColor, skin: selectedSkin, cos: selCos });
  });

  socket.on('joinError', (d) => {
    loginError.textContent = (d && d.error) || 'Impossibile entrare in partita.';
    refreshPlayEnabled();
  });

  window.ClimbAudio.music('menu');
  loadAccount();

  /* ═══ Connessione ═══ */
  socket.on('connect_error', () => {
    if (!joined) {
      loginError.textContent = 'Impossibile connettersi al server.';
      refreshPlayEnabled();
    }
  });

  socket.on('connect', () => {
    if (joined) location.reload();
  });

  socket.on('disconnect', () => {
    if (joined && !leaving) showBanner('Connessione persa, riconnessione in corso...', 0);
  });

  /* Torna al menu: chiude la connessione (il personaggio esce dalla stanza) e ricarica la pagina */
  function leaveToMenu() {
    if (!joined || leaving) return;
    leaving = true;
    socket.disconnect();
    location.reload();
  }
  $('menuBtn').addEventListener('click', leaveToMenu);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') leaveToMenu(); });

  /* Profilo del giocatore più vicino (tasto E): mini finestra con nickname, record, oggetti */
  const profileEl = $('profileCard');
  let profileTimer = null;
  const PROFILE_RANGE = 260;

  function hideProfile() {
    profileEl.hidden = true;
    clearTimeout(profileTimer);
  }

  function nearestPlayerId() {
    const now = Date.now();
    const renderServerTime = clockOffset === null ? now - INTERP_DELAY : now - clockOffset - INTERP_DELAY;
    let best = null;
    let bestD = PROFILE_RANGE;
    for (const [id] of roster) {
      if (id === myId) continue;
      const pos = remotePos(id, renderServerTime);
      if (!pos) continue;
      const d = Math.hypot(pos.x - renderX, pos.y - renderY);
      if (d < bestD) { bestD = d; best = id; }
    }
    return best;
  }

  function showProfile(profile) {
    profileEl.textContent = '';
    const title = document.createElement('div');
    title.className = 'profile-name';
    title.textContent = profile.nickname;
    const rows = [
      ['Altezza migliore', `${profile.best} m`],
      ['Pestate', String(profile.stomps)],
      ['Checkpoint', String(profile.checkpoints)],
      ['Oggetti', profile.items.length ? profile.items.join(', ') : 'nessuno'],
    ];
    profileEl.append(title);
    for (const [k, v] of rows) {
      const row = document.createElement('div');
      row.className = 'profile-row';
      const kEl = document.createElement('span');
      kEl.textContent = k;
      const vEl = document.createElement('b');
      vEl.textContent = v;
      row.append(kEl, vEl);
      profileEl.append(row);
    }
    profileEl.hidden = false;
    clearTimeout(profileTimer);
    profileTimer = setTimeout(hideProfile, 9000);
  }

  function toggleProfile() {
    if (!profileEl.hidden) { hideProfile(); return; }
    const id = nearestPlayerId();
    if (!id) {
      showBanner('Nessun giocatore vicino', 1500);
      return;
    }
    socket.emit('profile', id, (res) => {
      if (res && res.ok) showProfile(res.profile);
      else showBanner('Profilo non disponibile', 1500);
    });
  }

  /* Timer del prossimo crollo (in alto a sinistra) */
  let resetAtLocal = 0;
  const resetTimerEl = $('resetTimer');
  function setResetAt(next, serverNow) {
    if (!next) return;
    resetAtLocal = Date.now() + (next - (serverNow || Date.now()));
  }
  function renderResetTimer() {
    if (!resetTimerEl) return;
    if (!resetAtLocal || !joined) { resetTimerEl.hidden = true; return; }
    const sec = Math.max(0, Math.ceil((resetAtLocal - Date.now()) / 1000));
    const mm = String(Math.floor(sec / 60)).padStart(2, '0');
    const ss = String(sec % 60).padStart(2, '0');
    resetTimerEl.hidden = false;
    resetTimerEl.textContent = `CROLLO TRA ${mm}:${ss}`;
  }
  setInterval(renderResetTimer, 250);

  /* Crollo periodico: avviso, poi scossa, flash e polvere */
  socket.on('resetSoon', () => {
    window.ClimbAudio.sfx('warn');
    showBanner('ATTENZIONE: LA TORRE CROLLA TRA 5 SECONDI!', 4200);
    shake = Math.max(shake, 4);
  });

  socket.on('reset', (d) => {
    window.ClimbAudio.sfx('crash');
    setResetAt(d && d.next, d && d.serverNow);
    showBanner('CROLLO! CLASSIFICA AZZERATA', 3600);
    shake = Math.max(shake, 22);
    flash = 0.85;
    record = { name: '', meters: 0 };
    renderRecord();
    const w = canvas.width / dpr / camScale;
    const h = canvas.height / dpr / camScale;
    for (let i = 0; i < 8; i++) {
      burst(camX + Math.random() * w, camY + Math.random() * h, 'dust', 16);
    }
    burst(renderX + PLAYER_W / 2, renderY + PLAYER_H, 'spark', 14);
    setTimeout(() => burst(renderX + PLAYER_W / 2, renderY + PLAYER_H, 'dust', 24), 300);
  });

  socket.on('joined', (data) => {
    myId = data.id;
    window.ClimbAudio.music('game');
    if (data.stats) Object.assign(stats, data.stats);
    gen = new S.LevelGen(data.seed);
    roster.clear();
    for (const r of data.roster) roster.set(r.id, r);
    hall = data.hall || [];
    record = data.record || record;
    setResetAt(data.nextResetAt, data.serverNow);

    Object.assign(me, S.spawnState(data.slot, gen), { x: data.spawn.x, y: data.spawn.y, attacked: false });
    prevPos = { x: me.x, y: me.y };
    renderX = me.x;
    renderY = me.y;
    errX = errY = 0;
    myMaxH = 0;

    inputSeq = 0;
    history.length = 0;
    history.push({ seq: 0, input: { dir: 0, jump: false, attack: false }, s: S.stateOf(me) });

    joined = true;
    loginScreen.hidden = true;
    gameScreen.hidden = false;
    renderHall();

    resizeCanvas();
    startLoop();
  });

  socket.on('roster', (list) => {
    roster.clear();
    for (const r of list) roster.set(r.id, r);
  });

  socket.on('state', (snap) => {
    const sample = Date.now() - snap.t;
    clockOffset = clockOffset === null ? sample : clockOffset + (sample - clockOffset) * 0.05;

    const pos = new Map();
    for (const [id, x, y, vx, vy, og, ice, cp, ack, meters, stun, atkCd, face, inv] of snap.p) {
      pos.set(id, { x, y, vx, vy, onGround: og === 1, onIce: ice === 1, cp, ack, meters, stun, atkCd, face, inv });
      remoteState.set(id, { vx, vy, onGround: og === 1, onIce: ice === 1, meters, stun, face, inv });

      if (id !== myId && joined) {
        setGroundTransition(getVisual(id), og === 1, vy, x, y, false);
      }
      if (id === myId && meters > stats.best) {
        stats.best = meters;
        progressChanged();
      }
    }

    snapshots.push({ t: snap.t, pos });
    while (snapshots.length > 2 && snap.t - snapshots[0].t > BUFFER_MS) {
      snapshots.shift();
    }

    if (joined) {
      // Impulsi ancora da applicare al nostro personaggio
      const kbMap = new Map();
      for (const [id, seq, vx, vy, stun] of snap.kb || []) {
        if (id === myId) kbMap.set(seq, { vx, vy, stun });
      }
      const mine = pos.get(myId);
      if (mine) reconcile(mine.ack, mine, kbMap);
    }
  });

  socket.on('event', (ev) => {
    const A = window.ClimbAudio;
    if (ev.type === 'milestone') A.sfx('milestone');
    else if (ev.type === 'record') A.sfx('record');
    else if (ev.type === 'checkpoint') A.sfx('checkpoint');
    if (ev.type === 'milestone') {
      showBanner(`${ev.name} ha superato ${ev.meters} m!`, 2600);
    } else if (ev.type === 'record') {
      record = { name: ev.name, meters: ev.meters };
      showBanner(`🏆 Nuovo record della stanza: ${ev.name} · ${ev.meters} m`, 3200);
    } else if (ev.type === 'checkpoint') {
      showBanner(`Checkpoint salvato a ${ev.meters} m`, 1800);
      stats.checkpoints += 1;
      progressChanged();
    }
    renderRecord();
  });

  socket.on('fx', (ev) => {
    if (ev.type === 'hit') window.ClimbAudio.sfx('hit');
    else if (ev.type === 'stomp') window.ClimbAudio.sfx('stomp');
    if (ev.type === 'shove') {
      if (ev.id === myId) return;               // il nostro fendente è già mostrato in locale
      spawnFx('slash', ev.x, ev.y, ev.face);
    } else if (ev.type === 'hit') {
      spawnFx('hit', ev.x, ev.y, 1);
      burst(ev.x, ev.y, 'spark', 8);
    } else if (ev.type === 'stomp') {
      spawnFx('stomp', ev.x, ev.y, 1);
      burst(ev.x, ev.y, 'dust', 8);
      if (ev.by === myId) {
        stats.stomps += 1;
        progressChanged();
      }
    }
  });

  // Record della stanza aggiornato in tempo reale mentre qualcuno lo supera
  socket.on('recordLive', (r) => {
    record = { name: r.name, meters: r.meters };
    renderRecord();
  });

  socket.on('hall', (list) => {
    hall = list;
    renderHall();
  });

  socket.on('chat', (m) => {
    if (m.id !== myId) window.ClimbAudio.sfx('chat');
    appendChat(m);
    bubbles.set(m.id, { text: m.text, until: performance.now() + BUBBLE_MS });
  });

  socket.on('emote', (m) => {
    window.ClimbAudio.sfx('emote');
    emotes.set(m.id, { e: m.e, t0: performance.now() });
  });

  /* ═══ Input ═══ */
  const KEY_MAP = {
    ArrowLeft: 'left', KeyA: 'left',
    ArrowRight: 'right', KeyD: 'right',
    ArrowUp: 'jump', KeyW: 'jump', Space: 'jump',
    KeyF: 'attack', KeyJ: 'attack',
  };
  const EMOTE_KEYS = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3, Numpad1: 0, Numpad2: 1, Numpad3: 2, Numpad4: 3 };

  function currentDir() {
    const left = keys.left || touchKeys.left;
    const right = keys.right || touchKeys.right;
    return (right ? 1 : 0) - (left ? 1 : 0);
  }

  function pressJump() {
    jumpQueued = true;
    window.ClimbAudio.sfx('jump');
  }

  function pressAttack() {
    attackQueued = true;
    window.ClimbAudio.sfx('slash');
  }

  function openChat() {
    chatOpen = true;
    keys.left = keys.right = false;
    touchKeys.left = touchKeys.right = false;
    jumpQueued = false;
    chatInput.hidden = false;
    chatInput.focus();
  }

  function closeChat() {
    chatOpen = false;
    chatInput.value = '';
    chatInput.hidden = true;
    chatInput.blur();
  }

  chatInput.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      const text = chatInput.value.trim();
      if (text) socket.emit('chat', { text });
      closeChat();
    } else if (e.key === 'Escape') {
      closeChat();
    }
  });

  window.addEventListener('keydown', (e) => {
    if (!joined || chatOpen) return;

    if (e.code === 'KeyE' && !e.repeat) {
      toggleProfile();
      return;
    }

    if (e.code === 'Enter') {
      e.preventDefault();
      openChat();
      return;
    }
    if (e.code in EMOTE_KEYS) {
      socket.emit('emote', { e: EMOTE_KEYS[e.code] });
      return;
    }

    const action = KEY_MAP[e.code];
    if (!action) return;
    e.preventDefault();
    if (action === 'jump') {
      if (!e.repeat) pressJump();
    } else if (action === 'attack') {
      if (!e.repeat) pressAttack();
    } else {
      keys[action] = true;
    }
  });

  window.addEventListener('keyup', (e) => {
    const action = KEY_MAP[e.code];
    if (!action || !joined) return;
    if (action === 'left' || action === 'right') keys[action] = false;
  });

  window.addEventListener('blur', () => {
    keys.left = keys.right = false;
    touchKeys.left = touchKeys.right = false;
    jumpQueued = false;
    attackQueued = false;
  });

  document.querySelectorAll('[data-touch]').forEach((btn) => {
    const action = btn.dataset.touch;
    const press = (e) => {
      e.preventDefault();
      if (action === 'jump') pressJump();
      else if (action === 'attack') pressAttack();
      else touchKeys[action] = true;
      btn.classList.add('active');
    };
    const release = (e) => {
      e.preventDefault();
      if (action === 'left' || action === 'right') touchKeys[action] = false;
      btn.classList.remove('active');
    };
    btn.addEventListener('pointerdown', press);
    btn.addEventListener('pointerup', release);
    btn.addEventListener('pointerleave', release);
    btn.addEventListener('pointercancel', release);
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
  });

  /* ═══ Predizione e riconciliazione ═══ */
  function sameState(a, b) {
    return a.x === b.x && a.y === b.y && a.vx === b.vx && a.vy === b.vy &&
      a.onGround === b.onGround && a.onIce === b.onIce && a.cp === b.cp &&
      a.stun === b.stun && a.atkCd === b.atkCd && a.face === b.face;
  }

  function onLocalRespawn() {
    showBanner('Caduta! Torni all\'ultimo checkpoint', 1500);
    shake = Math.max(shake, 6);
  }

  /* Un passo di predizione locale. */
  function stepLocal() {
    const dir = currentDir();
    const jump = jumpQueued;
    const attack = attackQueued;
    jumpQueued = false;
    attackQueued = false;
    const input = { dir, jump, attack };

    prevPos.x = me.x;
    prevPos.y = me.y;
    S.simulate(me, input, gen, (ev) => {
      if (ev.type === 'respawn') onLocalRespawn();
    });

    setGroundTransition(getVisual(myId), me.onGround, me.vy, me.x, me.y, true);
    if (me.attacked) spawnFx('slash', me.x + PLAYER_W / 2 + me.face * (PLAYER_W / 2), me.y + PLAYER_H / 2, me.face);
    myMaxH = Math.max(myMaxH, -(me.y + PLAYER_H));

    inputSeq += 1;
    history.push({ seq: inputSeq, input, s: S.stateOf(me) });
    if (history.length > HISTORY_MAX) history.shift();

    socket.emit('input', { seq: inputSeq, dir, jump, attack });
  }

  /* Riconciliazione: il server ha simulato fino a `ack`. Si riparte dal suo stato e si
     rigiocano gli input successivi, applicando anche gli impulsi (spinte) previsti per
     ogni passo. Così la spinta compare nello stesso passo sia qui sia sul server. */
  function reconcile(ack, s, kbMap) {
    const idx = history.findIndex((h) => h.seq === ack);
    if (idx < 0) return;
    if (kbMap.size === 0 && sameState(history[idx].s, s)) return;

    const shownX = renderX;
    const shownY = renderY;

    Object.assign(me, {
      x: s.x, y: s.y, vx: s.vx, vy: s.vy, onGround: s.onGround, onIce: s.onIce,
      cp: s.cp, stun: s.stun, atkCd: s.atkCd, face: s.face,
    });
    history[idx] = { seq: ack, input: history[idx].input, s: S.stateOf(me) };

    for (let j = idx + 1; j < history.length; j++) {
      let input = history[j].input;
      const kb = kbMap.get(history[j].seq);
      if (kb) input = { ...input, kb };
      me.attacked = false;
      S.simulate(me, input, gen, null);
      history[j] = { seq: history[j].seq, input, s: S.stateOf(me) };
    }

    prevPos.x = me.x;
    prevPos.y = me.y;

    const dx = shownX - me.x;
    const dy = shownY - me.y;
    if (Math.hypot(dx, dy) > RECONCILE_SNAP) {
      errX = 0;
      errY = 0;
    } else {
      errX = dx;
      errY = dy;
    }
  }

  /* ═══ Interpolazione dei remoti sul tempo del server ═══ */
  function remotePos(id, renderServerTime) {
    const n = snapshots.length;
    if (n === 0) return null;

    if (renderServerTime <= snapshots[0].t) {
      return snapshots[0].pos.get(id) || null;
    }

    for (let i = n - 1; i >= 0; i--) {
      const a = snapshots[i];
      if (a.t <= renderServerTime) {
        const b = snapshots[i + 1];
        const pa = a.pos.get(id);
        if (!b) return pa || null;
        const pb = b.pos.get(id);
        if (!pa || !pb) return pa || pb || null;
        const span = b.t - a.t;
        const f = span > 0 ? clamp((renderServerTime - a.t) / span, 0, 1) : 1;
        return { x: lerp(pa.x, pb.x, f), y: lerp(pa.y, pb.y, f) };
      }
    }
    return snapshots[0].pos.get(id) || null;
  }

  /* ═══ Animazione: legata allo stato fisico ═══ */
  function getVisual(id) {
    let v = visuals.get(id);
    if (!v) {
      v = {
        inited: false,
        lastOg: true,
        lastVy: 0,
        mode: 'idle',
        airT: 0,
        fallT: 0,
        landT: 0,
        walkT: 0,
        breathT: 0,
        facing: 1,
        key: 'idle',
        frame: 0,
      };
      visuals.set(id, v);
    }
    return v;
  }

  function setGroundTransition(v, og, vy, x, y, isLocal) {
    if (!v.inited) {
      v.inited = true;
      v.lastOg = og;
      v.lastVy = vy;
      v.mode = og ? 'idle' : 'salto';
      return;
    }

    if (v.lastOg && !og) {
      v.mode = 'salto';
      v.airT = 0;
      v.fallT = 0;
      if (vy < 0) burst(x + PLAYER_W / 2, y + PLAYER_H, 'dust', 6);
    } else if (!v.lastOg && og) {
      v.mode = 'atterraggio';
      v.landT = 0;
      const fall = v.lastVy;
      if (fall > 220) {
        burst(x + PLAYER_W / 2, y + PLAYER_H, 'dust', Math.min(14, 4 + fall / 60));
        if (isLocal) shake = Math.max(shake, clamp(fall / 120, 2, 9));
        if (isLocal) window.ClimbAudio.sfx('land');
      }
    }

    if (!og && v.lastVy > 300 && vy < -600) {
      burst(x + PLAYER_W / 2, y + PLAYER_H, 'spark', 10);
    }

    v.lastOg = og;
    v.lastVy = vy;
  }

  /* Avanza l'animazione: sceglie il frame dal mode corrente. */
  function tickVisual(v, dt, vx, vy, og) {
    if (Math.abs(vx) > 20) v.facing = vx > 0 ? 1 : -1;

    if (v.mode === 'salto' && og) {
      v.mode = 'atterraggio';
      v.landT = 0;
    }

    if (v.mode === 'salto') {
      v.key = 'salto';
      if (vy < 0) {
        v.airT += dt;
        v.frame = v.airT < TAKEOFF_S ? 0 : 1 + Math.min(2, Math.floor((v.airT - TAKEOFF_S) / 0.13));
      } else {
        v.fallT += dt;
        v.frame = 4 + Math.min(2, Math.floor(v.fallT / 0.14));
      }
    } else if (v.mode === 'atterraggio') {
      v.key = 'salto';
      v.landT += dt;
      v.frame = v.landT * 1000 < LAND_FRAME_MS ? 7 : 8;
      if (v.landT > 0.2) v.mode = Math.abs(vx) > 20 ? 'corsa' : 'idle';
    } else if (Math.abs(vx) > 20 && og) {
      v.mode = 'corsa';
      v.key = 'corsa';
      v.walkT += dt * clamp(Math.abs(vx) / SPEED, 0.6, 1.6);
      v.frame = Math.floor((v.walkT * 1000) / WALK_FRAME_MS) % 4;
    } else {
      v.mode = 'idle';
      v.key = 'idle';
      v.walkT = 0;
      v.breathT += dt;
      v.frame = 0;
    }
  }

  /* ═══ Effetti pixel ═══ */
  function spawnFx(type, x, y, face) {
    const dur = type === 'slash' ? FX_SLASH_MS : type === 'hit' ? FX_HIT_MS : FX_STOMP_MS;
    fxList.push({ type, x, y, face, t0: performance.now(), dur });
    if (fxList.length > 40) fxList.shift();
  }

  function drawFx(now) {
    for (let i = fxList.length - 1; i >= 0; i--) {
      const f = fxList[i];
      const age = now - f.t0;
      if (age >= f.dur) {
        fxList.splice(i, 1);
        continue;
      }
      const sheet = f.type === 'slash' ? sprites.fxSlash : f.type === 'hit' ? sprites.fxHit : sprites.fxStomp;
      if (!sheet) continue;
      const frame = Math.min(2, Math.floor((age / f.dur) * 3));
      const size = 16 * FX_SCALE;
      ctx.save();
      ctx.translate(f.x, f.y);
      if (f.type === 'slash' && f.face < 0) ctx.scale(-1, 1);
      drawFrame(ctx, sheet, frame, -size / 2, -size / 2, size, size, 16, 16);
      ctx.restore();
    }
  }

  /* Stelline sopra la testa di chi è stordito */
  function drawStunStars(cx, topY, now) {
    if (!sprites.fxStar) return;
    const size = 8 * 3;
    for (let k = 0; k < 2; k++) {
      const a = now / 300 + k * Math.PI;
      const x = cx + Math.cos(a) * 18;
      const y = topY - 14 + Math.sin(a) * 4;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(sprites.fxStar, x - size / 2, y - size / 2, size, size);
    }
  }

  /* ═══ Particelle ═══ */
  function burst(x, y, kind, n) {
    for (let i = 0; i < n && particles.length < MAX_PARTICLES; i++) {
      const a = Math.random() * Math.PI;
      const sp = 40 + Math.random() * 90;
      if (kind === 'dust') {
        particles.push({ kind, x, y, vx: Math.cos(a) * sp * (Math.random() < 0.5 ? -1 : 1), vy: -Math.sin(a) * sp * 0.6, g: 220, life: 0.45, max: 0.45, size: 3 + Math.random() * 3 });
      } else if (kind === 'spark') {
        particles.push({ kind, x, y, vx: (Math.random() * 2 - 1) * 180, vy: -120 - Math.random() * 200, g: 500, life: 0.6, max: 0.6, size: 2 + Math.random() * 2 });
      } else {
        particles.push({ kind, x, y, vx: (Math.random() * 2 - 1) * 60, vy: -40 - Math.random() * 60, g: 260, life: 0.5, max: 0.5, size: 2 + Math.random() * 2 });
      }
    }
  }

  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        particles.splice(i, 1);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += p.g * dt;
    }
  }

  function drawParticles() {
    for (const p of particles) {
      const a = clamp(p.life / p.max, 0, 1);
      if (p.kind === 'dust') {
        ctx.fillStyle = `rgba(255, 248, 231, ${a * 0.85})`;
        ctx.strokeStyle = `rgba(43, 26, 12, ${a * 0.35})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      } else if (p.kind === 'spark') {
        ctx.fillStyle = `rgba(255, 214, 10, ${a})`;
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      } else {
        ctx.fillStyle = `rgba(143, 227, 255, ${a})`;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y - p.size);
        ctx.lineTo(p.x + p.size * 0.7, p.y);
        ctx.lineTo(p.x, p.y + p.size);
        ctx.lineTo(p.x - p.size * 0.7, p.y);
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  /* ═══ Camera ═══ */
  function updateCamera(dt, tx0, ty0, vx) {
    const cssW = canvas.width / dpr;
    const cssH = canvas.height / dpr;
    camScale = cssH / VIEW_H;
    const visW = cssW / camScale;

    const look = clamp(vx * 0.25, -CAM_LOOKAHEAD, CAM_LOOKAHEAD);
    const tx = tx0 + PLAYER_W / 2 - visW / 2 + look;
    const ty = ty0 + PLAYER_H / 2 - VIEW_H / 2;

    if (!camInit) {
      camX = tx;
      camY = ty;
      camInit = true;
    }
    const k = 1 - Math.exp(-dt * CAM_FOLLOW);
    camX += (tx - camX) * k;
    camY += (ty - camY) * k;
  }

  /* ═══════════════════════════════════════════════════════════
     RENDERING
     ═══════════════════════════════════════════════════════════ */
  function resizeCanvas() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(window.innerWidth * dpr);
    canvas.height = Math.round(window.innerHeight * dpr);
  }
  window.addEventListener('resize', resizeCanvas);

  function roundRectPath(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function skyAt(m) {
    let i = 0;
    while (i < SKY_STOPS.length - 2 && m > SKY_STOPS[i + 1].m) i++;
    const a = SKY_STOPS[i];
    const b = SKY_STOPS[i + 1];
    const t = clamp((m - a.m) / (b.m - a.m), 0, 1);
    const mix = (p, q) => p.map((v, k) => lerp(v, q[k], t));
    const rgb = (c) => `rgb(${c.map((v) => Math.round(v)).join(',')})`;
    return {
      top: rgb(mix(a.top, b.top)),
      bot: rgb(mix(a.bot, b.bot)),
      hill: rgb(mix(a.hill, b.hill)),
      hill2: rgb(mix(a.hill2, b.hill2)),
      night: clamp((m - 900) / 1200, 0, 1),
    };
  }

  function drawSky(w, h, meters, now) {
    const sky = skyAt(meters);
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, sky.top);
    g.addColorStop(0.62, sky.bot);
    g.addColorStop(1, sky.bot);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    if (sky.night > 0.02) {
      ctx.fillStyle = '#ffffff';
      for (const s of stars) {
        const tw = 0.55 + 0.45 * Math.sin(now / 600 + s.ph);
        ctx.globalAlpha = sky.night * tw * 0.9;
        ctx.beginPath();
        ctx.arc(s.x * w, s.y * h, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    for (let layer = 0; layer < 2; layer++) {
      const base = h * (0.7 + layer * 0.14);
      const amp = 56 - layer * 18;
      const off = -camX * (0.04 + layer * 0.05);
      ctx.fillStyle = layer === 0 ? sky.hill2 : sky.hill;
      ctx.beginPath();
      ctx.moveTo(0, h);
      for (let x = 0; x <= w + 12; x += 12) {
        const y = base - amp * (0.5 + 0.5 * Math.sin((x - off) * 0.006 + layer * 2.3)) - 14 * Math.sin((x - off) * 0.014);
        ctx.lineTo(x, y);
      }
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fill();
    }

    if (sprites.nuvola) {
      for (const d of decor) {
        const sx = d.x * w;
        const sy = ((d.y * h + camY * camScale * 0.12) % h + h) % h;
        const k = SPRITE_SCALE * d.s * 0.5;
        ctx.imageSmoothingEnabled = false;
        ctx.globalAlpha = 0.5 + 0.35 * (1 - sky.night);
        ctx.drawImage(sprites.nuvola, NUVOLA_SRC.x, NUVOLA_SRC.y, NUVOLA_SRC.w, NUVOLA_SRC.h,
          sx, sy, NUVOLA_SRC.w * k, NUVOLA_SRC.h * k);
      }
      ctx.globalAlpha = 1;
    }
  }

  function drawCloud(img, x, y, w) {
    const capDst = NUVOLA_CAP * SPRITE_SCALE;
    const midDst = Math.max(0, w - capDst * 2);
    const srcH = NUVOLA_SRC.h;

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, NUVOLA_SRC.x, NUVOLA_SRC.y, NUVOLA_CAP, srcH, x, y, capDst, CLOUD_H);
    ctx.drawImage(img, NUVOLA_SRC.x + NUVOLA_CAP, NUVOLA_SRC.y, NUVOLA_SRC.w - NUVOLA_CAP * 2, srcH,
      x + capDst, y, midDst, CLOUD_H);
    ctx.drawImage(img, NUVOLA_SRC.x + NUVOLA_SRC.w - NUVOLA_CAP, NUVOLA_SRC.y, NUVOLA_CAP, srcH,
      x + w - capDst, y, capDst, CLOUD_H);
  }

  const ROW_TINT = { cloud: null, bounce: '#ff7ab6', ice: '#8fe3ff', gold: '#ffd60a', wind: '#7fe0a0', storm: '#6f7390', mini: '#e8f6ff' };

  function drawRow(row) {
    if (row.kind === 'ground') {
      ctx.fillStyle = '#c98b4e';
      ctx.fillRect(row.x, row.y, row.w, 40);
      ctx.fillStyle = '#7bd35a';
      ctx.fillRect(row.x, row.y, row.w, 12);
      ctx.fillStyle = INK;
      ctx.fillRect(row.x, row.y, row.w, 3);
      return;
    }

    const img = getTinted('nuvola', ROW_TINT[row.kind]);
    if (img) drawCloud(img, row.x, row.y, row.w);
  }

  /* Linee di altitudine ogni 100 m: a metro m il piede sta a y = -m * PX_PER_METER */
  function drawAltitudeMarks(left, right) {
    const step = 100 * PX_PER_METER;
    ctx.save();
    ctx.setLineDash([8, 10]);
    ctx.strokeStyle = 'rgba(43, 26, 12, 0.22)';
    ctx.lineWidth = 2;
    ctx.font = `10px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = 'rgba(43, 26, 12, 0.55)';
    const top = camY - 60;
    const bottom = camY + VIEW_H + 60;
    for (let y = Math.ceil(top / step) * step; y <= bottom; y += step) {
      if (y > 0) break;
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
      ctx.stroke();
      ctx.fillText(`${Math.round(-y / PX_PER_METER)} m`, left + 10, y - 4);
    }
    ctx.restore();
  }

  function drawTag(cx, bottomY, text, bg, fg, alpha = 1) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = `8px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const w = ctx.measureText(text).width + 12;
    const h = 14;
    const x0 = cx - w / 2;
    const y0 = bottomY - h;

    ctx.fillStyle = INK;
    roundRectPath(x0 - 2, y0 - 2, w + 4, h + 4, 11);
    ctx.fill();

    ctx.fillStyle = bg;
    roundRectPath(x0, y0, w, h, 9);
    ctx.fill();

    ctx.fillStyle = fg;
    ctx.fillText(text, cx, y0 + h / 2 + 1);
    ctx.restore();
  }

  function drawBubble(cx, topY, text) {
    ctx.save();
    ctx.font = `10px ${FONT}`;
    const maxW = 220;
    const w = Math.min(maxW, ctx.measureText(text).width + 20);
    const h = 26;
    const x0 = cx - w / 2;
    const y0 = topY - h - 12;

    ctx.fillStyle = INK;
    roundRectPath(x0 - 2, y0 - 2, w + 4, h + 4, 12);
    ctx.fill();
    ctx.fillStyle = '#fff8e7';
    roundRectPath(x0, y0, w, h, 10);
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(cx - 5, y0 + h);
    ctx.lineTo(cx, y0 + h + 7);
    ctx.lineTo(cx + 5, y0 + h);
    ctx.closePath();
    ctx.fillStyle = INK;
    ctx.fill();

    ctx.fillStyle = INK;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.beginPath();
    ctx.rect(x0, y0, w, h);
    ctx.save();
    ctx.clip();
    ctx.fillText(text, cx, y0 + h / 2 + 1);
    ctx.restore();
    ctx.restore();
  }

  /* Personaggio: ombra, sprite ancorato ai piedi, stordimento, lampeggio, nome, fumetto, emote */
  function drawPlayer(x, y, color, name, isMe, id, v, st, now, skinKey, cos) {
    const cx = x + PLAYER_W / 2;
    const feetY = y + PLAYER_H;
    const drawW = CELL_W * SPRITE_SCALE;
    const drawH = CELL_H * SPRITE_SCALE;
    const sheet = getTinted(v.key, TINT_PLAYER ? color : null);
    if (!sheet) return;

    // Invulnerabilità dopo un colpo: lampeggio
    const blink = st && st.inv > 0 ? (Math.floor(now / 70) % 2 === 0 ? 0.35 : 1) : 1;

    const inAir = v.mode === 'salto';
    const shadowK = inAir ? 0.7 : 1;
    ctx.fillStyle = 'rgba(43, 26, 12, 0.25)';
    ctx.beginPath();
    ctx.ellipse(cx, feetY + 2, PLAYER_W * 0.4 * shadowK, 4 * shadowK, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.globalAlpha = blink;
    ctx.translate(cx, feetY);
    ctx.scale(v.facing, 1);
    if (v.mode === 'idle') {
      ctx.scale(1, 1 + Math.sin(v.breathT * 2.6) * 0.018);
      drawFrame(ctx, sheet, 0, -drawW / 2, -drawH, drawW, drawH);
    } else {
      drawFrame(ctx, sheet, v.frame, -drawW / 2, -drawH, drawW, drawH);
    }
    drawSkin(ctx, skinKey, -drawW / 2, -drawH, SPRITE_SCALE);
    const warp = itemWarp(v.mode === 'idle' ? 'idle' : v.key, v.mode === 'idle' ? 0 : v.frame);
    Cos.drawEquipped(ctx, cos, -drawW / 2, -drawH, SPRITE_SCALE, warp);
    ctx.restore();

    if (st && st.stun > 0) drawStunStars(cx, y, now);

    // Nome: sempre il proprio, quello degli altri compare solo se sei vicino e sfuma allontanandoti
    const dist = isMe ? 0 : Math.hypot(x - renderX, y - renderY);
    const nameAlpha = isMe ? 0.9 : clamp((NAME_FAR - dist) / (NAME_FAR - NAME_NEAR), 0, 1);
    if (nameAlpha > 0) drawTag(cx, y - 6, name, isMe ? '#ffd60a' : '#ffffff', INK, nameAlpha);

    const bubble = bubbles.get(id);
    if (bubble && now < bubble.until) drawBubble(cx, y - 26, bubble.text);

    const em = emotes.get(id);
    if (em) {
      const age = (now - em.t0) / EMOTE_MS;
      if (age < 1) {
        drawEmoteSprite(ctx, em.e, cx, y - 46 - age * 34, 1 - age * age);
      } else {
        emotes.delete(id);
      }
    }
  }

  function render(now) {
    const cssW = canvas.width / dpr;
    const cssH = canvas.height / dpr;
    const altitude = Math.max(0, -(camY + VIEW_H / 2) / PX_PER_METER);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawSky(cssW, cssH, altitude, now);

    const sx = (Math.random() * 2 - 1) * shake;
    const sy = (Math.random() * 2 - 1) * shake;
    ctx.setTransform(
      dpr * camScale, 0, 0, dpr * camScale,
      (-camX + sx) * camScale * dpr, (-camY + sy) * camScale * dpr
    );

    drawAltitudeMarks(camX, camX + cssW / camScale);

    const rows = gen.rowsBetween(camY - 200, camY + VIEW_H + 200);
    for (const row of rows) drawRow(row);

    drawParticles();

    const renderServerTime = clockOffset === null
      ? Date.now() - INTERP_DELAY
      : Date.now() - clockOffset - INTERP_DELAY;

    for (const [id, info] of roster) {
      if (id === myId) continue;
      const pos = remotePos(id, renderServerTime);
      if (!pos) continue;
      const rs = remoteState.get(id) || { vx: 0, vy: 0, onGround: true, onIce: false, stun: 0, inv: 0 };
      const v = getVisual(id);
      tickVisual(v, frameDt, rs.vx, rs.vy, rs.onGround);
      if (rs.onGround && rs.onIce && Math.abs(rs.vx) > 80 && Math.random() < 0.35) {
        burst(pos.x + PLAYER_W / 2, pos.y + PLAYER_H, 'ice', 1);
      }
      drawPlayer(pos.x, pos.y, info.color, info.name, false, id, v, rs, now, info.skin, info.cos);
    }

    const myInfo = roster.get(myId) || { color: '#ffb703', name: 'Tu', skin: '' };
    const v = getVisual(myId);
    tickVisual(v, frameDt, me.vx, me.vy, me.onGround);
    if (me.onGround && me.onIce && Math.abs(me.vx) > 80 && Math.random() < 0.35) {
      burst(renderX + PLAYER_W / 2, renderY + PLAYER_H, 'ice', 1);
    }
    const mySt = { stun: me.stun, inv: (remoteState.get(myId) || {}).inv || 0 };
    if (joined) window.ClimbAudio.setTempo(Math.max(0, -renderY / PX_PER_METER));
    drawPlayer(renderX, renderY, myInfo.color, myInfo.name, true, myId, v, mySt, now, selectedSkin, selCos);

    drawFx(now);
    updateParticles(frameDt);

    if (flash > 0) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = `rgba(255, 255, 255, ${flash.toFixed(3)})`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.restore();
    }
  }

  /* ═══ Classifica, record, hall, altitudine ═══ */
  function renderLeaderboard() {
    if (!joined) return;
    const entries = [];
    for (const [id, info] of roster) {
      const rs = remoteState.get(id);
      entries.push({ id, name: info.name, color: info.color, meters: rs ? rs.meters : 0 });
    }
    entries.sort((a, b) => b.meters - a.meters);

    const rows = entries.slice(0, 10).map((e, i) => {
      const li = document.createElement('li');
      if (e.id === myId) li.classList.add('me');

      const rank = document.createElement('span');
      rank.className = 'rank';
      rank.textContent = String(i + 1);

      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = e.color;

      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = e.name;

      const m = document.createElement('span');
      m.className = 'pct';
      m.textContent = `${e.meters} m`;

      li.append(rank, dot, name, m);
      return li;
    });
    leaderboardEl.replaceChildren(...rows);
  }

  function renderRecord() {
    recordEl.textContent = record.meters > 0
      ? `Record stanza: ${record.name} · ${record.meters} m`
      : 'Nessun record ancora';
  }

  function renderHall() {
    const rows = hall.slice(0, 5).map((e) => {
      const li = document.createElement('li');
      const n = document.createElement('span');
      n.textContent = e.name;
      const m = document.createElement('span');
      m.className = 'hm';
      m.textContent = `${e.meters} m`;
      li.append(n, m);
      return li;
    });
    hallEl.replaceChildren(...rows);
    renderRecord();
  }

  function renderAltitude() {
    if (!joined) return;
    const m = Math.floor(Math.max(0, myMaxH) / PX_PER_METER);
    const now = Math.floor(Math.max(0, -(me.y + PLAYER_H)) / PX_PER_METER);
    altitudeEl.innerHTML = '';
    altitudeEl.append(`${now}`);
    const small = document.createElement('small');
    small.textContent = ` m · max ${m} m`;
    altitudeEl.append(small);
  }

  /* ═══ Banner ═══ */
  function showBanner(text, ms) {
    bannerEl.textContent = text;
    bannerEl.hidden = false;
    clearTimeout(bannerTimer);
    if (ms > 0) bannerTimer = setTimeout(() => { bannerEl.hidden = true; }, ms);
  }

  /* ═══ Chat ═══ */
  function appendChat(m) {
    const li = document.createElement('li');
    const who = document.createElement('span');
    who.className = 'who';
    who.style.color = m.color;
    who.textContent = `${m.name}: `;
    const txt = document.createElement('span');
    txt.textContent = m.text;
    li.append(who, txt);
    chatLogEl.append(li);
    while (chatLogEl.children.length > CHAT_LOG_MAX) chatLogEl.firstElementChild.remove();
  }

  /* ═══ Loop principale (60 fps) ═══ */
  let lastFrame = 0;
  let accumulator = 0;
  let lastBoardUpdate = 0;

  function frame(now) {
    const dt = Math.min(0.1, (now - lastFrame) / 1000);
    lastFrame = now;
    frameDt = dt;

    accumulator += dt;
    while (accumulator >= TICK) {
      stepLocal();
      accumulator -= TICK;
    }

    const alpha = accumulator / TICK;
    const baseX = lerp(prevPos.x, me.x, alpha);
    const baseY = lerp(prevPos.y, me.y, alpha);

    const decay = Math.exp(-dt * ERR_DECAY);
    errX *= decay;
    errY *= decay;
    renderX = baseX + errX;
    renderY = baseY + errY;

    shake = Math.max(0, shake - dt * 30);
    flash = Math.max(0, flash - dt * 1.6);
    updateCamera(dt, renderX, renderY, me.vx);
    render(now);

    if (now - lastBoardUpdate > 250) {
      lastBoardUpdate = now;
      renderLeaderboard();
      renderAltitude();
    }

    requestAnimationFrame(frame);
  }

  function startLoop() {
    if (gameStarted) return;
    gameStarted = true;
    lastFrame = performance.now();
    requestAnimationFrame(frame);
  }
})();
