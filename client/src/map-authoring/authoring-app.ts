import type { MapAsset } from '@kriegsspiel/maps';
import { createAuthoringPanel, type AuthoringPanel, type PanelOptions } from './controls/index.js';
import type { ReadonlyData } from './generation/index.js';
import type { createAuthoringRuntime } from './runtime/index.js';
import { MapPreview, type PreviewState } from './preview.js';
import { DEFAULT_LAYERS, LAYER_NAMES, type Layer } from './renderer.js';
import { geometryBounds } from './geometry.js';

export function downloadFile(
  document: Document,
  filename: string,
  type: string,
  text: string,
): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
    URL.revokeObjectURL(url);
  }
}
export function mountAuthoringApp(
  document: Document,
  runtime: ReturnType<typeof createAuthoringRuntime>,
  options: Pick<
    PanelOptions,
    'initialParameters' | 'presets' | 'checkReplaySupport' | 'readFileText'
  >,
): { panel: AuthoringPanel; dispose(): void } {
  function element<T extends HTMLElement>(id: string): T {
    const value = document.getElementById(id);
    if (!value) throw new Error(`Missing authoring element: ${id}`);
    return value as T;
  }
  const status = element('asset-status'),
    summary = element('summary'),
    diagnostics = element('diagnostics');
  const position = element('position'),
    detail = element<HTMLButtonElement>('detail');
  const events = new AbortController();
  const signal = events.signal;
  let disposed = false;
  let displayed: ReadonlyData<MapAsset> | null = null;
  document.title = 'Map authoring · Kriegsspiel';
  document.querySelector('h1')!.textContent = 'Battlefield authoring';
  const note = document.querySelector<HTMLElement>('aside .note');
  if (note)
    note.textContent =
      'Public standalone map authoring in metres. Generate or load a saved map; only complete validated results can be exported. No game or LLM service is required.';
  status.textContent = 'No validated map · generate or load a saved asset';
  detail.textContent = 'Site detail';
  const select = document.createElement('select');
  select.setAttribute('aria-label', 'Site detail selection');
  select.className = 'site-selector';
  const blank = document.createElement('option');
  blank.value = '';
  blank.textContent = 'Select site…';
  select.append(blank);
  select.disabled = true;
  detail.disabled = true;
  for (const id of ['fit', 'zoom-in', 'zoom-out']) element<HTMLButtonElement>(id).disabled = true;
  const empty = document.createElement('section');
  empty.className = 'map-empty-state';
  empty.setAttribute('aria-label', 'Start a battlefield map');
  const outline = document.createElement('div');
  outline.className = 'empty-map-outline';
  outline.setAttribute('aria-hidden', 'true');
  outline.textContent = '⌁';
  const emptyHeading = document.createElement('h2');
  emptyHeading.textContent = 'No map generated yet';
  const emptyCopy = document.createElement('p');
  emptyCopy.textContent = 'Choose a preset and generate your battlefield, or load a saved map.';
  const emptyMessage = document.createElement('p');
  emptyMessage.className = 'empty-map-message';
  const emptyGenerate = document.createElement('button');
  emptyGenerate.type = 'button';
  emptyGenerate.textContent = 'Generate map';
  emptyGenerate.dataset.action = 'empty-generate';
  const emptyLoad = document.createElement('button');
  emptyLoad.type = 'button';
  emptyLoad.textContent = 'Load saved map';
  emptyLoad.dataset.action = 'empty-load';
  empty.append(outline, emptyHeading, emptyCopy, emptyGenerate, emptyLoad, emptyMessage);
  element('map').parentElement!.append(empty);
  detail.before(select);
  function updateSites(asset: ReadonlyData<MapAsset>): void {
    select.disabled = false;
    for (const id of ['fit', 'zoom-in', 'zoom-out'])
      element<HTMLButtonElement>(id).disabled = false;
    const previous = select.value;
    select.replaceChildren();
    const blank = document.createElement('option');
    blank.value = '';
    blank.textContent = 'Select site…';
    select.append(blank);
    for (const site of asset.layers.sites) {
      const option = document.createElement('option');
      option.value = site.id;
      option.textContent = `${site.name} (${site.kind})`;
      select.append(option);
    }
    select.value = asset.layers.sites.some((site) => site.id === previous) ? previous : '';
    detail.disabled = !select.value;
  }
  function updatePreview(state: PreviewState): void {
    if (state.view)
      position.textContent = `${state.view.scale.toFixed(3)} px/m · ${state.view.scale >= 0.15 ? 'detail labels' : 'overview labels'} · x east / y south`;
    if (!state.issues.length) return;
    diagnostics.replaceChildren();
    for (const issue of state.issues) {
      const line = document.createElement('li');
      line.dataset.severity = 'error';
      line.textContent = `${issue.code} · ${issue.path}: ${issue.message}`;
      diagnostics.append(line);
    }
  }
  const preview = new MapPreview(element<HTMLCanvasElement>('map'), updatePreview);
  const layerControls = element('layers');
  layerControls.replaceChildren();
  for (const layer of Object.keys(LAYER_NAMES) as Layer[]) {
    const label = document.createElement('label'),
      input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = DEFAULT_LAYERS[layer];
    input.addEventListener('change', () => preview.setLayer(layer, input.checked), { signal });
    label.append(input, document.createTextNode(LAYER_NAMES[layer]));
    layerControls.append(label);
  }
  element('fit').addEventListener('click', () => preview.fit(), { signal });
  element('zoom-in').addEventListener('click', () => preview.zoom(1.5), { signal });
  element('zoom-out').addEventListener('click', () => preview.zoom(1 / 1.5), { signal });
  element<HTMLInputElement>('contrast').addEventListener(
    'change',
    (event) => preview.setHighContrast((event.target as HTMLInputElement).checked),
    { signal },
  );
  select.addEventListener(
    'change',
    () => {
      detail.disabled = !select.value;
    },
    { signal },
  );
  detail.addEventListener(
    'click',
    () => {
      if (!preview.fitSite(select.value)) {
        select.value = '';
        detail.disabled = true;
      }
    },
    { signal },
  );
  const svgButton = document.createElement('button');
  svgButton.type = 'button';
  svgButton.textContent = 'Export SVG';
  svgButton.disabled = true;
  function currentFiles() {
    const asset = runtime.controller.exportAsset,
      files = runtime.exportFiles;
    if (!asset || !files || !panel.canExport()) return null;
    try {
      const recipe = panel.getParameters();
      return recipe.seed === asset.provenance.seed &&
        JSON.stringify(recipe.settings) === JSON.stringify(asset.settings) &&
        JSON.stringify(recipe.overrides) === JSON.stringify(asset.overrides)
        ? files
        : null;
    } catch {
      return null;
    }
  }
  const panel = createAuthoringPanel(document, runtime.controller, {
    ...options,
    onStatusChange: (message, canGenerate) => {
      emptyGenerate.disabled = !canGenerate;
      emptyMessage.textContent = message;
    },
    onDraftChange: () => {
      svgButton.disabled = !currentFiles();
    },
    onValidatedAsset: (asset) => {
      const loaded = preview.loadAsset(asset);
      if (!loaded.ok) throw new Error('Complete validated asset failed preview contract parsing');
      displayed = asset;
      empty.hidden = true;
      updateSites(asset);
      summary.replaceChildren();
      diagnostics.replaceChildren();
      for (const text of [
        asset.name,
        `${asset.bounds.maxX} × ${asset.bounds.maxY} m`,
        `${asset.layers.sites.length} sites · ${asset.layers.buildings.length} buildings · ${asset.layers.contours.length} contours`,
        `Generator: ${asset.provenance.generator.version}`,
      ]) {
        const p = document.createElement('p');
        p.textContent = text;
        summary.append(p);
      }
      for (const diagnostic of asset.diagnostics) {
        const line = document.createElement('li');
        line.dataset.severity = diagnostic.severity;
        line.textContent = `${diagnostic.stage} / ${diagnostic.code}: ${diagnostic.message}${diagnostic.featureId ? ` [${diagnostic.featureId}]` : ''}${diagnostic.remediation ? ` ${diagnostic.remediation}` : ''}`;
        diagnostics.append(line);
      }
    },
    onFocusOverride: (override) => {
      if (override.kind === 'exclude-sites')
        preview.fit(geometryBounds(override.polygon.outer, 15));
      else if (preview.fitSite(override.siteId)) {
        select.value = override.siteId;
        detail.disabled = false;
      }
    },
    currentCertifiedJson: () => currentFiles()?.json ?? null,
    onExport: (file) => {
      const files = currentFiles();
      if (!files || files.json !== file.text)
        throw new Error('Current worker-certified JSON export unavailable or inconsistent');
      downloadFile(document, file.filename, file.mimeType, files.json);
    },
  });
  emptyGenerate.addEventListener(
    'click',
    () => {
      panel.generate();
    },
    { signal },
  );
  emptyLoad.addEventListener('click', () => panel.openSavedFile(), { signal });
  panel.element.append(svgButton);
  element('summary').parentElement!.before(panel.element);
  svgButton.addEventListener(
    'click',
    () => {
      const files = currentFiles();
      if (!files) {
        svgButton.disabled = true;
        return;
      }
      downloadFile(
        document,
        `battlefield-${runtime.controller.exportAsset!.provenance.seed}.svg`,
        'image/svg+xml',
        files.svg,
      );
    },
    { signal },
  );
  // Invalid drafts do not invoke onDraftChange; keep presentation disabled as well as action guards.
  panel.element.addEventListener(
    'input',
    () => {
      svgButton.disabled = !currentFiles();
    },
    { signal },
  );
  function updateStatus(): void {
    const state = runtime.controller.state;
    status.dataset.error = String(state.status === 'failed');
    status.textContent =
      state.status === 'ready'
        ? `Complete validated map · ${state.source === 'saved' ? 'saved' : 'generated'}`
        : state.status === 'idle'
          ? 'No validated map · generate or load a saved asset'
          : `${state.status}${displayed ? ' · last validated map retained' : ''}`;
    svgButton.disabled = !currentFiles();
  }
  const unsubscribe = runtime.controller.subscribe(updateStatus);
  updateStatus();
  function dispose(): void {
    if (disposed) return;
    disposed = true;
    events.abort();
    unsubscribe();
    panel.dispose();
    preview.dispose();
    runtime.dispose();
    select.remove();
    empty.remove();
  }
  document.defaultView?.addEventListener(
    'pagehide',
    (event) => {
      if (!event.persisted) dispose();
    },
    { signal },
  );
  return { panel, dispose };
}
