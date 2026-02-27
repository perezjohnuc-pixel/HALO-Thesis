// HALO - ESP32 HTTP device example (Option B simulation)
//
// - Connects to WiFi
// - Calls /api/verify, /api/confirmPayment, /api/complete
//
// NOTE:
// - This is a sketch/template for thesis demonstration.
// - Replace "scan" parts with your actual QR scanner module...

#include <WiFi.h>
#include <HTTPClient.h>

// === CONFIG ===
const char* WIFI_SSID = "YOUR_WIFI_SSID";
const char* WIFI_PASS = "YOUR_WIFI_PASSWORD";

// Use Hosting emulator URL or deployed hosting URL.
// Emulator example: http://192.168.1.10:5000
const char* BASE_URL = "http://192.168.1.10:5000";

// Must match Admin → Devices key (or functions/.env DEVICE_API_KEY)
const char* DEVICE_KEY = "halo-device-key";

const char* DEVICE_ID = "ESP32-01";

static String postJson(const String& url, const String& jsonBody) {
  HTTPClient http;
  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-halo-device-key", DEVICE_KEY);
  int code = http.POST(jsonBody);
  String body = http.getString();
  http.end();
  Serial.printf("POST %s => %d\n", url.c_str(), code);
  Serial.println(body);
  return body;
}

void setup() {
  Serial.begin(115200);
  delay(200);

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.print("Connecting WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();
  Serial.print("Connected: ");
  Serial.println(WiFi.localIP());

  // ---- Demo flow (replace these with real scans) ----
  // 1) You scan booking QR from the app and parse bookingId/lockerId/token.
  String bookingId = "YOUR_BOOKING_ID";
  String lockerId = "L1";
  String token = "YOUR_QR_TOKEN";

  // verify
  String verifyUrl = String(BASE_URL) + "/api/verify";
  String verifyBody =
    String("{\"bookingId\":\"") + bookingId +
    "\",\"lockerId\":\"" + lockerId +
    "\",\"token\":\"" + token +
    "\",\"deviceId\":\"" + DEVICE_ID + "\"}";
  postJson(verifyUrl, verifyBody);

  // 2) Scan payment QR payload (GCash/Maya raw string) and send it.
  String paymentPayload = "RAW_PAYMENT_QR_STRING";
  String payUrl = String(BASE_URL) + "/api/confirmPayment";
  String payBody =
    String("{\"lockerId\":\"") + lockerId +
    "\",\"deviceId\":\"" + DEVICE_ID +
    "\",\"provider\":\"gcash\",\"paymentPayload\":\"" + paymentPayload + "\"}";
  postJson(payUrl, payBody);

  // 3) When UV-C is done, complete
  String doneUrl = String(BASE_URL) + "/api/complete";
  String doneBody =
    String("{\"lockerId\":\"") + lockerId +
    "\",\"deviceId\":\"" + DEVICE_ID + "\",\"success\":true}";
  postJson(doneUrl, doneBody);
}

void loop() {
  // In a real device you would run a loop that:
  // - waits for QR scans
  // - controls relays/solenoids
  // - counts down UV-C time
  delay(1000);
}
