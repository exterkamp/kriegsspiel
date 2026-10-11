// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { mount, tick, unmount } from 'svelte';
import TableHarness from './TableHarness.svelte';

it('renders native caption and column/row headers with a focusable labelled region and action', async () => {
  const target = document.createElement('div');
  document.body.append(target);
  const onAction = vi.fn();
  const component = mount(TableHarness, { target, props: { onAction } });
  try {
    await tick();
    const region = target.querySelector<HTMLElement>('[role="region"]')!;
    expect(region.getAttribute('aria-label')).toBe('Harness formations; scroll for actions');
    region.focus();
    expect(document.activeElement).toBe(region);
    const table = region.querySelector('table')!;
    expect(table.querySelector('caption')?.textContent).toBe('Supplied formation summary');
    expect(table.querySelectorAll('thead th[scope="col"]')).toHaveLength(3);
    expect(table.querySelector('tbody th[scope="row"]')?.textContent).toBe('First formation');
    const action = table.querySelector('button')!;
    action.focus();
    expect(document.activeElement).toBe(action);
    action.click();
    expect(onAction).toHaveBeenCalledOnce();
  } finally {
    await unmount(component);
    target.remove();
  }
});
