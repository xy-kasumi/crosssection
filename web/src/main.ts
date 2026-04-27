// Modeless editor for the cross-section. Drives an AuthoringShape, runs
// compose() on every change, kicks a Pyodide solve when compose succeeds,
// updates readouts. Latest input always wins; stale results suppressed.

import {
  compose,
  defaultDisk,
  defaultPolygonShape,
  rectOutline,
  type AuthoringShape,
  type CircleHole,
  type PolygonHole,
  type Selection,
} from "./authoring.ts";
import { Editor } from "./editor.ts";
import { twoSigFigs } from "./format.ts";
import type { ToWorker, FromWorker } from "./types.ts";
import { toWire } from "@core/shape.ts";

const els = {
  canvas: document.getElementById("cv") as HTMLCanvasElement,
  addRect:       document.getElementById("op-add-rect")        as HTMLButtonElement,
  addPoly:       document.getElementById("op-add-poly")        as HTMLButtonElement,
  addCircleHole: document.getElementById("op-add-circle-hole") as HTMLButtonElement,
  addPolyHole:   document.getElementById("op-add-poly-hole")   as HTMLButtonElement,
  modeDisk:      document.getElementById("op-mode-disk")       as HTMLButtonElement,
  modePoly:      document.getElementById("op-mode-poly")       as HTMLButtonElement,
  primList:      document.getElementById("prim-list")          as HTMLUListElement,
  ix:            document.getElementById("ix")!,
  iy:            document.getElementById("iy")!,
  j:             document.getElementById("j")!,
  status:        document.getElementById("status")!,
};

const editor = new Editor(els.canvas, defaultDisk(), {
  onChange: () => {
    refreshPrimList();
    refreshButtons();
    recompute();
  },
  onSelectionChange: () => {
    refreshPrimList();
  },
});

// Pyodide worker
const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
let workerReady = false;
let nextId = 1;
let lastDisplayedId = 0;

worker.addEventListener("message", (ev: MessageEvent<FromWorker>) => {
  const msg = ev.data;
  switch (msg.type) {
    case "progress":
      els.status.textContent = msg.phase + "…";
      break;
    case "ready":
      workerReady = true;
      els.status.textContent = "ready";
      recompute();
      break;
    case "result": {
      if (msg.id < lastDisplayedId) return;
      lastDisplayedId = msg.id;
      els.ix.textContent = twoSigFigs(msg.result.ixx_c);
      els.iy.textContent = twoSigFigs(msg.result.iyy_c);
      els.j.textContent  = twoSigFigs(msg.result.j);
      setComputing(false);
      els.status.textContent = `solved in ${msg.ms.toFixed(0)} ms`;
      break;
    }
    case "error":
      setComputing(false);
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

// ----- buttons -----

els.addRect.addEventListener("click", () => {
  ensurePolygonMode();
  editor.mutate((s) => {
    if (s.kind !== "polygon") return;
    s.outers.push(rectOutline(0, 0, 6, 6));
    editor.setSelection({ kind: "outer", index: s.outers.length - 1 });
  });
});

els.addPoly.addEventListener("click", () => {
  ensurePolygonMode();
  editor.mutate((s) => {
    if (s.kind !== "polygon") return;
    s.outers.push(rectOutline(0, 0, 6, 6));
    editor.setSelection({ kind: "outer", index: s.outers.length - 1 });
  });
});

els.addCircleHole.addEventListener("click", () => {
  editor.mutate((s) => {
    const hole: CircleHole = { kind: "circle", cx: 0, cy: 0, r: 1.5 };
    s.holes.push(hole);
    editor.setSelection({ kind: "hole", index: s.holes.length - 1 });
  });
});

els.addPolyHole.addEventListener("click", () => {
  editor.mutate((s) => {
    const hole: PolygonHole = { kind: "polygon", outline: rectOutline(0, 0, 3, 3) };
    s.holes.push(hole);
    editor.setSelection({ kind: "hole", index: s.holes.length - 1 });
  });
});

els.modeDisk.addEventListener("click", () => {
  editor.setShape(defaultDisk());
});

els.modePoly.addEventListener("click", () => {
  editor.setShape(defaultPolygonShape());
});

function ensurePolygonMode(): void {
  if (editor.getShape().kind !== "polygon") {
    // Switching kind discards holes (current ones may not be valid in the new outer).
    // For "+ Rect" to feel direct, we silently switch to polygon mode with the
    // current disk replaced by an inscribed rectangle so the user has something.
    const prev = editor.getShape();
    if (prev.kind === "disk") {
      const r = prev.r * Math.SQRT1_2; // inscribe square in disk
      editor.setShape({
        kind: "polygon",
        outers: [rectOutline(prev.cx, prev.cy, 2 * r, 2 * r)],
        holes: [],
      });
    } else {
      editor.setShape(defaultPolygonShape());
    }
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
  const s = editor.getShape();
  // Adding rects/polygons in disk mode silently switches to polygon mode (handled in ensurePolygonMode).
  els.modeDisk.disabled = s.kind === "disk";
  els.modePoly.disabled = s.kind === "polygon" && s.holes.length === 0 && s.outers.length === 1
    && rectish(s.outers[0]!);
}

function rectish(o: { x: number; y: number }[]): boolean {
  return o.length === 4;
}

// Initial render
editor.render();
refreshPrimList();
refreshButtons();
recompute();
