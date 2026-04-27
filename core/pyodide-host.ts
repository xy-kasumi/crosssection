// Host-agnostic Pyodide bootstrap. Same code runs under Node (via `pyodide`'s
// Node target) and in the browser (M2). Loads the standard distribution + our
// vendored cytriangle wheel + sectionproperties from PyPI/Pyodide CDN, then
// installs compute/solve.py and exposes solve(shape, meshSize).
//
// IMPORTANT: numerics are byte-identical between Pyodide-on-Node and
// Pyodide-in-browser for our usage. The CLI test battery (Node) is therefore
// load-bearing for the browser app's correctness.

import type { PyodideInterface } from "pyodide";
import type { PyProxy } from "pyodide/ffi";
import type { WireShape } from "./shape.ts";

export interface SolveResult {
  ixx_c: number;
  iyy_c: number;
  ixy_c: number;
  j: number;
  area: number;
  cx: number;
  cy: number;
  n_elems: number;
}

export interface PyodideHost {
  solve(shape: WireShape, meshSize: number): Promise<SolveResult>;
  destroy(): void;
}

interface BootOptions {
  // URL or filesystem path of the cytriangle wheel.
  cytriangleWheel: string;
  // Inline Python source of compute/solve.py.
  solveModuleSource: string;
}

export async function boot(options: BootOptions): Promise<PyodideHost> {
  // Lazy-load pyodide so this module is import-safe in non-Node-Pyodide contexts.
  const { loadPyodide } = await import("pyodide");
  const py = await loadPyodide();

  await py.loadPackage([
    "micropip",
    "numpy",
    "scipy",
    "shapely",
    "matplotlib", // sectionproperties imports it at module scope (visualization paths)
  ]);

  const micropip = py.pyimport("micropip");
  // numpy>=2.3.3 vs Pyodide's 2.0.2 mismatch — see pyodide-build/cytriangle/README.md
  await micropip.install(options.cytriangleWheel, py.toPy({ deps: false }));
  await micropip.install("sectionproperties", py.toPy({ deps: true }));
  micropip.destroy();

  // Install solve.py as a module so its `solve` function is callable from JS.
  await py.runPythonAsync(options.solveModuleSource);
  const solveFn = py.globals.get("solve") as PyProxy & ((shape: unknown, meshSize: number) => PyProxy);

  const host: PyodideHost = {
    async solve(shape, meshSize) {
      // py.toPy converts nested arrays to Python lists.
      const pyShape = py.toPy(shape);
      let resultProxy: PyProxy | null = null;
      try {
        resultProxy = solveFn(pyShape, meshSize);
        const result = resultProxy.toJs({ dict_converter: Object.fromEntries }) as SolveResult;
        return result;
      } finally {
        resultProxy?.destroy();
        pyShape.destroy?.();
      }
    },
    destroy() {
      solveFn.destroy();
      // pyodide instance itself is not destructible in 0.27 — leak it.
      // Node will reclaim on process exit; in the browser we boot once per page.
    },
  };
  return host;
}

// Node-only convenience: read solve.py + the wheel from the filesystem and
// boot. The browser path doesn't use this — it'll fetch them as URLs.
export async function bootForNode(repoRoot: string): Promise<PyodideHost> {
  const { readFile } = await import("node:fs/promises");
  const { pathToFileURL } = await import("node:url");
  const { resolve } = await import("node:path");

  const solveModuleSource = await readFile(resolve(repoRoot, "compute/solve.py"), "utf8");
  const wheelPath = resolve(repoRoot, "wheels/cytriangle-3.0.2-cp312-cp312-emscripten_3_1_58_wasm32.whl");
  const cytriangleWheel = pathToFileURL(wheelPath).href;

  return boot({ cytriangleWheel, solveModuleSource });
}

// Pyodide types used internally; suppress unused warning.
export type { PyodideInterface };
