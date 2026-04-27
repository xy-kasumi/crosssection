// Public API of the section-property library.
//
// Usage:
//   import { compute } from "../core/compute.ts";
//   const result = await compute(shape, { meshSize: 0.5 });
//
// `compute` boots Pyodide on first call and reuses the same instance for all
// subsequent calls. Boot takes ~2 s warm; subsequent calls are sub-second for
// typical mesh sizes.

import type { SolverShape } from "./shape.ts";
import { toWire } from "./shape.ts";
import { bootForNode, type PyodideHost, type SolveResult } from "./pyodide-host.ts";

export interface ComputeOptions {
  // Maximum element area for the FEM mesh. Smaller is more accurate, slower.
  meshSize: number;
}

export interface ComputeResult extends SolveResult {
  // Wall-clock for the solve call alone (excludes Pyodide boot).
  solveMs: number;
}

let hostPromise: Promise<PyodideHost> | null = null;

function getHost(): Promise<PyodideHost> {
  if (!hostPromise) {
    // Resolve the repo root from this file's location: core/compute.ts -> ../
    // For Node we read solve.py + wheel from the filesystem.
    hostPromise = (async () => {
      const { fileURLToPath } = await import("node:url");
      const { dirname, resolve } = await import("node:path");
      const here = dirname(fileURLToPath(import.meta.url));
      const repoRoot = resolve(here, "..");
      return bootForNode(repoRoot);
    })();
  }
  return hostPromise;
}

export async function compute(shape: SolverShape, options: ComputeOptions): Promise<ComputeResult> {
  const host = await getHost();
  const t0 = performance.now();
  const result = await host.solve(toWire(shape), options.meshSize);
  const solveMs = performance.now() - t0;
  return { ...result, solveMs };
}
