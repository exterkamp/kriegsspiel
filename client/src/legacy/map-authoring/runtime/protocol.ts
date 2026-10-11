import { parseAsset, type GenerationResult, type MapAsset } from '@kriegsspiel/maps';
import {
  checkJson,
  freezeData,
  parseReplayParameters,
  parseValidation,
  ProtocolError,
  validId,
  type ReadonlyData,
  type ValidationContext,
  type ValidationOutcome,
} from '../generation/index.js';

export interface ValidationRequest {
  v: 1;
  type: 'validate';
  requestId: number;
  asset: ReadonlyData<MapAsset>;
  context: ReadonlyData<ValidationContext>;
}
export interface ValidatedFiles {
  json: string;
  svg: string;
}
function parseFiles(input: unknown): ValidatedFiles {
  const parsed = object(input, ['json', 'svg']);
  if (
    typeof parsed.json !== 'string' ||
    !parsed.json.length ||
    typeof parsed.svg !== 'string' ||
    !parsed.svg.length
  )
    throw new ProtocolError('Expected nonempty JSON/SVG strings');
  return { json: parsed.json, svg: parsed.svg };
}
export function parseExportResult(input: unknown): GenerationResult<ValidatedFiles> {
  checkJson(input);
  const raw = input as Record<string, unknown> | null;
  const value = object(
    raw,
    raw?.ok === true ? ['ok', 'value', 'diagnostics'] : ['ok', 'kind', 'diagnostics'],
  );
  const outcome = parseValidation({
    ok: value.ok,
    diagnostics: value.diagnostics,
    ...(value.ok === true ? {} : { kind: value.kind }),
  });
  return outcome.ok
    ? { ok: true, value: parseFiles(value.value), diagnostics: outcome.diagnostics }
    : outcome;
}
export type ValidationResponse = { v: 1; requestId: number } & (
  | { type: 'validated'; outcome: ValidationOutcome; files?: ValidatedFiles }
  | { type: 'error'; code: string; message: string }
);
function object(input: unknown, keys: string[]): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new ProtocolError('Expected object');
  const value = input as Record<string, unknown>;
  if (Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key)))
    throw new ProtocolError('Unexpected validation message fields');
  return value;
}
export function parseValidationRequest(input: unknown): ReadonlyData<ValidationRequest> {
  checkJson(input);
  const value = object(input, ['v', 'type', 'requestId', 'asset', 'context']);
  if (value.v !== 1 || value.type !== 'validate' || !validId(value.requestId))
    throw new ProtocolError('Invalid validation envelope');
  const raw = value.context as Record<string, unknown> | null;
  const context = object(
    raw,
    raw?.source === 'generated' ? ['source', 'requestId', 'replay'] : ['source', 'requestId'],
  );
  if (
    context.requestId !== value.requestId ||
    (context.source !== 'saved' && context.source !== 'generated')
  )
    throw new ProtocolError('Invalid validation context');
  const parsed: ValidationContext =
    context.source === 'generated'
      ? {
          source: 'generated',
          requestId: value.requestId,
          replay: parseReplayParameters(context.replay),
        }
      : { source: 'saved', requestId: value.requestId };
  const asset = parseAsset(value.asset);
  if (
    parsed.source === 'generated' &&
    (asset.provenance.seed !== parsed.replay.seed ||
      JSON.stringify(asset.settings) !== JSON.stringify(parsed.replay.settings) ||
      JSON.stringify(asset.overrides) !== JSON.stringify(parsed.replay.overrides))
  )
    throw new ProtocolError('Validation candidate differs from requested recipe');
  return freezeData({ v: 1, type: 'validate', requestId: value.requestId, asset, context: parsed });
}
export function parseValidationResponse(input: unknown): ValidationResponse {
  checkJson(input);
  const raw = input as Record<string, unknown> | null;
  const value = object(
    raw,
    raw?.type === 'validated'
      ? ['v', 'type', 'requestId', 'outcome', ...(Object.hasOwn(raw, 'files') ? ['files'] : [])]
      : ['v', 'type', 'requestId', 'code', 'message'],
  );
  if (value.v !== 1 || !validId(value.requestId))
    throw new ProtocolError('Invalid validation response envelope');
  if (value.type === 'validated') {
    const outcome = parseValidation(value.outcome);
    let files: ValidatedFiles | undefined;
    if (Object.hasOwn(value, 'files')) {
      if (!outcome.ok) throw new ProtocolError('Exports require accepted validation');
      files = parseFiles(value.files);
    }
    return {
      v: 1,
      requestId: value.requestId,
      type: 'validated',
      outcome,
      ...(files ? { files } : {}),
    };
  }
  if (
    value.type !== 'error' ||
    typeof value.code !== 'string' ||
    value.code.length < 1 ||
    value.code.length > 96 ||
    typeof value.message !== 'string' ||
    value.message.length < 1 ||
    value.message.length > 512
  )
    throw new ProtocolError('Invalid validation error');
  return {
    v: 1,
    requestId: value.requestId,
    type: 'error',
    code: value.code,
    message: value.message,
  };
}
