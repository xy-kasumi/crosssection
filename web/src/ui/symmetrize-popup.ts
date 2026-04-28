// Symmetrize popup: parent toolbar button + 2 option buttons.
//
// Hover an option → live-preview the result on canvas (the editor's
// preview-shape hook). Click → commit (editor.setShape(result)). Esc /
// outside-click / popup close → cancel.
//
// The popup speaks directly to the editor's setShape / setPreviewShape
// because Symmetrize is a wholesale shape replacement, not an Op. apply()'s
// per-op pipeline isn't involved.

import { dimRegionsOf, symCompose, type SymComposeResult } from "@geom/index.ts";
import type { Editor, ToolStatus } from "../editor.ts";
import { errorText, warnText } from "../error-text.ts";
import { SYM_SPECS, type SymSpec } from "./symmetrize.ts";

export interface SymmetrizePopupOpts {
  editor: Editor;
  onStatus(status: ToolStatus): void;
}

interface Preview {
  spec: SymSpec;
  result: SymComposeResult;
}

export class SymmetrizePopup {
  private readonly editor: Editor;
  private readonly onStatus: (s: ToolStatus) => void;
  private readonly parentBtn: HTMLButtonElement;
  private readonly popupEl: HTMLElement;
  private readonly optionBtns: HTMLButtonElement[];

  private isOpen = false;
  private current: Preview | null = null;

  constructor(opts: SymmetrizePopupOpts) {
    this.editor = opts.editor;
    this.onStatus = opts.onStatus;
    this.parentBtn = document.getElementById("symmetrize-btn") as HTMLButtonElement;
    this.popupEl = document.getElementById("symmetrize-popup") as HTMLElement;
    this.optionBtns = Array.from(this.popupEl.querySelectorAll<HTMLButtonElement>(".sym-option"));

    this.parentBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      if (this.isOpen) this.close();
      else this.open();
    });

    for (const btn of this.optionBtns) {
      const kind = btn.dataset.sym;
      const spec = SYM_SPECS.find(s => s.kind === kind);
      if (!spec) continue;
      btn.addEventListener("mouseenter", () => this.preview(spec));
      btn.addEventListener("mouseleave", () => this.maybeClearPreview());
      btn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        this.commit(spec);
      });
    }

    document.addEventListener("click", () => {
      if (this.isOpen) this.close();
    });
    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape" && this.isOpen) {
        ev.preventDefault();
        this.close();
      }
    });
  }

  private open(): void {
    this.isOpen = true;
    this.parentBtn.classList.add("active");
    this.popupEl.hidden = false;
  }

  private close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.parentBtn.classList.remove("active");
    this.popupEl.hidden = true;
    this.clearPreview();
  }

  private preview(spec: SymSpec): void {
    const E = this.editor.getShape();
    const result = symCompose(E, spec.kind);
    const dim = dimRegionsOf(spec.kind);

    if (result.kind === "error") {
      this.onStatus({
        level: "error",
        message: `${spec.label}: ${errorText(result)}`,
      });
      // Keep the original shape visible; only show dim so user can see *why*.
      this.editor.setPreviewShape(null, { dim });
    } else if (result.kind === "warning") {
      this.onStatus({
        level: "warning",
        message: `${spec.label}: ${warnText(result)}`,
      });
      this.editor.setPreviewShape(result.shape, { dim });
    } else {
      this.onStatus({ level: "valid", message: null });
      this.editor.setPreviewShape(result.shape, { dim });
    }
    this.current = { spec, result };
  }

  // Debounced clear: wait a tick so moving between option buttons doesn't
  // briefly drop the preview.
  private maybeClearPreview(): void {
    setTimeout(() => {
      if (!this.isOpen) return;
      if (this.popupEl.matches(":hover") || this.parentBtn.matches(":hover")) return;
      this.clearPreview();
    }, 60);
  }

  private clearPreview(): void {
    if (!this.current) return;
    this.current = null;
    this.editor.setPreviewShape(null);
    this.onStatus({ level: "valid", message: null });
  }

  private commit(spec: SymSpec): void {
    if (!this.current || this.current.spec.kind !== spec.kind) {
      this.preview(spec);
    }
    const r = this.current?.result;
    if (!r || r.kind === "error") return;
    const shape = r.shape;
    this.close();
    this.editor.setShape(shape);
  }
}
