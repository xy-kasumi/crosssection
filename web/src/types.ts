// Messages between UI thread and the Pyodide worker.

import type { WireShape } from "@core/shape.ts";
import type { SolveResult } from "@core/pyodide-host.ts";

export type ToWorker =
  | { type: "solve"; id: number; shape: WireShape; meshSize: number };

export type FromWorker =
  | { type: "ready" }
  | { type: "progress"; phase: string }
  | { type: "result"; id: number; result: SolveResult; ms: number }
  | { type: "error"; id: number; error: string };
