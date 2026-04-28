// Symmetrize popup: parent toolbar button + 2 option buttons.
//
// Hover an option → live-preview the result on canvas (the editor's
// preview-shape hook). Click → commit (editor.setShape(result)). Esc /
// outside-click / popup close → cancel.
//
// The popup speaks directly to the editor's setShape / setPreviewShape
// because Symmetrize is a wholesale shape replacement, not an Op. apply()'s
// per-op pipeline isn't involved.

import { check, symCompose, type AuthoringShape, type ErrorTag } from "@geom/index.ts";
import type { Editor, ToolStatus } from "../editor.ts";
import { errorText } from "../error-text.ts";
import { SYM_SPECS, type SymKind, type SymSpec } from "./symmetrize.ts";

export interface SymmetrizePopupOpts {
  editor: Editor;
  onStatus(status: ToolStatus): void;
}

interface Preview {
  spec: SymSpec;
  result: AuthoringShape | null;  // null when symCompose returned empty
  errorTag: ErrorTag | null;       // non-null when result violates check()
  valid: boolean;                  // can we commit?
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
      const kind = btn.dataset.sym as SymKind;
      const spec = SYM_SPECS.find(s => s.kind === kind);
      if (!spec) continue;
      btn.addEventListener("mouseenter", () => this.preview(spec));
      btn.addEventListener("mouseleave", () => this.maybeClearPreview());
      btn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        this.commit(spec);
      });
    }

    // Outside-click and Esc to dismiss.
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
    const result = symCompose(E, spec.region, spec.transforms);
    let errorTag: ErrorTag | null = null;
    let valid = false;

    if (result === null) {
      this.onStatus({
        level: "error",
        message: `${spec.label}: nothing inside the canonical region`,
      });
      this.editor.setPreviewShape(null, { dim: spec.dimRegions });
    } else {
      errorTag = check(result);
      if (errorTag) {
        this.onStatus({
          level: "error",
          message: `${spec.label}: ${errorText(errorTag)}`,
        });
        // Show dim only — leave the original composed shape visible so the
        // user can see *why* the symmetric union didn't work.
        this.editor.setPreviewShape(null, { dim: spec.dimRegions });
      } else {
        this.onStatus({ level: "valid", message: null });
        this.editor.setPreviewShape(result, { dim: spec.dimRegions });
        valid = true;
      }
    }
    this.current = { spec, result, errorTag, valid };
  }

  // Debounced clear: wait a tick so moving between option buttons doesn't
  // briefly drop the preview. If the cursor is still inside the popup or
  // parent button after the tick, leave the preview alone.
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
    if (!this.current?.valid || !this.current.result) {
      // Invalid — keep popup open so the user can hover the other option.
      return;
    }
    const result = this.current.result;
    this.close();
    this.editor.setShape(result);
  }
}
