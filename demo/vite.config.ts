import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Relative base so the built bundle in dist/ also opens from any static host.
export default defineConfig({
  base: "./",
  plugins: [react()],
  server: { port: 5180 },
  preview: { port: 5181 },
  // three.js alone is ~1 MB; this is a local, single-page film.
  build: { chunkSizeWarningLimit: 1400 },
});
