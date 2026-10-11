import { HARD_LIMITS, type ImportLimits } from './contract.js';
import { fail } from './errors.js';

export function utf8Bytes(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 128) bytes++;
    else if (c < 2048) bytes += 2;
    else if (
      c >= 0xd800 &&
      c <= 0xdbff &&
      i + 1 < text.length &&
      text.charCodeAt(i + 1) >= 0xdc00 &&
      text.charCodeAt(i + 1) <= 0xdfff
    ) {
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
}
export function limitsFrom(options: Partial<ImportLimits>): ImportLimits {
  const limits = { ...HARD_LIMITS } as ImportLimits;
  for (const [key, value] of Object.entries(options)) {
    if (
      !(key in limits) ||
      !Number.isSafeInteger(value) ||
      value <= 0 ||
      value > HARD_LIMITS[key as keyof ImportLimits]
    )
      throw new TypeError(`Import limit ${key} must be a positive integer <= hard cap`);
    limits[key as keyof ImportLimits] = value;
  }
  return limits;
}
export interface ResourceUsage {
  bytes: number;
  samples: number;
  sampleValues: number;
  features: number;
  vertices: number;
  nodes: number;
}
export function preflightAsset(
  input: unknown,
  limits: ImportLimits,
  chargeNode?: () => void,
  chargeDescriptor?: () => void,
): ResourceUsage {
  const usage = { bytes: 0, samples: 0, sampleValues: 0, features: 0, vertices: 0, nodes: 0 };
  const active = new WeakSet<object>();
  const addBytes = (n: number, path: string) => {
    usage.bytes += n;
    if (usage.bytes > limits.maxBytes)
      fail(path, `Object representation exceeds ${limits.maxBytes} bytes`, 'RESOURCE_LIMIT');
  };
  const visit = (value: unknown, path: string, depth: number): void => {
    chargeNode?.();
    if (++usage.nodes > limits.maxNodes || depth > limits.maxDepth)
      fail(path, 'Object depth/node cap exceeded', 'RESOURCE_LIMIT');
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) fail(path, 'Number must be finite');
      addBytes(String(value).length, path);
      return;
    }
    if (typeof value === 'string') {
      if (value.length > limits.maxBytes - usage.bytes)
        fail(path, 'String exceeds remaining byte cap', 'RESOURCE_LIMIT');
      addBytes(utf8Bytes(JSON.stringify(value)), path);
      return;
    }
    if (value === null || typeof value === 'boolean') {
      addBytes(value === null ? 4 : value ? 4 : 5, path);
      return;
    }
    if (typeof value !== 'object')
      fail(path, 'Expected JSON data, not undefined/functions/symbols');
    if (active.has(value)) fail(path, 'Cyclic input is not JSON data');
    active.add(value);
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype)
        fail(path, 'Expected plain JSON array without a custom prototype');
      addBytes(value.length + 2, path);
      if (/\.(samples|filledSamples|downstream|accumulation)$/.test(path)) {
        if (value.length > limits.maxSamples)
          fail(path, 'Sample array cap exceeded before parsing', 'RESOURCE_LIMIT');
        usage.sampleValues += value.length;
        if (path === '$.elevation.samples') usage.samples = value.length;
        if (usage.sampleValues > limits.maxSampleValues)
          fail(path, 'Aggregate sample-value cap exceeded', 'RESOURCE_LIMIT');
      } else if (
        /\.(position|anchor|endpoint|location)$|\.(outer|path|centreline)\[\d+\]$|\.holes\[\d+\]\[\d+\]$|\.endpoints\[\d+\]$/.test(
          path,
        )
      ) {
        if (++usage.vertices > limits.maxVertices)
          fail(path, 'Aggregate vertex cap exceeded', 'RESOURCE_LIMIT');
      }
      if (/\.(outer)$|\.holes\[\d+\]$/.test(path) && value.length > limits.maxRingVertices)
        fail(path, 'Ring vertex cap exceeded', 'RESOURCE_LIMIT');
      // Reject oversized feature/path collections without first cloning them.
      if (/^\$\.layers\.[a-zA-Z]+$/.test(path) && value.length > limits.maxFeatures)
        fail(path, 'Layer feature cap exceeded', 'RESOURCE_LIMIT');
      if (/\.(routeIds|roadIds|crossingIds)$/.test(path) && value.length > limits.maxFeatures)
        fail(path, 'Reference array cap exceeded', 'RESOURCE_LIMIT');
      if (
        /\.(outer|path|centreline)$|\.holes\[\d+\]$/.test(path) &&
        value.length > limits.maxVertices
      )
        fail(path, 'Vertex collection cap exceeded before parsing', 'RESOURCE_LIMIT');
      if (value.length > limits.maxNodes) fail(path, 'Array cap exceeded', 'RESOURCE_LIMIT');
      for (const key of Reflect.ownKeys(value)) {
        if (key === 'length') continue;
        if (
          typeof key !== 'string' ||
          !/^(0|[1-9][0-9]*)$/.test(key) ||
          Number(key) >= value.length
        )
          fail(path, 'Arrays cannot carry named, hidden or symbol properties');
        chargeDescriptor?.();
        const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
        if (!descriptor.enumerable || !('value' in descriptor))
          fail(`${path}[${key}]`, 'Hidden/accessor arrays are not JSON data');
      }
      for (let i = 0; i < value.length; i++) {
        chargeDescriptor?.();
        const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
        if (!descriptor || !('value' in descriptor))
          fail(`${path}[${i}]`, 'Sparse/accessor arrays are not JSON data');
        visit(descriptor.value, `${path}[${i}]`, depth + 1);
      }
      if (Object.keys(value).length !== value.length)
        fail(path, 'Arrays cannot carry named properties');
    } else {
      if (
        Object.getPrototypeOf(value) !== Object.prototype &&
        Object.getPrototypeOf(value) !== null
      )
        fail(path, 'Expected plain JSON object');
      for (const key of Reflect.ownKeys(value)) {
        if (typeof key !== 'string') fail(path, 'Symbol properties are not JSON data');
        chargeDescriptor?.();
        const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
        if (!descriptor.enumerable || !('value' in descriptor))
          fail(`${path}.${key}`, 'Hidden/accessor properties are not JSON data');
      }
      const keys = Object.keys(value);
      addBytes(keys.length + 2, path);
      for (const key of keys) {
        chargeDescriptor?.();
        const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
        if (!('value' in descriptor))
          fail(`${path}.${key}`, 'Accessor properties are not JSON data');
        if (
          key === 'id' &&
          (path.startsWith('$.layers.') || path.startsWith('$.overrides[')) &&
          typeof descriptor.value === 'string' &&
          ++usage.features > limits.maxFeatures
        )
          fail(path, 'Aggregate feature/entrance/override cap exceeded', 'RESOURCE_LIMIT');
        addBytes(utf8Bytes(JSON.stringify(key)) + 1, path);
        visit(descriptor.value, `${path}.${key}`, depth + 1);
      }
    }
    active.delete(value);
  };
  visit(input, '$', 0);
  return usage;
}
