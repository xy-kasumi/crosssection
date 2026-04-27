// Composition root. Wires the panels (start, toolbar, readouts, debug,
// zero-state), the Editor, and the Pyodide CoreClient. No DOM lookups,
// no UI logic — those live in their respective modules.

import { compose, defaultDisk } from "./authoring.ts";
import { Editor } from "./editor.ts";
import { CoreClient } from "./core-boot.ts";
import { Readouts } from "./ui/readouts.ts";
import { StartPane } from "./ui/start-pane.ts";
import { Toolbar } from "./ui/toolbar.ts";
import { DebugPane } from "./ui/debug-pane.ts";
import { ZeroState } from "./ui/zero-state.ts";
import { toWire } from "@core/shape.ts";

const canvas = document.getElementById("cv") as HTMLCanvasElement;

const editor = new Editor(canvas, defaultDisk(), {
  onChange: () => {
    startPane.markUserModified();
    debugPane.refresh();
    recompute();
  },
  onSelectionChange: () => debugPane.refresh(),
  onToolChange: (state) => toolbar.syncToolState(state),
  onToolCommit: (kind, p1, p2) => toolbar.applyCommit(kind, p1, p2),
});

const readouts  = new Readouts();
const startPane = new StartPane({ editor, onFirstPreset: () => zeroState.exit() });
const toolbar   = new Toolbar({ editor });
const debugPane = new DebugPane(editor);
const zeroState = new ZeroState({ editor, readouts });

let nextId = 1;
let lastDisplayedId = 0;

const core = new CoreClient({
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
    readouts.setInvalid(`error: ${err.split("\n")[0]}`);
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
