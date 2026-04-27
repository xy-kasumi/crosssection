// Canvas-toolbar: tool buttons (Paint Rect / Erase Rect / Add Hole) and the
// snap-to-grid checkbox. Owns the global Space-bar shortcut for snap.
//
// Hints, warnings, and errors live in the canvas-status strip below the
// canvas (CanvasStatus). The toolbar is purely tool-selection chrome.

import type { ToolKind } from "../canvas/index.ts";
import type { Editor, ToolState } from "../editor.ts";

export class Toolbar {
  private readonly editor: Editor;
  private readonly toolBtns: HTMLButtonElement[];
  private readonly snap: HTMLInputElement;

  constructor(opts: { editor: Editor }) {
    this.editor = opts.editor;
    this.toolBtns = Array.from(document.querySelectorAll<HTMLButtonElement>(".tool-btn"));
    this.snap = document.getElementById("snap-toggle") as HTMLInputElement;

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

  // Editor → toolbar: tool started/ended/phase-changed. Used only to light
  // up the active tool button.
  syncToolState(state: ToolState | null): void {
    for (const b of this.toolBtns) {
      b.classList.toggle("active", state !== null && b.dataset.tool === state.kind);
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
