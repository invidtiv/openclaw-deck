import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "fs";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: "100.83.137.13",
    https: {
      key: fs.readFileSync("/var/lib/tailscale/certs/izt4n2sx18y9x7tfswtukhz.tail652dda.ts.net.key"),
      cert: fs.readFileSync("/var/lib/tailscale/certs/izt4n2sx18y9x7tfswtukhz.tail652dda.ts.net.crt"),
    },
    proxy: {
      "/ws": {
        target: "ws://127.0.0.1:18789",
        ws: true,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ws/, ""),
      },
    },
  },
});
