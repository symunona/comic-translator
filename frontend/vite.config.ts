import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

export default defineConfig({
  plugins: [solid()],
  server: {
    host: "127.0.0.1",
    port: Number(process.env.VITE_PORT ?? 4721),
    strictPort: true,
    allowedHosts: true,
    proxy: {
      "/models": { target: process.env.API_TARGET ?? "http://127.0.0.1:4750", changeOrigin: true },
      "/api": { target: process.env.API_TARGET ?? "http://127.0.0.1:4750", changeOrigin: true },
    },
  },
  build: { target: "es2022", rollupOptions: { input: { main: "index.html" } } },
  worker: { format: "es" },
  optimizeDeps: { exclude: ["onnxruntime-web"] },
});
