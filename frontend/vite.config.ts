import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

export default defineConfig({
  plugins: [solid()],
  server: {
    host: "127.0.0.1",
    port: 4721,
    strictPort: true,
    allowedHosts: true,
    proxy: {
      "/api": {
        target: process.env.API_TARGET ?? "http://127.0.0.1:4720",
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on("proxyRes", (res) => {
            if (String(res.headers["content-type"] ?? "").startsWith("text/event-stream")) {
              res.headers["cache-control"] = "no-cache, no-transform";
              res.headers["x-accel-buffering"] = "no";
              delete res.headers["content-length"];
            }
          });
        },
      },
    },
  },
  build: { target: "es2022" },
});
