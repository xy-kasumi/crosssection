import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

// Pyodide ships node-only files (e.g. fs/path requires) that vite tries to bundle.
// We exclude pyodide from optimizeDeps and let it be loaded as a regular ESM.
export default defineConfig({
  resolve: {
    alias: {
      // Let web code import from ../solver/* and ../compute/* using absolute aliases.
      "@solver": resolve(here, "../solver"),
      "@compute": resolve(here, "../compute"),
      "@wheels": resolve(here, "../wheels"),
    },
  },
  optimizeDeps: {
    exclude: ["pyodide"],
  },
  // Allow vite to serve files from the parent directory (../core, ../compute, ../wheels).
  server: {
    fs: {
      allow: [resolve(here, "..")],
    },
  },
  worker: {
    format: "es",
  },
});
