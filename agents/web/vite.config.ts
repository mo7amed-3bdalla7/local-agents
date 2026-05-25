import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Standalone mode: when `pnpm web` is run on its own (instead of being
    // hosted inside `pnpm api`), proxy /api/* through to the API server.
    // In the default `pnpm api` setup the api boots Vite in middleware mode,
    // so this proxy is unused.
    proxy: {
      "/api": {
        target: `http://localhost:${process.env.API_PORT ?? 3848}`,
        changeOrigin: true,
      },
    },
  },
});
