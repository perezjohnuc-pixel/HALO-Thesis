# Hardware Connection Notes

In HALO, the **hardware does not talk to Firestore directly**.

Instead, the device calls backend endpoints (Cloud Functions or Functions emulator). The backend:

- validates the QR token
- transitions booking status (reserved → pending_payment → active → completed)
- writes payments + logs
- can queue `deviceCommands` for a polling architecture

This is safer and easier to maintain because Firestore security rules stay simple.

## What the device needs to do

1) Connect to Wi‑Fi
2) Scan the **booking QR** shown in the app
3) Send the decoded fields to the backend
4) Scan a **payment QR** (GCash/Maya payload) and send that string to the backend
5) After UV‑C is done, tell the backend the session is complete

## Endpoints

All endpoints require a header:

`x-halo-device-key: <DEVICE_API_KEY>`

Endpoints (via Hosting rewrites):

- `POST /api/verify`
- `POST /api/confirmPayment`
- `POST /api/complete`

See `functions/src/index.ts` for request/response JSON.

## Spark plan note

If you are on Spark, run the Emulator Suite on your laptop and point your device to:

`http://<YOUR_LAPTOP_IP>:5000/api/...`

Your microcontroller and phone must be on the same Wi‑Fi.

## Example firmware snippet

An ESP32 HTTP example is in `hardware/esp32/halo_device_http.ino`.
