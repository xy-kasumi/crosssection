// The boundary between web UI and the FEM core (Pyodide worker).
//
// Owns the worker lifecycle: spawns it eagerly on page load, watches for the
// boot handshake, and shows the failure overlay if boot times out or the
// worker errors. Solve requests are sent via `solve()`; results and errors
// arrive on the registered handlers.
//
// The editor stays interactive throughout boot — readouts just stay blank
// until `onReady` fires. We only block the UI when boot has *failed*; that's
// the only state where editing is wasted effort.

import type { ToWorker, FromWorker } from "./types.ts";
import type { SolveResult } from "@core/pyodide-host.ts";
import type { WireShape } from "@core/shape.ts";

const BOOT_TIMEOUT_MS = 45_000;

export interface CoreClientOpts {
  onReady: () => void;
  onResult: (id: number, result: SolveResult) => void;
  onError: (id: number, error: string) => void;
}

export class CoreClient {
  private worker: Worker | null = null;
  private ready = false;
  private bootResolved = false;
  private bootTimer: number;
  private readonly opts: CoreClientOpts;
  private readonly overlay: HTMLElement;
  private readonly card: HTMLElement;

  constructor(opts: CoreClientOpts) {
    this.opts = opts;
    this.overlay = document.getElementById("boot-overlay") as HTMLElement;
    this.card = document.getElementById("boot-card") as HTMLElement;

    this.bootTimer = window.setTimeout(
      () => this.fail("Setup timed out after 45 seconds. The Python runtime probably couldn't be downloaded."),
      BOOT_TIMEOUT_MS,
    );

    try {
      this.worker = new Worker(new URL("./core-worker.ts", import.meta.url), { type: "module" });
    } catch (err) {
      this.fail(`Worker construction failed: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }

    this.worker.addEventListener("error", (ev) => {
      if (!this.bootResolved) this.fail(`Worker crashed during boot: ${ev.message || "unknown error"}`);
    });
    this.worker.addEventListener("message", (ev: MessageEvent<FromWorker>) => this.onMessage(ev.data));
  }

  isReady(): boolean { return this.ready; }

  solve(id: number, shape: WireShape, meshSize: number): void {
    if (!this.worker || !this.ready) return;
    const msg: ToWorker = { type: "solve", id, shape, meshSize };
    this.worker.postMessage(msg);
  }

  private onMessage(msg: FromWorker): void {
    switch (msg.type) {
      case "progress":
        // Boot progress is debug-only — log it, don't surface to the user.
        console.log(`[boot] ${msg.phase}`);
        break;
      case "ready":
        this.ready = true;
        this.bootResolved = true;
        clearTimeout(this.bootTimer);
        this.opts.onReady();
        break;
      case "result":
        this.opts.onResult(msg.id, msg.result);
        break;
      case "error":
        if (!this.bootResolved) {
          this.fail(msg.error);
          return;
        }
        this.opts.onError(msg.id, msg.error);
        break;
    }
  }

  private fail(detail: string): void {
    this.bootResolved = true;
    clearTimeout(this.bootTimer);
    this.card.innerHTML = `
      <div class="boot-msg">Couldn't start the FEM solver.</div>
      <p>This tool needs a recent browser with WebAssembly support and a working internet connection (the Python runtime is downloaded on first load). Try the latest Chrome, Firefox, Edge, or Safari.</p>
      <button id="boot-reload" type="button">Reload</button>
      <details><summary>Details</summary><pre id="boot-error-text"></pre></details>
    `;
    document.getElementById("boot-error-text")!.textContent = detail;
    document.getElementById("boot-reload")!.addEventListener("click", () => location.reload());
    this.overlay.classList.remove("hidden");
  }
}
