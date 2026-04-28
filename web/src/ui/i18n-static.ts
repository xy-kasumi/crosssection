// HTML static labels: selector → EN/JA tuple. index.html keeps its English
// text as the no-JS / view-source / SEO fallback; JP is applied at boot.
//
// The selector keys are not opaque IDs — the EN companion sits inline with
// the JA on the same line, which is the property the inline-tuple approach
// is meant to preserve. Centralizing the wiring here just acknowledges that
// HTML can't call t() directly.

import { t } from "./i18n.ts";

interface Entry { sel: string; attr?: string; en: string; ja: string }

const ENTRIES: Entry[] = [
  // Presets section
  { sel: "#start-pane-toggle", attr: "aria-label",               en: "toggle presets", ja: "プリセットを開閉" },
  { sel: "#start-section .section-title",                        en: "Presets",        ja: "プリセット" },
  { sel: '.start-row:nth-child(1) .start-row-label',             en: "Round",          ja: "丸" },
  { sel: '.start-row:nth-child(1) [data-preset="rod"]',  attr: "title",  en: "Solid",  ja: "中実" },
  { sel: '.start-row:nth-child(1) [data-preset="rod"]  .start-tag',      en: "solid",  ja: "中実" },
  { sel: '.start-row:nth-child(1) [data-preset="pipe"]', attr: "title",  en: "Hollow", ja: "中空" },
  { sel: '.start-row:nth-child(1) [data-preset="pipe"] .start-tag',      en: "hollow", ja: "中空" },
  { sel: '.start-row:nth-child(2) .start-row-label',                     en: "Rect",   ja: "角" },
  { sel: '.start-row:nth-child(2) [data-preset="rect"]', attr: "title",  en: "Solid",  ja: "中実" },
  { sel: '.start-row:nth-child(2) [data-preset="rect"] .start-tag',      en: "solid",  ja: "中実" },
  { sel: '.start-row:nth-child(2) [data-preset="box"]',  attr: "title",  en: "Hollow", ja: "中空" },
  { sel: '.start-row:nth-child(2) [data-preset="box"]  .start-tag',      en: "hollow", ja: "中空" },
  { sel: '.start-row:nth-child(3) .start-row-label',                     en: "Frame",  ja: "フレーム" },

  // Toolbar
  { sel: '.tool-btn[data-tool="paint-rect"]',                    en: "Paint Rect",  ja: "矩形ペイント" },
  { sel: '.tool-btn[data-tool="erase-rect"]',                    en: "Erase Rect",  ja: "矩形消去" },
  { sel: '.tool-btn[data-tool="add-hole"]',                      en: "Add Hole",    ja: "穴追加" },
  { sel: "#symmetrize-btn",                                      en: "Symmetrize…", ja: "対称化…" },
  { sel: '.sym-option[data-sym="D1"] .sym-label',                en: "Mirror",      ja: "ミラー" },
  { sel: '.sym-option[data-sym="D4"] .sym-label',                en: "Cross",   ja: "十字" },

  // Snap-to-grid checkbox label (label wraps the input + spans; the visible
  // text span is the one without a child <input> — index second).
  { sel: ".snap-toggle span:not(.kbd-hint)",                     en: "Snap to grid", ja: "グリッド吸着" },
];

export function applyStaticLabels(): void {
  for (const e of ENTRIES) {
    const el = document.querySelector(e.sel);
    if (!el) continue;
    const text = t({ en: e.en, ja: e.ja });
    if (e.attr) el.setAttribute(e.attr, text);
    else el.textContent = text;
  }
}
