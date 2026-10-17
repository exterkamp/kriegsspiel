import { describe, expect, it } from 'vitest';
import type { ScenarioBattlefield } from '@kriegsspiel/protocol';
import { createGame, fetchScenarioOptions } from './newGameApi.js';
import { initialForm, toRequest, type ScenarioOptions } from './newGame.js';

const terrainIdentity = `engine-terrain-v1:sha256:${'a'.repeat(64)}`;
const scenarioRevision = `engine-scenario-v1:sha256:${'b'.repeat(64)}`;
const battlefield: ScenarioBattlefield = {
  map: {
    id: 'bridge:default',
    name: 'Bridge battlefield',
    source: 'scenario-default',
    terrainIdentity,
    widthM: 4000,
    heightM: 3000,
    preview: [],
  },
  pairing: {
    id: 'bridge:default',
    revision: scenarioRevision,
    scenarioId: 'bridge',
    scenarioRevision,
    terrainIdentity,
  },
  capabilities: { addMaps: false },
};
const options: ScenarioOptions = {
  opponent: 'scripted',
  scenarios: [
    {
      id: 'bridge',
      name: 'Bridge',
      briefing: 'Defend the crossing.',
      lengthMinutes: 50,
      sides: [
        { id: 'blue', name: 'Blue', controller: 'human' },
        { id: 'red', name: 'Red', controller: 'scripted' },
      ],
      defaults: { side: 'blue', rate: 12 },
      battlefield,
    },
  ],
};

describe('new-game metadata transport', () => {
  it('preserves the server descriptor without creating a game or altering scenario defaults', async () => {
    const calls: string[] = [];
    const loaded = await fetchScenarioOptions(async (url) => {
      calls.push(String(url));
      return new Response(JSON.stringify(options));
    });
    expect(calls).toEqual(['/scenarios']);
    expect(loaded.scenarios[0]!.battlefield).toEqual(battlefield);
    expect(initialForm(loaded)).toEqual(initialForm(options));
  });

  it('keeps the existing scenario-only immediate-create request even when a pairing is displayed', async () => {
    const request = toRequest(initialForm(options)!, options);
    let sent: unknown;
    const game = await createGame(request, async (url, init) => {
      expect(url).toBe('/games');
      expect(init?.method).toBe('POST');
      sent = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ id: 'new-game' }), { status: 201 });
    });
    expect(game).toBe('new-game');
    expect(sent).toEqual({
      scenario: 'bridge',
      side: 'blue',
      rate: 12,
      dial: 'standard',
      persona: 'dry',
      sessionType: 'co_op_vs_ai',
    });
  });

  it('still accepts an older server without battlefield metadata', async () => {
    const oldScenario = { ...options.scenarios[0]!, battlefield: undefined };
    const loaded = await fetchScenarioOptions(
      async () => new Response(JSON.stringify({ ...options, scenarios: [oldScenario] })),
    );
    expect(loaded.scenarios[0]!.battlefield).toBeUndefined();
    expect(toRequest(initialForm(loaded)!, loaded).scenario).toBe('bridge');
  });
});
