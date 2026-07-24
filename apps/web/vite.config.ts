import path from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    // Allows tunnels (e.g. ngrok) to reach the dev server. Vite checks the
    // Host header against this list; without it, requests from a public
    // ngrok domain are rejected before they ever hit the app.
    allowedHosts: [".ngrok-free.dev", ".ngrok-free.app", ".ngrok.io"],
    proxy: {
      // changeOrigin stays false so the forwarded Host matches the browser's
      // Origin — the API's CSRF origin-check depends on it.
      "/api": { target: "http://localhost:3001", changeOrigin: false },
    },
  },
});