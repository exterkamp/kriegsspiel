// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { mount, tick, unmount } from 'svelte';
import axe from 'axe-core';
import App from '../App.svelte';
import { artwork, makePorts } from '../shell/fakes';

let component: ReturnType<typeof mount> | null = null;
let target: HTMLDivElement;
const flush = async () => {
  for (let i = 0; i < 15; i++) {
    await Promise.resolve();
    await tick();
  }
};
afterEach(async () => {
  if (component) await unmount(component);
  component = null;
  target?.remove();
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

it('checks every fixture desk route with axe in CI; layout and colour contrast require browser review', async () => {
  document.documentElement.lang = 'en';
  document.title = 'Kriegsspiel';
  window.localStorage.clear();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  const ports = makePorts();
  Object.assign(ports.snapshot, {
    papers: [
      {
        id: 'accessible-paper',
        from: 'Scout',
        category: 'scouts',
        writtenAtGame: 0,
        receivedAtGame: 0,
        observedAtGame: null,
        location: { x: 350, y: 250 },
        unitId: null,
        sizeEstimate: null,
        confidence: null,
        text: 'An enemy column was reported near the bridge.',
      },
    ],
  });
  target = document.body.appendChild(document.createElement('div'));
  component = mount(App, { target, props: { ...ports, artwork } });
  await flush();
  for (const label of [
    'Map table',
    'In-tray',
    'Orders',
    'Roster',
    'Journal',
    'Conference',
    'Terrain studies',
    'Replay',
  ]) {
    Array.from(target.querySelectorAll<HTMLButtonElement>('nav.desk button'))
      .find((button) => button.textContent?.includes(label))!
      .click();
    await flush();
    expect(target.querySelector('h2[data-heading]')?.textContent?.trim(), label).toBe(label);
    if (label === 'In-tray') {
      Array.from(target.querySelectorAll('button'))
        .find((button) => button.textContent?.includes('Open accessible-paper'))!
        .click();
      await flush();
    }
    // axe documents colour-contrast as unsupported in jsdom. No layout/visual claim.
    const result = await axe.run(document, { rules: { 'color-contrast': { enabled: false } } });
    expect(
      result.violations.map((item) => ({
        id: item.id,
        impact: item.impact,
        nodes: item.nodes.map((node) => node.target),
      })),
      label,
    ).toEqual([]);
    expect(target.querySelectorAll('h1'), label).toHaveLength(1);
    const levels = Array.from(target.querySelectorAll('h1,h2,h3,h4,h5,h6')).map((heading) =>
      Number(heading.tagName.slice(1)),
    );
    for (let i = 1; i < levels.length; i++)
      expect(levels[i]!, label).toBeLessThanOrEqual(levels[i - 1]! + 1);
  }
  Array.from(target.querySelectorAll<HTMLButtonElement>('nav.desk button'))
    .find((button) => button.textContent?.includes('In-tray'))!
    .click();
  await flush();
  Array.from(target.querySelectorAll('button'))
    .find((button) => button.textContent?.includes('Open accessible-paper'))!
    .click();
  await flush();
  Array.from(target.querySelectorAll('button'))
    .find((button) => button.textContent === 'Choose report coordinates')!
    .click();
  await flush();
  expect(target.querySelector('h2[data-heading]')?.textContent?.trim()).toBe('Map table');
  const panel = target.querySelector('[aria-label="Report placement"]')!;
  expect(panel).not.toBeNull();
  expect(
    (await axe.run(document, { rules: { 'color-contrast': { enabled: false } } })).violations,
  ).toEqual([]);
  panel
    .querySelector('form')!
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await flush();
  expect(panel.textContent).toContain('Created locally; unsaved.');
  expect(
    (await axe.run(document, { rules: { 'color-contrast': { enabled: false } } })).violations,
  ).toEqual([]);
});
