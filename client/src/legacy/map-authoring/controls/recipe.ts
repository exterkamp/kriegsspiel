import { DEFAULT_SETTINGS, type MapOverride } from '@kriegsspiel/maps';
import { checkJson, parseReplayParameters, type ReplayParameters } from '../generation/index.js';

export type OverrideEdit =
  | { type: 'append'; override: MapOverride }
  | { type: 'replace'; index: number; override: MapOverride }
  | { type: 'remove'; index: number }
  | { type: 'reorder'; from: number; to: number };

export function defaultParameters(): ReplayParameters {
  return { seed: 17, settings: structuredClone(DEFAULT_SETTINGS), overrides: [] };
}
/** Detached schema-valid recipe. Edits retain order, ring starts, winding and holes. */
export function editOverrides(parameters: ReplayParameters, edit: OverrideEdit): ReplayParameters {
  checkJson(edit);
  const keys =
    edit.type === 'append'
      ? ['type', 'override']
      : edit.type === 'replace'
        ? ['type', 'index', 'override']
        : edit.type === 'remove'
          ? ['type', 'index']
          : edit.type === 'reorder'
            ? ['type', 'from', 'to']
            : [];
  if (
    !keys.length ||
    Object.keys(edit).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(edit, key))
  )
    throw new TypeError('Invalid override edit fields');
  const recipe = parseReplayParameters(parameters);
  const index = (value: number): void => {
    if (!Number.isSafeInteger(value) || value < 0 || value >= recipe.overrides.length) {
      throw new RangeError('Override index outside the ordered list');
    }
  };
  switch (edit.type) {
    case 'append':
      recipe.overrides.push(edit.override);
      break;
    case 'replace':
      index(edit.index);
      recipe.overrides[edit.index] = edit.override;
      break;
    case 'remove':
      index(edit.index);
      recipe.overrides.splice(edit.index, 1);
      break;
    case 'reorder': {
      index(edit.from);
      index(edit.to);
      const [override] = recipe.overrides.splice(edit.from, 1);
      recipe.overrides.splice(edit.to, 0, override!);
      break;
    }
    default:
      throw new TypeError('Unknown override edit');
  }
  return parseReplayParameters(recipe);
}
