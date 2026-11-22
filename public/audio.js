/* Audio del gioco: effetti e musica sintetizzati in Web Audio (nessun file esterno).
   Rispetta gli interruttori Suoni e Musica del menu (preferenze salvate in climbrace.prefs).
   Il browser richiede un gesto dell'utente prima di far partire l'audio: il primo click o tasto lo sblocca. */
(() => {
  'use strict';

  const PREF_KEY = 'climbrace.prefs';
  let ctx = null;
  let master = null;
  let sfxBus = null;
  let musicBus = null;
  let noiseBuf = null;
  let unlocked = false;
  let wantedTrack = null;

  const prefs = () => {
    try { return JSON.parse(localStorage.getItem(PREF_KEY) || '{}'); } catch { return {}; }
  };
  const soundOn = () => prefs().sound !== false;
  const musicOn = () => prefs().music !== false;

  function ensure() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.7;
    master.connect(ctx.destination);
    sfxBus = ctx.createGain();
    sfxBus.gain.value = 0.55;
    sfxBus.connect(master);
    musicBus = ctx.createGain();
    musicBus.gain.value = 0.2;
    musicBus.connect(master);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return ctx;
  }

  /* ─── Effetti ─── */
  function tone(type, f0, f1, dur, vol, when = 0, bus = null) {
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(bus || sfxBus);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  function noise(dur, vol, hp, when = 0) {
    const t = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = hp;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(sfxBus);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  const SFX = {
    jump: () => tone('square', 320, 640, 0.12, 0.16),
    land: () => tone('triangle', 180, 70, 0.1, 0.28),
    slash: () => { noise(0.12, 0.18, 1500); tone('square', 900, 300, 0.1, 0.12); },
    hit: () => { tone('sawtooth', 260, 90, 0.2, 0.18); noise(0.1, 0.2, 600); },
    stomp: () => { tone('triangle', 300, 120, 0.15, 0.3); noise(0.08, 0.2, 400); },
    checkpoint: () => [523, 659, 784].forEach((f, i) => tone('square', f, 0, 0.1, 0.14, i * 0.08)),
    milestone: () => [392, 523, 659, 784].forEach((f, i) => tone('square', f, 0, 0.1, 0.14, i * 0.09)),
    record: () => {
      [523, 659, 784, 1047].forEach((f, i) => {
        tone('square', f, 0, 0.14, 0.15, i * 0.1);
        tone('triangle', f / 2, 0, 0.14, 0.15, i * 0.1);
      });
    },
    emote: () => { tone('square', 880, 0, 0.07, 0.12); tone('square', 1320, 0, 0.07, 0.12, 0.08); },
    chat: () => tone('square', 660, 0, 0.05, 0.08),
    unlock: () => [659, 784, 988, 1319].forEach((f, i) => tone('square', f, 0, 0.09, 0.14, i * 0.07)),
    warn: () => [0, 0.25, 0.5].forEach((w) => tone('square', 880, 660, 0.18, 0.16, w)),
    crash: () => { noise(0.9, 0.5, 60); tone('triangle', 80, 30, 0.9, 0.35); },
    click: () => tone('square', 1200, 900, 0.04, 0.1),
  };

  function sfx(name) {
    if (!unlocked || !soundOn() || !SFX[name]) return;
    SFX[name]();
  }

  /* ─── Musica: sequencer chiptune in La minore con tempo regolabile ─── */
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const CHORDS = [[57, 60, 64], [53, 57, 60], [60, 64, 67], [55, 59, 62]]; // Am F C G
  const BASS = [45, 41, 48, 43];
  const TRACKS = {
    menu: { bpm: 100, lead: true, drums: false },
    game: { bpm: 124, lead: true, drums: true },
  };

  let track = null;
  let bpm = 124;
  let step = 0;
  let nextTime = 0;
  let timer = null;

  function playStep(s, t) {
    const bar = Math.floor(s / 16) % 4;
    const i = s % 16;
    const chord = CHORDS[bar];
    const stepDur = 60 / bpm / 4;
    const cfg = TRACKS[track];

    // basso: ottavo sulla fondamentale, nota alta sui tempi deboli
    if (i % 2 === 0) {
      const note = i % 4 === 0 ? BASS[bar] : BASS[bar] + 12;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'triangle';
      o.frequency.value = mtof(note);
      g.gain.setValueAtTime(0.5, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + stepDur * 1.6);
      o.connect(g);
      g.connect(musicBus);
      o.start(t);
      o.stop(t + stepDur * 1.7);
    }

    // arpeggio della melodia sugli accordi
    if (cfg.lead) {
      const order = [0, 1, 2, 1, 0, 2, 1, 2];
      const note = chord[order[i % 8]] + (s >= 64 && bar % 2 === 1 ? 12 : 0);
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'square';
      o.frequency.value = mtof(note);
      g.gain.setValueAtTime(0.09, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + stepDur * 0.9);
      o.connect(g);
      g.connect(musicBus);
      o.start(t);
      o.stop(t + stepDur);
    }

    if (cfg.drums) {
      if (i === 0 || i === 8) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.frequency.setValueAtTime(140, t);
        o.frequency.exponentialRampToValueAtTime(40, t + 0.15);
        g.gain.setValueAtTime(0.5, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
        o.connect(g);
        g.connect(musicBus);
        o.start(t);
        o.stop(t + 0.2);
      }
      if (i % 4 === 2) {
        const src = ctx.createBufferSource();
        src.buffer = noiseBuf;
        const f = ctx.createBiquadFilter();
        f.type = 'highpass';
        f.frequency.value = 7000;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.12, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
        src.connect(f);
        f.connect(g);
        g.connect(musicBus);
        src.start(t, Math.random() * 0.5);
        src.stop(t + 0.06);
      }
    }
  }

  // Con la scheda in background il browser rallenta i timer (anche a 1 volta al secondo):
  // per questo si pianifica con molto anticipo.
  const LOOKAHEAD = 0.8;

  function scheduler() {
    if (!ctx || !track) return;
    try {
      const now = ctx.currentTime;
      // Dopo una pausa (contesto sospeso o scheda nascosta) riparte dal presente, senza recuperare tutto insieme
      if (nextTime < now) {
        step += Math.floor((now - nextTime) / (60 / bpm / 4));
        nextTime = now + 0.05;
      }
      const stepDur = 60 / bpm / 4;
      while (nextTime < now + LOOKAHEAD) {
        playStep(step, nextTime);
        nextTime += stepDur;
        step += 1;
      }
    } catch (err) {
      // Un passo che fallisce non deve fermare la musica per sempre
      console.warn('Audio:', err);
      nextTime = (ctx ? ctx.currentTime : 0) + 0.05;
    }
  }

  // Il contesto può essere sospeso (cambio scheda, interruzioni del sistema): lo riprendo appena possibile
  function keepRunning() {
    if (ctx && unlocked && ctx.state !== 'running') ctx.resume().catch(() => {});
  }
  document.addEventListener('visibilitychange', keepRunning);
  window.addEventListener('focus', keepRunning);

  function startTrack(name) {
    if (!ctx) return;
    if (track === name) return;
    stopTrack();
    track = name;
    bpm = TRACKS[name].bpm;
    step = 0;
    nextTime = ctx.currentTime + 0.05;
    musicBus.gain.cancelScheduledValues(ctx.currentTime);
    musicBus.gain.setValueAtTime(0.2, ctx.currentTime);
    timer = setInterval(scheduler, 25);
  }

  function stopTrack() {
    track = null;
    if (timer) clearInterval(timer);
    timer = null;
  }

  function music(name) {
    wantedTrack = name;
    if (!unlocked || !musicOn()) { stopTrack(); return; }
    if (name) startTrack(name);
    else stopTrack();
  }

  // Più alto è il giocatore, più la musica accelera (tra 124 e 148 BPM)
  function setTempo(meters) {
    if (track !== 'game') return;
    const target = 124 + Math.min(24, Math.floor(meters / 250) * 3);
    if (target !== bpm) {
      bpm = target;
    }
  }

  /* ─── Sblocco e impostazioni ─── */
  function unlock() {
    const c = ensure();
    if (!c) return;
    if (c.state !== 'running') c.resume().catch(() => {});
    if (!unlocked) {
      unlocked = true;
      if (musicOn() && wantedTrack) startTrack(wantedTrack);
    }
    // Riprende se il sistema ha sospeso l'audio, poi reimposta il sequencer dal presente
    c.onstatechange = () => { if (c.state === 'running' && track) nextTime = c.currentTime + 0.05; };
  }

  function applySettings() {
    if (!unlocked) return;
    if (!musicOn()) stopTrack();
    else if (wantedTrack) startTrack(wantedTrack);
  }

  ['pointerdown', 'keydown', 'touchstart'].forEach((ev) => {
    document.addEventListener(ev, unlock, { passive: true });
  });
  document.addEventListener('click', (e) => {
    if (e.target && e.target.closest && e.target.closest('button, .slot, .swatch')) sfx('click');
  });
  window.addEventListener('settings', applySettings);

  window.ClimbAudio = { unlock, sfx, music, setTempo };
})();
