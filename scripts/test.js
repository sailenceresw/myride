// Portable test runner: Node 20 has no glob support in `node --test`, Node 24 rejects a bare directory.
const { readdirSync } = require('fs');
const { join } = require('path');
const { spawnSync } = require('child_process');

const files = readdirSync('test').filter((f) => f.endsWith('.test.js')).map((f) => join('test', f));
process.exit(spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' }).status ?? 1);
