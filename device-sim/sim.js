#!/usr/bin/env node
/*
  HALO device simulation script (Option B)

  Examples:
    node device-sim/sim.js verify --base http://localhost:5000 --key YOUR_KEY --payload '{"v":1,"bookingId":"...","lockerId":"...","token":"..."}'
    node device-sim/sim.js pay    --base http://localhost:5000 --key YOUR_KEY --lockerId L1 --provider gcash --qr ...
    node device-sim/sim.js complete --base http://localhost:5000 --key YOUR_KEY --lockerId L1

  Note:
    This is for demos/testing only. Replace with real firmware calls later.
*/

const args = process.argv.slice(2);
const cmd = args[0];

function getFlag(name, def = undefined) {
  const i = args.indexOf(name);
  if (i === -1) return def;
  return args[i + 1] ?? def;
}

const base = getFlag("--base", "http://localhost:5000");
const key = getFlag("--key", "");
const deviceId = getFlag("--deviceId", "SIM-01");

if (!cmd || ["verify", "pay", "complete"].indexOf(cmd) === -1) {
  console.log("Usage: node device-sim/sim.js <verify|pay|complete> --base <url> --key <deviceKey> ...");
  process.exit(1);
}

async function post(path, body) {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(key ? { "x-halo-device-key": key } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) {
    console.error("HTTP", res.status, json);
    process.exit(2);
  }
  console.log(JSON.stringify(json, null, 2));
}

(async () => {
  if (cmd === "verify") {
    const payloadStr = getFlag("--payload", "");
    if (!payloadStr) throw new Error("Missing --payload");
    const payload = JSON.parse(payloadStr);
    await post("/api/verify", {
      bookingId: payload.bookingId,
      lockerId: payload.lockerId,
      token: payload.token,
      deviceId,
    });
    return;
  }

  if (cmd === "pay") {
    const lockerId = getFlag("--lockerId", "");
    const provider = getFlag("--provider", "unknown");
    const qr = getFlag("--qr", "");
    if (!lockerId || !qr) throw new Error("Missing --lockerId or --qr");
    await post("/api/confirmPayment", {
      lockerId,
      deviceId,
      provider,
      paymentPayload: qr,
    });
    return;
  }

  if (cmd === "complete") {
    const lockerId = getFlag("--lockerId", "");
    const ok = getFlag("--ok", "true") !== "false";
    if (!lockerId) throw new Error("Missing --lockerId");
    await post("/api/complete", { lockerId, deviceId, success: ok });
    return;
  }
})().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});
