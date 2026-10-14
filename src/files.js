// KYC documents, selfies and proof-of-delivery photos. Stored outside /public and served only to the owner or
// an admin. PRODUCTION: encrypted object storage (S3/R2 with SSE) + retention policy; Uber deletes check selfies
// within 24 h in the UK — set KYC_SELFIE_RETENTION_DAYS accordingly.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { KYC } = require('./config');

const MIME = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };
const MAGIC = { jpg: [0xff, 0xd8, 0xff], png: [0x89, 0x50, 0x4e, 0x47], webp: [0x52, 0x49, 0x46, 0x46], pdf: [0x25, 0x50, 0x44, 0x46] };
const httpErr = (status, msg) => Object.assign(new Error(msg), { status });

function createFiles(store, dir) {
  // Accepts a data URL ("data:image/jpeg;base64,...") and stores it after checking type and size.
  function save(ownerId, kind, dataUrl) {
    const m = /^data:([a-z/+-]+);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
    if (!m || !MIME[m[1]]) throw httpErr(400, 'Upload a JPG, PNG, WEBP or PDF');
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > KYC.maxUploadBytes) throw httpErr(413, 'File too large (max 1.5 MB) — retake the photo');
    const ext = MIME[m[1]];
    if (!MAGIC[ext].every((b, i) => buf[i] === b)) throw httpErr(400, 'File content does not match its type');
    const id = crypto.randomBytes(12).toString('hex');
    const rec = { id, ownerId, kind, mime: m[1], size: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex'), createdAt: Date.now() };
    if (dir) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${id}.${ext}`), buf);
      rec.file = `${id}.${ext}`;
    } else {
      rec.inline = buf.toString('base64'); // tests / no-disk mode
    }
    store.put('files', rec);
    return { id, kind, size: rec.size };
  }

  function read(id) {
    const rec = store.get('files', id);
    if (!rec) return null;
    const buf = rec.file ? fs.readFileSync(path.join(dir, rec.file)) : Buffer.from(rec.inline, 'base64');
    return { rec, buf };
  }

  return { save, read };
}

module.exports = { createFiles };
