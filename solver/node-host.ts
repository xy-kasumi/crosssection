// Node-only convenience: read solve.py + the wheel from the filesystem and
// hand them to the host-agnostic `boot()` in pyodide-host.ts. The browser
// path doesn't use this — it gets the same files as Vite-resolved URLs via
// `worker.ts`'s `?raw` and `?url` imports.
//
// This is the only file in solver/ that imports `node:*` modules. Keeping
// the Node leaf isolated lets `pyodide-host.ts` stay browser-importable
// (web's typecheck does not pull `node:*` types).
//
// All paths are resolved relative to *this* file, so `solver/python/solve.py`
// and `solver/wheels/*.whl` always resolve correctly regardless of CWD.

import { boot, type PyodideHost } from "./pyodide-host.ts";

export async function bootForNode(): Promise<PyodideHost> {
  const { readFile } = await import("node:fs/promises");
  const { fileURLToPath, pathToFileURL } = await import("node:url");
  const { dirname, resolve } = await import("node:path");

  const here = dirname(fileURLToPath(import.meta.url));
  const solveModuleSource = await readFile(resolve(here, "python/solve.py"), "utf8");
  const wheelPath = resolve(here, "wheels/cytriangle-3.0.2-cp312-cp312-emscripten_3_1_58_wasm32.whl");
  const cytriangleWheel = pathToFileURL(wheelPath).href;

  return boot({ cytriangleWheel, solveModuleSource });
}
