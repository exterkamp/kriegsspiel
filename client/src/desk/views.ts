/** The views the player moves between. `table` is the Three.js map table; the rest are desk objects. */
export const VIEWS = [
  { id: 'table', label: 'Map table', key: 't' },
  { id: 'inTray', label: 'In-tray', key: 'i' },
  { id: 'orders', label: 'Orders desk', key: 'o' },
  { id: 'roster', label: 'Order of battle', key: 'r' },
  { id: 'journal', label: 'Journal', key: 'j' },
  { id: 'conference', label: 'Staff conference', key: 'c' },
] as const;

export type ViewId = (typeof VIEWS)[number]['id'];

export const isDeskView = (v: ViewId): boolean => v !== 'table';

/** The view a key press asks for, or undefined. Escape returns to the table. */
export function viewForKey(e: {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}): ViewId | undefined {
  if (e.ctrlKey || e.metaKey || e.altKey) return undefined;
  if (e.key === 'Escape') return 'table';
  const k = e.key.toLowerCase();
  return VIEWS.find((v) => v.key === k)?.id;
}

/** True when the key event came from somewhere the player is typing, so shortcuts must not fire. */
export function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable === true;
}
