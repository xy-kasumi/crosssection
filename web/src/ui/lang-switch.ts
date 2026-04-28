// EN/JA toggle in the left aside footer. Always shows the *other*
// language as the affordance label, paired with a ↗ glyph so the user
// reads "this navigates" rather than "this toggles in place" — clicking
// reloads the page to apply the locale (see i18n.ts setLang).
//
// No loss-of-work guard yet; the visual treatment is the only warning.
// Revisit after seeing the UI in practice.

import { getLang, setLang, type Lang } from "./i18n.ts";

export function mountLangSwitch(): void {
  const host = document.getElementById("lang-switch");
  if (!host) return;

  const current = getLang();
  const target: Lang = current === "en" ? "ja" : "en";
  const label = target === "ja" ? "日本語" : "English";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "lang-switch-btn";
  btn.dataset.target = target;

  const glyph = document.createElement("span");
  glyph.className = "lang-switch-glyph";
  glyph.setAttribute("aria-hidden", "true");
  glyph.textContent = "↗";

  const labelEl = document.createElement("span");
  labelEl.className = "lang-switch-label";
  labelEl.textContent = label;

  btn.append(glyph, labelEl);
  btn.addEventListener("click", () => setLang(target));

  host.append(btn);
}
