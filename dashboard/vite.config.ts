import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const HOST = "127.0.0.1";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    // The default glob walks the whole dashboard directory. `restore-targets/` holds copies of
    // files taken out of Conway backups — including their own `*.test.ts` — and those bytes are
    // unverified input that must never be executed as this project's suite.
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    host: HOST,
    port: 8788,
    strictPort: true,
    proxy: {
      "/api": { target: `http://${HOST}:8787`, changeOrigin: false },
    },
  },
  preview: {
    host: HOST,
    port: 8788,
    strictPort: true,
  },
});
