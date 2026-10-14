const path = require('path');
const { Store } = require('./src/store');
const { createApp } = require('./src/app');
const { route } = require('./src/geo');
const { startSimulator } = require('./src/simulator');

const PORT = +process.env.PORT || 3000;
const store = new Store(process.env.MYRIDE_DB || path.join(__dirname, 'data', 'db.json'));
const { app, svc } = createApp({ store, routeFn: route, uploadsDir: process.env.MYRIDE_UPLOADS || path.join(__dirname, 'data', 'uploads') });

setInterval(() => svc.tick(), 2000);
if (process.env.SIMULATE === '1') {
  const sim = startSimulator({ store, svc, routeFn: route });
  console.log(`Simulator: ${sim.count} demo drivers online across Pokhara`);
}

const server = app.listen(PORT, () => console.log(`MyRide running on http://localhost:${PORT}  (driver: /driver.html, admin: /admin.html)`));
const shutdown = () => { store.flush(); server.close(() => process.exit(0)); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
