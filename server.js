'use strict';

const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const S = require('./public/shared.js');
const Accounts = require('./accounts');
const { maskProfanity } = require('./profanity');

/* ═══ Configurazione ═══ */
const PORT = process.env.PORT || 3000;
const TICK_MS = Math.round(S.TICK * 1000);     // 50 ms = 20 Hz
const MAX_PLAYERS_PER_ROOM = 25;
const CATCHUP_QUEUE = 4;                       // coda input oltre questa soglia: recupero 2 passi per tick
const MAX_INPUT_AHEAD = 50;
const NAME_MAX = 14;
const CHAT_MAX = 60;
const CHAT_COOLDOWN_MS = 800;
const EMOTE_COOLDOWN_MS = 600;
const EMOTE_COUNT = 4;
const HALL_SIZE = 10;
const RESET_EVERY_MS = 10 * 60 * 1000; // ogni 10 minuti: classifica azzerata e crollo
const RESET_WARN_MS = 5000;            // avviso prima del crollo
let nextResetAt = Date.now() + RESET_EVERY_MS + RESET_WARN_MS; // momento del prossimo crollo (per il timer)
// Oggetti sbloccati con l'altezza migliore (metri), come in public/cosmetics.js
const COS_REQ = { cat: 350, hat: 1000, knight: 10000 };
const ITEM_NAMES = { cat: 'Orecchie di gatto', hat: 'Cappello rosso', knight: 'Elmo' };
const ALLOWED_COLORS = [
  '#ffb703', '#ff4d6d', '#06d6a0', '#118ab2', '#8338ec',
  '#fb5607', '#ff006e', '#3a86ff', '#ffd60a', '#73d2de',
];

// Skin indossabili (vuoto = nessuna). Devono corrispondere agli slot in index.html e a SKIN_FILES in game.js.
const ALLOWED_SKINS = ['', 'cat', 'hat', 'knight'];

const rooms = new Map();
let hall = [];        // classifica della sessione: { key, name, meters, room }

/* ═══ Utilità ═══ */
function sanitizeName(raw) {
  const cleaned = String(raw ?? '')
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .trim()
    .slice(0, NAME_MAX);
  return cleaned || 'Giocatore';
}

function sanitizeColor(raw) {
  return ALLOWED_COLORS.includes(raw) ? raw : ALLOWED_COLORS[0];
}

// Oggetti estetici per slot (devono corrispondere a SLOTS in public/cosmetics.js).
// Lo sblocco è verificato dal client: il server accetta solo ID noti.
const COS_SLOTS = [
  ['', 'cat'],
  ['', 'hat'],
  ['', 'knight'],
];
function unlockedFor(acc, id) {
  return !!id && COS_REQ[id] !== undefined && acc.best >= COS_REQ[id];
}

function sanitizeCos(raw, acc) {
  const arr = Array.isArray(raw) ? raw : [];
  return COS_SLOTS.map((ids, i) => (ids.includes(arr[i]) && (!arr[i] || unlockedFor(acc, arr[i])) ? arr[i] : ''));
}

// Chiave stabile del giocatore (generata dal client e salvata in locale): tiene la stessa riga
// in classifica anche quando si chiude il menu e si riapre una nuova connessione.
function sanitizePlayerKey(raw) {
  return typeof raw === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(raw) ? raw : '';
}

function sanitizeSkin(raw) {
  return ALLOWED_SKINS.includes(raw) ? raw : '';
}

function sanitizeText(raw, max) {
  return String(raw ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, max);
}


/* ═══ Stanze ═══ */
function createRoom() {
  const id = Math.random().toString(36).slice(2, 8);
  const seed = (Math.random() * 0xffffffff) >>> 0;
  return {
    id,
    seed,
    gen: new S.LevelGen(seed),
    players: new Map(),
    record: { name: '', meters: 0 },   // record della stanza (sessione corrente)
  };
}

function findOrCreateRoom() {
  for (const room of rooms.values()) {
    if (room.players.size < MAX_PLAYERS_PER_ROOM) return room;
  }
  const room = createRoom();
  rooms.set(room.id, room);
  return room;
}

function freeSlot(room) {
  const used = new Set([...room.players.values()].map((p) => p.slot));
  for (let i = 0; i < MAX_PLAYERS_PER_ROOM; i++) {
    if (!used.has(i)) return i;
  }
  return -1;
}

function getRoster(room) {
  return [...room.players.values()].map((p) => ({ id: p.id, name: p.name, color: p.color, skin: p.skin, cos: p.cos }));
}

function broadcastRoster(room) {
  io.to(room.id).emit('roster', getRoster(room));
}

/* ═══ Classifica della sessione ═══ */
function hallTop() {
  return hall.slice(0, HALL_SIZE).map((e) => ({ name: e.name, meters: e.meters, room: e.room }));
}

let hallEmitPending = false;
function updateHall(room, p) {
  const existing = hall.find((e) => e.key === p.key);
  if (existing) {
    existing.meters = Math.max(existing.meters, p.meters);
    existing.name = p.name;
    existing.room = room.id;
  } else {
    hall.push({ key: p.key, name: p.name, meters: p.meters, room: room.id });
  }
  hall.sort((a, b) => b.meters - a.meters);
  hall = hall.slice(0, HALL_SIZE * 3);
  // Emissione limitata: al massimo una volta ogni 500 ms
  if (!hallEmitPending) {
    hallEmitPending = true;
    setTimeout(() => {
      hallEmitPending = false;
      io.emit('hall', hallTop());
    }, 500);
  }
}

/* ═══ Eventi di gioco (traguardi, record, checkpoint) ═══ */
function onPlayerEvent(room, p, ev) {
  if (ev.type === 'checkpoint') {
    if (p.acc) Accounts.updateStats(p.acc, { checkpoints: p.cp });
    const meters = Math.floor(-room.gen.rows[ev.row].y / S.PX_PER_METER);
    io.to(p.id).emit('event', { type: 'checkpoint', meters });
  }
}

function afterMove(room, p) {
  const meters = Math.floor(Math.max(0, p.maxH) / S.PX_PER_METER);
  if (meters <= p.meters) return;
  p.meters = meters;
  if (p.acc) Accounts.updateStats(p.acc, { best: meters });

  const prevRecord = room.record.meters;
  if (meters > prevRecord) {
    room.record = { name: p.name, meters };
    io.to(room.id).emit('recordLive', { name: p.name, meters });
  }
  updateHall(room, p);

  while (p.msIdx < S.MILESTONES.length && meters >= S.MILESTONES[p.msIdx]) {
    const mark = S.MILESTONES[p.msIdx];
    p.msIdx += 1;
    const isRecord = room.record.name === p.name && meters > prevRecord;
    io.to(room.id).emit('event', {
      type: isRecord ? 'record' : 'milestone',
      name: p.name,
      color: p.color,
      meters: mark,
    });
  }
}

/* ═══ Combattimento (tutto deciso dal server) ═══
   Il colpo viene registrato come impulso per il passo successivo del colpito:
   il client lo riceve nello snapshot e lo riapplica nello stesso passo. */
function queueImpulse(victim, vx, vy, stun) {
  const seq = victim.ack + 1;                       // il prossimo passo che il server simulerà
  victim.kb = victim.kb.filter((k) => k.seq !== seq);
  victim.kb.push({ seq, vx, vy, stun });
}

function hitPlayer(room, victim, vx, vy, stun) {
  victim.inv = S.INV_HIT;
  queueImpulse(victim, vx, vy, stun);
}

function applyShove(room, a) {
  const W = S.PLAYER_W;
  const H = S.PLAYER_H;
  const rx0 = a.face > 0 ? a.x + W - 4 : a.x - S.ATK_RANGE;
  const rx1 = a.face > 0 ? a.x + W + S.ATK_RANGE : a.x + 4;
  const ry0 = a.y - 6;
  const ry1 = a.y + H + 6;

  for (const b of room.players.values()) {
    if (b === a || b.inv > 0) continue;
    const overlap = b.x < rx1 && b.x + W > rx0 && b.y < ry1 && b.y + H > ry0;
    if (!overlap) continue;
    hitPlayer(room, b, a.face * S.KB_X, -S.KB_Y, S.STUN_HIT);
    io.to(room.id).emit('fx', { type: 'hit', x: b.x + W / 2, y: b.y + H / 2 });
  }

  // Effetto della spinta: il fendente davanti al giocatore (chi l'ha lanciata lo mostra già in locale)
  io.to(room.id).except(a.id).emit('fx', {
    type: 'shove',
    id: a.id,
    x: a.x + W / 2 + a.face * (W / 2),
    y: a.y + H / 2,
    face: a.face,
  });
}

function checkStomps(room) {
  const arr = [...room.players.values()];
  for (const a of arr) {
    if (a.onGround || a.vy <= 200) continue;          // solo chi cade può pestare
    const feet = a.y + S.PLAYER_H;
    for (const b of arr) {
      if (b === a || b.inv > 0) continue;
      const overlapX = a.x + S.PLAYER_W - 8 > b.x && a.x + 8 < b.x + S.PLAYER_W;
      if (!overlapX) continue;
      if (feet < b.y - 6 || feet > b.y + 16) continue;

      const dir = b.x >= a.x ? 1 : -1;
      hitPlayer(room, b, dir * S.STOMP_KB_X, -S.STOMP_KB_Y, S.STOMP_STUN);
      if (a.acc) Accounts.addStat(a.acc, 'stomps', 1);

      // Chi pesta rimbalza un po'
      const seq = a.ack + 1;
      a.kb = a.kb.filter((k) => k.seq !== seq);
      a.kb.push({ seq, vx: a.vx, vy: -S.STOMP_BOUNCE, stun: 0 });

      io.to(room.id).emit('fx', { type: 'stomp', by: a.id, x: a.x + S.PLAYER_W / 2, y: feet });
      break;
    }
  }
}

/* ═══ Tick di simulazione (20 Hz) ═══ */
function buildSnapshot(room, now) {
  const players = [...room.players.values()];
  // [id, x, y, vx, vy, onGround, onIce, cp, ackSeq, meters, stun, face, inv]
  return {
    t: now,
    p: players.map((p) => [
      p.id, p.x, p.y, p.vx, p.vy,
      p.onGround ? 1 : 0, p.onIce ? 1 : 0, p.cp, p.ack,
      p.meters, p.stun, p.atkCd, p.face, p.inv,
    ]),
    // impulsi ancora da applicare: [id, seq, vx, vy, stun]
    kb: players.flatMap((p) => p.kb.map((k) => [p.id, k.seq, k.vx, k.vy, k.stun])),
  };
}

function tick() {
  const now = Date.now();

  for (const room of rooms.values()) {
    if (room.players.size === 0) continue;

    for (const p of room.players.values()) {
      if (p.inv > 0) p.inv -= 1;
      const steps = p.queue.length > CATCHUP_QUEUE ? 2 : 1;
      let moved = false;

      for (let i = 0; i < steps && p.queue.length > 0; i++) {
        const inp = p.queue.shift();
        p.ack = inp.seq;

        // Impulso previsto per questo passo?
        const k = p.kb.findIndex((item) => item.seq === inp.seq);
        if (k >= 0) {
          inp.kb = p.kb[k];
          p.kb.splice(k, 1);
        }

        S.simulate(p, inp, room.gen, (ev) => onPlayerEvent(room, p, ev));
        // Altezza dai piedi: il pavimento (riga 0) vale 0 m
        p.maxH = Math.max(p.maxH, -(p.y + S.PLAYER_H));
        if (p.attacked) applyShove(room, p);
        moved = true;
      }

      if (moved) afterMove(room, p);
    }

    checkStomps(room);
    io.to(room.id).volatile.emit('state', buildSnapshot(room, now));
  }
}

/* ═══ Reset periodico: il crollo ═══
   La classifica della stanza torna a zero (la hall of fame resta) e tutti vengono
   riportati a terra con una spinta verso l'alto che li fa ricadere. */
function resetRoom(room) {
  room.record = { name: '', meters: 0 };
  for (const p of room.players.values()) {
    const st = S.spawnState(p.slot, room.gen);
    p.x = st.x;
    p.y = st.y;
    p.vx = 0;
    p.vy = 0;
    p.onGround = true;
    p.onIce = false;
    p.cp = 0;
    p.stun = 0;
    p.maxH = 0;
    p.meters = 0;
    p.msIdx = 0;
    queueImpulse(p, (Math.random() < 0.5 ? -1 : 1) * 320, -700, 16);
  }
  io.to(room.id).emit('reset', { at: Date.now(), next: nextResetAt, serverNow: Date.now() });
  io.to(room.id).emit('state', buildSnapshot(room, Date.now()));
}

function resetSchedule() {
  for (const room of rooms.values()) {
    if (room.players.size > 0) io.to(room.id).emit('resetSoon', { in: RESET_WARN_MS });
  }
  nextResetAt = Date.now() + RESET_WARN_MS;
  setTimeout(() => {
    nextResetAt = Date.now() + RESET_EVERY_MS;
    for (const room of rooms.values()) {
      if (room.players.size > 0) resetRoom(room);
    }
  }, RESET_WARN_MS);
}

/* ═══ Server HTTP + Socket.io ═══ */
const app = express();
app.use(express.json({ limit: '2kb' }));
app.use(express.static(path.join(__dirname, 'public')));

function accountFromCookies(header) {
  const id = Accounts.readSession(Accounts.parseCookies(header).cr_session);
  return id ? Accounts.getAccount(id) : null;
}

function sessionCookie(req, value, maxAge) {
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  return `cr_session=${value}; Max-Age=${maxAge}; Path=/; HttpOnly; SameSite=Lax${secure}`;
}

// Limite ai tentativi di accesso: 20 ogni 15 minuti per indirizzo
const authHits = new Map();
function authLimited(req) {
  const ip = req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';
  const now = Date.now();
  const h = authHits.get(ip) || { n: 0, t: now };
  if (now - h.t > 15 * 60 * 1000) { h.n = 0; h.t = now; }
  h.n += 1;
  authHits.set(ip, h);
  return h.n > 20;
}

function startSession(req, res, account) {
  res.setHeader('Set-Cookie', sessionCookie(req, encodeURIComponent(Accounts.signSession(account.id)), Math.floor(Accounts.SESSION_MS / 1000)));
}

app.post('/api/register', (req, res) => {
  if (authLimited(req)) return res.status(429).json({ error: 'Troppi tentativi, riprova tra qualche minuto' });
  const b = req.body || {};
  const r = Accounts.register(b.username, b.password);
  if (!r.ok) return res.status(400).json({ error: r.error });
  startSession(req, res, r.account);
  res.json({ ok: true, nickname: r.account.nickname });
});

app.post('/api/login', (req, res) => {
  if (authLimited(req)) return res.status(429).json({ error: 'Troppi tentativi, riprova tra qualche minuto' });
  const b = req.body || {};
  const acc = Accounts.authenticate(b.username, b.password);
  if (!acc) return res.status(401).json({ error: 'Nome utente o password errati' });
  startSession(req, res, acc);
  res.json({ ok: true, nickname: acc.nickname });
});

app.post('/api/logout', (req, res) => {
  res.setHeader('Set-Cookie', sessionCookie(req, '', 0));
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  const acc = accountFromCookies(req.headers.cookie);
  if (!acc) return res.json({ loggedIn: false });
  res.json({
    loggedIn: true,
    nickname: acc.nickname,
    stats: { best: acc.best, stomps: acc.stomps, checkpoints: acc.checkpoints },
    cos: sanitizeCos(acc.cos, acc),
  });
});

app.post('/api/cos', (req, res) => {
  const acc = accountFromCookies(req.headers.cookie);
  if (!acc) return res.status(401).json({ error: 'Accedi per cambiare gli oggetti' });
  const cos = sanitizeCos(req.body && req.body.cos, acc);
  Accounts.setCos(acc, cos);
  res.json({ ok: true, cos });
});

process.on('SIGINT', () => { Accounts.flush(); process.exit(0); });
process.on('SIGTERM', () => { Accounts.flush(); process.exit(0); });
app.get('/healthz', (req, res) => {
  res.json({ ok: true, rooms: rooms.size });
});
app.get('/api/hall', (req, res) => {
  res.json(hallTop());
});

const server = http.createServer(app);
const io = new Server(server);

io.on('connection', (socket) => {
  socket.on('join', (data) => {
    if (socket.data.roomId) return;

    const acc = accountFromCookies(socket.handshake.headers.cookie);
    if (!acc) return socket.emit('joinError', { error: 'Accedi per giocare' });
    if ([...rooms.values()].some((r) => [...r.players.values()].some((p) => p.key === acc.id))) {
      return socket.emit('joinError', { error: 'Sei già in partita in un\'altra scheda' });
    }

    const room = findOrCreateRoom();
    const slot = freeSlot(room);
    const st = S.spawnState(slot, room.gen);
    const player = {
      id: socket.id,
      key: acc.id,
      acc,
      name: acc.nickname,
      color: sanitizeColor(data && data.color),
      skin: sanitizeSkin(data && data.skin),
      cos: sanitizeCos(acc.cos, acc),
      slot,
      ...st,
      queue: [],       // input in attesa: { seq, dir, jump, attack }
      kb: [],          // impulsi pendenti: { seq, vx, vy, stun }
      inv: 0,          // invulnerabilità residua (tick), solo server
      attacked: false,
      lastSeq: 0,
      ack: 0,
      maxH: 0,
      meters: 0,
      msIdx: 0,
      lastChat: 0,
      lastEmote: 0,
    };
    room.players.set(socket.id, player);

    socket.data.roomId = room.id;
    socket.join(room.id);

    socket.emit('joined', {
      id: socket.id,
      room: room.id,
      seed: room.seed,
      slot,
      spawn: { x: st.x, y: st.y },
      roster: getRoster(room),
      hall: hallTop(),
      record: room.record,
      nextResetAt,
      serverNow: Date.now(),
      nickname: acc.nickname,
      stats: { best: acc.best, stomps: acc.stomps, checkpoints: acc.checkpoints },
    });

    broadcastRoster(room);
  });

  socket.on('input', (data) => {
    const room = rooms.get(socket.data.roomId);
    if (!room || !data) return;
    const player = room.players.get(socket.id);
    if (!player) return;

    const seq = Number(data.seq);
    if (!Number.isInteger(seq) || seq <= player.lastSeq || seq > player.lastSeq + MAX_INPUT_AHEAD) return;
    player.lastSeq = seq;

    player.queue.push({
      seq,
      dir: data.dir === 1 ? 1 : data.dir === -1 ? -1 : 0,
      jump: data.jump === true,
      attack: data.attack === true,
    });
  });

  socket.on('chat', (data) => {
    const room = rooms.get(socket.data.roomId);
    const player = room && room.players.get(socket.id);
    if (!player) return;

    const now = Date.now();
    if (now - player.lastChat < CHAT_COOLDOWN_MS) return;

    const text = sanitizeText(data && data.text, CHAT_MAX);
    if (!text) return;
    player.lastChat = now;

    io.to(room.id).emit('chat', {
      id: player.id,
      name: player.name,
      color: player.color,
      text: maskProfanity(text),
    });
  });

  socket.on('profile', (id, cb) => {
    if (typeof cb !== 'function') return;
    const room = rooms.get(socket.data.roomId);
    const target = room && typeof id === 'string' ? room.players.get(id) : null;
    if (!target || !target.acc) return cb({ ok: false });
    const a = target.acc;
    cb({
      ok: true,
      profile: {
        nickname: a.nickname,
        color: target.color,
        best: a.best,
        stomps: a.stomps,
        checkpoints: a.checkpoints,
        items: a.cos.filter(Boolean).map((cid) => ITEM_NAMES[cid]),
      },
    });
  });

  socket.on('emote', (data) => {
    const room = rooms.get(socket.data.roomId);
    const player = room && room.players.get(socket.id);
    if (!player) return;

    const e = Number(data && data.e);
    if (!Number.isInteger(e) || e < 0 || e >= EMOTE_COUNT) return;

    const now = Date.now();
    if (now - player.lastEmote < EMOTE_COOLDOWN_MS) return;
    player.lastEmote = now;

    io.to(room.id).emit('emote', { id: player.id, e });
  });

  socket.on('disconnect', () => {
    const room = rooms.get(socket.data.roomId);
    if (!room) return;

    room.players.delete(socket.id);
    if (room.players.size === 0) {
      rooms.delete(room.id);
    } else {
      broadcastRoster(room);
    }
  });
});

/* ═══ Avvio ═══ */
setInterval(tick, TICK_MS);
setInterval(resetSchedule, RESET_EVERY_MS);

server.listen(PORT, () => {
  console.log(`Climb Race in ascolto sulla porta ${PORT} (tick ${1000 / TICK_MS} Hz)`);
});

process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});
