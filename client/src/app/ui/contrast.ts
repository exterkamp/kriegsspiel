const KEY = 'ks-contrast';

/** Applies the saved contrast choice to the page (`data-contrast` on <html>). Safe without storage. */
export function applyContrast(doc: Document = document): void {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'high') doc.documentElement.dataset['contrast'] = 'high';
  } catch {
    // Storage blocked: the OS setting still applies through CSS.
  }
}

export function isHighContrast(doc: Document = document): boolean {
  return doc.documentElement.dataset['contrast'] === 'high';
}

export function setHighContrast(on: boolean, doc: Document = document): void {
  if (on) doc.documentElement.dataset['contrast'] = 'high';
  else delete doc.documentElement.dataset['contrast'];
  try {
    if (on) localStorage.setItem(KEY, 'high');
    else localStorage.removeItem(KEY);
  } catch {
    // Not saved; it still applies to this page.
  }
}
