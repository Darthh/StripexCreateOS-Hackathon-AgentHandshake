import { defineConfig } from "vite";

export default defineConfig({
  root: "web",
  build: { outDir: "../dist", emptyOutDir: true },
  server: { proxy: { "/api": { target: "http://localhost:8787", ws: true } } },
});
