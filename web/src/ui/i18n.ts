// EN/JP localization. Strings are inline tuples — `t({ en, ja })` — so the
// JP companion sits next to the EN on the same line in source. There is no
// ID-keyed dictionary; the string itself is the key. See i18n-static.ts for
// the only exception (HTML labels addressed by selector).
//
// Locale resolution: persisted choice in localStorage wins; otherwise
// navigator.language. Switching reloads the page — every text node is set
// during the page's existing init paths, so there's no per-component
// re-render wiring to maintain.

export type Lang = "en" | "ja";

const STORAGE_KEY = "crosssection.lang";

function detect(): Lang {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "en" || stored === "ja") return stored;
  return navigator.language.startsWith("ja") ? "ja" : "en";
}

const current: Lang = detect();

export function t(s: { en: string; ja: string }): string {
  return s[current];
}

export function getLang(): Lang { return current; }

export function setLang(l: Lang): void {
  if (l === current) return;
  localStorage.setItem(STORAGE_KEY, l);
  location.reload();
}
