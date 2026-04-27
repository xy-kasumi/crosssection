// Canvas-toolbar: tool buttons (Paint Rect / Erase Rect / Add Hole), the
// snap-to-grid checkbox, and the small hint that tells the user what to
// click next during a 2-step tool flow. Also owns the global Space-bar
// shortcut for snap.
//
// Tool semantics (rect-from-corners, circle-from-center+radius) live here
// because they're the toolbar's contract — the editor just delivers two
// world-space points and the kind of tool that produced them.

import { rectOutline, type Outline, type Vec2 } from "../authoring.ts";
import type { ToolKind } from "../canvas.ts";
import type { Editor, ToolState } from "../editor.ts";

export class Toolbar {
  private readonly editor: Editor;
  private readonly toolBtns: HTMLButtonElement[];
  private readonly snap: HTMLInputElement;
  private readonly hint: HTMLElement;

  constructor(opts: { editor: Editor }) {
    this.editor = opts.editor;
    this.toolBtns = Array.from(document.querySelectorAll<HTMLButtonElement>(".tool-btn"));
    this.snap = document.getElementById("snap-toggle") as HTMLInputElement;
    this.hint = document.getElementById("tool-hint")!;

    for (const b of this.toolBtns) {
      b.addEventListener("click", () => {
        const kind = b.dataset.tool as ToolKind;
        // Click an active tool button to deactivate it.
        if (b.classList.contains("active")) this.editor.setTool(null);
        else this.editor.setTool(kind);
      });
    }

    this.snap.addEventListener("change", () => this.editor.setSnap(this.snap.checked));
    window.addEventListener("keydown", (ev) => this.onKey(ev));
  }

  // Editor → toolbar: refresh button highlight + hint text.
  syncToolState(state: ToolState | null): void {
    for (const b of this.toolBtns) {
      b.classList.toggle("active", state !== null && b.dataset.tool === state.kind);
    }
    this.hint.textContent = state ? toolHintText(state) : "";
  }

  // Editor → toolbar: the user finished a 2-click tool flow. Translate the
  // two world points + tool kind into a mutation on the authoring shape.
  applyCommit(kind: ToolKind, p1: Vec2, p2: Vec2): void {
    if (kind === "paint-rect") {
      const out = rectFromCorners(p1, p2);
      if (out === null) return;
      ensurePolygonMode(this.editor);
      this.editor.mutate((s) => {
        if (s.kind !== "polygon") return;
        s.outers.push(out);
        this.editor.setSelection({ kind: "outer", index: s.outers.length - 1 });
      });
    } else if (kind === "erase-rect") {
      const out = rectFromCorners(p1, p2);
      if (out === null) return;
      this.editor.mutate((s) => {
        s.holes.push({ kind: "polygon", outline: out });
        this.editor.setSelection({ kind: "hole", index: s.holes.length - 1 });
      });
    } else { // add-hole
      const r = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      if (r < 0.05) return;
      this.editor.mutate((s) => {
        s.holes.push({ kind: "circle", cx: p1.x, cy: p1.y, r });
        this.editor.setSelection({ kind: "hole", index: s.holes.length - 1 });
      });
    }
  }

  private onKey(ev: KeyboardEvent): void {
    if (ev.code !== "Space") return;
    // Skip when focus is in a text/number input so typing a space in the
    // size-input field still works as text entry.
    const t = ev.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    if (this.editor.isZeroState()) return;
    ev.preventDefault();
    this.snap.checked = !this.snap.checked;
    this.editor.setSnap(this.snap.checked);
  }
}

function toolHintText(state: ToolState): string {
  if (state.phase === "wait-anchor") {
    if (state.kind === "add-hole") return "Click center";
    return "Click first corner";
  }
  if (state.kind === "add-hole") return "Click circumference";
  return "Click opposite corner";
}

function rectFromCorners(p1: Vec2, p2: Vec2): Outline | null {
  const x0 = Math.min(p1.x, p2.x), x1 = Math.max(p1.x, p2.x);
  const y0 = Math.min(p1.y, p2.y), y1 = Math.max(p1.y, p2.y);
  if (x1 - x0 < 0.05 || y1 - y0 < 0.05) return null;
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
}

// Switching kind discards holes (current ones may not be valid in the new
// outer). For "Paint Rect" against a disk to feel direct, we silently swap
// the disk for an inscribed rectangle so the user has something to combine
// the new prim with.
function ensurePolygonMode(editor: Editor): void {
  const prev = editor.getShape();
  if (prev.kind !== "disk") return;
  const r = prev.r * Math.SQRT1_2;
  editor.setShape({
    kind: "polygon",
    outers: [rectOutline(prev.cx, prev.cy, 2 * r, 2 * r)],
    holes: [],
  });
}
