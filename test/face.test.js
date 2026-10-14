const test = require('node:test');
const assert = require('node:assert/strict');
const { createFaceVerifier, sigv4 } = require('../src/faceVerify');

const desc = (seed) => Array.from({ length: 128 }, (_, i) => Math.sin(seed * 31 + i) * 0.1);
const near = (d, eps = 0.01) => d.map((x, i) => x + (i % 2 ? eps : -eps));
const AWS = { FACE_PROVIDER: 'rekognition', AWS_REGION: 'ap-south-1', AWS_ACCESS_KEY_ID: 'AKIDEXAMPLE', AWS_SECRET_ACCESS_KEY: 'secret' };
const IMG = Buffer.from([0xff, 0xd8, 0xff, 1, 2, 3]);

test('SigV4 matches the AWS documentation example (IAM ListUsers)', () => {
  const h = sigv4({
    method: 'GET', host: 'iam.amazonaws.com', query: 'Action=ListUsers&Version=2010-05-08', region: 'us-east-1', service: 'iam',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8' },
    key: 'AKIDEXAMPLE', secret: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY', date: new Date('2015-08-30T12:36:00Z'),
  });
  assert.equal(h.authorization, 'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/iam/aws4_request, SignedHeaders=content-type;host;x-amz-date, Signature=5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7');
  assert.equal(h.host, undefined, 'fetch sets Host');
});

test('local provider: matches the enrolled face and rejects a replayed descriptor', async () => {
  const face = createFaceVerifier({ env: {} });
  assert.equal(face.serverSide, false);
  const ok = await face.verify({ descriptor: near(desc(3)), enrolled: desc(3), history: [] });
  assert.equal(ok.passed, true);
  assert.equal((await face.verify({ descriptor: desc(7), enrolled: desc(3) })).passed, false);
  const replay = await face.verify({ descriptor: near(desc(3)), enrolled: desc(3), history: [{ fp: ok.fp }] });
  assert.deepEqual([replay.passed, replay.error], [false, 'This selfie was already used — take a new one']);
});

test('config errors fail fast at startup', () => {
  assert.throws(() => createFaceVerifier({ env: { FACE_PROVIDER: 'magic' } }), /Unknown/);
  assert.throws(() => createFaceVerifier({ env: { FACE_PROVIDER: 'rekognition' } }), /credentials/);
});

test('rekognition: the server compares photos itself; one face ≥ 90% similarity passes', async () => {
  let call;
  const reply = (json, ok = true) => async (url, opts) => { call = { url, opts, body: JSON.parse(opts.body) }; return { ok, status: ok ? 200 : 400, json: async () => json }; };
  const face = (json, ok) => createFaceVerifier({ env: AWS, fetchImpl: reply(json, ok) });

  const r = await face({ FaceMatches: [{ Similarity: 98.765 }], UnmatchedFaces: [] }).verify({ photo: IMG, reference: IMG, descriptor: desc(1) });
  assert.deepEqual(r, { provider: 'rekognition', passed: true, similarity: 98.77, error: undefined });
  assert.equal(call.url, 'https://rekognition.ap-south-1.amazonaws.com/');
  assert.equal(call.opts.headers['x-amz-target'], 'RekognitionService.CompareFaces');
  assert.match(call.opts.headers.authorization, /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/\d{8}\/ap-south-1\/rekognition\/aws4_request/);
  assert.equal(call.body.TargetImage.Bytes, IMG.toString('base64'));

  assert.equal((await face({ FaceMatches: [{ Similarity: 70 }] }).verify({ photo: IMG, reference: IMG })).passed, false);
  const two = await face({ FaceMatches: [{ Similarity: 99 }], UnmatchedFaces: [{}] }).verify({ photo: IMG, reference: IMG });
  assert.deepEqual([two.passed, two.error], [false, 'More than one face in the selfie']);
  assert.equal((await face({}).verify({ photo: IMG, reference: null })).passed, false);
  await assert.rejects(face({ __type: 'com.amazonaws#InvalidImageFormatException' }, false).verify({ photo: IMG, reference: IMG }), (e) => e.status === 503 && /InvalidImageFormat/.test(e.message));
});

test('service: with a server-side provider the selfie photo is required and checked against the enrolled one', async () => {
  const { Store } = require('../src/store');
  const { createFiles } = require('../src/files');
  const { createService } = require('../src/service');
  const store = new Store(null);
  const files = createFiles(store, null);
  const seen = [];
  const face = { provider: 'fake', serverSide: true, verify: async (i) => { seen.push(i); return { provider: 'fake', passed: i.photo.equals(i.reference) }; } };
  const svc = createService({ store, files, face, routeFn: async () => ({ km: 1, min: 3, geometry: [] }) });
  const user = store.put('users', { id: 'usr_d', phone: '9800000002', name: 'Ram Gurung', roles: ['driver'] });
  const jpg = (b) => `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, b]).toString('base64')}`;
  const d = svc.seedDriver(user, { gender: 'male', vehicle: { type: 'bike', plate: 'GA 1 PA 1' }, faceRef: files.save(user.id, 'selfie', jpg(1)).id });
  d.faceCheck = { pending: true, reason: 'random' };

  await assert.rejects(svc.submitSelfie(user, { descriptor: desc(1) }), (e) => e.status === 400);
  assert.equal((await svc.submitSelfie(user, { photo: jpg(1) })).passed, true);
  assert.equal(d.faceCheck.pending, false);
  assert.equal((await svc.submitSelfie(user, { photo: jpg(2) })).passed, false);
  assert.equal(seen[0].reference.length, 4);
  assert.equal(d.faceCheck.history.at(-1).provider, 'fake');
});
