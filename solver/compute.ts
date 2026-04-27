// Node-side public API of the FEM solver. Used by solver/tests/.
//
// Usage:
//   import { compute } from "@solver/compute.ts";
//   const result = await compute(shape, { meshSize: 0.5 });
//
// Boots Pyodide on first call and reuses the same instance for subsequent
// calls. Boot takes ~2 s warm; subsequent calls are sub-second for typical
// mesh sizes. Browser callers use `client.ts` instead — same shape data,
// different transport (Web Worker + postMessage).

import type { SolverShape } from "./shape.ts";
import { toWire } from "./shape.ts";
import type { PyodideHost, SolveResult } from "./pyodide-host.ts";
import { bootForNode } from "./node-host.ts";

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
  if (!hostPromise) hostPromise = bootForNode();
  return hostPromise;
}

export async function compute(shape: SolverShape, options: ComputeOptions): Promise<ComputeResult> {
  const host = await getHost();
  const t0 = performance.now();
  const result = await host.solve(toWire(shape), options.meshSize);
  const solveMs = performance.now() - t0;
  return { ...result, solveMs };
}
