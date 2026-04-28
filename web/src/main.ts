// Composition root. Wires the panels (start, toolbar, readouts, zero-state),
// the Editor, and the SolverClient. No DOM lookups, no UI logic — those live
// in their respective modules.

import { compose, defaultDisk } from "@geom/index.ts";
import { Editor } from "./editor.ts";
import { SolverClient } from "@solver/client.ts";
import { Readouts } from "./ui/readouts.ts";
import { StartPane } from "./ui/start-pane.ts";
import { SymmetrizePopup } from "./ui/symmetrize-popup.ts";
import { Toolbar } from "./ui/toolbar.ts";
import { CanvasStatus } from "./ui/canvas-status.ts";
import { ZeroState } from "./ui/zero-state.ts";
import { ringSignedArea, sharpCornerCount, toWire, type SolverShape } from "@solver/shape.ts";
import { t } from "./ui/i18n.ts";
import { applyStaticLabels } from "./ui/i18n-static.ts";
import { mountLangSwitch } from "./ui/lang-switch.ts";

applyStaticLabels();
mountLangSwitch();

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
  const msg = t({ en: "Something went wrong.", ja: "予期しないエラーが発生しました。" });
  const desc = t({
    en: "The editor hit an unexpected internal state. Reload to start fresh — the current shape will be lost.",
    ja: "エディタが不正な状態になりました。リロードしてやり直してください — 現在の形状は失われます。",
  });
  const reloadLabel = t({ en: "Reload", ja: "リロード" });
  const detailsLabel = t({ en: "Details", ja: "詳細" });
  card.innerHTML = `
    <div class="boot-msg"></div>
    <p></p>
    <button id="boot-reload" type="button"></button>
    <details><summary></summary><pre id="boot-error-text"></pre></details>
  `;
  card.querySelector(".boot-msg")!.textContent = msg;
  card.querySelector("p")!.textContent = desc;
  card.querySelector("#boot-reload")!.textContent = reloadLabel;
  card.querySelector("summary")!.textContent = detailsLabel;
  const errEl = document.getElementById("boot-error-text");
  if (errEl) errEl.textContent = detailText;
  document.getElementById("boot-reload")?.addEventListener("click", () => location.reload());
  overlay.classList.remove("hidden");
}

const canvas = document.getElementById("cv") as HTMLCanvasElement;

const editor = new Editor(canvas, defaultDisk(), {
  onChange: () => {
    startPane.markUserModified();
    recompute();
  },
  onToolChange: (state) => {
    toolbar.syncToolState(state);
    canvasStatus.setTool(state);
  },
  onToolStatus: (status) => canvasStatus.setStatus(status),
});

// Hidden hook for browser-automation tests and devtools poking.
// Usage: (window as any).__editor.getShape()
(window as Window & { __editor?: Editor }).__editor = editor;

const readouts     = new Readouts();
const startPane    = new StartPane({ editor, onFirstPreset: () => zeroState.exit() });
const toolbar      = new Toolbar({ editor });
const canvasStatus = new CanvasStatus();
const zeroState    = new ZeroState({ editor, readouts });
new SymmetrizePopup({ editor, onStatus: (s) => canvasStatus.setStatus(s) });

let nextId = 1;
let lastDisplayedId = 0;

const core = new SolverClient({
  onReady: () => recompute(),
  onResult: (id, result) => {
    if (id < lastDisplayedId) return;
    if (zeroState.isActive()) return;
    lastDisplayedId = id;
    readouts.setComputed(
      result.area, result.ixx_c, result.iyy_c, result.j,
      t({
        en: `${result.n_elems.toLocaleString()} elems FEM`,
        ja: `${result.n_elems.toLocaleString()}要素 FEM`,
      }),
    );
  },
  onError: (_id, err) => {
    if (zeroState.isActive()) return;
    // Solver tracebacks are long. Show "solver error" in the readout strip
    // and dump the full message to the devtools console for debugging.
    readouts.setInvalid(t({ en: "solver error", ja: "ソルバーエラー" }));
    console.error("[solver]", err);
  },
});

let solveTimer: number | null = null;
function recompute(): void {
  if (zeroState.isActive()) return;
  // Editor's shape is always check-valid (apply() maintains the contract);
  // compose is a pure translation here.
  const composed = compose(editor.getShape());
  editor.setComposed(composed);
  if (!core.isReady()) {
    // User left zero-state before Pyodide finished booting. Without this,
    // readouts would keep displaying the zero-state demo values until the
    // solver fired onReady → recompute. Flip to "—" now; onReady will run
    // a fresh recompute and the normal debounced path takes over.
    readouts.setComputing(true);
    return;
  }

  // Debounce — drag emits many events per frame.
  if (solveTimer !== null) clearTimeout(solveTimer);
  solveTimer = window.setTimeout(() => {
    solveTimer = null;
    const id = nextId++;
    readouts.setComputing(true);
    core.solve(id, toWire(composed), pickMeshSize(composed));
  }, 80);
}

// `mesh_size` is target max element AREA (mm²); element count scales as
// area / meshSize, so targeting an element count keeps accuracy
// size-invariant. The right element count depends on shape *complexity*,
// not size: smooth boundaries (rect, polygonized circle) converge at
// ~100 quadratic elements; sharp 90° corners introduce warping-function
// singularities that need mesh concentration to resolve.
//
// Empirical fit (solver/tests/bench-mesh.ts):
//   rect (4 sharp), triangle (3), circle 64-gon (0): converge at N=100.
//   T-slot (~44 sharp): converges at N=500.
//   12 × sharp_count tracks this within the ranges we measured.
// N_FLOOR/CEIL bound wall-clock so a pathological 1000-tooth shape
// degrades to ~6 s rather than spinning forever.
const N_FLOOR = 100;
const N_CEIL  = 2000;
const SHARP_FACTOR = 12;
const MIN_MESH_AREA = 0.0001;
function pickMeshSize(composed: SolverShape): number {
  let area = 0;
  for (const ring of composed) area += ringSignedArea(ring);
  const sharp = sharpCornerCount(composed);
  const N = Math.min(N_CEIL, Math.max(N_FLOOR, SHARP_FACTOR * sharp));
  return Math.max(MIN_MESH_AREA, area / N);
}

zeroState.start();
recompute();
