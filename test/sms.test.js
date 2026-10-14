const test = require('node:test');
const assert = require('node:assert/strict');
const { PROVIDERS, sendSms, templates, toLocal } = require('../src/sms');
const { Store } = require('../src/store');
const { createService } = require('../src/service');

const fakeFetch = (status, json, seen) => async (url, opts) => {
  seen?.push({ url, body: Object.fromEntries(new URLSearchParams(opts.body.toString())) });
  return { status, json: async () => json };
};
const withEnv = async (env, fn) => {
  const old = {};
  for (const k of Object.keys(env)) { old[k] = process.env[k]; if (env[k] == null) delete process.env[k]; else process.env[k] = env[k]; }
  try { return await fn(); } finally { for (const k of Object.keys(env)) { if (old[k] == null) delete process.env[k]; else process.env[k] = old[k]; } }
};

test('Sparrow: posts token/from/to/text form fields; success needs HTTP 200 + response_code 200', async () => {
  await withEnv({ SPARROW_TOKEN: 'tok', SPARROW_FROM: 'MyRide' }, async () => {
    const seen = [];
    const ok = await PROVIDERS.sparrow.send('9846000001', 'hi', { fetchImpl: fakeFetch(200, { count: 1, response_code: 200, response: '1 mesages has been queued for delivery', message_id: 77, credit_consumed: 1 }, seen) });
    assert.deepEqual(ok, { ok: true, id: 77, credit: 1 });
    assert.match(seen[0].url, /api\.sparrowsms\.com\/v2\/sms/);
    assert.deepEqual(seen[0].body, { token: 'tok', from: 'MyRide', to: '9846000001', text: 'hi' });
    const bad = await PROVIDERS.sparrow.send('9846000001', 'hi', { fetchImpl: fakeFetch(403, { response_code: 1002, response: 'Invalid Token' }) });
    assert.deepEqual(bad, { ok: false, error: 'Invalid Token' });
  });
});

test('Aakash: posts auth_token/to/text; success needs error:false and the number in data.valid', async () => {
  await withEnv({ AAKASH_TOKEN: 'ak' }, async () => {
    const seen = [];
    const ok = await PROVIDERS.aakash.send('9806000004', 'hi', { fetchImpl: fakeFetch(200, { error: false, message: '1 messages has been queued for delivery.', data: { valid: [{ id: 2673160, mobile: '977980*******', credit: 1, network: 'ncell', status: 'queued' }], invalid: [] } }, seen) });
    assert.deepEqual(ok, { ok: true, id: 2673160, network: 'ncell' });
    assert.match(seen[0].url, /sms\.aakashsms\.com\/sms\/v3\/send/);
    assert.deepEqual(seen[0].body, { auth_token: 'ak', to: '9806000004', text: 'hi' });
    const broke = await PROVIDERS.aakash.send('9806000004', 'hi', { fetchImpl: fakeFetch(200, { error: true, message: 'Not enough balance.', data: [] }) });
    assert.deepEqual(broke, { ok: false, error: 'Not enough balance.' });
    const invalid = await PROVIDERS.aakash.send('9806000004', 'hi', { fetchImpl: fakeFetch(200, { error: false, message: '', data: { valid: [], invalid: [{ mobile: '9806000004', status: 'aborted' }] } }) });
    assert.equal(invalid.ok, false);
  });
});

test('failover: Sparrow fails → Aakash delivers; no provider configured → clear error', async () => {
  await withEnv({ SMS_PROVIDER: 'sparrow', SMS_FALLBACK: 'aakash', SPARROW_TOKEN: 't', SPARROW_FROM: 'MyRide', AAKASH_TOKEN: 'a' }, async () => {
    const fetchImpl = async (url) => (url.includes('sparrow')
      ? { status: 500, json: async () => ({ response: 'Server down' }) }
      : { status: 200, json: async () => ({ error: false, data: { valid: [{ id: 9, network: 'ntc' }] } }) });
    const r = await sendSms('+977-9846000001', 'x', { fetchImpl });
    assert.equal(r.ok, true);
    assert.equal(r.provider, 'aakash');
    assert.deepEqual(r.attempts.map((x) => [x.provider, x.ok]), [['sparrow', false], ['aakash', true]]);
  });
  await withEnv({ SMS_PROVIDER: 'sparrow', SMS_FALLBACK: null, SPARROW_TOKEN: null, SPARROW_FROM: null }, async () => {
    assert.match((await sendSms('9846000001', 'x')).error, /No SMS provider configured/);
  });
  assert.equal((await sendSms('12345', 'x')).ok, false);
  assert.equal(toLocal('+9779846000001'), '9846000001');
});

test('OTP template: 6-digit code first (Android SMS Retriever <#> prefix), under 160 chars, app hash appended', async () => {
  await withEnv({ ANDROID_SMS_HASH: 'FA+9qCX9VSu' }, async () => {
    const t = templates.otp('482913');
    assert.match(t, /^<#> 482913 is your MyRide code/);
    assert.ok(t.endsWith('FA+9qCX9VSu'));
    assert.ok(t.length <= 160, String(t.length));
  });
});

// ---------- OTP flow in the service ----------
function svcWith({ smsOk = true } = {}) {
  let clock = Date.parse('2026-10-14T05:00:00Z');
  const sent = [];
  const store = new Store(null);
  const svc = createService({ store, now: () => clock, sms: async (phone, text) => { sent.push({ phone, text }); return smsOk ? { ok: true, provider: 'test' } : { ok: false, error: 'down' }; } });
  return { svc, store, sent, tick: (ms) => { clock += ms; } };
}
const codeOf = (text) => text.match(/(\d{6})/)[1];

test('OTP is sent by SMS, stored only as a hash, and verifies once', async () => {
  const { svc, store, sent } = svcWith();
  await svc.requestOtp('9846000001', { ip: '1.2.3.4' });
  assert.equal(sent.length, 1);
  const code = codeOf(sent[0].text);
  const rec = store.db.otps['9846000001'];
  assert.equal(rec.code, undefined);
  assert.match(rec.hash, /^[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify(store.db).includes(`"${code}"`), 'plain code never stored');
  const { token } = svc.verifyOtp('9846000001', code, { name: 'A' });
  assert.ok(token);
  assert.throws(() => svc.verifyOtp('9846000001', code), /expired/);
});

test('OTP limits: 60 s resend cooldown, 5 per hour per number, 5 wrong tries, per-IP cap', async () => {
  const { svc, tick } = svcWith();
  await svc.requestOtp('9846000002', { ip: 'a' });
  await assert.rejects(svc.requestOtp('9846000002', { ip: 'a' }), /wait/);
  for (let i = 0; i < 4; i++) { tick(61000); await svc.requestOtp('9846000002', { ip: 'a' }); }
  tick(61000);
  await assert.rejects(svc.requestOtp('9846000002', { ip: 'a' }), /Too many codes/);
  tick(3600000);
  await svc.requestOtp('9846000002', { ip: 'a' });
  for (let i = 1; i <= 5; i++) assert.throws(() => svc.verifyOtp('9846000002', '000000'), i < 5 ? /Wrong code/ : /Wrong code|Too many/);
  assert.throws(() => svc.verifyOtp('9846000002', '000000'), /Too many wrong|expired/);
  const limit = +process.env.OTP_IP_LIMIT || 20;
  const many = svcWith();
  for (let i = 0; i < limit; i++) await many.svc.requestOtp(`98460${String(10000 + i)}`, { ip: 'same' });
  await assert.rejects(many.svc.requestOtp('9846099999', { ip: 'same' }), /this network/);
});

test('if the SMS gateway fails, the user gets a retryable error and no OTP is stored', async () => {
  const { svc, store } = svcWith({ smsOk: false });
  await assert.rejects(svc.requestOtp('9846000003', { ip: 'x' }), (e) => e.status === 502);
  assert.equal(store.db.otps['9846000003'], undefined);
});
