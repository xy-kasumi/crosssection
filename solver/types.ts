// Messages between UI thread and the Pyodide worker. Re-exports SolveResult
// so worker.ts and client.ts can take all wire types from one import.

import type { WireShape } from "./shape.ts";
import type { SolveResult } from "./pyodide-host.ts";
export type { SolveResult } from "./pyodide-host.ts";

export type ToWorker =
  | { type: "solve"; id: number; shape: WireShape; meshSize: number };

export type FromWorker =
  | { type: "ready" }
  | { type: "progress"; phase: string }
  | { type: "result"; id: number; result: SolveResult; ms: number }
  | { type: "error"; id: number; error: string };
