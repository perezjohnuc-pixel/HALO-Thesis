# HALO Android Wrapper (Capacitor)

This folder turns the deployed HALO web app (Firebase Hosting) into an installable Android app.

## Why this is the recommended thesis option
You maintain **one UI** (the web app), and the Android app simply loads the same deployed URL.
So any update you deploy to Hosting immediately updates the app UI without rebuilding the APK.

## Prerequisites
- Node 18+
- Android Studio installed (and Android SDK configured)
- You already deployed the web app to Firebase Hosting

## Setup (once)
1) Deploy web:
```bash
cd ../web
npm install
npm run build
firebase deploy --only hosting
```

2) Confirm `capacitor.config.ts` has your Firebase Hosting URL:

- `server.url`: `https://halo-a54f3.web.app`

### Using the Emulator Suite URL (Spark-friendly)

If you're running the Firebase Emulator Suite on your laptop and want the Android app to load it:

- Find your laptop LAN IP (example: `192.168.1.10`)
- Set `server.url` to `http://192.168.1.10:5000`

**Android cleartext note:** if you use `http://...` you may need to allow cleartext traffic.
After you run `npx cap add android`, edit:

- `android/app/src/main/AndroidManifest.xml`

and set `android:usesCleartextTraffic="true"` inside the `<application>` tag.

3) Create the Android project:
```bash
cd android-wrapper
npm install
npx cap add android
```

## Run / Build
```bash
# sync web updates into the Android project
npx cap sync

# open in Android Studio
npx cap open android
```

Then in Android Studio:
- Run (for emulator/device)
- Build → Generate Signed Bundle / APK (for release)

## Notes
- If you change only the web UI (and keep the same Hosting URL), the wrapper doesn't need rebuild.
- If you change the Hosting URL, update `server.url` and re-sync.
