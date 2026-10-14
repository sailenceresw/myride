// Minimal persistent store: in-memory collections snapshotted to a JSON file.
// Swap for PostgreSQL/PostGIS before production (see docs/ARCHITECTURE.md).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const empty = () => ({ users: {}, drivers: {}, trips: {}, sessions: {}, otps: {}, promos: {} });

class Store {
  constructor(file) {
    this.file = file;
    this.db = empty();
    if (file && fs.existsSync(file)) {
      try { this.db = { ...empty(), ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch { /* corrupt snapshot: start fresh */ }
    }
    this.timer = null;
  }

  id(prefix) { return `${prefix}_${crypto.randomBytes(6).toString('hex')}`; }

  save() {
    if (!this.file || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.db));
    }, 300);
  }

  flush() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.file) fs.writeFileSync(this.file, JSON.stringify(this.db));
  }

  put(coll, obj) { this.db[coll][obj.id] = obj; this.save(); return obj; }
  get(coll, id) { return this.db[coll][id]; }
  all(coll) { return Object.values(this.db[coll]); }
  del(coll, id) { delete this.db[coll][id]; this.save(); }
  reset() { this.db = empty(); }
}

module.exports = { Store };
