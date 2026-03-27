import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.halo.thesis",
  appName: "HALO Thesis",
  webDir: "../web/dist",
  bundledWebRuntime: false,
  server: { url: "https://halo-a54f3.web.app",
    cleartext: false
}
};

export default config;
