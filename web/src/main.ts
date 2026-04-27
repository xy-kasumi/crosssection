// Composition root. Wires the panels (start, toolbar, readouts, debug,
// zero-state), the Editor, and the SolverClient. No DOM lookups, no UI
// logic — those live in their respective modules.

import { compose, defaultDisk } from "@geom/index.ts";
import { Editor } from "./editor.ts";
import { SolverClient } from "@solver/client.ts";
import { Readouts } from "./ui/readouts.ts";
import { StartPane } from "./ui/start-pane.ts";
import { Toolbar } from "./ui/toolbar.ts";
import { CanvasStatus } from "./ui/canvas-status.ts";
import { DebugPane } from "./ui/debug-pane.ts";
import { ZeroState } from "./ui/zero-state.ts";
import { toWire } from "@solver/shape.ts";

// Top-level error trap. The geom kernel surfaces unreachable-from-sound-UI
// states ("invalid" Op results) by having editor.ts throw; the throw lands
// here and we re-use the boot-overlay to tell the user something's wrong.
// Pyodide boot failures still own the overlay's primary path; this just
// piggybacks on the same UI element.
window.addEventListener("error", (ev) => showFatalOverlay(ev.message, ev.error));
window.addEventListener("unhandledrejection", (ev) =>
  showFatalOverlay("unhandled promise rejection", ev.reason));

function showFatalOverlay(summary: string, detail: unknown): void {
  const overlay = document.getElementById("boot-overlay");
  const card = document.getElementById("boot-card");
  if (!overlay || !card) return;
  const detailText = detail instanceof Error
    ? `${detail.name}: ${detail.message}\n${detail.stack ?? ""}`
    : String(detail ?? summary);
  card.innerHTML = `
    <div class="boot-msg">Something went wrong.</div>
    <p>The editor hit an unexpected internal state. Reload to start fresh — your unsaved geometry will be lost.</p>
    <button id="boot-reload" type="button">Reload</button>
    <details><summary>Details</summary><pre id="boot-error-text"></pre></details>
  `;
  const errEl = document.getElementById("boot-error-text");
  if (errEl) errEl.textContent = detailText;
  document.getElementById("boot-reload")?.addEventListener("click", () => location.reload());
  overlay.classList.remove("hidden");
}

const canvas = document.getElementById("cv") as HTMLCanvasElement;

const editor = new Editor(canvas, defaultDisk(), {
  onChange: () => {
    startPane.markUserModified();
    debugPane.refresh();
    recompute();
  },
  onSelectionChange: () => debugPane.refresh(),
  onToolChange: (state) => {
    toolbar.syncToolState(state);
    canvasStatus.setTool(state);
  },
  onToolStatus: (status) => canvasStatus.setStatus(status),
});

const readouts     = new Readouts();
const startPane    = new StartPane({ editor, onFirstPreset: () => zeroState.exit() });
const toolbar      = new Toolbar({ editor });
const canvasStatus = new CanvasStatus();
const debugPane    = new DebugPane(editor);
const zeroState    = new ZeroState({ editor, readouts });

let nextId = 1;
let lastDisplayedId = 0;

const core = new SolverClient({
  onReady: () => recompute(),
  onResult: (id, result) => {
    if (id < lastDisplayedId) return;
    if (zeroState.isActive()) return;
    lastDisplayedId = id;
    readouts.setComputed(
      result.ixx_c, result.iyy_c, result.j,
      `${result.n_elems.toLocaleString()} elems FEM`,
    );
  },
  onError: (_id, err) => {
    if (zeroState.isActive()) return;
    // Solver tracebacks are long. Show "solver error" in the readout strip
    // and dump the full message to the devtools console for debugging.
    readouts.setInvalid("solver error");
    console.error("[solver]", err);
  },
});

let solveTimer: number | null = null;
function recompute(): void {
  if (zeroState.isActive()) return;
  // Recompose immediately so the canvas mirrors current state.
  const result = compose(editor.getShape());
  if (!result.ok) {
    editor.setComposed(null);
    readouts.setInvalid(`invalid: ${result.reason}`);
    return;
  }
  editor.setComposed(result.shape);
  if (!core.isReady()) return;

  // Debounce — drag emits many events per frame.
  if (solveTimer !== null) clearTimeout(solveTimer);
  solveTimer = window.setTimeout(() => {
    solveTimer = null;
    const id = nextId++;
    readouts.setComputing(true);
    let maxExtent = 0;
    for (const ring of result.shape) for (const p of ring) {
      maxExtent = Math.max(maxExtent, Math.abs(p.x), Math.abs(p.y));
    }
    const meshSize = Math.max(0.05, maxExtent / 10);
    core.solve(id, toWire(result.shape), meshSize);
  }, 80);
}

debugPane.refresh();
zeroState.start();
recompute();
