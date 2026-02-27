# Device Simulation (Option B)

This folder contains a small Node script that simulates the locker device.

It calls the same endpoints your firmware will call later:

- `/api/verify` – first scan (QR token)
- `/api/confirmPayment` – second scan (payment QR payload)
- `/api/complete` – end session

Run (Node 18+):

```bash
node device-sim/sim.js verify --base http://localhost:5000 --key YOUR_KEY --payload '{"v":1,"bookingId":"...","lockerId":"...","token":"..."}'
node device-sim/sim.js pay --base http://localhost:5000 --key YOUR_KEY --lockerId L1 --provider gcash --qr 'RAW_PAYMENT_QR'
node device-sim/sim.js complete --base http://localhost:5000 --key YOUR_KEY --lockerId L1
```