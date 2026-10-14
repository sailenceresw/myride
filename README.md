# MyRide — rides, parcels & logistics for Pokhara, Nepal

All 33 wards of Pokhara Metropolitan City (incl. former Lekhnath, wards 26–33). Motorcycle / EV motorcycle / car / EV car rides
("bike" in the code = motorcycle/scooter), motorcycle parcels, and logistics — cargo vans, 4×4 jeeps (hill wards), pickups and trucks — with intercity lanes — priced below the Gandaki legal cap and below Pathao/Yango estimates.

Research, wards, pricing, ROI model, KYC & payroll design: **[docs/RESEARCH.md](docs/RESEARCH.md)**.

## Run

```bash
npm install
npm run dev        # SIMULATE=1: 28 demo drivers (core wards + Lekhnath + van, jeep, trucks) accept and drive trips
npm start          # no simulator
npm test           # 88 tests: pricing/legal cap, 33 wards, logistics, Plus/promos/referrals, KYC & face checks,
                   # payroll, economics, full API flows (portals, KYC→approval, fleet, payouts, eSewa)
```

| Portal | URL | Who |
|---|---|---|
| MyRide (rider app: Ride · Parcel · Logistics · Trips · Account/Plus) | http://localhost:3000/ | riders, shops |
| **MyRide Drive** (KYC application, selfie checks, earnings, weekly payouts) | http://localhost:3000/driver.html | partners & fleet employees |
| **MyRide Ops** (KYC review, fleet, payouts, promos, ward demand, economics) | http://localhost:3000/admin.html | staff (dev admin `9800000000`) |
| Fare chart (MyRide vs Gandaki max vs national draft vs market) | http://localhost:3000/fares.html | everyone |
| Live trip link | `/track.html?t=<shareToken>` | family/friends |

Each portal has its own login session; a rider token cannot call Drive endpoints and vice-versa. In dev mode OTPs are
shown on screen; `MYRIDE_AUTO_VERIFY=1` auto-approves clean partner KYC applications.

## Environment

| Var | Purpose |
|---|---|
| `PORT` | default 3000 |
| `NODE_ENV=production` | hides dev OTPs, disables default admin & sandbox payments |
| `ADMIN_PHONES` | comma-separated admin mobile numbers |
| `OSRM_URL` | routing server (default public OSRM demo — self-host for production) |
| `MYRIDE_FEDERAL_DRAFT=0` | apply Gandaki rules only (default also complies with the national draft: 10% commission, Rs 25/55 per km cap, 1% accident fund) |
| `MYRIDE_OFFLINE=1` | skip OSRM, use straight line × 1.33 measured detour factor |
| `MYRIDE_DB`, `MYRIDE_UPLOADS` | JSON snapshot path, KYC/POD upload folder (default `data/`) |
| `ESEWA_*`, `KHALTI_SECRET_KEY` | payment providers (defaults: public sandboxes) |

## Layout

```
src/config.js      cities, Gandaki rules, vehicles & licence categories, tariffs, logistics, Plus, promos, KYC, payroll
src/geo.js         OSRM routing, city boundary & ward polygons (point-in-polygon), service-area rules
src/pricing.js     quotes: legal cap, intercity logistics, helpers/insurance, VAT/fee split, discount stacking
src/rewards.js     MyRide Plus, first ride free, referrals, credits, promo codes
src/kyc.js         application validation, face-descriptor matching, Real-Time ID (random selfie) checks
src/payroll.js     weekly payouts: partner balances, employee wages (OT, incentives, SSF), bank CSV
src/dispatch.js    eligibility (plates, seats, permits, suspensions, selfie pending, 12 h), heading-home filter, ranking
src/service.js     auth/portals, trips, ledger wallet, onboarding & review, fleet, face checks, admin
src/economics.js   v1→v2 lever bridge, 24-month projection & ROI, fleet unit economics
src/app.js         Express API + SSE; portal guards; private file serving
public/            rider app, MyRide Drive (face.js = face-api.js liveness + descriptors), Ops console, tracker
data/              places.json, route-matrix.json, wards.json, pokhara-boundary.json
tools/             geocode.js (landmarks + OSRM matrix), wards.js (OSM ward polygons + road distances)
```

## Before production
- PostgreSQL + PostGIS; Redis pub/sub for SSE; encrypted object storage for KYC files with a retention policy.
- Server-side face matching + anti-spoofing liveness (vendor); Nepal Police report verification workflow.
- Self-hosted OSRM (Nepal extract); SMS OTP gateway; eSewa/Khalti merchant keys; Fonepay QR; CorporatePay API.
- Native apps (React Native / Flutter) on this API. Confirm Gandaki regulation status; register as operator.
