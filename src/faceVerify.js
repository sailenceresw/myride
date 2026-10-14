// Face verification for driver selfie checks, behind one interface so the vendor can change:
//
//   FACE_PROVIDER=local        (default) the Drive app computes a 128-d descriptor with face-api.js; the server
//                              compares it with the enrolled one and rejects replayed descriptors.
//   FACE_PROVIDER=rekognition  the server compares the selfie PHOTO itself with AWS Rekognition CompareFaces —
//                              nothing computed on the phone is trusted. Env: AWS_REGION (ap-south-1 = Mumbai,
//                              closest to Nepal), AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, [AWS_SESSION_TOKEN],
//                              FACE_MIN_SIMILARITY (default 90).
//
// Every provider returns { provider, passed, distance?, similarity?, error? }.
const crypto = require('crypto');
const { KYC } = require('./config');
const { faceDistance } = require('./kyc');

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const hmac = (key, s) => crypto.createHmac('sha256', key).update(s).digest();

/** Fingerprint of a descriptor: a real camera never produces the same one twice, so a repeat is a replay. */
const fingerprint = (d) => sha256(d.map((x) => x.toFixed(3)).join(',')).slice(0, 16);

/** AWS Signature Version 4 headers (https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_sigv-create-signed-request.html). */
function sigv4({ method = 'POST', host, path = '/', query = '', headers = {}, body = '', region, service, key, secret, session, date = new Date() }) {
  const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = amzDate.slice(0, 8);
  const all = { ...headers, host, 'x-amz-date': amzDate, ...(session ? { 'x-amz-security-token': session } : {}) };
  const names = Object.keys(all).map((n) => n.toLowerCase()).sort();
  const lower = Object.fromEntries(Object.entries(all).map(([k, v]) => [k.toLowerCase(), String(v).trim()]));
  const signed = names.join(';');
  const canonical = [method, path, query, names.map((n) => `${n}:${lower[n]}\n`).join(''), signed, sha256(body)].join('\n');
  const scope = `${day}/${region}/${service}/aws4_request`;
  const signingKey = [day, region, service, 'aws4_request'].reduce(hmac, `AWS4${secret}`);
  const signature = crypto.createHmac('sha256', signingKey).update(['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n')).digest('hex');
  const { host: _host, ...send } = lower; // fetch sets Host itself
  return { ...send, authorization: `AWS4-HMAC-SHA256 Credential=${key}/${scope}, SignedHeaders=${signed}, Signature=${signature}` };
}

const PROVIDERS = {
  local: {
    configured: () => true,
    async verify({ descriptor, enrolled, history = [] }) {
      if (!Array.isArray(descriptor)) return { provider: 'local', passed: false, error: 'No face found — retake the selfie' };
      const fp = fingerprint(descriptor);
      if (history.some((h) => h.fp === fp)) return { provider: 'local', passed: false, fp, error: 'This selfie was already used — take a new one' };
      const dist = faceDistance(descriptor, enrolled);
      return { provider: 'local', passed: dist <= KYC.faceMatchThreshold, distance: Number.isFinite(dist) ? +dist.toFixed(4) : null, fp };
    },
  },
  rekognition: {
    configured: (env) => !!(env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY),
    async verify({ photo, reference }, { env, fetchImpl }) {
      if (!photo || !reference) return { provider: 'rekognition', passed: false, error: photo ? 'No enrolled selfie on file — ops must re-verify' : 'Selfie photo required' };
      const region = env.AWS_REGION || 'ap-south-1', host = `rekognition.${region}.amazonaws.com`;
      const body = JSON.stringify({ SourceImage: { Bytes: reference.toString('base64') }, TargetImage: { Bytes: photo.toString('base64') }, SimilarityThreshold: 0, QualityFilter: 'AUTO' });
      const headers = sigv4({ host, body, region, service: 'rekognition', key: env.AWS_ACCESS_KEY_ID, secret: env.AWS_SECRET_ACCESS_KEY, session: env.AWS_SESSION_TOKEN, headers: { 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': 'RekognitionService.CompareFaces' } });
      const res = await fetchImpl(`https://${host}/`, { method: 'POST', headers, body, signal: AbortSignal.timeout(10000) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw Object.assign(new Error(`Face verification unavailable (${json.__type?.split('#').pop() || res.status})`), { status: 503, expose: true });
      const faces = (json.FaceMatches?.length || 0) + (json.UnmatchedFaces?.length || 0);
      const similarity = Math.max(0, ...(json.FaceMatches || []).map((m) => m.Similarity));
      const min = +env.FACE_MIN_SIMILARITY || 90;
      // Exactly one face, and it is the enrolled driver (no second person in frame, no photo-of-a-photo crowd).
      return { provider: 'rekognition', passed: faces === 1 && similarity >= min, similarity: +similarity.toFixed(2), error: faces === 1 ? undefined : faces ? 'More than one face in the selfie' : 'No face found — retake the selfie' };
    },
  },
};

function createFaceVerifier({ env = process.env, fetchImpl = fetch } = {}) {
  const name = env.FACE_PROVIDER || 'local';
  const p = PROVIDERS[name];
  if (!p) throw new Error(`Unknown FACE_PROVIDER "${name}"`);
  if (!p.configured(env)) throw new Error(`FACE_PROVIDER=${name} is missing credentials`);
  return { provider: name, serverSide: name !== 'local', verify: (input) => p.verify(input, { env, fetchImpl }) };
}

module.exports = { createFaceVerifier, sigv4, fingerprint };
