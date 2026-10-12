const KEY = 'ks-contrast';

/** Applies the saved contrast choice to the page (`data-contrast` on <html>). Safe without storage. */
export function applyContrast(doc: Document = document): void {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'high' || v === 'normal') doc.documentElement.dataset['contrast'] = v;
  } catch {
    // Storage blocked: the OS setting still applies through CSS.
  }
}

export function isHighContrast(doc: Document = document): boolean {
  return doc.documentElement.dataset['contrast'] === 'high';
}

export function setHighContrast(on: boolean, doc: Document = document): void {
  // Off is stored as 'normal', not removed, so it overrides an OS `prefers-contrast: more`.
  const v = on ? 'high' : 'normal';
  doc.documentElement.dataset['contrast'] = v;
  try {
    localStorage.setItem(KEY, v);
  } catch {
    // Not saved; it still applies to this page.
  }
}
