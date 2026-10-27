// Persistent store: in-memory collections (fast reads, same API everywhere) backed by SQLite.
// - Each save writes only the documents that changed, in one transaction (WAL journal): a crash mid-save can't
//   corrupt or lose the database, and saves no longer rewrite everything.
// - First start with an old data/db.json: it is imported, then kept as db.json.migrated.
// - Node without node:sqlite (< 22.5): falls back to the JSON file, written atomically (temp file + rename).
// Next step for many servers / heavy load: PostgreSQL/PostGIS (see docs/ARCHITECTURE.md).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let DatabaseSync = null;
try { ({ DatabaseSync } = require('node:sqlite')); } catch { /* older Node: JSON fallback */ }

const empty = () => ({ users: {}, drivers: {}, trips: {}, sessions: {}, otps: {}, promos: {} });
const ARRAY = '\u0001'; // snapshot key prefix for list-valued collections (smsLog, clientErrors)

class Store {
  /** @param {string|null} file  data/db.json (SQLite goes next to it as db.sqlite); null = memory only (tests) */
  constructor(file) {
    this.file = file;
    this.db = empty();
    this.timer = null;
    this.sql = null;
    this.snap = new Map(); // `${coll}\0${id}` (or ARRAY + coll) → JSON last written
    if (!file) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (DatabaseSync) this.openSqlite(file);
    else if (fs.existsSync(file)) this.db = { ...empty(), ...this.readJson(file) };
  }

  openSqlite(jsonFile) {
    this.sqlFile = jsonFile.replace(/\.json$/i, '') + '.sqlite';
    this.sql = new DatabaseSync(this.sqlFile);
    this.sql.exec(`
      PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS docs (coll TEXT NOT NULL, id TEXT NOT NULL, json TEXT NOT NULL, PRIMARY KEY (coll, id)) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS lists (coll TEXT PRIMARY KEY, json TEXT NOT NULL);`);
    this.q = {
      upsert: this.sql.prepare('INSERT INTO docs (coll, id, json) VALUES (?, ?, ?) ON CONFLICT (coll, id) DO UPDATE SET json = excluded.json'),
      remove: this.sql.prepare('DELETE FROM docs WHERE coll = ? AND id = ?'),
      upsertList: this.sql.prepare('INSERT INTO lists (coll, json) VALUES (?, ?) ON CONFLICT (coll) DO UPDATE SET json = excluded.json'),
      removeList: this.sql.prepare('DELETE FROM lists WHERE coll = ?'),
    };
    let rows = 0;
    for (const { coll, id, json } of this.sql.prepare('SELECT coll, id, json FROM docs').all()) {
      (this.db[coll] ||= {})[id] = JSON.parse(json);
      this.snap.set(`${coll}\0${id}`, json);
      rows++;
    }
    for (const { coll, json } of this.sql.prepare('SELECT coll, json FROM lists').all()) {
      this.db[coll] = JSON.parse(json);
      this.snap.set(ARRAY + coll, json);
      rows++;
    }
    // One-time import of the old JSON snapshot.
    if (!rows && fs.existsSync(jsonFile)) {
      this.db = { ...empty(), ...this.readJson(jsonFile) };
      this.persist();
      fs.renameSync(jsonFile, `${jsonFile}.migrated`);
    }
  }

  // A corrupt file must stop the server, not silently start an empty database (that would lose every user).
  readJson(file) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw new Error(`Cannot read ${file}: ${e.message}. Restore it from a backup.`); }
  }

  id(prefix) { return `${prefix}_${crypto.randomBytes(6).toString('hex')}`; }

  /** Write changes soon (coalesced: many mutations in one tick = one transaction). */
  save() {
    if (!this.file || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      try { this.persist(); } catch (e) { console.error('store: save failed, retrying', e.message); setTimeout(() => this.save(), 2000); } // never crash the server
    }, 300);
  }

  /** Write changes now (shutdown, tests). */
  flush() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.file) this.persist();
  }

  persist() {
    if (!this.sql) {
      // JSON fallback, atomic: a crash leaves either the old or the new file, never half of one.
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.db));
      fs.renameSync(tmp, this.file);
      return;
    }
    const seen = new Set();
    this.sql.exec('BEGIN');
    try {
      for (const [coll, value] of Object.entries(this.db)) {
        if (Array.isArray(value)) {
          const key = ARRAY + coll, json = JSON.stringify(value);
          seen.add(key);
          if (this.snap.get(key) !== json) { this.q.upsertList.run(coll, json); this.snap.set(key, json); }
          continue;
        }
        for (const [id, doc] of Object.entries(value || {})) {
          const key = `${coll}\0${id}`, json = JSON.stringify(doc);
          seen.add(key);
          if (this.snap.get(key) !== json) { this.q.upsert.run(coll, id, json); this.snap.set(key, json); }
        }
      }
      for (const key of [...this.snap.keys()]) {
        if (seen.has(key)) continue;
        if (key.startsWith(ARRAY)) this.q.removeList.run(key.slice(1));
        else { const [coll, id] = key.split('\0'); this.q.remove.run(coll, id); }
        this.snap.delete(key);
      }
      this.sql.exec('COMMIT');
    } catch (e) {
      this.sql.exec('ROLLBACK');
      this.reloadSnapshot(); // back in step with what the database really holds, so the next save is correct
      throw e;
    }
  }

  reloadSnapshot() {
    this.snap.clear();
    for (const { coll, id, json } of this.sql.prepare('SELECT coll, id, json FROM docs').all()) this.snap.set(`${coll}\0${id}`, json);
    for (const { coll, json } of this.sql.prepare('SELECT coll, json FROM lists').all()) this.snap.set(ARRAY + coll, json);
  }

  close() { this.flush(); this.sql?.close(); this.sql = null; }

  put(coll, obj) { this.db[coll][obj.id] = obj; this.save(); return obj; }
  get(coll, id) { return this.db[coll][id]; }
  all(coll) { return Object.values(this.db[coll]); }
  del(coll, id) { delete this.db[coll][id]; this.save(); }
  reset() { this.db = empty(); }
}

module.exports = { Store };
