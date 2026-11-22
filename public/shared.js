/*
 * shared.js — fisica e generazione del mondo, identiche su client e server.
 * Il server lo carica con require(), il browser con <script>. Non modificare
 * questo file senza considerare che client e server devono restare sincronizzati.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Shared = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* ═══ Costanti di gioco ═══ */
  const TICK = 1 / 20;                 // passo fisso di simulazione (20 Hz)
  const WORLD_W = 1000;
  const PLAYER_W = 48;                 // hitbox: corpo dell'arancino (12×10 px sprite × 4)
  const PLAYER_H = 40;
  const SPEED = 260;
  const GRAVITY = 1600;
  const JUMP_VELOCITY = 720;           // altezza ≈ 162 px
  const BOUNCE_VELOCITY = 1080;        // salto della nuvola elastica ≈ 364 px
  const MAX_FALL_SPEED = 900;
  const ICE_ACCEL = 0.04;              // inerzia sul ghiaccio (più basso = più scivoloso)
  const WIND_PUSH = 150;               // spinta orizzontale della nuvola del vento (unità/s)
  const STORM_SLOW = 0.5;              // velocità sulla nuvola della tempesta (frazione)
  const SIDE_TOP = 8;                  // fascia del corpo della nuvola che blocca di lato (dal bordo superiore)
  const SIDE_BOTTOM = 40;             // fino all'altezza disegnata della nuvola (CLOUD_H)

  // Combattimento
  const ATK_COOLDOWN = 16;             // passi (0,8 s) tra una spinta e l'altra
  const ATK_RANGE = 36;                // portata della spinta in unità di mondo
  const KB_FRICTION = 0.9;             // attrito durante lo stordimento (per passo)
  const KB_X = 300;                    // spinta orizzontale della spinta
  const KB_Y = 520;                    // spinta verticale della spinta
  const STUN_HIT = 16;                 // passi di stordimento dopo una spinta (0,8 s)
  const STOMP_KB_X = 140;
  const STOMP_KB_Y = 500;
  const STOMP_STUN = 12;
  const STOMP_BOUNCE = 560;            // rimbalzo di chi pesta
  const INV_HIT = 20;                  // invulnerabilità dopo un colpo (1 s), solo lato server

  const ROW_GAP_MIN = 112;             // distanza verticale tra righe (sempre raggiungibile)
  const ROW_GAP_MAX = 128;
  const ROW_DX = 190;                  // spostamento orizzontale massimo tra righe consecutive
  const CHECKPOINT_EVERY = 10;         // una nuvola dorata ogni N righe
  const PX_PER_METER = 10;             // 1 metro = 10 unità di mondo
  const DEATH_DEPTH = 600;             // caduta oltre il checkpoint: si torna lì
  const MILESTONES = [50, 100, 250, 500, 750, 1000, 1500, 2000, 3000, 4000, 5000, 7500, 10000];

  const clampN = (v, min, max) => Math.min(max, Math.max(min, v));

  /* PRNG deterministico (mulberry32): stessa sequenza su client e server */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ═══ Generazione infinita ═══
     Le righe si generano in sequenza, quindi il risultato dipende solo dal seme.
     Ogni riga è una nuvola (kind):
       cloud  → normale
       bounce → nuvola elastica (rimbalza in alto)
       ice    → ghiaccio (scivola, inerzia)
       gold   → checkpoint dorato (salvataggio del respawn)
       wind   → nuvola del vento (spinge chi ci sta sopra, a destra e sinistra alternate)
       storm  → nuvola della tempesta (rallenta chi ci cammina)
       mini   → nuvola piccola (stessa fisica, più stretta) */
  function genRow(gen) {
    const r = gen.rows.length;
    const rnd = gen.rnd;

    if (r === 0) {
      gen.rows.push({ r: 0, x: 0, w: WORLD_W, y: 0, kind: 'ground' });
      return;
    }

    const prev = gen.rows[r - 1];
    // Chiamate sempre nello stesso ordine: la sequenza dei numeri non deve cambiare
    const gapRoll = rnd();
    const kindRoll = rnd();
    const widthRoll = rnd();
    const dxRoll = rnd();

    const gap = ROW_GAP_MIN + gapRoll * (ROW_GAP_MAX - ROW_GAP_MIN);
    const d = Math.min(1, r / 150);

    let kind = 'cloud';
    if (r % CHECKPOINT_EVERY === 0) kind = 'gold';
    else if (kindRoll < 0.09 + d * 0.05) kind = 'bounce';
    else if (kindRoll < 0.18 + d * 0.08) kind = 'ice';
    else if (kindRoll < 0.25 + d * 0.06) kind = 'wind';
    else if (kindRoll < 0.31 + d * 0.06) kind = 'storm';
    else if (kindRoll < 0.37 + d * 0.04) kind = 'mini';

    let w = Math.round(clampN(200 - d * 90 + (widthRoll - 0.5) * 40, 90, 220));
    if (kind === 'mini') w = Math.round(70 + widthRoll * 30);
    const dx = (dxRoll * 2 - 1) * (ROW_DX - d * 40);
    const prevCx = prev.x + prev.w / 2;
    const cx = clampN(prevCx + dx, w / 2 + 20, WORLD_W - w / 2 - 20);

    gen.rows.push({
      r,
      x: Math.round(cx - w / 2),
      w,
      y: Math.round(prev.y - gap),
      kind,
    });
  }

  class LevelGen {
    constructor(seed) {
      this.seed = seed >>> 0;
      this.rnd = mulberry32(this.seed);
      this.rows = [];
      genRow(this); // riga 0: il pavimento
    }

    /* Restituisce le righe con y (lato superiore) tra yMin e yMax, generando se serve. */
    rowsBetween(yMin, yMax) {
      while (this.rows[this.rows.length - 1].y > yMin - 600) genRow(this);

      const rows = this.rows;
      let lo = 0;
      let hi = rows.length;
      // y decresce con l'indice: cerca il primo indice con y <= yMax
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (rows[mid].y > yMax) lo = mid + 1;
        else hi = mid;
      }
      const out = [];
      for (let i = lo; i < rows.length && rows[i].y >= yMin; i++) out.push(rows[i]);
      return out;
    }
  }

  /* Nuvola su cui il giocatore sta appoggiato (o null). */
  function rowUnder(p, gen) {
    const bottom = p.y + PLAYER_H;
    const rows = gen.rowsBetween(bottom - 4, bottom + 4);
    for (let i = 0; i < rows.length; i++) {
      const pl = rows[i];
      if (Math.abs(bottom - pl.y) > 4) continue;
      if (p.x + PLAYER_W > pl.x && p.x < pl.x + pl.w) return pl;
    }
    return null;
  }

  /* ═══ Stato del giocatore ═══ */
  function spawnState(slot, gen) {
    return {
      x: 60 + (slot % 12) * 50,
      y: gen.rows[0].y - PLAYER_H,
      vx: 0,
      vy: 0,
      onGround: true,
      onIce: false,
      cp: 0,
      stun: 0,       // passi rimanenti di stordimento
      atkCd: 0,      // passi rimanenti di cooldown della spinta
      face: 1,       // direzione dell'ultimo movimento (1 destra, -1 sinistra)
    };
  }

  function stateOf(p) {
    return {
      x: p.x,
      y: p.y,
      vx: p.vx,
      vy: p.vy,
      onGround: p.onGround,
      onIce: p.onIce,
      cp: p.cp,
      stun: p.stun,
      atkCd: p.atkCd,
      face: p.face,
    };
  }

  /* ═══ Fisica: un passo = un input {dir, jump, attack, kb?} ═══
     - input.kb (opzionale): impulso ricevuto dal server per questo passo (spinta o rimbalzo).
     - p.attacked: true se in questo passo è partita una spinta (il server calcola i colpi).
     onEvent (opzionale) riceve 'checkpoint' e 'respawn'. Solo il server lo passa. */
  function simulate(p, input, gen, onEvent) {
    p.attacked = false;

    if (input.kb) {
      p.vx = input.kb.vx;
      p.vy = input.kb.vy;
      p.stun = input.kb.stun;
      p.onGround = false;
      p.onIce = false;
    }

    const stunned = p.stun > 0;
    if (stunned) p.stun -= 1;
    if (p.atkCd > 0) p.atkCd -= 1;

    const dir = stunned ? 0 : input.dir;
    if (dir !== 0) p.face = dir;

    if (!stunned && input.attack && p.atkCd === 0) {
      p.atkCd = ATK_COOLDOWN;
      p.attacked = true;
    }

    if (!stunned && input.jump && p.onGround) {
      p.vy = -JUMP_VELOCITY;
      p.onGround = false;
      p.onIce = false;
    }

    // Orizzontale: stordito = la spinta decade; sul ghiaccio accelera gradualmente; altrove immediata
    if (stunned) p.vx *= KB_FRICTION;
    else if (p.onGround && p.onIce) p.vx += (dir * SPEED - p.vx) * ICE_ACCEL;
    else p.vx = dir * SPEED;

    // Effetti delle nuvole speciali su cui si è appoggiati
    if (!stunned && p.onGround) {
      const under = rowUnder(p, gen);
      if (under && under.kind === 'wind') p.vx += (under.r % 2 === 0 ? 1 : -1) * WIND_PUSH;
      if (under && under.kind === 'storm') p.vx *= STORM_SLOW;
    }

    p.vy = Math.min(p.vy + GRAVITY * TICK, MAX_FALL_SPEED);

    const prevBottom = p.y + PLAYER_H;
    const prevX = p.x;
    p.x = clampN(p.x + p.vx * TICK, 0, WORLD_W - PLAYER_W);
    p.y += p.vy * TICK;
    p.onGround = false;
    p.onIce = false;

    // Collisione laterale: il corpo della nuvola blocca il giocatore che ci entra di lato
    const near = gen.rowsBetween(p.y - 200, p.y + PLAYER_H + 200);
    for (let i = 0; i < near.length; i++) {
      const pl = near[i];
      if (pl.kind === 'ground') continue;
      const inBody = p.y + PLAYER_H > pl.y + SIDE_TOP && p.y < pl.y + SIDE_BOTTOM;
      if (!inBody) continue;
      if (!(p.x < pl.x + pl.w && p.x + PLAYER_W > pl.x)) continue;
      if (prevX + PLAYER_W <= pl.x + 0.01) {
        p.x = pl.x - PLAYER_W;
        if (p.vx > 0) p.vx = 0;
      } else if (prevX >= pl.x + pl.w - 0.01) {
        p.x = pl.x + pl.w;
        if (p.vx < 0) p.vx = 0;
      }
    }
    p.x = clampN(p.x, 0, WORLD_W - PLAYER_W);

    if (p.vy >= 0) {
      const rows = near;
      for (let i = 0; i < rows.length; i++) {
        const pl = rows[i];
        const landing =
          prevBottom <= pl.y + 1 &&
          p.y + PLAYER_H >= pl.y &&
          p.x + PLAYER_W > pl.x &&
          p.x < pl.x + pl.w;
        if (!landing) continue;

        p.y = pl.y - PLAYER_H;
        p.vy = 0;

        if (pl.kind === 'bounce') {
          p.vy = -BOUNCE_VELOCITY;      // rimbalzo: niente atterraggio
        } else {
          p.onGround = true;
          p.onIce = pl.kind === 'ice';
          if (pl.kind === 'gold' && pl.r > p.cp) {
            p.cp = pl.r;
            if (onEvent) onEvent({ type: 'checkpoint', row: pl.r });
          }
        }
        break;
      }
    }

    // Caduta troppo in basso: ritorno all'ultimo checkpoint
    const cp = gen.rows[p.cp];
    if (p.y > cp.y + DEATH_DEPTH) {
      p.x = clampN(cp.x + cp.w / 2 - PLAYER_W / 2, 0, WORLD_W - PLAYER_W);
      p.y = cp.y - PLAYER_H;
      p.vx = 0;
      p.vy = 0;
      p.stun = 0;
      p.onGround = true;
      p.onIce = false;
      if (onEvent) onEvent({ type: 'respawn' });
    }
  }

  return {
    TICK,
    WORLD_W,
    PLAYER_W,
    WIND_PUSH,
    STORM_SLOW,
    PLAYER_H,
    SPEED,
    PX_PER_METER,
    MILESTONES,
    CHECKPOINT_EVERY,
    ATK_COOLDOWN,
    ATK_RANGE,
    KB_X,
    KB_Y,
    STUN_HIT,
    STOMP_KB_X,
    STOMP_KB_Y,
    STOMP_STUN,
    STOMP_BOUNCE,
    INV_HIT,
    LevelGen,
    simulate,
    spawnState,
    stateOf,
  };
});
