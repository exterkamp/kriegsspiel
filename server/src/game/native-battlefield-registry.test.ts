import { holdTheBridge, loadScenario } from '@kriegsspiel/engine';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BRIDGE_PAIRING,
  OPEN_BRIDGE_PAIRING,
  NativeBattlefieldRegistry,
} from './native-battlefield-registry.js';
import { decodeNativeScenarioPin } from './native-scenario-pin.js';
import { scenarioList } from './registry.js';

const enabled = () => new NativeBattlefieldRegistry([DEFAULT_BRIDGE_PAIRING, OPEN_BRIDGE_PAIRING]);

describe('pure approved native battlefield registry', () => {
  it('keeps default-only production availability and unchanged legacy scenario metadata', () => {
    const before = scenarioList();
    const registry = new NativeBattlefieldRegistry();
    expect(
      registry.publicCatalog('hold-the-bridge').entries.map((entry) => entry.pairing.id),
    ).toEqual([DEFAULT_BRIDGE_PAIRING]);
    expect(registry.resolve('hold-the-bridge').initialWorld).toEqual(loadScenario(holdTheBridge));
    const alternative = enabled().publicCatalog('hold-the-bridge').entries[1]!;
    expect(() =>
      registry.resolve('hold-the-bridge', {
        pairingId: alternative.pairing.id,
        revision: alternative.pairing.revision,
      }),
    ).toThrow('unavailable_pairing');
    expect(scenarioList()).toEqual(before);
  });

  it('resolves both exact registered identities after trusted availability is enabled', () => {
    const registry = enabled();
    const catalog = registry.publicCatalog('hold-the-bridge');
    expect(catalog.entries.map((entry) => entry.isDefault)).toEqual([true, false]);
    for (const entry of catalog.entries) {
      const pin = registry.resolve(catalog.scenarioId, {
        pairingId: entry.pairing.id,
        revision: entry.pairing.revision,
      });
      expect(decodeNativeScenarioPin(JSON.parse(JSON.stringify(pin)))).toEqual(pin);
      expect(pin.battlefield).toEqual(entry);
      expect(pin.initialWorld.scenarioId).toBe(entry.pairing.resolvedScenarioId);
    }
  });

  it('rejects unknown, stale, foreign and unpaired geography distinctly', () => {
    const registry = enabled();
    const entry = registry.publicCatalog('hold-the-bridge').entries[0]!;
    expect(() =>
      registry.resolve('hold-the-bridge', {
        pairingId: 'owned:unpaired',
        revision: entry.pairing.revision,
      }),
    ).toThrow('unknown_pairing');
    expect(() =>
      registry.resolve('hold-the-bridge', {
        pairingId: entry.pairing.id,
        revision: `engine-pairing-v1:sha256:${'b'.repeat(64)}`,
      }),
    ).toThrow('stale_pairing');
    expect(() =>
      registry.resolve('foreign', {
        pairingId: entry.pairing.id,
        revision: entry.pairing.revision,
      }),
    ).toThrow('foreign_scenario');
    expect(() =>
      registry.resolve('hold-the-bridge', {
        pairingId: entry.pairing.id,
        revision: entry.pairing.scenarioRevision,
      }),
    ).toThrow('invalid_battlefield');
  });

  it('returns detached pin/catalog data without per-request authored reloads or identity changes', () => {
    const registry = enabled();
    const first = registry.publicCatalog('hold-the-bridge');
    const originalName = first.entries[0]!.map.name;
    first.entries[0]!.map.name = 'caller mutation';
    first.entries.length = 0;
    expect(registry.publicCatalog('hold-the-bridge').entries[0]!.map.name).toBe(originalName);
    const pin = registry.resolve('hold-the-bridge');
    const revision = pin.battlefield.pairing.revision;
    pin.initialWorld.units[0]!.center.x = 0;
    expect(registry.resolve('hold-the-bridge').initialWorld.units[0]!.center.x).toBe(1_960_000);
    expect(registry.resolve('hold-the-bridge').battlefield.pairing.revision).toBe(revision);
  });

  it('refuses composition that silently removes the default or enables an unknown pairing', () => {
    expect(() => new NativeBattlefieldRegistry([])).toThrow(/default/);
    expect(() => new NativeBattlefieldRegistry([DEFAULT_BRIDGE_PAIRING, 'unpaired'])).toThrow(
      /Unknown/,
    );
  });
});
