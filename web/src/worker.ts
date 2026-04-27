/// <reference lib="webworker" />
//
// Pyodide worker. Boots Pyodide from the official CDN, installs our vendored
// cytriangle wheel + sectionproperties, loads compute/solve.py, then services
// `solve` requests.
//
// We use the CDN for the Pyodide runtime itself (~5 MB) so the dev workflow
// is one-step. The cytriangle wheel is served by Vite from our repo. If we
// ever need full offline support, mirror the Pyodide files into web/public/.

import solveSource from "@compute/solve.py?raw";
import wheelUrl from "@wheels/cytriangle-3.0.2-cp312-cp312-emscripten_3_1_58_wasm32.whl?url";
import type { ToWorker, FromWorker } from "./types.ts";

const PYODIDE_VERSION = "0.27.7";
const PYODIDE_INDEX = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

declare const self: DedicatedWorkerGlobalScope;

function emit(msg: FromWorker): void {
  self.postMessage(msg);
}

async function boot(): Promise<(shape: unknown, meshSize: number) => unknown> {
  emit({ type: "progress", phase: "loading Pyodide" });
  const pyodideMod = await import(/* @vite-ignore */ `${PYODIDE_INDEX}pyodide.mjs`);
  const py = await pyodideMod.loadPyodide({ indexURL: PYODIDE_INDEX });

  emit({ type: "progress", phase: "loading numpy/scipy/shapely" });
  await py.loadPackage(["micropip", "numpy", "scipy", "shapely", "matplotlib"]);

  emit({ type: "progress", phase: "installing cytriangle + sectionproperties" });
  const micropip = py.pyimport("micropip");
  // Resolve the wheel to an absolute URL the worker can fetch.
  const wheelAbs = new URL(wheelUrl, self.location.href).href;
  await micropip.install(wheelAbs, py.toPy({ deps: false }));
  await micropip.install("sectionproperties", py.toPy({ deps: true }));
  micropip.destroy();

  emit({ type: "progress", phase: "loading solve.py" });
  await py.runPythonAsync(solveSource);
  const solveFn = py.globals.get("solve");
  return solveFn as (shape: unknown, meshSize: number) => unknown;
}

// Boot eagerly on worker startup; don't wait for the first solve request.
const solvePromise: Promise<(shape: unknown, meshSize: number) => unknown> = boot()
  .then((fn) => {
    emit({ type: "ready" });
    return fn;
  })
  .catch((err) => {
    const error = err instanceof Error ? err.message : String(err);
    emit({ type: "error", id: -1, error: `boot failed: ${error}` });
    throw err;
  });

self.onmessage = async (ev: MessageEvent<ToWorker>) => {
  const msg = ev.data;
  if (msg.type !== "solve") return;
  try {
    const solveFn = await solvePromise;
    const t0 = performance.now();
    // Convert deeply: nested arrays become Python lists.
    // We re-import pyodide's helpers via the function's __wrapped__ or use eval;
    // simpler: solveFn accepts a JS array directly because pyodide auto-converts.
    const resultProxy = solveFn(msg.shape, msg.meshSize) as { toJs: (o: unknown) => unknown; destroy: () => void };
    const ms = performance.now() - t0;
    const result = resultProxy.toJs({ dict_converter: Object.fromEntries }) as Awaited<ReturnType<typeof boot>> extends never ? never : import("@core/pyodide-host.ts").SolveResult;
    resultProxy.destroy();
    emit({ type: "result", id: msg.id, result: result as import("@core/pyodide-host.ts").SolveResult, ms });
  } catch (err) {
    const error = err instanceof Error ? `${err.message}` : String(err);
    emit({ type: "error", id: msg.id, error });
  }
};
