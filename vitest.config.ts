import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    // The app is written for Indian agents, and a stored timestamp is read in
    // local time; pinning the zone keeps a date assertion true off this machine.
    env: { TZ: "Asia/Kolkata" },
    css: false,
    restoreMocks: true,
    testTimeout: 10_000,
  },
});
