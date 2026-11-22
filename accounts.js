'use strict';

/* Account con username e password.
   - username unico (senza distinguere maiuscole), 3–14 caratteri: lettere, numeri, _;
     non può contenere parolacce e non si può cambiare; è anche il nome che vedono gli altri;
   - password: 6–72 caratteri, salvata solo come hash scrypt con sale casuale;
   - progressi salvati in data/accounts.json (scrittura atomica);
   - sessioni: cookie firmato con HMAC (SESSION_SECRET), nessuna dipendenza esterna. */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { hasProfanity } = require('./profanity');

const DATA_DIR = path.join(__dirname, 'data');
const FILE = path.join(DATA_DIR, 'accounts.json');
const NAME_RE = /^[A-Za-z0-9_]{3,14}$/;
const PASS_MIN = 6;
const PASS_MAX = 72;
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;

const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.SESSION_SECRET) {
  console.warn('SESSION_SECRET non impostata: le sessioni si azzereranno ad ogni riavvio.');
}

let accounts = {};   // id -> account
let byName = {};     // username minuscolo -> id
let dirty = false;
let saveTimer = null;

function reindex() {
  byName = {};
  for (const a of Object.values(accounts)) byName[a.nickname.toLowerCase()] = a.id;
}

function load() {
  try {
    accounts = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    accounts = {};
  }
  reindex();
}

function flush() {
  if (!dirty) return;
  dirty = false;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(accounts));
  fs.renameSync(tmp, FILE);
}

function markDirty() {
  dirty = true;
  if (!saveTimer) {
    saveTimer = setTimeout(() => {
      saveTimer = null;
      try { flush(); } catch (err) { console.error('Salvataggio account fallito:', err); }
    }, 2000);
  }
}

process.on('exit', () => { try { flush(); } catch { /* ignora */ } });

load();

function getAccount(id) {
  return accounts[id] || null;
}

/* ─── Password ─── */
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function checkPassword(password, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const a = Buffer.from(crypto.scryptSync(password, salt, 64).toString('hex'));
  const b = Buffer.from(hash);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* ─── Registrazione e login ─── */
// Restituisce un messaggio d'errore oppure '' se username e password sono validi
function validateCredentials(username, password) {
  const name = String(username ?? '').trim();
  const pass = String(password ?? '');
  if (!NAME_RE.test(name)) return 'Il nome utente deve avere 3–14 caratteri: lettere, numeri o _';
  if (hasProfanity(name)) return 'Questo nome utente non è consentito';
  if (byName[name.toLowerCase()]) return 'Nome utente già preso';
  if (pass.length < PASS_MIN || pass.length > PASS_MAX) return `La password deve avere ${PASS_MIN}–${PASS_MAX} caratteri`;
  return '';
}

function register(username, password) {
  const error = validateCredentials(username, password);
  if (error) return { ok: false, error };
  const id = crypto.randomUUID();
  const account = {
    id,
    nickname: String(username).trim(),
    passwordHash: hashPassword(String(password)),
    createdAt: Date.now(),
    best: 0,
    stomps: 0,
    checkpoints: 0,
    cos: ['', '', ''],
  };
  accounts[id] = account;
  byName[account.nickname.toLowerCase()] = id;
  markDirty();
  return { ok: true, account };
}

// Restituisce l'account se username e password coincidono, altrimenti null
function authenticate(username, password) {
  const id = byName[String(username ?? '').trim().toLowerCase()];
  const account = id ? accounts[id] : null;
  if (!account) {
    // Stesso tempo di calcolo anche con utente sconosciuto
    checkPassword(String(password ?? ''), 'x:y');
    return null;
  }
  return checkPassword(String(password ?? ''), account.passwordHash) ? account : null;
}

/* ─── Progressi ─── */
function updateStats(account, patch) {
  let changed = false;
  for (const k of ['best', 'stomps', 'checkpoints']) {
    if (typeof patch[k] === 'number' && patch[k] > account[k]) {
      account[k] = patch[k];
      changed = true;
    }
  }
  if (changed) markDirty();
}

function addStat(account, key, n) {
  account[key] = (account[key] || 0) + n;
  markDirty();
}

function setCos(account, cos) {
  account.cos = cos;
  markDirty();
}

/* ─── Sessioni ─── */
function signSession(id) {
  const payload = Buffer.from(JSON.stringify({ id, exp: Date.now() + SESSION_MS })).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function readSession(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data.id || !(data.exp > Date.now())) return null;
    return data.id;
  } catch {
    return null;
  }
}

function parseCookies(header) {
  const out = {};
  String(header || '').split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

module.exports = {
  getAccount,
  register,
  authenticate,
  validateCredentials,
  updateStats,
  addStat,
  setCos,
  signSession,
  readSession,
  parseCookies,
  SESSION_MS,
  flush,
};
