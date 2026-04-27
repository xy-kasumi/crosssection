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
  const t0 = performance.now();
  const mark = (label: string): void => {
    const dt = performance.now() - t0;
    console.log(`[boot] ${dt.toFixed(0).padStart(5)} ms — ${label}`);
  };

  mark("start");
  emit({ type: "progress", phase: "loading Pyodide" });
  const pyodideMod = await import(/* @vite-ignore */ `${PYODIDE_INDEX}pyodide.mjs`);
  mark("pyodide.mjs imported");
  const py = await pyodideMod.loadPyodide({ indexURL: PYODIDE_INDEX });
  mark("pyodide loaded (asm.wasm + stdlib)");

  emit({ type: "progress", phase: "loading numpy/scipy/shapely" });
  await py.loadPackage(["micropip", "numpy", "scipy", "shapely"]);
  mark("loadPackage(numpy/scipy/shapely) done");

  emit({ type: "progress", phase: "installing cytriangle + sectionproperties" });
  // cytriangle must be installed before sectionproperties — sectionproperties
  // declares cytriangle as a runtime dep and would try to resolve it from PyPI
  // (no pure-python wheel exists) if it ran first.
  //
  // sectionproperties is installed with deps=False so we don't drag in
  // matplotlib (5+ MB; its font cache builds at first sectionproperties import
  // and costs ~4 s of boot), pillow, rich, etc. We then manually install the
  // deps that ARE actually used at import + on our solve() codepath. If a
  // future sectionproperties release imports matplotlib at module top, this
  // will blow up at import — easy to diagnose, easy to revert by adding
  // "matplotlib" to the manual list (or just removing deps=False).
  //
  // NOTE: pyodide JS→Python calls don't auto-convert the trailing JS object
  // to kwargs. Must use .callKwargs() (or run-as-Python) to pass deps=False.
  const wheelAbs = new URL(wheelUrl, self.location.href).href;
  await py.runPythonAsync(`
import sys, types, importlib.abc, importlib.machinery
# Stub any matplotlib.* / mpl_toolkits.* / rich.* import via a meta-path
# finder. sectionproperties imports these at module top in many places but
# only uses them in plotting / pretty-CLI codepaths we never hit. Stubs
# satisfy the import; real calls fail loudly, which is what we want — those
# would mean we accidentally hit a plot/CLI path. Together this saves ~4-5 s
# of boot (matplotlib font-cache build + rich install + import time).
class _StubBase:
    """Subclassable, callable, attribute-tolerant stub for arbitrary classes."""
    def __init__(self, *a, **kw): pass
    def __call__(self, *a, **kw): return self
    def __getattr__(self, name): return _StubBase
class _Stub(types.ModuleType):
    def __getattr__(self, name):
        # Heuristic: CapitalCase or ALL_CAPS names look like classes/constants.
        # Return a fresh subclassable stub class so \`class X(StubbedClass):\` works.
        # Lowercase names look like submodules — return a stub module.
        if name and (name[0].isupper() or name.isupper()):
            cls = type(name, (_StubBase,), {})
            setattr(self, name, cls)
            return cls
        sub = _Stub(f"{self.__name__}.{name}")
        sys.modules[sub.__name__] = sub
        return sub
    def __call__(self, *a, **kw):
        return _StubBase()
class _StubLoader(importlib.abc.Loader):
    def create_module(self, spec):
        return _Stub(spec.name)
    def exec_module(self, module):
        pass
class _StubFinder:
    PREFIXES = ("matplotlib", "mpl_toolkits", "rich")
    def find_spec(self, fullname, path, target=None):
        if fullname.split(".")[0] in self.PREFIXES:
            return importlib.machinery.ModuleSpec(fullname, _StubLoader())
        return None
sys.meta_path.insert(0, _StubFinder())

import micropip
await micropip.install(${JSON.stringify(wheelAbs)}, deps=False)
await micropip.install("sectionproperties", deps=False)
# more-itertools is a small pure-Python pkg that sectionproperties uses for
# iteration helpers; cheaper to install than to stub correctly.
await micropip.install(["more-itertools"], deps=False)
`);
  mark("sectionproperties installed (lean)");

  emit({ type: "progress", phase: "loading solve.py" });
  await py.runPythonAsync(solveSource);
  mark("solve.py loaded (boot complete)");
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
