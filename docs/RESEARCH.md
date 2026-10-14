# MyRide: Pokhara market research, pricing, ROI and operating model (v2)

*Terminology: **"bike" = motorcycle/scooter (two-wheeler, मोटरसाइकल)** throughout. Research dates: 12–14 October 2026. Money is in NPR; "L" means lakh (100,000). Figures marked **estimate** or **DECISION** are our assumptions, not official tariffs. Verify them with live data before launch.*

**What changed in v2:** v2 covers all 33 wards, including Lekhnath. It adds corrected landmark positions, retuned bike fares, a revised profit model, MyRide Plus, free rides and referrals, intercity logistics, Uber-style driver KYC with random face checks, a salaried fleet with weekly payroll, and separate rider, driver and ops portals.

---

## 1. Pokhara Metropolitan City: all 33 wards (measured)

- Pokhara Metropolitan City has **33 wards (Pokhara-1 … Pokhara-33), not 32**.
- Wards **26–33 are the former Lekhnath Municipality**, merged in 2017 to form Pokhara-Lekhnath.
- Wards 18 and 20–25 were village development committees (VDCs) before the merger.
- We downloaded the **official OpenStreetMap boundary of the city (relation 6104486) and of each ward** (`tools/wards.js` → `data/wards.json`, `data/pokhara-boundary.json`).
- **Area check:** the OSM polygons add up to **462.1 km²**, against the official **464.24 km² (99.5%)**.
- **Population check:** the ward table sums to **513,504**, the 2021 census figure.
- **Radius check:** the whole city lies within **18.4 km of Zero Kilometer**, so Gandaki's **20 km operating radius covers every ward**.

| Ward | Name | Pop. 2021 | km² | Road km to centre | | Ward | Name | Pop. 2021 | km² | Road km to centre |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Bagar | 13,947 | 1.5 | 3.8 | | 18 | Sarangkot | 12,945 | 17.8 | 8.1 |
| 2 | Miruwa | 10,100 | 0.6 | 3.1 | | 19 | Lamachaur/Puranchaur | 13,855 | 24.8 | 14.9 |
| 3 | Nadipur | 8,284 | 0.6 | 3.7 | | 20 | Bhalam | 3,936 | 22.8 | 12.1 |
| 4 | Gairapatan | 9,152 | 0.6 | 2.6 | | 21 | Nirmal Pokhari | 9,070 | 36.3 | 12.7 |
| 5 | Malepatan | 22,325 | 1.5 | 0.9 | | 22 | Pumdi Bhumdi | 7,596 | 32.3 | 11.9 |
| 6 | Baidam (Lakeside, Damside) | 14,455 | 6.3 | 2.3 | | 23 | Chapakot | 4,276 | 47.8 | 17.0 |
| 7 | Masbar | 16,139 | 2.2 | 1.1 | | 24 | Kaskikot | 5,950 | 18.2 | 11.2 |
| 8 | Shrijana Chowk | 25,439 | 1.8 | 1.0 | | 25 | Hemja | 17,597 | 22.3 | 11.0 |
| 9 | Naya Bazar | 15,981 | 1.2 | 2.0 | | **26** | **Budhi Bazar** | 16,777 | 13.1 | 9.0 |
| 10 | Amarsingh | 18,435 | 2.0 | 2.7 | | **27** | **Tal Chowk** | 16,377 | 11.2 | 9.9 |
| 11 | Ranipauwa | 17,594 | 6.9 | 5.8 | | **28** | **Kalika** | 4,224 | 17.6 | 19.3 |
| 12 | Sital Devi | 12,710 | 1.5 | 4.2 | | **29** | **Bhandardhik** | 16,257 | 4.3 | 12.1 |
| 13 | Miya Patan | 22,399 | 15.6 | 8.4 | | **30** | **Khudi** (Pokhara Univ., Sisuwa) | 16,192 | 9.0 | 13.5 |
| 14 | Majheripatan (Intl Airport) | 31,561 | 13.8 | 7.0 | | **31** | **Begnas** | 8,702 | 24.1 | 21.4 |
| 15 | Rambazar | 24,406 | 4.6 | 4.9 | | **32** | **Gagangauda** | 14,683 | 14.1 | ~21 |
| 16 | Batulechaur | 24,465 | 34.5 | 10.4 | | **33** | **Bharat Pokhari** | 11,670 | 43.4 | ~19 |
| 17 | Birauta | **46,005** | 8.0 | 4.7 | | | *Total* | **513,504** | **462.1** | |

**What this means for the business:**
- **The demand is concentrated.** 43% of the population (223,000 people) lives in 12 dense core wards (1–5, 7–10, 12, 15 and 17) that cover only **26 km², or 5.6% of the city**. Launch supply goes there first.
- **Lekhnath (wards 26–33) has 105,000 people (20%)** spread over 137 km², 9–21 km by road from the centre. Trips between Lekhnath and the city are long, and a driver who takes one ends up far from the next rider. In our demo the Lekhnath drivers drifted into the city and Lekhnath pickups ran out of drivers.
  - The fix is a **Lekhnath driver hub**, plus a **"heading home" filter** (like Uber's destination filter, 2 uses a day). A driver who is in the city only gets trips that move them back toward Lekhnath.
- **Most residents live far from the centre.** 54% live more than 5 km by road from it, and the population-weighted average distance is 7.5 km. Average trips are therefore longer than the 3.5 km measured between core landmarks. The profit model uses 4.2 km for bikes and 6 km for cars.

**Corrections from v1:**
- Nominatim's points for "Lakeside", "Damside", "Chhorepatan" and "Talchowk" fell in the wrong wards. They are now checked against the ward polygons: Lakeside and Damside are in Ward 6, Chhorepatan in Ward 17, Talchowk in Ward 27.
- **Rupa Lake is not in Pokhara.** It is in Rupa Rural Municipality. Drops there are allowed because it is inside the 20 km radius, but pickups are not.

**Service-area rules in the app:**
- **Pickups:** anywhere inside the city boundary, all 33 wards.
- **Ride and parcel drops:** within 20 km of the centre.
- **Logistics drops:** any destination up to 320 km away.
- **Intercity lanes:** Kathmandu, Bharatpur, Butwal, Bhairahawa, Damauli, Syangja, Baglung, Beni and Besisahar.

**Expansion:** cities are configured in `src/config.js → CITIES`. Kathmandu, Bharatpur and Butwal are already listed but switched off. To open a city, add its OSM boundary and encode its province's rules. Bagmati's ride-sharing rules were still in draft in 2026.

---

## 2. Regulation (Gandaki Province + national)

| Rule | Value | How the app enforces it |
|---|---|---|
| Two-wheeler fare | Rs 30 + Rs 16.85/km, min Rs 46.85 | Every ride quote is capped at this ceiling |
| Four-wheeler fare | Rs 60 + Rs 48.5/km, min Rs 156.5 (the notice's own formula gives 157) | Capped |
| Mandated discount | 10% petrol, 15% electric | Built into the cap |
| Cars | Black plate, ≤ 5 seats, **max 300 per company** | Checked at KYC; cap checked when ops approve |
| Platform fee | ≤ 12% per transaction | Capped per trip |
| Driver hours | ≤ 12 per day | Drivers are blocked from going online |
| Radius | 20 km | Checked on every quote |
| VAT | 5% on platform transport and delivery (from 17 Jul 2026); 13% on fees and subscriptions | Shown on the receipt |
| Goods transport | Not covered by the passenger fare schedule. Needs goods-registered vehicles and licence category **F** (minitruck) or **G** (truck). | KYC rule |

The rules were suspended for a time; the province formally implemented them in February 2026, and registration re-opened in July 2026. **Confirm the current status with the Gandaki Ministry of Physical Infrastructure Development & Transport Management before launch.**

### National draft: Digital Mobility Service Operation Standards 2082 (2026)
Published for consultation on 20 Apr 2026. As of the latest report (Kathmandu Post, 30 Jul 2026) it is **still under ministry review**. Some April articles called it "finalised", which conflicts with the later reporting.

| Draft rule | Value | MyRide |
|---|---|---|
| Max rate | **Rs 25/km motorcycle, Rs 55/km car**; providers may charge at least 2 km | Enforced (stricter of this and Gandaki) |
| Commission | **≤ 10% of each fare** (Gandaki allows 12%) | Rides capped at 10%; parcels/logistics keep 12% |
| Traffic Accident Fund | 1% of the fare + 0.5% of platform income (pays up to Rs 10 lakh per major accident) | Deducted in the fare split |
| Night / bad weather / remote | Up to +20% | Not charged |
| Surge | 30% motorcycle / 40% car | No surge |
| Vehicles | ≤ 15 years old; pollution test; EV two-wheeler ≥ 1.5 kW; GPS, SOS button, helmets (motorcycle); first-aid kit (car) | To be added to the KYC checklist |
| Drivers | 18+, licence held ≥ 1 year, life insurance + SSF; female passengers can choose female drivers | Women-preferred option already in the app |
| Registration | Rs 1,000 per two-wheeler and Rs 5,000 per four-wheeler a year; central DoTM system via API | Pending |

**One interpretation risk:** one outlet (Nepali Telecom) described the Rs 25/55 figures as *minimum* fares. The Kathmandu Post and myRepublica both call them *caps*. If they turned out to be floors, a Rs 25/km motorcycle minimum would conflict with Gandaki's legal maximum (about Rs 15–17/km). Watch the final text.

MyRide applies these draft rules by default. Set `MYRIDE_FEDERAL_DRAFT=0` to apply Gandaki rules only. Early compliance costs about **Rs 1.5 lakh/month of EBITDA at maturity** (month 12: Rs 11.8 L with the draft rules vs Rs 13.3 L under Gandaki only).

### Market benchmarks for fares ("bhada")
- **Kathmandu metered taxi (DoTM tariff):** Rs 50 flag-down including the first km, then Rs 10 per 200 m (Rs 50/km). Meters are rarely used; street taxis quote Rs 500–1,200 from the airport to Lakeside.
- **Car hire with driver in Pokhara:** half day Rs 2,999–4,800; full day Rs 4,999–8,500 (jeep Rs 7,999–10,500); about Rs 700–900/hour with a 4-hour minimum.
- **Scooter/motorcycle self-drive rental in Pokhara:** Rs 1,000–1,500/day in the city for a 125 cc scooter; Rs 3,000–5,000 for a Royal Enfield, Xpulse or Himalayan; higher for trips outside Pokhara.

---

## 3. Competitors

| | Pathao | inDrive | Yango | Street taxi |
|---|---|---|---|---|
| Pokhara | Bike, car, food, parcel | Reportedly the largest fleet; riders and drivers negotiate the fare | Expanding | Lakeside and airport |
| Fare (estimate) | ~Rs 25/km bike; car base 90–110 + 55–65/km | Negotiated | From Rs 40; car base 80–100 + 45–55/km | Airport → Lakeside Rs 500–1,200 |
| Driver take | **Rs 12 flat** on bikes (Aug 2026); ~20% on cars | ~10% | ~3% for 3 years | 0 |

Driver economics: drivers' operating cost is about **Rs 14–15/km**, and they report earning **Rs 12–14/km** (Kathmandu Post, Aug 2026).

---

## 4. MyRide pricing (v2.1: motorcycle & car fares checked against Nepal rules)

All ride tariffs now sit **under every legal limit without needing to be clamped**: the Gandaki schedule after its 10% (petrol) / 15% (EV) discount, and the national draft cap. A test enforces this every 0.1 km from 0.3 to 20 km. Live chart: `/fares.html`.

| Service | MyRide tariff | Minimum fare | Legal minimum ceiling | Notes |
|---|---|---|---|---|
| Motorcycle (petrol) | Rs 10 + Rs 16/km | **Rs 40** | Rs 42.17 (Gandaki 46.85 −10%) | Low base: short core-ward hops are the most common trip |
| Green Motorcycle (EV) | Rs 9 + Rs 14.7/km | **Rs 37** | Rs 39.82 (−15%) | |
| Car (petrol, black plate) | **Rs 20 + Rs 42/km** (was 55 + 42) | **Rs 105** (was 135) | **Rs 110** (draft Rs 55/km × 2 km); Gandaki Rs 140.85 | The old minimum exceeded the draft cap on short trips |
| Green Car (EV) | **Rs 18 + Rs 39/km** (was 50 + 39) | **Rs 99** (was 125) | Rs 110 (draft); Gandaki Rs 133 | |

| Trip | MyRide | Driver keeps | Legal max | Pathao est. | Yango est. | Taxi meter |
|---|---|---|---|---|---|---|
| Motorcycle, 3.5 km | **Rs 66** | Rs 56 | Rs 80 | 88 | 77 | — |
| Motorcycle, Talchowk → Lakeside (11.8 km) | **Rs 199** | Rs 177 | Rs 207 | 295 | 260 | — |
| Car, 3.5 km | **Rs 167** | Rs 141 | Rs 193 | 310 | 265 | 175 |
| Car, Lakeside → Airport (7.5 km) | **Rs 335** | Rs 282 | Rs 381 | 550 | 465 | 375 |

- **Platform fee:** at most 10% per ride (Rs 10 cap on motorcycles, so about Rs 6.7 on a 3.5 km trip; 10% cars; 9% EV cars); 12% on parcels; 10% on logistics.
- **Where competitors match or beat us:** at 1 km, motorcycles tie Pathao and Yango at Rs 40, and the taxi meter is cheaper for car trips under 2 km. MyRide is cheaper at every other distance.
- **EV driver pay:** Green Motorcycle drivers earn about Rs 14–14.5/km, below the Rs 14–15/km petrol benchmark. Their running cost is only about Rs 4/km, so they still net more than petrol riders.

### Logistics (goods vehicles; intercity rate beyond 25 km includes a share of the empty return)

| Vehicle | Base | City /km | Intercity /km | Example |
|---|---|---|---|---|
| Mini-truck 750 kg | Rs 450 (2 km) | 45 | 55 | 7 km house move, Rs 675 |
| **Cargo van 800 kg (covered)** | Rs 600 (3 km) | 50 | 60 | 10 km, 500 kg: Rs 950 · Pokhara → Kathmandu Rs 12,200 |
| **4×4 jeep 1 t (hill & rough roads)** | Rs 900 (3 km) | 70 | 80 | Chipledhunga → Sarangkot (8.4 km) Rs 1,277 · Pokhara → Kathmandu Rs 16,440 |
| Pickup 1.5 t | Rs 800 (3 km) | 60 | 70 | **Pokhara → Kathmandu Rs 14,370** |
| Light truck 4 t | Rs 1,800 (5 km) | 90 | 95 | Pokhara → Kathmandu Rs 20,225 |
| Truck 9 t | Rs 3,500 (5 km) | 140 | 140 | **Pokhara → Kathmandu Rs 30,800** |

- **Van vs jeep:**
  - The **cargo van** (e.g. Suzuki Super Carry, Maruti Eeco cargo) is enclosed, for e-commerce, furniture and shop stock that must stay dry in the monsoon.
  - The **4×4 jeep** (Bolero or Scorpio 4WD) reaches the low-density hill wards with steep or partly unpaved roads: 18 Sarangkot, 20 Bhalam, 21 Nirmal Pokhari, 22 Pumdi Bhumdi, 23 Chapakot, 24 Kaskikot, 28 Kalika and 33 Bharat Pokhari, plus trek trailheads. The app **recommends the jeep automatically** when the pickup or drop is in one of these wards.
  - Both need licence category **B** and a goods-registered vehicle.
  - The jeep deliberately costs more than a pickup on flat city roads (it carries a 4WD premium); passenger 4×4 day hire in Pokhara is Rs 8,000–10,500.
  - **No published Nepali freight rates** exist for vans or jeeps. These prices are cost-based (fuel at Rs 195–200/L plus maintenance and a margin) and need checking with local operators.
- **Extras:** loading helpers cost Rs 800 each (the minimum wage is about Rs 754/day). Goods-in-transit insurance is 0.3% of the declared value, minimum Rs 100. Weight limits are enforced. The receiver must give a delivery code, and the driver takes a proof-of-delivery photo. Businesses can add a PAN/VAT number for receipts.
- **Benchmark:** a private sedan from Pokhara to Kathmandu costs Rs 14,000–18,000 one way (vehiclehiringnepal, June 2026).
- **Caveat:** we found **no published Nepali truck tariff**. Validate the truck rates with Pokhara transport entrepreneurs and the local syndicates before launch.

---

## 5. MyRide Plus, free rides and promo codes

**How Uber One actually works (and where the brief needed correcting):** Uber One costs US$9.99/month or $96/year. Members get **6% back as credits on rides** and **Rs 0 delivery fees**. Uber One does **not** include free rides. Uber's free rides come from **first-ride and referral promos**. MyRide does both:

| | Free | **MyRide Plus** |
|---|---|---|
| Price | Rs 0 | **Rs 199.99/month** or **Rs 1,999.99/year** (12 months for the price of 10, 17% off); 7-day trial for first-time members |
| Discount | — | **5% off every ride, parcel and logistics job**, up to Rs 25 per trip |
| Cancellations | Rs 20–50 fee after the free waiting time | **3 free cancellations a month** (MyRide still pays the driver) |
| Cash-on-delivery fee | 1% (min Rs 10) | Waived |
| Matching | 5 km search radius | **Priority:** 7 km radius when it's busy |

- **Free first ride:** every new rider's first trip is free up to **Rs 100**, which covers an average city bike ride completely.
- **Referrals:** the friend gets the free first ride, and the referrer gets **Rs 50 in credit** once the friend finishes it (up to 20 referrals a month).
- **Codes:** FREERIDE (one free ride up to Rs 120, 500 uses), POKHARA20, NAMASTE, GREEN10 (EV only) and SHIFT500 (house shifting). Ops can create percent, flat or free-ride codes with an expiry date, a usage limit, new-riders-only and service restrictions.
- **Stacking order:** Plus discount → promo code *or* free first ride → credits.
- **Who pays:** every discount is paid by MyRide. **The driver is always paid on the full fare.**

---

## 6. Profit model v2: higher EBITDA, less burn (`src/economics.js`, shown live in Ops)

**First, a correction to v1.** v1 left out costs that grow with volume:
- support staff (one agent per 1,500 trips/day);
- passenger accident insurance (Rs 1.5 per ride);
- peak, rain and Lekhnath driver incentives (2% of ride GMV);
- fraud and bad debt (0.3%);
- per-trip cloud costs;
- driver joining bonuses.

Once those are included, **the v1 plan never becomes profitable.** At month 12 it would still be at −Rs 3.2 L/month. Your instinct was right.

**How each change moves EBITDA** (cumulative, on the **same ride and parcel trip volumes**):

| Change | Launch (M1–3) | Growth (M6) | Mature (M12) |
|---|---|---|---|
| v1 plan, with the missing costs added | −10.21 L | −7.32 L | −3.21 L |
| + Fees: bike Rs 8→10, EV bike 5→7, car 8→10%, EV car 7→9% | −9.59 L | −5.37 L | +0.35 L |
| + Lean Pokhara team (fixed costs Rs 8.7 L → 5.5 L/month; 4.3 L during launch) | −5.19 L | −2.17 L | +3.55 L |
| + Free first ride and referrals, instead of a blanket 20% off | −8.05 L | −3.04 L | +2.83 L |
| + MyRide Plus | −7.98 L | −2.45 L | +4.47 L |
| + Logistics: vans, 4×4 jeeps, pickups, trucks, intercity lanes | −6.80 L | +1.35 L | +12.00 L |
| + Hotel and restaurant partnerships at Lakeside | **−6.80 L** | **+1.79 L** | **+13.33 L** |

**24 months:**

| | v1 | **v2** | v2 + 10 salaried EV fleet cars |
|---|---|---|---|
| Peak cash needed | Rs 107 L (and still burning) | **Rs 26.8 L** | Rs 81.2 L (includes car down payments) |
| First month EBITDA turns positive | never | **Month 6** | Month 6 |
| Investment paid back | never | **Month 10** | Month 13 |
| Cash after 24 months | −Rs 107 L | **+Rs 247 L** | +Rs 257 L |
| Cash after 24 months ÷ peak investment | — | **9.2×** | 3.2× |
| EBITDA at month 12 / month 24 | −3.2 L / −0.6 L | **13.7 L / 22.6 L per month** | 17.8 L / 26.7 L |

- **Launch burn falls from Rs 10.2 L to Rs 6.8 L a month.** Half of what remains is the free-first-ride promo (Rs 3.4 L).
  - **One lever if you want a lower burn:** cap the free first ride at **Rs 60** instead of Rs 100. That still covers a full 2.5 km bike ride. Launch burn drops to about **Rs 5 L/month**, peak cash need to about **Rs 19.5 L**, and payback comes in month 9.
- **Logistics is the biggest single lever** (+Rs 7.5 L/month at maturity), because truck jobs carry large fares. It is also the **riskiest assumption**: 6 trucks and 15 light trucks a day. Truck transport in Nepal is broker- and syndicate-driven, so pilot it with B2B shippers (hardware and construction suppliers in Lekhnath and Prithvi Chowk) before counting on it.
- **The salaried EV car fleet only pays off when each car runs two shifts:**
  - two 8-hour shifts: **+Rs 41,000** per car per month;
  - one shift: **−Rs 17,000** per car per month.
  - This assumes a Rs 32 L EV with 20% down and an Rs 55,661 EMI.
  - The fleet improves service control at the airport and Lakeside but **triples the peak cash need**. BluSmart in India collapsed in April 2025 running this asset-heavy model.
  - **Recommendation:** stay mainly partner-owned (asset-light). Start with 3–5 double-shift EV fleet cars on airport and Lakeside duty.
- **These are model outputs, not forecasts.** Volumes (8,000 trips/day by month 12), new-rider counts, Plus uptake (6% of monthly riders) and the partnership revenue are DECISION assumptions. Replace them with real data from the first 4–6 weeks.

---

## 7. Drivers: two models, KYC, face checks and weekly pay

**Partner vs salaried fleet:**
- **Partner (own vehicle)** is how Uber works: drivers are independent contractors who are paid weekly.
- **MyRide Fleet (salaried)** means the company provides the vehicle and pays wages.
- Both have **separate login portals.** Riders use `/`, drivers use **MyRide Drive** (`/driver.html`) and ops use `/admin.html`. One mobile number can be both a rider and a driver, but the sessions are separate. A rider token cannot call driver endpoints, and the reverse is also blocked.
- A rider can apply to drive from their profile ("Drive with MyRide"), which opens the Drive portal.

**KYC, modelled on Uber's onboarding with Nepali documents:**
- **Documents:** citizenship certificate (front and back), optional national ID number, smart driving licence, Nepal Police report (character certificate), and a live selfie. Partners also provide their bluebook and insurance.
- **Licence category must match the vehicle:** A or K for bikes, B for cars and pickups, B or F for mini-trucks, F or G for light trucks, G for trucks. Truck drivers must be at least 21.
- **Vehicle rules:** cars need a black plate and at most 5 seats; goods vehicles need a goods permit.
- **Bank account:** we check that the account holder's name matches the legal name.
- **Face checks at signup:** the selfie is matched to the licence photo (128-d face descriptor, face-api.js), with a liveness test (turn your head one way, then the other).
- **Review:** ops review every application. For each one they see document images, the automated checks and the face-match distance, then approve, ask for a resubmission, or reject. When approving a fleet employee, ops assign a company vehicle and set the wage. Approval also checks the 300-car cap.
- **Storage:** uploads are type- and size-checked and served **only to the owner or an admin**. Face descriptors are never sent back to client apps.

**Random face checks (like Uber's Real-Time ID Check):**
- **How Uber does it:** random selfies before going online and during shifts, compared with the profile photo (Microsoft Face API). A mismatch means a temporary block, then human review. In the UK, biometrics are deleted within 24 hours.
- **When MyRide asks:**
  - always, if the last check passed more than 72 hours ago;
  - 30% of the time when a driver goes online;
  - about once every 4 hours while online.
- **Response window:** 10 minutes, otherwise the driver is taken offline.
- **Failures:** two failed matches suspend the account for ops review.
- **Limitation:** matching runs in the browser, which is fine for a demo but forgeable. **For production, use a server-side vendor with anti-spoofing liveness** (for example AWS Rekognition Face Liveness, or a Nepal e-KYC provider such as Didit or Shufti Pro). Nepal Rastra Bank now requires wallets to verify users against the national ID database, but there is no public API for it yet.

**Weekly pay, every Sunday for the previous Sunday–Saturday:**
- **Partners** are paid their positive wallet balance (trip earnings, bonuses and cancellation fees, minus cash they collected). A negative balance carries forward.
- **Fleet employees** are paid by the hour from their logged shifts:
  - **Wage:** Rs 25,000/month equivalent by default, above the **Rs 19,550 minimum wage** (FY 2082/83).
  - **Hours:** 8 regular hours a day, plus **overtime at 1.5×, max 4 hours a day** (Labour Act 2074).
  - **Trip incentive:** Rs 15 per trip beyond 12 a day.
  - **SSF:** the employee pays **11% of basic** (deducted); MyRide pays **20%** on top. Basic is 60% of pay.
  - **Cash fares** are deposited at the hub and never deducted from wages.
- **Bank file:** a CSV for **NCHL CorporatePay / connectIPS** bulk upload. The NCHL-IPS fee is Rs 5 per transfer plus VAT.

---

## 8. Risks and next steps

1. **Regulation:** confirm the Gandaki rules are in force, register as an operator, and set up passenger insurance.
2. **Competitor prices:** record about 50 real Pathao, inDrive and Yango quotes across the core wards, Lekhnath and the airport, and retune.
3. **Logistics pilot:** sign 10 B2B shippers. Agree truck rates with transport entrepreneurs and syndicates.
4. **Face matching:** move it to a server-side vendor with anti-spoofing liveness, and set a retention policy for selfies.
5. **Infrastructure:** PostgreSQL/PostGIS, a self-hosted OSRM server for Nepal, an SMS gateway (Sparrow or Aakash), real eSewa and Khalti merchant keys, and Fonepay dynamic QR.
6. **Monsoon (June–September):** landslide-prone roads to Sarangkot, Hemja, Bhalam and Begnas. Add a road-closure feed.
7. **Expansion:** a second city only after Pokhara is EBITDA-positive. Bharatpur is the natural next step (Bagmati rules are pending), then Butwal (Lumbini).

---

## Sources
**Geography and wards**
- OpenStreetMap admin relations: Pokhara 6104486; wards Pokhara-01…33. Retrieved via Overpass (kumi.systems) and Nominatim. © OpenStreetMap contributors, ODbL. Routing by OSRM.
- [Pokhara — Wikipedia](https://en.wikipedia.org/wiki/Pokhara) (ward table, 2021 census) · [edusanjal: Pokhara profile](https://edusanjal.com/local-level/pokhara/)
- [Pokhara-Lekhnath becomes largest metropolitan city — Kathmandu Post (2017)](https://kathmandupost.com/national/2017/03/13/pokhara-lekhnath-becomes-largest-metropolitan-city) · [Lekhnath — Wikipedia](https://en.wikipedia.org/wiki/Lekhnath)

**Regulation and tax**
- [Gandaki Province sets ride-sharing fares — Meroauto (31 May 2026)](https://www.en.meroauto.com/gandaki-province-sets-ride-sharing-fares-mandates-up-to-15-discount/)
- [Gandaki 300-car cap — Meroauto (12 Jul 2026)](https://www.en.meroauto.com/gandaki-greenlights-ride-sharing-registration-sets-300-car-cap-per-firm/)
- [Gandaki first to regulate ride-hailing — Kathmandu Post](https://kathmandupost.com/money/2025/05/17/gandaki-first-province-to-regulate-ride-hailing-bagmati-to-follow)
- [Gandaki suspends regulation — myRepublica](https://myrepublica.nagariknetwork.com/news/gandaki-suspends-ride-sharing-regulation-transportation-services-resume-nat-21-56.html)
- [5% VAT on ride-sharing — VATupdate](https://www.vatupdate.com/2026/07/18/nepal-introduces-5-vat-on-ride-sharing-service-providers/)
- [Nepal licence categories — Onlinekhabar](https://english.onlinekhabar.com/how-to-get-driving-licence-in-nepal.html) · [Provincial licence fees — Meroauto](https://www.en.meroauto.com/provincial-governments-set-different-drivers-license-fees-across-nepal/)

**Competitors and drivers**
- [Fare dispute, Aug 2026 — Kathmandu Post](https://kathmandupost.com/money/2026/08/13/ride-hailing-riders-suspend-protest-but-fare-dispute-remains-unresolved)
- [Pathao Rs 12 fee — ShareSansar](https://www.sharesansar.com/newsdetail/pathao-backs-fair-rider-earnings-calls-for-common-fare-rules-2026-08-23)
- [Fare comparison 2026 — PriceNepal](https://www.pricenepal.com/uber-vs-pathao-vs-indrive-nepal-2026/)
- [Rider earnings — RYD Nepal](https://www.rydnepal.com/blog/pathao-vs-indrive-vs-yango-rider-earnings)
- [Yango driver page](https://yango.com/en_np/driver/) · [Ride-sharing in Pokhara — Motar](https://motar-company.com.np/ride-sharing-in-pokhara/)

**Uber reference model**
- [Uber One (US)](https://www.uber.com/us/en/u/uber-one/) · [Uber One perks — Motley Fool](https://fool.com/the-ascent/personal-finance/articles/the-5-biggest-perks-of-uber-one/)
- [Uber Real-Time ID Check (India)](https://www.uber.com/in/en/blog/selfie-powered-real-time-id-check-comes-to-india/) · [Uber Real-Time ID Check (UK)](https://www.uber.com/en-GB/newsroom/uber-launches-real-time-id-check-for-drivers-in-the-uk)
- [BluSmart collapse — BHRRC/BBC](https://www.business-humanrights.org/en/latest-news/blusmart-breakdown-how-ubers-ev-rival-in-india-collapsed/) · [Green SM vs BluSmart — Inc42](https://inc42.com/features/can-green-sm-succeed-where-blusmart-failed/)

**Labour and payments**
- [Minimum wage Rs 19,550 — Himalayan Times](https://thehimalayantimes.com/nepal/govt-hikes-workers-minimum-wage-to-rs-19550-per-month)
- [SSF 31% — Pioneer Law](https://pioneerlaw.com/resource/social-security-system-in-nepal/) · [SSF enrolment — LawBhandari](https://lawbhandari.com/publication/social-security-fund-in-nepal-enrollment-process)
- [Labour Act 2074 hours and overtime — B360](https://www.b360nepal.com/underscoring-the-new-labour-act-2074)
- [NCHL CorporatePay](https://nchl.com.np/corporatepay/) · [NCHL-IPS fees](https://nchl.com.np/wp-content/uploads/2024/07/NCHL-IPS-fee-and-charges.pdf)
- [NID as trust layer for wallets — Biometric Update](https://www.biometricupdate.com/202607/nepal-makes-national-id-the-trust-layer-for-digital-payments) · [Didit Nepal](https://didit.me/solutions/countries/nepal/) · [Shufti Pro Nepal](https://shuftipro.com/nepal)

**Fuel and logistics**
- [NOC diesel Rs 192.50 (Jul 2026) — Spotlight](https://www.spotlightnepal.com/2026/07/01/nepal-oil-corporation-reduced-prices-petroleum-product/) · [Fuel prices Oct 2026 — Niguro](https://www.niguro.com/fuel-prices) · [NOC holds prices — People's Review](https://peoplesreview.com.np/2026/10/01/heavy-petroleum-price-increment-yet-noc-not-to-increase-retail-price-until-upcoming-festival/)
- [Pokhara–Kathmandu vehicle hire — Vehicle Hiring Nepal (Jun 2026)](https://vehiclehiringnepal.com/pokhara-to-kathmandu-transport/) · [Kathmandu–Pokhara road 2026](https://vehiclehiringnepal.com/kathmandu-to-pokhara-road-condition/)
- [Pathao Parcel — ICT Frame](https://ictframe.com/pathao-parcel-delivery-nationwide-in-nepal/) · [Garuda Express Pokhara](https://www.thegarudaexpress.com/pricing/location/Pokhara)
- [Pokhara occupancy — Onlinekhabar](https://english.onlinekhabar.com/tourist-influx-during-long-holidays-lifts-pokhara-hotel-occupancy-to-90.html) · [Airport transport — AirConnect](https://airconnect.live/en/airports/pokhara-airport-transport-guide)
