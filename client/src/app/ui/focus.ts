const FOCUSABLE = 'button:not([disabled]), input, select, textarea, a[href]';

/** Keeps Tab and Shift+Tab inside `container` (a modal dialog): wraps from the last control to the first and back. */
export function trapTab(e: KeyboardEvent, container: HTMLElement): void {
  if (e.key !== 'Tab') return;
  const items = [...container.querySelectorAll<HTMLElement>(FOCUSABLE)];
  const first = items[0];
  const last = items[items.length - 1];
  if (!first || !last) return;
  const at = document.activeElement;
  if (e.shiftKey && at === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && at === last) {
    e.preventDefault();
    first.focus();
  }
}
