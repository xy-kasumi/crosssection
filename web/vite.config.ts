import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

// Pyodide ships node-only files (e.g. fs/path requires) that vite tries to bundle.
// We exclude pyodide from optimizeDeps and let it be loaded as a regular ESM.
export default defineConfig({
  resolve: {
    alias: {
      // The only thing web is allowed to import from solver at runtime is
      // `import { SolverClient } from "@solver/client.ts"`. Worker, Python,
      // and wheel files are solver-internal and resolved inside solver/.
      "@solver": resolve(here, "../solver"),
    },
  },
  optimizeDeps: {
    exclude: ["pyodide"],
  },
  // Allow vite to serve files from the sibling solver/ directory (worker module,
  // Python source, vendored wheels — all referenced from solver/ via import.meta.url).
  server: {
    fs: {
      allow: [resolve(here, "..")],
    },
  },
  worker: {
    format: "es",
  },
});
