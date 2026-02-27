import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Android wrapper for the HALO web app.
 *
 * Recommended for the thesis (Option B):
 * - Load the deployed Firebase Hosting URL (so web + app stay in sync).
 *
 * After you deploy Hosting, replace server.url below.
 */
const config: CapacitorConfig = {
  appId: "com.halo.thesis",
  appName: "HALO Thesis",
  // Not used when server.url is set, but required.
  webDir: "../web/dist",
  bundledWebRuntime: false,
  server: {
    // Firebase Hosting URL
    url: "https://halo-a54f3.web.app",
    cleartext: false
  }
};

export default config;
