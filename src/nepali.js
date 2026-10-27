// Nepali text helpers for place search: Devanagari → the Roman spelling people type, and a loose
// "search key" so different romanisations of the same name match (chowk/chok, marg/road, aa/a, w/v/b…).

const VOWELS = { 'अ': 'a', 'आ': 'a', 'इ': 'i', 'ई': 'i', 'उ': 'u', 'ऊ': 'u', 'ऋ': 'ri', 'ए': 'e', 'ऐ': 'ai', 'ओ': 'o', 'औ': 'au' };
const MATRAS = { 'ा': 'a', 'ि': 'i', 'ी': 'i', 'ु': 'u', 'ू': 'u', 'ृ': 'ri', 'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au' };
const CONSONANTS = {
  'क': 'k', 'ख': 'kh', 'ग': 'g', 'घ': 'gh', 'ङ': 'ng', 'च': 'ch', 'छ': 'chh', 'ज': 'j', 'झ': 'jh', 'ञ': 'ny',
  'ट': 't', 'ठ': 'th', 'ड': 'd', 'ढ': 'dh', 'ण': 'n', 'त': 't', 'थ': 'th', 'द': 'd', 'ध': 'dh', 'न': 'n',
  'प': 'p', 'फ': 'ph', 'ब': 'b', 'भ': 'bh', 'म': 'm', 'य': 'y', 'र': 'r', 'ल': 'l', 'व': 'w', 'श': 'sh', 'ष': 'sh', 'स': 's', 'ह': 'h',
};
const SIGNS = { 'ं': 'n', 'ँ': 'n', 'ः': 'h', '।': '.', '॥': '.' };
const DIGITS = '०१२३४५६७८९';

const hasDevanagari = (s) => /[ऀ-ॿ]/.test(s || '');

/**
 * Devanagari → everyday Nepali romanisation: inherent "a" after consonants, dropped at the end of a word
 * ("चोक" → "chok", "पोखरा" → "pokhara", "मिलन" → "milan"); long and short vowels written alike.
 */
function transliterate(text) {
  let out = '';
  const chars = [...(text || '').normalize('NFC')];
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (CONSONANTS[c]) {
      out += CONSONANTS[c];
      let j = i + 1;
      if (chars[j] === '़') j++; // nukta
      const next = chars[j];
      if (next === '्') { i = j; continue; } // halant: no vowel
      if (MATRAS[next]) { out += MATRAS[next]; i = j; continue; }
      // Inherent "a" unless this consonant ends the word (Nepali drops the final schwa).
      const endOfWord = next === undefined || !/[ऀ-ॿ]/.test(next) || (SIGNS[next] && !/[ऀ-ॿ]/.test(chars[j + 1] || ''));
      if (!endOfWord) out += 'a';
      i = j - 1;
    } else if (VOWELS[c]) out += VOWELS[c];
    else if (SIGNS[c]) out += SIGNS[c];
    else if (DIGITS.includes(c)) out += DIGITS.indexOf(c);
    else if (MATRAS[c] || c === '्' || c === '़') { /* stray sign */ } else out += c;
  }
  return out.replace(/ngg(?![aeiou])/g, 'ng'); // "प्रस्याङ्ग" → "prasyang"
}

/** "khahare chok" → "Khahare Chok" */
const titleCase = (s) => s.replace(/(^|[\s(/-])([a-z])/g, (m, p, l) => p + l.toUpperCase());

// Words that mean the same thing in place names → one spelling (which then goes through the key rules like any word).
const SYNONYMS = {
  rd: 'marg', road: 'marg', sadak: 'marg', path: 'marg', street: 'marg', st: 'marg', marga: 'marg',
  chowk: 'chok', chock: 'chok', chwok: 'chok', tole: 'tol', temple: 'mandir', mandira: 'mandir', lake: 'tal',
  aspatal: 'hospital', hospitel: 'hospital', vidhyalaya: 'school', vidyalaya: 'school', bidhyalaya: 'school', bidyalaya: 'school', widyalay: 'school', vidyalay: 'school',
  bridge: 'pul', bazaar: 'bazar', bajar: 'bazar', guesthouse: 'guesthouse', college: 'campus', stn: 'station', nyurod: 'newroad',
  madhyamik: 'secondary', mavi: 'secondary', prabidhik: 'technical', airport: 'bimansthal', bimanasthal: 'bimansthal',
};
// Two-word names often typed as one ("New Road" = "Newroad" = न्यूरोड).
const PHRASES = [[/\bnew\s+road\b/gi, 'newroad'], [/\bzero\s+(km|kilometer|kilometre)\b/gi, 'zerokm'], [/\bbus\s+park\b/gi, 'buspark']];

/**
 * Loose key for one word: lower-case, no accents, aspiration dropped (kh/k, dh/d, chh/ch…),
 * long vowels and doubled letters collapsed, w/v → b, f → p, sh → s, z → j.
 */
function wordKey(word) {
  let w = word.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (hasDevanagari(w)) w = transliterate(w);
  w = w.replace(/[^a-z0-9]/g, '');
  w = SYNONYMS[w] || w;
  w = w.replace(/ow/g, 'o').replace(/ee/g, 'i').replace(/oo/g, 'u').replace(/aa/g, 'a')
    .replace(/sh/g, 's').replace(/ph/g, 'p').replace(/f/g, 'p').replace(/[wv]/g, 'b').replace(/z/g, 'j').replace(/q/g, 'k').replace(/x/g, 'ks')
    .replace(/([bcdgjkpt])h/g, '$1').replace(/(?<=.)y(?=[aeiou])/g, '') // "bidhya"/"bidya"
    .replace(/(.)\1+/g, '$1');
  if (w.length > 3) w = w.replace(/a$/, ''); // "marga"/"marg", "pokhara"/"pokhar"
  return w;
}

/** Search keys for a name or query: one per word. */
const keys = (text) => {
  let s = text || '';
  if (hasDevanagari(s)) s = transliterate(s);
  for (const [re, to] of PHRASES) s = s.replace(re, to);
  return s.split(/[\s,.;:/()&'"’\-–]+/).filter(Boolean).map(wordKey).filter(Boolean);
};

module.exports = { transliterate, hasDevanagari, titleCase, wordKey, keys };
