// Modeless UI: presets + slider drive a Pyodide worker, results stream into
// readouts. Latest input always wins; in-flight stale results are discarded.

import { circle, rectangle } from "@core/presets.ts";
import { toWire, type Shape } from "@core/shape.ts";
import { drawShape } from "./canvas.ts";
import { twoSigFigs } from "./format.ts";
import type { ToWorker, FromWorker } from "./types.ts";

type Preset = "rod" | "square";

interface State {
  preset: Preset;
  d: number; // diameter (rod) or side length (square), mm
}

const els = {
  canvas: document.getElementById("cv") as HTMLCanvasElement,
  presetBtns: Array.from(document.querySelectorAll<HTMLButtonElement>(".preset-btn")),
  paramName: document.getElementById("param-name")!,
  paramVal: document.getElementById("param-val")!,
  slider: document.getElementById("d-slider") as HTMLInputElement,
  ix: document.getElementById("ix")!,
  iy: document.getElementById("iy")!,
  j: document.getElementById("j")!,
  status: document.getElementById("status")!,
};

const state: State = { preset: "rod", d: 10 };

let nextId = 1;
let lastDisplayedId = 0; // id of the most recent result we actually rendered

const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });

worker.addEventListener("message", (ev: MessageEvent<FromWorker>) => {
  const msg = ev.data;
  switch (msg.type) {
    case "progress":
      els.status.textContent = msg.phase + "…";
      break;
    case "ready":
      els.status.textContent = "ready";
      kickOffSolve(); // first compute now that backend is alive
      break;
    case "result": {
      // Ignore stale results: only paint if this is the newest finished result.
      if (msg.id < lastDisplayedId) return;
      lastDisplayedId = msg.id;
      els.ix.textContent = twoSigFigs(msg.result.ixx_c);
      els.iy.textContent = twoSigFigs(msg.result.iyy_c);
      els.j.textContent = twoSigFigs(msg.result.j);
      setComputing(false);
      els.status.textContent = `solved in ${msg.ms.toFixed(0)} ms`;
      break;
    }
    case "error":
      els.status.textContent = `error: ${msg.error}`;
      setComputing(false);
      break;
  }
});

function setComputing(on: boolean): void {
  for (const r of [els.ix, els.iy, els.j]) {
    r.classList.toggle("computing", on);
  }
  if (on) els.status.textContent = "computing…";
}

function buildShape(): { shape: Shape; meshSize: number } {
  switch (state.preset) {
    case "rod":
      return { shape: circle(state.d, 64), meshSize: Math.max(0.05, state.d / 20) };
    case "square":
      return { shape: rectangle(state.d, state.d), meshSize: Math.max(0.05, state.d / 20) };
  }
}

function render(): void {
  const { shape } = buildShape();
  drawShape(els.canvas, shape);
}

function kickOffSolve(): void {
  const { shape, meshSize } = buildShape();
  const id = nextId++;
  setComputing(true);
  const msg: ToWorker = { type: "solve", id, shape: toWire(shape), meshSize };
  worker.postMessage(msg);
}

// --- Wire UI ---

for (const btn of els.presetBtns) {
  btn.addEventListener("click", () => {
    const preset = btn.dataset.preset as Preset;
    if (state.preset === preset) return;
    state.preset = preset;
    for (const b of els.presetBtns) b.classList.toggle("active", b === btn);
    render();
    kickOffSolve();
  });
}

els.slider.addEventListener("input", () => {
  state.d = Number(els.slider.value);
  els.paramVal.textContent = `${state.d.toFixed(1)} mm`;
  render();
  // Don't solve on every micro-input event; queue the latest value.
  scheduleSolve();
});

let solveTimer: number | null = null;
function scheduleSolve(): void {
  if (solveTimer !== null) clearTimeout(solveTimer);
  solveTimer = window.setTimeout(() => {
    solveTimer = null;
    kickOffSolve();
  }, 100);
}

// Initial paint while the worker is still booting
render();
els.paramVal.textContent = `${state.d.toFixed(1)} mm`;
