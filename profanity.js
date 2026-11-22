'use strict';

/* Filtro parolacce per chat e nickname.
   - riconosce anche le varianti con lettere ripetute, separatori (c.a.z.z.o), accenti e leetspeak (c4zz0);
   - nella chat le parole trovate diventano asterischi, nei nickname sono rifiutate.
   Per aggiungere o togliere termini modifica solo la lista qui sotto. */

const WORDS = [
  // italiano
  'cazzo', 'cazzi', 'minchia', 'merda', 'stronzo', 'stronza', 'stronzi', 'coglione', 'coglioni',
  'puttana', 'puttane', 'troia', 'troie', 'vaffanculo', 'fanculo', 'bastardo', 'bastarda',
  'porca madonna', 'figlio di puttana', 'frocio', 'froci', 'ritardato', 'ritardata',
  // inglese
  'fuck', 'fucking', 'shit', 'bitch', 'asshole', 'cunt', 'nigger', 'nigga', 'faggot', 'retard',
];

// Lettere → varianti accettate (accenti, maiuscole, leetspeak)
const LETTER = {
  a: 'aàáâäAÀÁÂÄ@4',
  e: 'eèéêëEÈÉÊË3',
  i: 'iìíîïIÌÍÎÏ1!l|',
  o: 'oòóôöOÒÓÔÖ0',
  u: 'uùúûüUÙÚÛÜ',
  s: 'sS5$',
  t: 'tT7+',
  b: 'bB8',
  g: 'gG9',
  c: 'cC(',
  z: 'zZ2',
  f: 'fF',
  k: 'kK',
  r: 'rR',
  n: 'nN',
  d: 'dD',
  h: 'hH',
  l: 'lL',
  m: 'mM',
  p: 'pP',
  v: 'vV',
  y: 'yY',
  w: 'wW',
  q: 'qQ',
  x: 'xX',
  j: 'jJ',
};

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function letterClass(ch) {
  const set = LETTER[ch.toLowerCase()];
  if (!set) return escapeRe(ch);
  return `[${set.split('').map(escapeRe).join('')}]`;
}

// Tra una lettera e l'altra della parola sono ammessi separatori e ripetizioni
const SEP = '[^A-Za-zÀ-ÿ0-9]{0,2}';

function wordRegex(word) {
  const parts = [];
  for (const ch of word) {
    if (ch === ' ') { parts.push('[^A-Za-zÀ-ÿ0-9]+'); continue; }
    parts.push(`${letterClass(ch)}+`);
  }
  return new RegExp(parts.join(SEP), 'giu');
}

const REGEXES = WORDS.map(wordRegex);

// Chat: sostituisce le parole vietate con asterischi (mantiene la lunghezza)
function maskProfanity(text) {
  let out = String(text ?? '');
  for (const re of REGEXES) {
    out = out.replace(re, (m) => '*'.repeat(m.length));
  }
  return out;
}

// Nickname: vero se contiene una parola vietata (in qualunque forma)
function hasProfanity(text) {
  const s = String(text ?? '');
  return REGEXES.some((re) => {
    re.lastIndex = 0;
    return re.test(s);
  });
}

module.exports = { maskProfanity, hasProfanity };
