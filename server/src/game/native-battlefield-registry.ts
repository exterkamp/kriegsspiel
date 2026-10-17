import { decodeBattlefieldCatalog, type BattlefieldCatalog } from '@kriegsspiel/protocol';
import { createNativeScenarioPin, type NativeScenarioPinV1 } from './native-scenario-pin.js';
import { defaultBridgeV1Input } from './native-scenarios/default-bridge-v1.js';
import { openBridgeV1Input } from './native-scenarios/open-bridge-v1.js';

const SCENARIO = 'hold-the-bridge';
export const DEFAULT_BRIDGE_PAIRING = `${SCENARIO}:default`;
export const OPEN_BRIDGE_PAIRING = `${SCENARIO}:open-v1`;
export type NativePairingFailure =
  | 'unknown_pairing'
  | 'stale_pairing'
  | 'foreign_scenario'
  | 'invalid_battlefield'
  | 'unavailable_pairing';
export class NativePairingError extends Error {
  constructor(readonly code: NativePairingFailure) {
    super(code);
  }
}

/**
 * Pure authored catalog, not game creation or canonical asset conversion.
 * The alternative is unavailable by default. Only trusted composition may enable
 * it after create/pin/replay/render acceptance; no request supplies this setting.
 */
export class NativeBattlefieldRegistry {
  private readonly pins = new Map<string, NativeScenarioPinV1>();
  private readonly enabled: ReadonlySet<string>;
  private readonly catalog: BattlefieldCatalog;

  constructor(enabledPairings: readonly string[] = [DEFAULT_BRIDGE_PAIRING]) {
    this.enabled = new Set(enabledPairings);
    if (!this.enabled.has(DEFAULT_BRIDGE_PAIRING))
      throw new Error('Native default must remain available');
    const definitions = [
      {
        rawScenario: defaultBridgeV1Input(),
        scenarioId: SCENARIO,
        pairingId: DEFAULT_BRIDGE_PAIRING,
        name: 'The bridge battlefield',
        isDefault: true,
      },
      {
        rawScenario: openBridgeV1Input(),
        scenarioId: SCENARIO,
        pairingId: OPEN_BRIDGE_PAIRING,
        name: 'Open bridge approaches',
        isDefault: false,
      },
    ];
    for (const definition of definitions) {
      const pin = createNativeScenarioPin(definition);
      this.pins.set(pin.battlefield.pairing.id, pin);
    }
    for (const id of this.enabled)
      if (!this.pins.has(id)) throw new Error('Unknown enabled native pairing');
    this.catalog = decodeBattlefieldCatalog(
      {
        schemaVersion: 1,
        scenarioId: SCENARIO,
        entries: [...this.pins.values()]
          .filter((pin) => this.enabled.has(pin.battlefield.pairing.id))
          .map((pin) => pin.battlefield),
      },
      SCENARIO,
    );
  }

  publicCatalog(scenarioId: string): BattlefieldCatalog {
    if (scenarioId !== SCENARIO) throw new NativePairingError('foreign_scenario');
    return structuredClone(this.catalog);
  }

  resolve(
    scenarioId: string,
    selection?: { pairingId: string; revision: string },
  ): NativeScenarioPinV1 {
    if (
      selection !== undefined &&
      (!selection ||
        typeof selection !== 'object' ||
        Object.keys(selection).length !== 2 ||
        typeof selection.pairingId !== 'string' ||
        selection.pairingId.length > 128 ||
        typeof selection.revision !== 'string' ||
        !/^engine-pairing-v1:sha256:[a-f0-9]{64}$/.test(selection.revision))
    )
      throw new NativePairingError('invalid_battlefield');
    const id = selection?.pairingId ?? DEFAULT_BRIDGE_PAIRING;
    const pin = this.pins.get(id);
    if (!pin) throw new NativePairingError('unknown_pairing');
    if (pin.publicScenarioId !== scenarioId) throw new NativePairingError('foreign_scenario');
    if (selection && selection.revision !== pin.battlefield.pairing.revision)
      throw new NativePairingError('stale_pairing');
    if (!this.enabled.has(id)) throw new NativePairingError('unavailable_pairing');
    return structuredClone(pin);
  }
}
