# HALO – Thesis Web App (Web + Android Wrapper)

This repository contains:

- **Web app (customer + admin)**: `web/` (Vite + React + Tailwind)
- **Cloud Functions (device simulation + timers)**: `functions/` (Firebase Functions v2)
- **Android wrapper**: `android-wrapper/` (Capacitor)

Your project ID / hosting domain:

- Project: `halo-a54f3`
- Domain: `https://halo-a54f3.web.app`

Payment amount used by the app: **₱25**

---

## Important note about Spark plan

On the **Spark (free)** plan, you **cannot deploy Cloud Functions**.

You can still:

- Deploy **Hosting**, **Firestore**, and **Auth**
- Use **Firebase Emulator Suite** locally to run Functions for demos/thesis testing

If you need Functions deployed to production later, you must upgrade to **Blaze**.

---

## 1) Setup (one-time)

### Install tools

- Node.js 18+
- Firebase CLI

```bash
npm i -g firebase-tools
firebase login
```

### Configure the web app

1) Copy env file:

```bash
cd web
cp .env.example .env
```

2) Fill your Firebase web config values in `web/.env`.

---

## 2) Run locally with Emulator Suite (recommended for Spark)

From the repo root:

```bash
firebase use halo-a54f3

# Install deps
cd functions && npm i
cd ../web && npm i

# Create functions env
cd ../functions
cp .env.example .env
```

Start all emulators:

```bash
cd ..
npm run emulators
```

Open:

- Emulator UI: `http://localhost:4000`
- Hosting emulator (web): `http://localhost:5000`

### If you want to use Vite dev server instead (optional)

Vite runs on `http://localhost:5173` and **does not** use Hosting rewrites.
Set this in `web/.env`:

```env
VITE_API_BASE=http://localhost:5001/halo-a54f3/asia-east2
```

Then:

```bash
cd web
npm run dev
```

---

## 3) Deploy Hosting + Rules (Spark-compatible)

```bash
firebase use halo-a54f3
# If you are using PowerShell, wrap the list in quotes:
firebase deploy --only "hosting,firestore:rules"

# Or deploy separately:
# firebase deploy --only hosting
# firebase deploy --only firestore:rules
```

Your live URL will be:

- `https://halo-a54f3.web.app`

---

## 4) Admin setup

1) Register an account in the app.
2) Promote yourself to admin in Firestore:

`users/{yourUid}` → set `role: "admin"`

3) Go to **Admin → Devices** and set a **Device Key**.

That key is used by the **device simulation** calls (`/api/*`).

---

## 5) Device scan simulation (Option B)

### Flow

1) **User reserves** a locker → status `reserved` and backend generates QR token (3 min scan window)
2) **Device scans the QR** → calls `/api/verify` → status becomes `pending_payment` (2 min payment window)
3) **User chooses payment method** (Cash / Online) → device confirms payment by calling `/api/confirmPayment`
   - `provider: "cash" | "gcash" | "maya"`
4) After payment, booking becomes `active` and a `deviceCommands` doc is queued
5) **Device completes session** → calls `/api/complete` → status becomes `completed` and locker is released

### Quick manual test (Postman / curl)

> Add header: `x-halo-device-key: <yourDeviceKeyFromAdminPage>`

```bash
# verify QR
curl -X POST http://localhost:5000/api/verify \
  -H "Content-Type: application/json" \
  -H "x-halo-device-key: YOUR_KEY" \
  -d '{"bookingId":"...","lockerId":"...","token":"...","deviceId":"SIM-01"}'

# confirm payment
curl -X POST http://localhost:5000/api/confirmPayment \
  -H "Content-Type: application/json" \
  -H "x-halo-device-key: YOUR_KEY" \
  -d '{"lockerId":"...","paymentPayload":"<raw-qr>","provider":"gcash","deviceId":"SIM-01"}'

# cash example
curl -X POST http://localhost:5000/api/confirmPayment \
  -H "Content-Type: application/json" \
  -H "x-halo-device-key: YOUR_KEY" \
  -d '{"lockerId":"...","paymentPayload":"CASH-REF-123","provider":"cash","deviceId":"SIM-01"}'

# complete
curl -X POST http://localhost:5000/api/complete \
  -H "Content-Type: application/json" \
  -H "x-halo-device-key: YOUR_KEY" \
  -d '{"lockerId":"...","success":true,"deviceId":"SIM-01"}'
```

---

## 6) Android wrapper (Capacitor)

Build the web app then sync to Android:

```bash
cd web
npm run build

cd ../android-wrapper
npm i
npx cap sync android
npx cap open android
```

### If you want to point the wrapper to a different URL

Edit `android-wrapper/capacitor.config.ts`:

- `server.url = "https://halo-a54f3.web.app"` (production)
- For Emulator Suite on your laptop, use your laptop LAN IP:
  - Example: `http://192.168.1.10:5000`

If you use HTTP, Android may require **cleartext**; see `android-wrapper/android/app/src/main/AndroidManifest.xml`.

---

## Where to adjust your thesis-specific settings

- Amount: `web/src/pages/user/LockersPage.tsx` (`DEFAULT_AMOUNT = 25`)
- Duration default: same file (`FIXED_DURATION_MIN = 3`)
- Timers:
  - Scan window: `functions/src/index.ts` (`SCAN_TTL_MS`)
  - Payment window: `functions/src/index.ts` (`PAYMENT_TTL_MS`)
- UV-C seconds: `functions/.env` (`DEFAULT_UV_SECONDS`) and `functions/src/index.ts`

## Demo helpers (for panel presentations)

- **Sanitation timers speed-up:** set `VITE_DEMO_SPEED=30` in `web/.env` (or set to `1` for real minutes)
- **Spark demo shortcut:** set `VITE_SPARK_DEMO=true` to show a payment QR immediately after reserve (demo only)
