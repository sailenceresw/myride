// Cross-platform launcher: `npm run start:drive` sets APP_VARIANT for app.config.js and starts Expo.
// (Windows cmd can't run `APP_VARIANT=drive expo start` from npm scripts.)
const { spawn } = require('child_process');

const variant = process.argv[2] === 'drive' ? 'drive' : 'customer';
const args = ['expo', 'start', ...process.argv.slice(3)];
const child = spawn('npx', args, { stdio: 'inherit', shell: true, env: { ...process.env, APP_VARIANT: variant, EXPO_PUBLIC_APP_VARIANT: variant } });
child.on('exit', (code) => process.exit(code ?? 0));
