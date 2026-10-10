import { createReferenceAsset } from '@kriegsspiel/maps';
import { geometryBounds } from './geometry.js';
import { MapPreview, type PreviewState } from './preview.js';
import { DEFAULT_LAYERS, LAYER_NAMES, type Layer } from './renderer.js';
import './style.css';

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing preview element: ${id}`);
  return found as T;
}
const diagnostics = element('diagnostics');
const summary = element('summary');
const status = element('asset-status');
const position = element('position');
const detail = element<HTMLButtonElement>('detail');
let state: PreviewState;
function update(next: PreviewState): void {
  const assetChanged = state?.asset !== next.asset || state?.issues !== next.issues;
  state = next;
  if (next.view)
    position.textContent = `${next.view.scale.toFixed(3)} px/m · ${next.view.scale >= 0.15 ? 'detail labels' : 'overview labels'} · x east / y south`;
  if (!assetChanged) return;
  const asset = next.asset;
  status.textContent = next.issues.length
    ? 'Candidate rejected · last valid map retained'
    : next.source === 'reference-fixture'
      ? 'Reference fixture · not generated'
      : 'Loaded asset · contract validation only';
  status.dataset.error = String(next.issues.length > 0);
  detail.disabled = !asset?.layers.sites.length;
  summary.replaceChildren();
  diagnostics.replaceChildren();
  if (asset) {
    for (const text of [
      asset.name,
      `${asset.bounds.maxX - asset.bounds.minX} × ${asset.bounds.maxY - asset.bounds.minY} m`,
      `${asset.layers.sites.length} sites · ${asset.layers.buildings.length} buildings · ${asset.layers.contours.length} contours`,
      `${asset.elevation.columns} × ${asset.elevation.rows} height samples · ${asset.elevation.spacingM} m spacing`,
      `Generator: ${asset.provenance.generator.version}`,
    ]) {
      const line = document.createElement('p');
      line.textContent = text;
      summary.append(line);
    }
    for (const d of asset.diagnostics) {
      const line = document.createElement('li');
      line.dataset.severity = d.severity;
      line.textContent = `${d.severity.toUpperCase()} · ${d.stage} / ${d.code}: ${d.message}${d.featureId ? ` [${d.featureId}]` : ''}${d.location ? ` at (${d.location.join(', ')}) m` : ''}${d.constraint ? ` Constraint: ${d.constraint}.` : ''}${d.path ? ` Path: ${d.path}.` : ''}${d.remediation ? ` ${d.remediation}` : ''}`;
      diagnostics.append(line);
    }
  }
  for (const issue of next.issues) {
    const line = document.createElement('li');
    line.dataset.severity = 'error';
    line.textContent = `${issue.code} · ${issue.path}: ${issue.message}`;
    diagnostics.append(line);
  }
  if (!diagnostics.childElementCount) {
    const line = document.createElement('li');
    line.textContent = 'No contract diagnostics. Composition certification is not checked here.';
    diagnostics.append(line);
  }
}
const preview = new MapPreview(element<HTMLCanvasElement>('map'), update);
const layerControls = element('layers');
for (const layer of Object.keys(LAYER_NAMES) as Layer[]) {
  const label = document.createElement('label');
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = DEFAULT_LAYERS[layer];
  input.addEventListener('change', () => preview.setLayer(layer, input.checked));
  label.append(input, document.createTextNode(LAYER_NAMES[layer]));
  layerControls.append(label);
}
element('fit').addEventListener('click', () => preview.fit());
element('zoom-in').addEventListener('click', () => preview.zoom(1.5));
element('zoom-out').addEventListener('click', () => preview.zoom(1 / 1.5));
element<HTMLInputElement>('contrast').addEventListener('change', (event) =>
  preview.setHighContrast((event.target as HTMLInputElement).checked),
);
detail.addEventListener('click', () => {
  const site = state?.asset?.layers.sites[0];
  if (!site) return;
  preview.fit(geometryBounds(site.placementArea.outer, 15));
});
try {
  preview.loadAsset(createReferenceAsset(), 'reference-fixture');
} catch (error) {
  status.textContent = error instanceof Error ? error.message : 'Preview initialization failed';
  status.dataset.error = 'true';
}
