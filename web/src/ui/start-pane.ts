// Left-column "Start from" pane: collapsible header, three preset buttons,
// and the size-input overlay that pops up over the canvas after a preset is
// chosen. Owns its own DOM and userModified flag.
//
// Sequence: click Rod/Rectangle/Extrusion → confirm-discard if the user
// already edited → notify host (so it can exit zero state) → swap in the
// preset shape → show the size-input overlay so the user can dial values.
// Typing in the overlay updates the shape immediately; the grid refit is
// debounced so it doesn't chase rapid keystrokes ("32" → "3" → "33").

import { boxOf, extrusionOf, pipeOf, rectShapeOf, rodOf } from "@geom/index.ts";
import type { Editor } from "../editor.ts";
import { t } from "./i18n.ts";

type Preset = "rod" | "pipe" | "rect" | "box" | "extrusion";
type FieldDef = { name: string; label: string; min: number; step: number };

// Floor for initial-size dimensions. 0.02 mm is the smallest the editor
// accepts at preset entry — well above the 0.0001 mm coord grid so a
// freshly-built shape has room to be edited without immediately bumping
// against quantization.
const MIN_INITIAL_DIM = 0.02;

const PRESET_FIELDS: Record<Preset, FieldDef[]> = {
  rod:       [{ name: "D", label: "D", min: MIN_INITIAL_DIM, step: 0.5 }],
  pipe:      [{ name: "D", label: "D", min: MIN_INITIAL_DIM, step: 0.5 },
              { name: "T", label: "T", min: MIN_INITIAL_DIM, step: 0.2 }],
  rect:      [{ name: "W", label: "W", min: MIN_INITIAL_DIM, step: 0.5 },
              { name: "H", label: "H", min: MIN_INITIAL_DIM, step: 0.5 }],
  box:       [{ name: "W", label: "W", min: MIN_INITIAL_DIM, step: 0.5 },
              { name: "H", label: "H", min: MIN_INITIAL_DIM, step: 0.5 },
              { name: "T", label: "T", min: MIN_INITIAL_DIM, step: 0.2 }],
  extrusion: [],
};
const PRESET_DEFAULTS: Record<Preset, Record<string, number>> = {
  rod:       { D: 5 },
  pipe:      { D: 12, T: 2 },
  rect:      { W: 20, H: 5 },
  box:       { W: 20, H: 20, T: 2 },
  extrusion: {},
};

const SIZE_INPUT_REFIT_DEBOUNCE_MS = 350;

export interface StartPaneOpts {
  editor: Editor;
  // Called once, just before the first preset is applied. Hook for the
  // host to tear down zero-state mode before the editor receives its first
  // real shape.
  onFirstPreset?: () => void;
}

export class StartPane {
  private readonly editor: Editor;
  private readonly onFirstPreset?: () => void;
  private readonly section: HTMLElement;
  private readonly sizeInput: HTMLFormElement;
  private userModified = false;
  private firstPresetPicked = false;
  private refitTimer: number | null = null;

  constructor(opts: StartPaneOpts) {
    this.editor = opts.editor;
    this.onFirstPreset = opts.onFirstPreset;
    this.section = document.getElementById("start-section") as HTMLElement;
    this.sizeInput = document.getElementById("size-input") as HTMLFormElement;

    document.getElementById("start-pane-toggle")!
      .addEventListener("click", () => this.setOpen(this.section.classList.contains("collapsed")));

    for (const btn of document.querySelectorAll<HTMLButtonElement>(".start-btn")) {
      btn.addEventListener("click", () => {
        const preset = btn.dataset.preset as Preset;
        if (this.userModified && !confirm(t({
          en: "Replace current shape?",
          ja: "現在の形状を置き換えますか？",
        }))) return;
        if (!this.firstPresetPicked) {
          this.firstPresetPicked = true;
          this.onFirstPreset?.();
        }
        this.applyPreset(preset, PRESET_DEFAULTS[preset]);
        this.setOpen(false);
      });
    }
  }

  // Editor changes count as user-driven unless they came from us setting a
  // preset. Host wires editor.onChange → markUserModified.
  markUserModified(): void { this.userModified = true; }

  private setOpen(open: boolean): void {
    this.section.classList.toggle("collapsed", !open);
  }

  private applyPreset(preset: Preset, vals: Record<string, number>): void {
    this.setShapeFromPreset(preset, vals);
    if (PRESET_FIELDS[preset].length > 0) this.showSizeInput(preset, vals);
  }

  private setShapeFromPreset(
    preset: Preset,
    vals: Record<string, number>,
    opts: { refit?: boolean } = {},
  ): void {
    switch (preset) {
      case "rod":       this.editor.setShape(rodOf(vals.D!), opts); break;
      case "pipe":      this.editor.setShape(pipeOf(vals.D!, vals.T!), opts); break;
      case "rect":      this.editor.setShape(rectShapeOf(vals.W!, vals.H!), opts); break;
      case "box":       this.editor.setShape(boxOf(vals.W!, vals.H!, vals.T!), opts); break;
      case "extrusion": this.editor.setShape(extrusionOf(), opts); break;
    }
    // Preset-driven shape changes don't count as user modification.
    this.userModified = false;
  }

  private showSizeInput(preset: Preset, initial: Record<string, number>): void {
    if (this.refitTimer !== null) {
      clearTimeout(this.refitTimer);
      this.refitTimer = null;
    }
    const form = this.sizeInput;
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
    hint.textContent = t({ en: "Enter to confirm", ja: "Enterで確定" });
    form.appendChild(hint);

    const apply = (): void => {
      const vals: Record<string, number> = {};
      for (let i = 0; i < fields.length; i++) {
        const v = Number(inputs[i]!.value);
        if (!isFinite(v) || v < fields[i]!.min) return;
        vals[fields[i]!.name] = v;
      }
      this.setShapeFromPreset(preset, vals, { refit: false });
      if (this.refitTimer !== null) clearTimeout(this.refitTimer);
      this.refitTimer = window.setTimeout(() => {
        this.refitTimer = null;
        this.editor.refit();
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
            this.dismissSizeInput();
          }
        } else if (ev.key === "Escape") {
          ev.preventDefault();
          this.dismissSizeInput();
        }
      });
    }

    // Dismiss when focus leaves the form. setTimeout lets Tab settle on the
    // next focused element before we check.
    form.addEventListener("focusout", () => {
      setTimeout(() => {
        if (!form.contains(document.activeElement)) this.dismissSizeInput();
      }, 0);
    });

    inputs[0]?.focus();
    inputs[0]?.select();
  }

  private dismissSizeInput(): void {
    // Flush any pending refit so the grid lands on the final value.
    if (this.refitTimer !== null) {
      clearTimeout(this.refitTimer);
      this.refitTimer = null;
      this.editor.refit();
    }
    this.sizeInput.hidden = true;
    this.sizeInput.innerHTML = "";
  }
}
