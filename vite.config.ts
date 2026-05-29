import { defineConfig } from "vite";

export default defineConfig({
  build: {
    chunkSizeWarningLimit: 900,
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
  },
});
