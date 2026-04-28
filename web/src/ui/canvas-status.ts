// Canvas-status strip: a single-line band beneath the canvas that surfaces
// what the in-flight tool is doing or why it would refuse to commit.
//
// Three levels:
//   valid    — gray hint (kbd-chip "[Click] center · [Esc]/[R-Click] cancel") or empty
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
    // default hint. No tool active → blank.
    if (this.status.message) {
      this.el.textContent = this.status.message;
      return;
    }
    if (this.toolState) {
      this.el.replaceChildren(...defaultHint(this.toolState));
    } else {
      this.el.textContent = "";
    }
  }
}

function defaultHint(state: ToolState): Node[] {
  const action = state.phase === "wait-anchor"
    ? (state.kind === "add-hole" ? "center"           : "first corner")
    : (state.kind === "add-hole" ? "circumference"    : "opposite corner");
  return [
    kbd("Click"), text(` ${action}  ·  `),
    kbd("Esc"), text("/"), kbd("R-Click"), text(" cancel"),
  ];
}

function kbd(label: string): HTMLElement {
  const el = document.createElement("kbd");
  el.className = "kbd-hint";
  el.textContent = label;
  return el;
}

function text(s: string): Text {
  return document.createTextNode(s);
}
