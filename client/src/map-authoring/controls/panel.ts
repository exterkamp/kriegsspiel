import {
  canonicalizeAsset,
  HARD_LIMITS,
  utf8Bytes,
  type MapAsset,
  type MapOverride,
  type MapSettings,
} from '@kriegsspiel/maps';
import {
  errorMessage,
  freezeData,
  parseReplayParameters,
  type GenerationController,
  type ReadonlyData,
  type ReplayParameters,
} from '../generation/index.js';
import { defaultParameters, editOverrides, type OverrideEdit } from './recipe.js';

export interface AuthoringPreset {
  id: string;
  label: string;
  settings: MapSettings;
}
export interface JsonExport {
  filename: string;
  mimeType: 'application/json';
  text: string;
}
export type ReplaySupport = { supported: true } | { supported: false; reason: string };
export interface PanelOptions {
  initialParameters?: ReplayParameters;
  presets?: AuthoringPreset[];
  /** Must verify recorded generator/stage/fork versions before regenerating a loaded recipe. */
  checkReplaySupport?: (
    provenance: ReadonlyData<MapAsset['provenance']>,
    recipe: ReadonlyData<ReplayParameters>,
  ) => ReplaySupport;
  onDraftChange?: (recipe: ReadonlyData<ReplayParameters>) => void;
  onValidatedAsset?: (asset: ReadonlyData<MapAsset>) => void;
  onFocusOverride?: (override: ReadonlyData<MapOverride>, index: number) => void;
  onExport?: (file: JsonExport) => void | Promise<void>;
  readFileText?: (file: File, signal: AbortSignal) => Promise<string>;
}
export interface AuthoringPanel {
  element: HTMLElement;
  getParameters(): ReplayParameters;
  setParameters(input: ReplayParameters): void;
  applyOverride(edit: OverrideEdit): void;
  generate(): number | null;
  cancel(): void;
  loadText(text: string): number;
  loadFile(file: File): Promise<number | null>;
  exportJson(): JsonExport | null;
  dispose(): void;
}
interface Field {
  path: string[];
  input: HTMLInputElement;
  kind: 'number' | 'boolean' | 'string';
}
const labels: Record<string, string> = {
  widthM: 'Width (m)',
  heightM: 'Height (m)',
  sampleSpacingM: 'Elevation sample spacing (m)',
  roughness: 'Roughness (0–1)',
  woodFraction: 'Wood fraction (0–1)',
  fieldFraction: 'Field fraction (0–1)',
  riverThresholdSamples: 'River selection threshold (upstream samples)',
  terrain: 'Relief and roughness',
  hydrology: 'Water',
  cover: 'Cover',
  settlements: 'Villages, farms and population',
  roads: 'Road constraints and work limits',
  limits: 'Resource limits',
  contours: 'Contours and work limits',
  geometry: 'Geometry policy',
};
function title(key: string): string {
  return (
    labels[key] ??
    key.replace(/([a-z])([A-Z0-9])/g, '$1 $2').replace(/^./, (letter) => letter.toUpperCase())
  );
}
function getAt(value: unknown, path: string[]): unknown {
  for (const key of path) value = (value as Record<string, unknown>)[key];
  return value;
}
function setAt(value: unknown, path: string[], next: unknown): void {
  for (const key of path.slice(0, -1)) value = (value as Record<string, unknown>)[key];
  (value as Record<string, unknown>)[path.at(-1)!] = next;
}
function finiteInput(input: HTMLInputElement): number {
  if (!input.value.trim() || !Number.isFinite(Number(input.value)))
    throw new TypeError(`${input.name || 'Number'} must be finite and nonempty`);
  return Number(input.value);
}

/** Detached DOM module: mounting and controller lifetime belong to the integration owner. */
export function createAuthoringPanel(
  document: Document,
  controller: GenerationController,
  options: PanelOptions = {},
): AuthoringPanel {
  const retained = controller.state.lastValidatedAsset;
  let baseline = parseReplayParameters(
    options.initialParameters ??
      (retained
        ? {
            seed: retained.provenance.seed,
            settings: structuredClone(retained.settings),
            overrides: structuredClone(retained.overrides),
          }
        : defaultParameters()),
  );
  const presets = (
    options.presets ?? [
      { id: 'default', label: 'Default settings', settings: defaultParameters().settings },
    ]
  ).map((preset) => {
    if (!/^[a-z][a-z0-9_-]{0,63}$/.test(preset.id) || !preset.label || preset.label.length > 128)
      throw new TypeError('Invalid preset ID/label');
    return {
      ...preset,
      settings: parseReplayParameters({ ...defaultParameters(), settings: preset.settings })
        .settings,
    };
  });
  if (new Set(presets.map((preset) => preset.id)).size !== presets.length || presets.length > 32)
    throw new RangeError('Preset IDs must be unique; at most 32 presets');
  const element = document.createElement('section');
  element.className = 'map-authoring-controls';
  element.setAttribute('aria-label', 'Map authoring controls');
  const heading = document.createElement('h2');
  heading.textContent = 'Map authoring';
  element.append(heading);
  const note = document.createElement('p');
  note.textContent = 'Generation and complete validation are supplied by the integration adapter.';
  element.append(note);
  const form = document.createElement('form');
  form.noValidate = true;
  element.append(form);
  const labelInput = (parent: HTMLElement, text: string, input: HTMLElement) => {
    const label = document.createElement('label');
    const span = document.createElement('span');
    span.textContent = text;
    label.append(span, input);
    parent.append(label);
  };
  const seed = document.createElement('input');
  seed.type = 'number';
  seed.name = 'seed';
  seed.step = '1';
  seed.min = '0';
  seed.max = String(Number.MAX_SAFE_INTEGER);
  labelInput(form, 'Seed', seed);
  const presetSelect = document.createElement('select');
  presetSelect.name = 'preset';
  for (const preset of [{ id: '', label: 'Custom / recorded settings' }, ...presets]) {
    const option = document.createElement('option');
    option.value = preset.id;
    option.textContent = preset.label;
    presetSelect.append(option);
  }
  labelInput(form, 'Preset (explicitly replaces settings)', presetSelect);
  const fields: Field[] = [];
  function settingFields(
    parent: HTMLElement,
    value: Record<string, unknown>,
    path: string[] = [],
  ): void {
    for (const [key, child] of Object.entries(value)) {
      const nextPath = [...path, key];
      if (child !== null && typeof child === 'object') {
        const group = document.createElement('details');
        const summary = document.createElement('summary');
        summary.textContent = title(key);
        group.append(summary);
        parent.append(group);
        group.open = ['terrain', 'hydrology', 'cover', 'settlements'].includes(key);
        settingFields(group, child as Record<string, unknown>, nextPath);
      } else {
        const input = document.createElement('input');
        input.name = nextPath.join('.');
        input.dataset.setting = input.name;
        const kind = typeof child as Field['kind'];
        input.type = kind === 'boolean' ? 'checkbox' : kind === 'number' ? 'number' : 'text';
        if (kind === 'number') input.step = 'any';
        if (kind === 'string') input.readOnly = true;
        fields.push({ path: nextPath, input, kind });
        labelInput(parent, title(key), input);
      }
    }
  }
  settingFields(form, baseline.settings);
  const overrideGroup = document.createElement('fieldset');
  const legend = document.createElement('legend');
  legend.textContent = 'Ordered overrides';
  overrideGroup.append(legend);
  element.append(overrideGroup);
  const siteId = document.createElement('input');
  siteId.name = 'siteId';
  siteId.maxLength = 96;
  labelInput(overrideGroup, 'Stable site ID', siteId);
  const name = document.createElement('input');
  name.name = 'placeName';
  name.maxLength = 128;
  labelInput(overrideGroup, 'Place name', name);
  const x = document.createElement('input');
  x.type = 'number';
  x.step = 'any';
  x.name = 'anchorX';
  labelInput(overrideGroup, 'Anchor x east (m)', x);
  const y = document.createElement('input');
  y.type = 'number';
  y.step = 'any';
  y.name = 'anchorY';
  labelInput(overrideGroup, 'Anchor y south (m)', y);
  const exclusionId = document.createElement('input');
  exclusionId.name = 'exclusionId';
  exclusionId.maxLength = 96;
  labelInput(overrideGroup, 'Exclusion ID', exclusionId);
  const polygon = document.createElement('textarea');
  polygon.name = 'exclusionPolygon';
  labelInput(overrideGroup, 'Exclusion polygon JSON (outer and holes, local metres)', polygon);
  const overrideList = document.createElement('ol');
  overrideList.dataset.role = 'overrides';
  overrideGroup.append(overrideList);
  function button(
    parent: HTMLElement,
    text: string,
    action: string,
    listener: () => void,
  ): HTMLButtonElement {
    const result = document.createElement('button');
    result.type = 'button';
    result.textContent = text;
    result.dataset.action = action;
    result.addEventListener('click', () => {
      if (!disposed) listener();
    });
    parent.append(result);
    return result;
  }
  let disposed = false;
  let revision = 0;
  let readToken = 0;
  let readAbort: AbortController | null = null;
  let reading = false;
  let fileReadFailed = false;
  let submitted: { id: number; revision: number } | null = null;
  let seenReadyId: number | null = null;
  let seenAsset: ReadonlyData<MapAsset> | null = null;
  let recorded: ReadonlyData<MapAsset['provenance']> | null = retained?.provenance ?? null;
  let replayRequired = !!retained;
  let problem: { kind: 'input' | 'file' | 'programming'; message: string } | null = null;
  const status = document.createElement('p');
  status.dataset.role = 'status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const progress = document.createElement('progress');
  progress.max = 1;
  progress.setAttribute('aria-label', 'Generation progress');
  const diagnosticList = document.createElement('ul');
  diagnosticList.dataset.role = 'diagnostics';
  const provenance = document.createElement('pre');
  provenance.dataset.role = 'provenance';
  function invalidateRead(): void {
    readToken++;
    readAbort?.abort();
    readAbort = null;
    reading = false;
  }
  function live(): void {
    if (disposed) throw new Error('Authoring panel is disposed');
  }
  function fail(kind: 'input' | 'file' | 'programming', error: unknown): void {
    problem = { kind, message: errorMessage(error) };
    render();
  }
  function getParameters(): ReplayParameters {
    live();
    const parameters = structuredClone(baseline);
    parameters.seed = finiteInput(seed);
    for (const field of fields)
      setAt(
        parameters.settings,
        field.path,
        field.kind === 'boolean'
          ? field.input.checked
          : field.kind === 'number'
            ? finiteInput(field.input)
            : field.input.value,
      );
    return parseReplayParameters(parameters);
  }
  function writeFields(): void {
    seed.value = String(baseline.seed);
    for (const field of fields) {
      const value = getAt(baseline.settings, field.path);
      if (field.kind === 'boolean') field.input.checked = value as boolean;
      else field.input.value = String(value);
    }
    presetSelect.value = '';
    renderOverrides();
  }
  function synchronizeReadyRecipe(): void {
    const state = controller.state;
    const asset = state.lastValidatedAsset;
    // Saved provenance is an action-time policy, not a subscriber side effect.
    if (asset && state.source === 'saved') replayRequired = true;
    if (asset && (state.status === 'ready' || !recorded)) recorded = asset.provenance;
    if (state.status !== 'ready' || !asset || state.requestId === seenReadyId) return;
    seenReadyId = state.requestId;
    // An older validation may finish during a newer file read. Do not adopt its
    // fields or invalidate that read; only the new saved request may replace them.
    if (
      !reading &&
      !fileReadFailed &&
      (!submitted || submitted.id !== state.requestId || submitted.revision === revision)
    ) {
      baseline = parseReplayParameters({
        seed: asset.provenance.seed,
        settings: structuredClone(asset.settings),
        overrides: structuredClone(asset.overrides),
      });
      writeFields();
    }
  }
  function support(parameters: ReplayParameters): ReplaySupport {
    synchronizeReadyRecipe();
    if (!replayRequired || !recorded) return { supported: true };
    if (!options.checkReplaySupport)
      return {
        supported: false,
        reason: 'Loaded recipe requires a generator-version adapter before regeneration.',
      };
    const result = options.checkReplaySupport(recorded, freezeData(parameters));
    if (result?.supported === true) return { supported: true };
    if (
      result?.supported === false &&
      typeof result.reason === 'string' &&
      result.reason.length > 0 &&
      result.reason.length <= 512
    )
      return result;
    throw new TypeError('Invalid replay-support callback result');
  }
  function sameRecipe(asset: ReadonlyData<MapAsset>, parameters: ReplayParameters): boolean {
    return (
      asset.provenance.seed === parameters.seed &&
      JSON.stringify(asset.settings) === JSON.stringify(parameters.settings) &&
      JSON.stringify(asset.overrides) === JSON.stringify(parameters.overrides)
    );
  }
  function exportable(): ReadonlyData<MapAsset> | null {
    const asset = controller.exportAsset;
    if (!asset || reading || fileReadFailed) return null;
    try {
      return sameRecipe(asset, getParameters()) ? asset : null;
    } catch {
      return null;
    }
  }
  function changed(): void {
    revision++;
    invalidateRead();
    problem = null;
    presetSelect.value = '';
    let parameters: ReplayParameters;
    try {
      parameters = getParameters();
    } catch (error) {
      problem = { kind: 'input', message: errorMessage(error) };
      render();
      return;
    }
    try {
      options.onDraftChange?.(freezeData(parameters));
    } catch (error) {
      problem = { kind: 'programming', message: errorMessage(error) };
    }
    render();
  }
  function setParameters(input: ReplayParameters): void {
    live();
    baseline = parseReplayParameters(input);
    writeFields();
    changed();
  }
  function applyOverride(edit: OverrideEdit): void {
    live();
    baseline = editOverrides(getParameters(), edit);
    writeFields();
    changed();
  }
  function attemptOverride(override: () => MapOverride): void {
    try {
      applyOverride({ type: 'append', override: override() });
    } catch (error) {
      fail('input', error);
    }
  }
  button(overrideGroup, 'Append rename', 'rename', () =>
    attemptOverride(() => ({ kind: 'rename', siteId: siteId.value, name: name.value })),
  );
  button(overrideGroup, 'Append move', 'move', () =>
    attemptOverride(() => ({
      kind: 'move-site',
      siteId: siteId.value,
      anchor: [finiteInput(x), finiteInput(y)],
    })),
  );
  button(overrideGroup, 'Append exclusion', 'exclude', () =>
    attemptOverride(() => {
      if (
        polygon.value.length > HARD_LIMITS.maxBytes ||
        utf8Bytes(polygon.value) > HARD_LIMITS.maxBytes
      )
        throw new RangeError('Exclusion JSON exceeds byte cap');
      return { kind: 'exclude-sites', id: exclusionId.value, polygon: JSON.parse(polygon.value) };
    }),
  );
  function renderOverrides(): void {
    overrideList.replaceChildren();
    baseline.overrides.forEach((override, index) => {
      const row = document.createElement('li');
      const text = document.createElement('span');
      text.textContent = `${index + 1}. ${override.kind}: ${override.kind === 'exclude-sites' ? override.id : override.siteId}${override.kind === 'rename' ? ` → ${override.name}` : override.kind === 'move-site' ? ` → (${override.anchor.join(', ')}) m` : ''}`;
      row.append(text);
      for (const [label, edit, disabled] of [
        ['Earlier', { type: 'reorder', from: index, to: index - 1 }, index === 0],
        [
          'Later',
          { type: 'reorder', from: index, to: index + 1 },
          index === baseline.overrides.length - 1,
        ],
        ['Remove', { type: 'remove', index }, false],
      ] as const)
        button(row, label, label.toLowerCase(), () => {
          try {
            applyOverride(edit);
          } catch (error) {
            fail('input', error);
          }
        }).disabled = disabled;
      if (options.onFocusOverride)
        button(row, 'Show on map', 'focus', () => {
          try {
            options.onFocusOverride!(freezeData(structuredClone(override)), index);
          } catch (error) {
            fail('programming', error);
          }
        });
      overrideList.append(row);
    });
  }
  function generate(): number | null {
    live();
    synchronizeReadyRecipe();
    let parameters: ReplayParameters;
    try {
      parameters = getParameters();
    } catch (error) {
      fail('input', error);
      return null;
    }
    try {
      const compatibility = support(parameters);
      if (!compatibility.supported) {
        problem = { kind: 'input', message: compatibility.reason };
        render();
        return null;
      }
      invalidateRead();
      fileReadFailed = false;
      problem = null;
      const id = controller.generate(parameters);
      submitted = { id, revision };
      render();
      return id;
    } catch (error) {
      fail('programming', error);
      return null;
    }
  }
  function cancel(): void {
    live();
    invalidateRead();
    problem = null;
    fileReadFailed = false;
    controller.cancel();
    render();
  }
  function loadText(text: string): number {
    live();
    replayRequired = true;
    invalidateRead();
    fileReadFailed = false;
    problem = null;
    const id = controller.loadSavedAsset(text);
    submitted = { id, revision };
    render();
    return id;
  }
  function browserRead(file: File, signal: AbortSignal): Promise<string> {
    return new Promise((resolve, reject) => {
      const Reader = document.defaultView?.FileReader;
      if (!Reader) {
        reject(new Error('FileReader unavailable'));
        return;
      }
      const reader = new Reader();
      const cleanup = () => signal.removeEventListener('abort', abort);
      const failed = (error: unknown) => {
        cleanup();
        reject(error);
      };
      const abort = () => {
        reader.abort();
        failed(new Error('Saved file read cancelled'));
      };
      reader.onerror = () => failed(reader.error ?? new Error('Saved file read failed'));
      reader.onabort = () => failed(new Error('Saved file read cancelled'));
      reader.onload = () => {
        cleanup();
        if (typeof reader.result === 'string') resolve(reader.result);
        else reject(new TypeError('Saved file reader did not return text'));
      };
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
      else {
        try {
          reader.readAsText(file);
        } catch (error) {
          failed(error);
        }
      }
    });
  }
  async function loadFile(file: File): Promise<number | null> {
    live();
    invalidateRead();
    const token = readToken;
    const abort = new AbortController();
    readAbort = abort;
    reading = true;
    fileReadFailed = false;
    problem = null;
    render();
    try {
      if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > HARD_LIMITS.maxBytes)
        throw new RangeError('Saved file exceeds import byte cap');
      const text = await (options.readFileText ?? browserRead)(file, abort.signal);
      if (disposed || token !== readToken) return null;
      if (typeof text !== 'string') throw new TypeError('Saved file reader must return text');
      return loadText(text);
    } catch (error) {
      if (!disposed && token === readToken) {
        reading = false;
        readAbort = null;
        fileReadFailed = true;
        fail('file', error);
      }
      return null;
    }
  }
  function exportJson(): JsonExport | null {
    live();
    const asset = exportable();
    if (!asset) {
      problem = {
        kind: 'input',
        message: 'Export requires the current validated map matching these settings and overrides.',
      };
      render();
      return null;
    }
    try {
      return {
        filename: `map-seed-${asset.provenance.seed}.json`,
        mimeType: 'application/json',
        text: canonicalizeAsset(structuredClone(asset) as MapAsset),
      };
    } catch (error) {
      fail('input', error);
      return null;
    }
  }
  async function deliverExport(): Promise<void> {
    const file = exportJson();
    if (!file) return;
    try {
      if (options.onExport) await options.onExport(file);
      else {
        const view = document.defaultView;
        if (!view?.URL.createObjectURL)
          throw new Error('Download API unavailable; provide onExport');
        const url = view.URL.createObjectURL(new view.Blob([file.text], { type: file.mimeType }));
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = file.filename;
        element.append(anchor);
        try {
          anchor.click();
        } finally {
          anchor.remove();
          view.URL.revokeObjectURL(url);
        }
      }
    } catch (error) {
      if (!disposed) fail('programming', error);
    }
  }
  const actions = document.createElement('div');
  element.append(actions);
  const generateButton = button(actions, 'Generate', 'generate', () => {
    generate();
  });
  const cancelButton = button(actions, 'Cancel', 'cancel', cancel);
  const file = document.createElement('input');
  file.type = 'file';
  file.accept = '.json,application/json';
  file.name = 'savedMap';
  labelInput(actions, 'Load saved map JSON', file);
  const exportButton = button(actions, 'Export validated map JSON', 'export', () => {
    void deliverExport();
  });
  element.append(status, progress, diagnosticList, provenance);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!disposed) generate();
  });
  form.addEventListener('input', (event) => {
    if (!disposed && event.target !== presetSelect) changed();
  });
  presetSelect.addEventListener('change', () => {
    if (disposed || !presetSelect.value) return;
    try {
      setParameters({
        seed: finiteInput(seed),
        settings: presets.find((preset) => preset.id === presetSelect.value)!.settings,
        overrides: baseline.overrides,
      });
    } catch (error) {
      fail('input', error);
    }
  });
  file.addEventListener('change', () => {
    if (!disposed && file.files?.[0]) void loadFile(file.files[0]);
  });
  function render(): void {
    if (disposed) return;
    // Always read live state; the subscriber argument is not an export authority.
    const state = controller.state;
    const asset = state.lastValidatedAsset;
    synchronizeReadyRecipe();
    if (asset && asset !== seenAsset) {
      seenAsset = asset;
      try {
        options.onValidatedAsset?.(asset);
      } catch (error) {
        problem = { kind: 'programming', message: errorMessage(error) };
      }
    }
    let validationMessage = '';
    let parameters: ReplayParameters | null = null;
    try {
      parameters = getParameters();
    } catch (error) {
      validationMessage = errorMessage(error);
    }
    if (parameters) {
      try {
        const compatibility = support(parameters);
        if (!compatibility.supported) validationMessage = compatibility.reason;
      } catch (error) {
        validationMessage = errorMessage(error);
        problem = { kind: 'programming', message: validationMessage };
      }
    }
    generateButton.disabled = state.status === 'disposed' || !!validationMessage;
    cancelButton.disabled =
      !reading && state.status !== 'generating' && state.status !== 'validating';
    exportButton.disabled = !exportable();
    progress.hidden = !state.progress;
    if (state.progress) progress.value = state.progress.fraction;
    const draftDiffers = !!asset && (!parameters || !sameRecipe(asset, parameters));
    const message = fileReadFailed
      ? 'Saved file read failed; export disabled until another validated request.'
      : state.status === 'failed'
        ? state.failure
          ? `${state.failure.kind} failure [${state.failure.code}]: ${state.failure.message}`
          : 'Expected infeasibility: candidate rejected.'
        : state.status === 'ready'
          ? draftDiffers
            ? 'Draft changed; validate settings and regenerate before export.'
            : 'Ready: complete validation passed.'
          : state.status === 'validating'
            ? 'Validating candidate; export disabled.'
            : state.status === 'generating'
              ? `Generating request ${state.requestId}.`
              : state.status === 'cancelled'
                ? 'Cancelled.'
                : state.status === 'disposed'
                  ? 'Controller disposed.'
                  : 'Draft settings; no generated map.';
    status.textContent = `${reading ? 'Reading saved file; export disabled. ' : ''}${message}${state.progress ? ` ${state.progress.stage}: ${state.progress.message}` : ''}${problem ? ` ${problem.kind} error: ${problem.message}` : validationMessage ? ` Settings/replay: ${validationMessage}` : ''}${asset && (state.status !== 'ready' || fileReadFailed || draftDiffers) ? ' Last validated map retained for preview.' : ''}`;
    diagnosticList.replaceChildren();
    for (const diagnostic of state.candidateDiagnostics) {
      const row = document.createElement('li');
      row.textContent = `${diagnostic.severity} ${diagnostic.stage} [${diagnostic.code}]: ${diagnostic.message}${diagnostic.featureId ? ` (${diagnostic.featureId})` : ''}${diagnostic.remediation ? ` — ${diagnostic.remediation}` : ''}`;
      diagnosticList.append(row);
    }
    provenance.textContent = recorded
      ? `Recorded generator/fork/stage versions:\n${JSON.stringify(recorded, null, 2)}`
      : 'No recorded generator version yet.';
  }
  writeFields();
  const unsubscribe = controller.subscribe(() => render());
  render();
  return {
    element,
    getParameters,
    setParameters,
    applyOverride,
    generate,
    cancel,
    loadText,
    loadFile,
    exportJson,
    dispose() {
      if (disposed) return;
      disposed = true;
      invalidateRead();
      unsubscribe();
      element.remove();
    },
  };
}
