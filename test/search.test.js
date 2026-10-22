const test = require('node:test');
const assert = require('node:assert/strict');
const { transliterate, keys } = require('../src/nepali');
const { search, reverse, size } = require('../src/search');
const { wardOf } = require('../src/geo');

const top = (q, near) => search(q, { near, limit: 5 }).map((r) => r.name);
const LAKESIDE = { lat: 28.209, lng: 83.9595 };

test('Devanagari place names romanise the way Nepalis write them', () => {
  assert.equal(transliterate('खहरे चोक'), 'khahare chok');
  assert.equal(transliterate('पोखरा'), 'pokhara');
  assert.equal(transliterate('सरङ्कोट'), 'sarangkot');
  assert.equal(transliterate('फेवा ताल'), 'phewa tal');
  assert.equal(transliterate('प्रस्याङ्ग'), 'prasyang');
});

test('different spellings of the same name give the same search keys', () => {
  const same = [['खहरे चोक', 'Khahare Chowk'], ['पृथ्वी चोक', 'Prithvi Chok'], ['चिप्लेढुंगा', 'Chipledunga'], ['बिन्ध्यवासिनी', 'Vindhyavasini'], ['न्यूरोड', 'New Road'], ['फेवा ताल', 'Fewa Lake']];
  for (const [a, b] of same) assert.deepEqual(keys(a), keys(b), `${a} = ${b}`);
});

test('the gazetteer covers thousands of real Pokhara places, not just landmarks', () => {
  assert.ok(size() > 5000, `only ${size()} places`);
});

test('search finds toles, chowks, hotels, hospitals and shops in any spelling or script', () => {
  assert.match(top('khahare chowk')[0], /^Khahare chowk$/i);
  assert.match(top('chipledunga')[0], /^Chipledhunga/);
  assert.match(top('bindabasini')[0], /Bindhyabasini/);
  assert.match(top('सरङ्कोट')[0], /Sarangkot/);
  assert.match(top('manipal')[0], /Manipal Teaching Hospital/);
  assert.ok(top('bhatbhateni').some((n) => /Bhat-?Bhateni/i.test(n)));
  assert.ok(top('lakeside hotel', LAKESIDE).every((n) => /lake ?side/i.test(n) && /hotel/i.test(n)));
  assert.ok(top('bus park').includes('Tourist Bus Park'));
});

test('search tolerates typos and half-typed words', () => {
  assert.match(top('fishtial')[0], /Fishtail/);
  assert.match(top('lak', LAKESIDE)[0], /^Lakeside/);
  assert.deepEqual(top('newroad')[0], top('new road')[0]);
});

test('results say what and where each place is', () => {
  const [r] = search('Tal Barahi Ghat', { limit: 1 });
  assert.equal(r.ward, 6);
  assert.match(r.subtitle, /Ward 6/);
  assert.equal(r.outside, false);
});

test('reverse geocoding names the place, street, area and ward of a point', () => {
  const r = reverse({ lat: 28.21399, lng: 83.95776 }, wardOf); // Hallan Chowk
  assert.equal(r.label, 'Hallan Chowk');
  assert.match(r.subtitle, /Ward 6/);
  const far = reverse({ lat: 27.7, lng: 85.3 }, wardOf); // Kathmandu
  assert.match(far.subtitle, /Outside Pokhara/);
});
