import type { TableScene, PreviewApplyError } from '../table/FixtureTableScene.js';
import { createSavedMapLoader, type LoadState } from './loader.js';

export function mountMapTable(
  doc: Document,
  createTable: (
    canvas: HTMLCanvasElement,
    onUnavailable: (error: PreviewApplyError) => void,
  ) => TableScene,
) {
  function element<T extends HTMLElement>(id: string): T {
    const found = doc.getElementById(id);
    if (!found) throw new Error(`Missing map table element ${id}`);
    return found as T;
  }
  const canvas = element<HTMLCanvasElement>('map-canvas');
  const input = element<HTMLInputElement>('saved-map');
  const status = element('load-status');
  const buttons = ['fit', 'top-down', 'oblique'].map((id) => element<HTMLButtonElement>(id));
  const cancel = element<HTMLButtonElement>('cancel');
  let table: TableScene;
  let loader: ReturnType<typeof createSavedMapLoader>;
  let observer: ResizeObserver | undefined;
  const listeners = new AbortController();
  let disposed = false;
  let suspended = false;
  let available = true;
  function dispose() {
    if (disposed) return;
    disposed = true;
    listeners.abort();
    observer?.disconnect();
    loader?.dispose();
    table?.dispose();
  }
  function show(state: LoadState) {
    available = state.available;
    const busy = ['reading', 'validating', 'preparing'].includes(state.phase);
    status.textContent = state.message;
    status.dataset.error = String(state.phase === 'failed');
    element('load-progress').hidden = !busy;
    cancel.disabled = !busy;
    buttons.forEach((button) => {
      button.disabled = !state.displayed || !state.available;
    });
    element('displayed-name').textContent = state.displayed?.name ?? 'No map displayed';
    element('displayed-extent').textContent = state.displayed
      ? `${state.displayed.widthM.toLocaleString()} × ${state.displayed.heightM.toLocaleString()} m · ${state.displayed.filename}`
      : '';
    element('identity-details').hidden = !state.displayed;
    element('displayed-identity').textContent = state.displayed?.sourceKey ?? '';
    element('empty-table').hidden = !!state.displayed;
    const retained = element('retained-display');
    retained.hidden = !state.displayed || (state.available && state.phase === 'ready');
    retained.textContent = state.available
      ? 'The previously displayed map remains on the table.'
      : 'Display unavailable. The last map identity above is historical; reload the page and load the saved JSON again.';
    if (!state.available && !state.displayed) {
      element('empty-table').hidden = false;
      element('empty-table').textContent =
        'Table display unavailable. Reload the page and try again.';
    }
  }
  try {
    table = createTable(canvas, (error) => {
      if (disposed) return;
      loader.unavailable(
        `Table rendering failed: ${error.message}. Reload the page to restore the display.`,
      );
    });
    loader = createSavedMapLoader(table);
    loader.subscribe(show);
    const resize = () => {
      if (disposed || suspended) return;
      try {
        table.resize();
      } catch (error) {
        table.stop();
        loader.unavailable(error instanceof Error ? error.message : 'Table resize failed');
      }
    };
    observer = new ResizeObserver(resize);
    observer.observe(canvas);
    doc.defaultView?.addEventListener('resize', resize, { signal: listeners.signal });
    input.addEventListener(
      'change',
      () => {
        const file = input.files?.[0];
        input.value = '';
        if (file && !disposed && !suspended) void loader.load(file);
      },
      { signal: listeners.signal },
    );
    cancel.addEventListener('click', () => loader.cancel(), { signal: listeners.signal });
    const actions = [
      () => table.fitPreview(),
      () => table.snapTopDown(),
      () => table.snapOblique(),
    ];
    buttons.forEach((button, index) =>
      button.addEventListener('click', actions[index]!, { signal: listeners.signal }),
    );
    canvas.addEventListener(
      'webglcontextlost',
      (event) => {
        event.preventDefault();
        table.stop();
        loader.unavailable('WebGL context was lost. Reload the page to restore the table.');
      },
      { signal: listeners.signal },
    );
    doc.defaultView?.addEventListener(
      'pagehide',
      (event) => {
        if (disposed) return;
        if (!event.persisted) {
          dispose();
          return;
        }
        suspended = true;
        table.stop();
        loader.cancel();
      },
      { signal: listeners.signal },
    );
    doc.defaultView?.addEventListener(
      'pageshow',
      (event) => {
        if (disposed || !event.persisted || !suspended) return;
        suspended = false;
        resize();
        if (!disposed && available) table.start();
      },
      { signal: listeners.signal },
    );
    table.start();
  } catch (error) {
    dispose();
    status.textContent = `Table unavailable: ${error instanceof Error ? error.message : 'initialization failed'}. Reload with WebGL enabled.`;
    status.dataset.error = 'true';
    input.disabled = true;
    element('load-progress').hidden = true;
    cancel.disabled = true;
    buttons.forEach((button) => {
      button.disabled = true;
    });
  }
  return { dispose };
}
