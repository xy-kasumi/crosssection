// Canvas-status strip: a single-line band beneath the canvas that surfaces
// what the in-flight tool is doing or why it would refuse to commit.
//
// Three levels:
//   valid    — gray hint ("Click first corner") or empty
//   warning  — amber, committable; user-facing consequence (loss of circle)
//   error    — red, would-be discarded on commit
//
// Owns one DOM node; toolbar.ts no longer carries hint state.

import type { ToolState, ToolStatus } from "../editor.ts";

export class CanvasStatus {
  private readonly el: HTMLElement;
  private toolState: ToolState | null = null;
  private status: ToolStatus = { level: "valid", message: null };

  constructor() {
    this.el = document.getElementById("canvas-status")!;
    this.render();
  }

  setTool(state: ToolState | null): void {
    this.toolState = state;
    this.render();
  }

  setStatus(status: ToolStatus): void {
    this.status = status;
    this.render();
  }

  private render(): void {
    this.el.classList.remove("warning", "error");
    if (this.status.level === "warning") {
      this.el.classList.add("warning");
      this.el.textContent = this.status.message;
      return;
    }
    if (this.status.level === "error") {
      this.el.classList.add("error");
      this.el.textContent = this.status.message;
      return;
    }
    // Valid: explicit message wins; otherwise fall back to the tool's
    // default hint ("Click first corner" etc.). No tool active → blank.
    if (this.status.message) {
      this.el.textContent = this.status.message;
      return;
    }
    this.el.textContent = this.toolState ? defaultHint(this.toolState) : "";
  }
}

function defaultHint(state: ToolState): string {
  if (state.phase === "wait-anchor") {
    return state.kind === "add-hole" ? "Click center" : "Click first corner";
  }
  return state.kind === "add-hole" ? "Click circumference" : "Click opposite corner";
}
