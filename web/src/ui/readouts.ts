// Owns the A/Ix/Iy/J readout boxes plus the small status line below them.
// All four states are mutually exclusive: blank, computing (last value
// faded), computed (fresh value), invalid (error red). Callers don't poke
// the DOM directly — they pick a state.
//
// Long-computing escalation: if `computing` lingers past LONG_DELAY_MS,
// readouts swap to an animated wave glyph (.computing-long) and the
// status line says "still computing…". Communicates "this is genuinely
// working" without scaring the user — covers slow Pyodide boot, complex
// shapes, slow machines.

import { t } from "./i18n.ts";
import { twoSigFigs } from "../format.ts";

export class Readouts {
  private readonly area: HTMLElement;
  private readonly ix: HTMLElement;
  private readonly iy: HTMLElement;
  private readonly j: HTMLElement;
  private readonly status: HTMLElement;
  // Stays false until the first real (FEM or demo-supplied) value lands.
  // While false, entering computing mode blanks the readouts to "—" — we
  // don't have a previous value worth fading. Once true, recompute keeps
  // the previous value visible (and faded) so the user sees what's being
  // refined instead of a blank flash.
  private hasComputed = false;
  private longTimer: number | null = null;
  private static readonly LONG_DELAY_MS = 3000;

  constructor() {
    this.area = document.getElementById("area")!;
    this.ix = document.getElementById("ix")!;
    this.iy = document.getElementById("iy")!;
    this.j  = document.getElementById("j")!;
    this.status = document.getElementById("status")!;
  }

  setComputed(area: number, ix: number, iy: number, j: number, statusText: string): void {
    this.cancelLong();
    this.area.textContent = twoSigFigs(area);
    this.ix.textContent = twoSigFigs(ix);
    this.iy.textContent = twoSigFigs(iy);
    this.j.textContent  = twoSigFigs(j);
    this.setMode("computed");
    this.status.textContent = statusText;
    this.hasComputed = true;
  }

  setComputing(on: boolean): void {
    if (!on) { this.cancelLong(); this.setMode("computed"); return; }
    if (!this.hasComputed) {
      for (const el of this.allValues()) el.textContent = "—";
    }
    for (const el of this.allValues()) {
      el.classList.add("computing");
      el.classList.remove("invalid");
    }
    this.armLong();
  }

  setInvalid(message: string): void {
    this.cancelLong();
    for (const el of this.allValues()) {
      el.textContent = "—";
      el.classList.add("invalid");
      el.classList.remove("computing");
    }
    this.status.textContent = message;
  }

  // Display arbitrary precomputed values without tagging them as FEM-derived
  // (used by the zero-state demo, which carries closed-form numbers).
  setDemo(area: number, ix: number, iy: number, j: number): void {
    this.cancelLong();
    this.area.textContent = twoSigFigs(area);
    this.ix.textContent = twoSigFigs(ix);
    this.iy.textContent = twoSigFigs(iy);
    this.j.textContent  = twoSigFigs(j);
    this.setMode("computed");
    this.status.textContent = "";
    // Zero-state demo numbers are not the user's own first compute — leave
    // hasComputed false so the readouts blank to "—" the moment the user
    // exits zero-state and a real recompute starts.
  }

  private *allValues(): Generator<HTMLElement> {
    yield this.area; yield this.ix; yield this.iy; yield this.j;
  }

  private setMode(mode: "computed" | "computing" | "invalid"): void {
    for (const el of this.allValues()) {
      el.classList.toggle("computing", mode === "computing");
      el.classList.toggle("invalid",   mode === "invalid");
    }
  }

  private armLong(): void {
    this.cancelLong();
    this.longTimer = window.setTimeout(() => {
      for (const el of this.allValues()) el.classList.add("computing-long");
      this.status.textContent = t({ en: "still computing…", ja: "計算中…" });
    }, Readouts.LONG_DELAY_MS);
  }

  private cancelLong(): void {
    if (this.longTimer !== null) {
      clearTimeout(this.longTimer);
      this.longTimer = null;
    }
    for (const el of this.allValues()) el.classList.remove("computing-long");
  }
}
