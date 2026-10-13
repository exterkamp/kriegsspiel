import { afterEach, describe, expect, it } from 'vitest';
import { trapTab } from './focus';

function tab(container: HTMLElement, shiftKey = false): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { key: 'Tab', shiftKey, cancelable: true });
  trapTab(e, container);
  return e;
}

function mount(html: string): HTMLElement {
  const el = document.createElement('div');
  el.innerHTML = html;
  document.body.append(el);
  return el;
}

describe('trapTab', () => {
  afterEach(() => (document.body.innerHTML = ''));

  it('wraps forwards from the last control and backwards from the first', () => {
    const el = mount('<button id="a">A</button><input id="b" />');
    el.querySelector<HTMLElement>('#b')!.focus();
    expect(tab(el).defaultPrevented).toBe(true);
    expect(document.activeElement?.id).toBe('a');
    expect(tab(el, true).defaultPrevented).toBe(true);
    expect(document.activeElement?.id).toBe('b');
  });

  it('skips disabled controls and tabindex -1, and counts tabindex elements', () => {
    const el = mount(
      '<div id="a" tabindex="0"></div><input id="x" disabled /><div id="y" tabindex="-1"></div><textarea id="b"></textarea><input id="z" disabled />',
    );
    el.querySelector<HTMLElement>('#b')!.focus();
    tab(el);
    expect(document.activeElement?.id).toBe('a');
  });

  it('leaves Tab alone mid-dialog, for other keys, and with nothing focusable', () => {
    const el = mount('<button id="a">A</button><button id="b">B</button>');
    el.querySelector<HTMLElement>('#a')!.focus();
    expect(tab(el).defaultPrevented).toBe(false);
    const k = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
    trapTab(k, el);
    expect(k.defaultPrevented).toBe(false);
    expect(tab(mount('<p>none</p>')).defaultPrevented).toBe(false);
  });
});
