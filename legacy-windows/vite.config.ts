/**
 * Builds the app's own React interface for this edition.
 *
 * The source is `../src`, unchanged and unforked. Two things make that possible:
 * every `@tauri-apps/*` import is aliased onto a shim in `ui/shims/`, and the CSS
 * is downlevelled for Chromium 108.
 *
 * That second part is not cosmetic. Tailwind 4 writes its default palette as
 * `oklch()` and its opacity modifiers as `color-mix()`, both of which Chromium
 * gained in 111. Left alone, every slate, amber and rose in the app fails to
 * parse and the screens come out unstyled — so Lightning CSS is pointed at
 * Chrome 108 and emits the fallbacks. Build-time tools may be as modern as they
 * like; only what ships has to be old enough.
 */

import path from "node:path";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const appRoot = path.resolve(__dirname, "..");
const shims = path.resolve(__dirname, "ui", "shims");

/**
 * The two values Lightning CSS leaves alone because they are not colours.
 *
 * Tailwind writes a gradient's interpolation space into the value — `to bottom
 * right in oklab` — and Chromium 108 rejects the whole `linear-gradient` for it,
 * dropping the background rather than falling back. That gradient is the panel on
 * the lock screen, the first thing anyone sees. Naming the direction without the
 * colour space keeps the gradient, colours and all.
 *
 * `1lh` arrived in Chrome 109, and a dropped `min-height` clips the date fields
 * this app is mostly made of.
 *
 * The selector is `html .class` rather than `.class` so it outranks Tailwind's own
 * rule wherever this ends up in the document.
 */
const chromium108Fallbacks = `
html .bg-gradient-to-br { --tw-gradient-position: to bottom right; }
::-webkit-date-and-time-value { min-height: 1.5em; }
`;

export default defineConfig({
  root: appRoot,
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "chromium-108-fallbacks",
      transformIndexHtml: () => [
        { tag: "style", children: chromium108Fallbacks, injectTo: "head" as const },
      ],
    },
  ],

  resolve: {
    alias: {
      "@": path.resolve(appRoot, "src"),

      // The interface believes it is talking to Tauri. It is talking to Electron.
      "@tauri-apps/api/core": path.join(shims, "core.ts"),
      "@tauri-apps/api/event": path.join(shims, "event.ts"),
      "@tauri-apps/api/app": path.join(shims, "misc.ts"),
      "@tauri-apps/api/window": path.join(shims, "misc.ts"),
      "@tauri-apps/plugin-dialog": path.join(shims, "dialog.ts"),
      "@tauri-apps/plugin-process": path.join(shims, "misc.ts"),
      "@tauri-apps/plugin-updater": path.join(shims, "misc.ts"),
      "@tauri-apps/plugin-autostart": path.join(shims, "misc.ts"),
    },
  },

  css: {
    transformer: "lightningcss",
    lightningcss: { targets: { chrome: 108 << 16 } },
  },

  build: {
    outDir: path.resolve(__dirname, "dist-ui"),
    emptyOutDir: true,
    // The renderer loads from `file://`, so assets cannot be addressed from the
    // root of anything. `HashRouter` already keeps the routes working there.
    assetsDir: "assets",
    target: "chrome108",
    cssMinify: "lightningcss",
    sourcemap: true,
  },

  base: "./",
});
