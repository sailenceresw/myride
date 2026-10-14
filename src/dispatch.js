const { SERVICES, GANDAKI, DISPATCH, CITY, MEMBERSHIP } = require('./config');
const { haversineKm } = require('./geo');

// Can this driver legally and physically serve this service?
function canServe(driver, serviceId) {
  const svc = SERVICES[serviceId];
  const v = driver.vehicle;
  if (!svc || !v || !driver.verified || driver.suspended) return false;
  if (svc.kind === 'ride') {
    if (v.type !== svc.vehicle || (v.fuel === 'ev') !== (svc.fuel === 'ev')) return false;
    // Gandaki: only public (black-plate / public EV) cars, max 5 seats.
    if (v.type === 'car') return v.publicPlate === true && v.seats <= GANDAKI.maxSeats;
    return true;
  }
  if (svc.vehicle === 'bike') return v.type === 'bike' && driver.acceptsDelivery !== false;
  // Logistics: matching goods vehicle registered for goods transport.
  return v.type === svc.vehicle && v.goodsPermit === true;
}

function hoursLeftToday(driver, now = Date.now()) {
  const today = new Date(now).toISOString().slice(0, 10);
  const used = driver.shiftDate === today ? driver.onlineMinutesToday || 0 : 0;
  return GANDAKI.maxDriverHoursPerDay - used / 60;
}

/**
 * Rank eligible drivers for a request, nearest first.
 * @returns [{driver, pickupKm}]
 */
// "Heading home" (like Uber's destination filter): only trips that end meaningfully closer to the driver's home.
function towardHome(d, pickup, drop) {
  const home = d.homeFilter;
  return haversineKm(drop, home) <= haversineKm(d.loc, home) - 1 && haversineKm(pickup, home) <= haversineKm(d.loc, home) + 1.5;
}

function findCandidates(drivers, { serviceId, pickup, drop, womenOnly = false, exclude = [], priority = false }, now = Date.now()) {
  const svc = SERVICES[serviceId];
  const radius = svc?.logistics ? DISPATCH.logisticsRadiusKm : priority ? MEMBERSHIP.benefits.priorityRadiusKm : DISPATCH.searchRadiusKm;
  return drivers
    .filter((d) => d.online && d.status === 'idle' && d.loc && !exclude.includes(d.id) && !d.faceCheck?.pending)
    .filter((d) => canServe(d, serviceId))
    .filter((d) => hoursLeftToday(d, now) > 0)
    .filter((d) => !womenOnly || d.gender === 'female')
    .filter((d) => !d.homeFilter || !drop || towardHome(d, pickup, drop))
    .map((d) => ({ driver: d, pickupKm: haversineKm(d.loc, pickup) * CITY.detourFactor }))
    .filter((c) => c.pickupKm <= radius)
    // Prefer nearer drivers; break near-ties (≤300 m) by rating.
    .sort((a, b) => (Math.abs(a.pickupKm - b.pickupKm) > 0.3 ? a.pickupKm - b.pickupKm : (b.driver.rating || 0) - (a.driver.rating || 0)))
    .slice(0, DISPATCH.offerToNearest);
}

module.exports = { canServe, findCandidates, hoursLeftToday, towardHome };
