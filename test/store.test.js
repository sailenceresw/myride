const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Store } = require('../src/store');

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'myride-store-'));

test('data survives a restart: changes, in-place edits, deletions and list collections', () => {
  const file = path.join(tmpDir(), 'db.json');
  const a = new Store(file);
  a.put('users', { id: 'u1', name: 'Sita', phone: '9800000001' });
  a.put('trips', { id: 't1', status: 'searching', fare: 90 });
  a.put('trips', { id: 't2', status: 'searching', fare: 50 });
  a.db.smsLog = [{ phone: '9800000001', kind: 'otp' }];
  a.flush();
  a.get('trips', 't1').status = 'completed'; // most code edits documents in place, then saves
  a.del('trips', 't2');
  a.close();

  const b = new Store(file);
  assert.equal(b.get('users', 'u1').name, 'Sita');
  assert.equal(b.get('trips', 't1').status, 'completed', 'in-place edit was saved');
  assert.equal(b.get('trips', 't2'), undefined, 'deletion was saved');
  assert.deepEqual(b.db.smsLog, [{ phone: '9800000001', kind: 'otp' }]);
  assert.ok(fs.existsSync(b.sqlFile), 'stored in SQLite');
  b.close();
});

test('an old db.json is imported once, then kept as a backup', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'db.json');
  fs.writeFileSync(file, JSON.stringify({ users: { u9: { id: 'u9', name: 'Old Data' } }, trips: {}, drivers: {}, sessions: {}, otps: {}, promos: {} }));
  const s = new Store(file);
  assert.equal(s.get('users', 'u9').name, 'Old Data');
  assert.equal(fs.existsSync(file), false);
  assert.ok(fs.existsSync(`${file}.migrated`), 'original kept');
  s.close();
  assert.equal(new Store(file).get('users', 'u9').name, 'Old Data', 'and loaded from SQLite after that');
});

test('a corrupt data file stops the server instead of silently starting empty', () => {
  const file = path.join(tmpDir(), 'db.json');
  fs.writeFileSync(file, '{"users": {"u1": ');
  assert.throws(() => new Store(file), /Cannot read .*db\.json.*Restore it from a backup/);
});

test('memory-only store (tests) writes nothing', () => {
  const s = new Store(null);
  s.put('users', { id: 'x', name: 'Temp' });
  s.flush();
  assert.equal(s.get('users', 'x').name, 'Temp');
});
