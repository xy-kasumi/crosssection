// Modeless editor for the cross-section. Drives an AuthoringShape, runs
// compose() on every change, kicks a Pyodide solve when compose succeeds,
// updates readouts. Latest input always wins; stale results suppressed.

import {
  compose,
  defaultDisk,
  extrusionOf,
  rectOutline,
  rectShapeOf,
  rodOf,
  type AuthoringShape,
  type Outline,
  type Selection,
  type Vec2,
} from "./authoring.ts";
import { Editor, type ToolState } from "./editor.ts";
import type { ToolKind } from "./canvas.ts";
import { twoSigFigs } from "./format.ts";
import type { ToWorker, FromWorker } from "./types.ts";
import { toWire, type Shape as CoreShape } from "@core/shape.ts";

const els = {
  main:             document.querySelector("main") as HTMLElement,
  canvas:           document.getElementById("cv") as HTMLCanvasElement,
  startSection:     document.getElementById("start-section")     as HTMLElement,
  startPaneToggle:  document.getElementById("start-pane-toggle") as HTMLButtonElement,
  startBtns:        Array.from(document.querySelectorAll<HTMLButtonElement>(".start-btn")),
  sizeInput:        document.getElementById("size-input")        as HTMLFormElement,
  toolBtns:         Array.from(document.querySelectorAll<HTMLButtonElement>(".tool-btn")),
  snapToggle:       document.getElementById("snap-toggle")       as HTMLInputElement,
  toolHint:         document.getElementById("tool-hint")!,
  primList:         document.getElementById("prim-list")          as HTMLUListElement,
  ix:               document.getElementById("ix")!,
  iy:               document.getElementById("iy")!,
  j:                document.getElementById("j")!,
  status:           document.getElementById("status")!,
  bootOverlay:      document.getElementById("boot-overlay")       as HTMLElement,
  bootCard:         document.getElementById("boot-card")          as HTMLElement,
};

// Tracks whether the user has touched the shape since the last preset load.
// Used to decide whether picking a different "Start from" entry should ask
// for confirmation before discarding their current shape.
let userModified = false;

const editor = new Editor(els.canvas, defaultDisk(), {
  onChange: () => {
    userModified = true;
    refreshPrimList();
    refreshButtons();
    recompute();
  },
  onSelectionChange: () => {
    refreshPrimList();
  },
  onToolChange: (state) => {
    for (const b of els.toolBtns) {
      b.classList.toggle("active", state !== null && b.dataset.tool === state.kind);
    }
    els.toolHint.textContent = state ? toolHintText(state) : "";
  },
  onToolCommit: (kind, p1, p2) => {
    applyToolCommit(kind, p1, p2);
  },
});

// ----- boot state -----
//
// Boot is non-blocking: the editor is fully live from page load. We just
// can't compute numbers until the worker reports ready. Most users never
// notice — they're picking a preset or starting to draw, and by the time
// they want a number it's already there. The overlay only appears in the
// rare path where boot fails (no WASM, slow/blocked network, etc.) so we
// can tell the user clearly rather than leave them editing in vain.

const BOOT_TIMEOUT_MS = 45_000;
let bootResolved = false;
const bootTimeout = window.setTimeout(() => {
  if (!bootResolved) showBootFailure(
    "Setup timed out after 45 seconds. The Python runtime probably couldn't be downloaded.",
  );
}, BOOT_TIMEOUT_MS);

function showBootFailure(detail: string): void {
  bootResolved = true;
  clearTimeout(bootTimeout);
  els.bootCard.innerHTML = `
    <div class="boot-msg">Couldn't start the FEM solver.</div>
    <p>This tool needs a recent browser with WebAssembly support and a working internet connection (the Python runtime is downloaded on first load). Try the latest Chrome, Firefox, Edge, or Safari.</p>
    <button id="boot-reload" type="button">Reload</button>
    <details><summary>Details</summary><pre id="boot-error-text"></pre></details>
  `;
  document.getElementById("boot-error-text")!.textContent = detail;
  document.getElementById("boot-reload")!.addEventListener("click", () => location.reload());
  els.bootOverlay.classList.remove("hidden");
}

// Pyodide worker
let worker: Worker;
try {
  worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
} catch (err) {
  showBootFailure(`Worker construction failed: ${err instanceof Error ? err.message : String(err)}`);
  throw err;
}
let workerReady = false;
let nextId = 1;
let lastDisplayedId = 0;

worker.addEventListener("error", (ev) => {
  if (!bootResolved) showBootFailure(`Worker crashed during boot: ${ev.message || "unknown error"}`);
});

worker.addEventListener("message", (ev: MessageEvent<FromWorker>) => {
  const msg = ev.data;
  switch (msg.type) {
    case "progress":
      // Boot progress is debug-only — log it, don't surface to the user.
      // The editor stays interactive throughout.
      console.log(`[boot] ${msg.phase}`);
      break;
    case "ready":
      workerReady = true;
      bootResolved = true;
      clearTimeout(bootTimeout);
      recompute();
      break;
    case "result": {
      if (msg.id < lastDisplayedId) return;
      // Zero state still owns the readouts; ignore any stale boot-time
      // computation that finishes after we entered (or are still in) demo.
      if (editor.isZeroState()) return;
      lastDisplayedId = msg.id;
      els.ix.textContent = twoSigFigs(msg.result.ixx_c);
      els.iy.textContent = twoSigFigs(msg.result.iyy_c);
      els.j.textContent  = twoSigFigs(msg.result.j);
      setComputing(false);
      els.status.textContent = `${msg.result.n_elems.toLocaleString()} elems FEM`;
      break;
    }
    case "error":
      setComputing(false);
      if (!bootResolved) {
        showBootFailure(msg.error);
        return;
      }
      if (editor.isZeroState()) return;
      setReadouts("—", true);
      els.status.textContent = `error: ${msg.error.split("\n")[0]}`;
      break;
  }
});

function setComputing(on: boolean): void {
  for (const r of [els.ix, els.iy, els.j]) {
    r.classList.toggle("computing", on);
    r.classList.remove("invalid");
  }
}

function setReadouts(val: string, invalid: boolean): void {
  for (const r of [els.ix, els.iy, els.j]) {
    r.textContent = val;
    r.classList.toggle("invalid", invalid);
    r.classList.remove("computing");
  }
}

let solveTimer: number | null = null;
function recompute(): void {
  // Zero state owns the readouts and canvas; suppress real solves until the
  // user picks a preset. The worker keeps booting in the background.
  if (editor.isZeroState()) return;
  // Always recompose immediately so the canvas mirrors current state.
  const result = compose(editor.getShape());
  if (!result.ok) {
    editor.setComposed(null);
    setReadouts("—", true);
    els.status.textContent = `invalid: ${result.reason}`;
    return;
  }
  editor.setComposed(result.shape);

  if (!workerReady) return;

  // Debounce the solver kick — drag emits many events per frame.
  if (solveTimer !== null) clearTimeout(solveTimer);
  solveTimer = window.setTimeout(() => {
    solveTimer = null;
    kickOffSolve(result.shape);
  }, 80);
}

function kickOffSolve(shape: ReturnType<typeof compose> extends { ok: true; shape: infer S } ? S : never): void {
  const id = nextId++;
  setComputing(true);
  // Mesh size proxy: heuristic by bbox size of composed shape.
  let maxExtent = 0;
  for (const ring of shape) for (const p of ring) maxExtent = Math.max(maxExtent, Math.abs(p.x), Math.abs(p.y));
  const meshSize = Math.max(0.05, maxExtent / 10);
  const msg: ToWorker = { type: "solve", id, shape: toWire(shape), meshSize };
  worker.postMessage(msg);
}

// ----- start-from pane -----

type Preset = "rod" | "rect" | "extrusion";
type FieldDef = { name: string; label: string; min: number; step: number };

const PRESET_FIELDS: Record<Preset, FieldDef[]> = {
  rod:       [{ name: "D", label: "D", min: 0.1, step: 0.5 }],
  rect:      [{ name: "W", label: "W", min: 0.1, step: 0.5 },
              { name: "H", label: "H", min: 0.1, step: 0.5 }],
  extrusion: [{ name: "S", label: "S", min: 1010, step: 1 }],
};
const PRESET_DEFAULTS: Record<Preset, Record<string, number>> = {
  rod:       { D: 5 },
  rect:      { W: 20, H: 5 },
  extrusion: { S: 2020 },
};

function setStartPaneOpen(open: boolean): void {
  els.startSection.classList.toggle("collapsed", !open);
}

els.startPaneToggle.addEventListener("click", () => {
  setStartPaneOpen(els.startSection.classList.contains("collapsed"));
});

for (const btn of els.startBtns) {
  btn.addEventListener("click", () => {
    const preset = btn.dataset.preset as Preset;
    if (userModified && !confirm("Replace current shape?")) return;
    if (editor.isZeroState()) exitZeroState();
    applyPreset(preset, PRESET_DEFAULTS[preset]);
    setStartPaneOpen(false);
  });
}

function applyPreset(preset: Preset, vals: Record<string, number>): void {
  setShapeFromPreset(preset, vals);
  showSizeInput(preset, vals);
}

function setShapeFromPreset(
  preset: Preset,
  vals: Record<string, number>,
  opts: { refit?: boolean } = {},
): void {
  switch (preset) {
    case "rod":       editor.setShape(rodOf(vals.D!), opts); break;
    case "rect":      editor.setShape(rectShapeOf(vals.W!, vals.H!), opts); break;
    case "extrusion": editor.setShape(extrusionOf(vals.S!), opts); break;
  }
  // Preset-driven shape changes don't count as user modification.
  userModified = false;
}

// Track the pending grid-refit while the user is typing in the size-input.
// Each keystroke updates the shape immediately but only schedules a refit;
// the grid catches up after a short idle period. This avoids the grid
// scrubbing rapidly when the user is mid-edit (e.g. "32" → backspace → "3"
// → "33" should not pulse the grid down to ±5 mm and back).
let sizeInputRefitTimer: number | null = null;
const SIZE_INPUT_REFIT_DEBOUNCE_MS = 350;

function showSizeInput(preset: Preset, initial: Record<string, number>): void {
  if (sizeInputRefitTimer !== null) {
    clearTimeout(sizeInputRefitTimer);
    sizeInputRefitTimer = null;
  }
  const form = els.sizeInput;
  form.innerHTML = "";
  form.hidden = false;

  const fields = PRESET_FIELDS[preset];
  const inputs: HTMLInputElement[] = [];
  for (const f of fields) {
    const label = document.createElement("label");
    label.textContent = `${f.label} = `;
    const input = document.createElement("input");
    input.type = "number";
    input.value = String(initial[f.name]);
    input.min = String(f.min);
    input.step = String(f.step);
    label.appendChild(input);
    form.appendChild(label);
    inputs.push(input);
  }
  const hint = document.createElement("span");
  hint.className = "hint";
  hint.textContent = "Enter to confirm";
  form.appendChild(hint);

  const apply = (): void => {
    const vals: Record<string, number> = {};
    for (let i = 0; i < fields.length; i++) {
      const v = Number(inputs[i]!.value);
      if (!isFinite(v) || v <= 0) return;
      vals[fields[i]!.name] = v;
    }
    setShapeFromPreset(preset, vals, { refit: false });
    if (sizeInputRefitTimer !== null) clearTimeout(sizeInputRefitTimer);
    sizeInputRefitTimer = window.setTimeout(() => {
      sizeInputRefitTimer = null;
      editor.refit();
    }, SIZE_INPUT_REFIT_DEBOUNCE_MS);
  };

  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i]!;
    input.addEventListener("input", apply);
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        if (i + 1 < inputs.length) {
          inputs[i + 1]!.focus();
          inputs[i + 1]!.select();
        } else {
          dismissSizeInput();
        }
      } else if (ev.key === "Escape") {
        ev.preventDefault();
        dismissSizeInput();
      }
    });
  }

  // Dismiss when focus leaves the form. setTimeout lets Tab settle on the
  // next focused element before we check.
  form.addEventListener("focusout", () => {
    setTimeout(() => {
      if (!form.contains(document.activeElement)) dismissSizeInput();
    }, 0);
  });

  inputs[0]?.focus();
  inputs[0]?.select();
}

function dismissSizeInput(): void {
  // Flush any pending refit so the grid lands on the final value
  // immediately when the user confirms or focuses out.
  if (sizeInputRefitTimer !== null) {
    clearTimeout(sizeInputRefitTimer);
    sizeInputRefitTimer = null;
    editor.refit();
  }
  els.sizeInput.hidden = true;
  els.sizeInput.innerHTML = "";
}

// ----- toolbar -----

for (const b of els.toolBtns) {
  b.addEventListener("click", () => {
    const kind = b.dataset.tool as ToolKind;
    // Click an active tool button to deactivate it.
    if (b.classList.contains("active")) editor.setTool(null);
    else editor.setTool(kind);
  });
}

els.snapToggle.addEventListener("change", () => editor.setSnap(els.snapToggle.checked));

function toolHintText(state: ToolState): string {
  if (state.phase === "wait-anchor") {
    if (state.kind === "add-hole") return "Click center";
    return "Click first corner";
  }
  if (state.kind === "add-hole") return "Click circumference";
  return "Click opposite corner";
}

function applyToolCommit(kind: ToolKind, p1: Vec2, p2: Vec2): void {
  if (kind === "paint-rect") {
    const out = rectFromCorners(p1, p2);
    if (out === null) return;
    ensurePolygonMode();
    editor.mutate((s) => {
      if (s.kind !== "polygon") return;
      s.outers.push(out);
      editor.setSelection({ kind: "outer", index: s.outers.length - 1 });
    });
  } else if (kind === "erase-rect") {
    const out = rectFromCorners(p1, p2);
    if (out === null) return;
    editor.mutate((s) => {
      s.holes.push({ kind: "polygon", outline: out });
      editor.setSelection({ kind: "hole", index: s.holes.length - 1 });
    });
  } else { // add-hole
    const r = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    if (r < 0.05) return;
    editor.mutate((s) => {
      s.holes.push({ kind: "circle", cx: p1.x, cy: p1.y, r });
      editor.setSelection({ kind: "hole", index: s.holes.length - 1 });
    });
  }
}

function rectFromCorners(p1: Vec2, p2: Vec2): Outline | null {
  const x0 = Math.min(p1.x, p2.x), x1 = Math.max(p1.x, p2.x);
  const y0 = Math.min(p1.y, p2.y), y1 = Math.max(p1.y, p2.y);
  if (x1 - x0 < 0.05 || y1 - y0 < 0.05) return null; // ignore zero-area drag
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
}

function ensurePolygonMode(): void {
  // Switching kind discards holes (current ones may not be valid in the new outer).
  // For "+ Rect" to feel direct, we silently switch to polygon mode with the
  // current disk replaced by an inscribed rectangle so the user has something.
  const prev = editor.getShape();
  if (prev.kind === "disk") {
    const r = prev.r * Math.SQRT1_2;
    editor.setShape({
      kind: "polygon",
      outers: [rectOutline(prev.cx, prev.cy, 2 * r, 2 * r)],
      holes: [],
    });
  }
}

// ----- prim list rendering -----

function refreshPrimList(): void {
  const s = editor.getShape();
  const sel = editor.getSelection();
  const items: { tag: string; desc: string; sel: Selection; key: string }[] = [];
  if (s.kind === "disk") {
    items.push({
      tag: "DISK",
      desc: `r=${s.r.toFixed(2)} @ (${s.cx.toFixed(1)}, ${s.cy.toFixed(1)})`,
      sel: { kind: "disk" },
      key: "disk",
    });
  } else {
    s.outers.forEach((o, i) => {
      items.push({
        tag: `OUT ${i + 1}`,
        desc: `${o.length}-vertex polygon`,
        sel: { kind: "outer", index: i },
        key: `outer-${i}`,
      });
    });
  }
  s.holes.forEach((h, i) => {
    if (h.kind === "circle") {
      items.push({
        tag: `HOLE ${i + 1}`,
        desc: `circle r=${h.r.toFixed(2)} @ (${h.cx.toFixed(1)}, ${h.cy.toFixed(1)})`,
        sel: { kind: "hole", index: i },
        key: `hole-${i}`,
      });
    } else {
      items.push({
        tag: `HOLE ${i + 1}`,
        desc: `${h.outline.length}-vertex polygon`,
        sel: { kind: "hole", index: i },
        key: `hole-${i}`,
      });
    }
  });

  els.primList.innerHTML = "";
  for (const it of items) {
    const li = document.createElement("li");
    if (sel && selectionEq(sel, it.sel)) li.classList.add("selected");
    const tag = document.createElement("span");
    tag.className = "prim-tag";
    tag.textContent = it.tag;
    const desc = document.createElement("span");
    desc.className = "prim-desc";
    desc.textContent = it.desc;
    li.appendChild(tag);
    li.appendChild(desc);
    // Disk can't be deleted (it's the whole shape); outers and holes can.
    if (it.sel.kind !== "disk") {
      const del = document.createElement("button");
      del.className = "prim-del";
      del.textContent = "✕";
      del.title = "delete";
      del.addEventListener("click", (ev) => {
        ev.stopPropagation();
        deletePrim(it.sel);
      });
      li.appendChild(del);
    }
    li.addEventListener("click", () => editor.setSelection(it.sel));
    els.primList.appendChild(li);
  }
}

function deletePrim(sel: Selection): void {
  editor.mutate((s) => {
    if (sel.kind === "outer" && s.kind === "polygon") {
      s.outers.splice(sel.index, 1);
      // If the user deleted the last outer, reset back to the default polygon.
      if (s.outers.length === 0) s.outers.push(rectOutline(0, 0, 10, 10));
    } else if (sel.kind === "hole") {
      s.holes.splice(sel.index, 1);
    }
    editor.setSelection(null);
  });
}

function selectionEq(a: Selection, b: Selection): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "disk") return b.kind === "disk";
  return (a as { index: number }).index === (b as { index: number }).index;
}

function refreshButtons(): void {
  // No state-dependent buttons in the right panel right now.
}

// ----- zero-state landing -----
//
// Until the user picks a Start from preset, the canvas runs a slow muted
// crossfade through a few representative cross-sections, and the Ix/Iy/J
// readouts carousel in lockstep with the visible shape using closed-form
// values. Goals: hide Pyodide boot time behind something useful; show
// concretely what this tool computes; keep the user's eye on the only
// active control (the Start from list).
//
// The canvas toolbar (Paint/Erase/Snap) and the right-side debug panel stay
// hidden — they don't apply until there's a real shape. The status line
// (`N elems FEM`) is also suppressed: zero-state numbers are closed-form,
// not FEM, so labelling them as FEM would lie.
type DemoEntry = { shape: CoreShape; ix: number; iy: number; j: number };

function buildDemoEntries(): DemoEntry[] {
  const out: DemoEntry[] = [];
  const push = (auth: AuthoringShape, ix: number, iy: number, j: number): void => {
    const r = compose(auth);
    if (r.ok) out.push({ shape: r.shape, ix, iy, j });
  };

  // 1. Solid rod, D = 8 mm. Ix = Iy = πD⁴/64; J = 2 Ix.
  {
    const D = 8;
    const I = Math.PI * D ** 4 / 64;
    push(rodOf(D), I, I, 2 * I);
  }
  // 2. Hollow rod, Do = 12, Di = 8 mm.
  {
    const Do = 12, Di = 8;
    const I = Math.PI * (Do ** 4 - Di ** 4) / 64;
    push(
      { kind: "disk", cx: 0, cy: 0, r: Do / 2,
        holes: [{ kind: "circle", cx: 0, cy: 0, r: Di / 2 }] },
      I, I, 2 * I,
    );
  }
  // 3. Solid square, a = 14 mm. Ix = Iy = a⁴/12; J = β₁ a⁴, β₁ ≈ 0.140577 (Roark).
  {
    const a = 14;
    const I = a ** 4 / 12;
    const J = 0.140577 * a ** 4;
    push(rectShapeOf(a, a), I, I, J);
  }
  // 4. 30×30 hollow square (extrusion 3030 placeholder, t = 2 mm wall).
  //    Ix = Iy by subtraction (exact). J via Bredt thin-wall, which for a
  //    square tube simplifies: J = 4·Aₘ²·t / peri = Wₘ³·t  with Wₘ = W−t.
  {
    const Wo = 30, Wi = 26;
    const I = (Wo ** 4 - Wi ** 4) / 12;
    const Wm = (Wo + Wi) / 2;
    const t = (Wo - Wi) / 2;
    const J = Wm ** 3 * t;
    push(extrusionOf(3030), I, I, J);
  }
  return out;
}

function exitZeroState(): void {
  document.body.classList.remove("zero-state");
  editor.setZeroState(null);
}

const demoEntries = buildDemoEntries();
document.body.classList.add("zero-state");
editor.setZeroState(
  demoEntries.map((e) => e.shape),
  (idx) => {
    const e = demoEntries[idx];
    if (!e) return;
    els.ix.textContent = twoSigFigs(e.ix);
    els.iy.textContent = twoSigFigs(e.iy);
    els.j.textContent  = twoSigFigs(e.j);
    els.status.textContent = "";
  },
);
refreshPrimList();
refreshButtons();
recompute();
