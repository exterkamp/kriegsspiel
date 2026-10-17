import { expect, it, vi } from 'vitest';

// An unexpected exception inside a stage, from valid input, stands in for a
// generator fault such as the out-of-map height query of #542.
vi.mock('../src/planning/index.js', async (original) => ({
  ...(await original<typeof import('../src/planning/index.js')>()),
  generatePlanning: () => {
    throw new RangeError('Height query (-3,2848) is outside [0,500] × [0,500]');
  },
}));

const { battlefieldPreset, generateBattlefield } = await import('../src/composition/index.js');

function small() {
  const input = battlefieldPreset('flat-countryside');
  input.settings.widthM = input.settings.heightM = 500;
  input.settings.settlements.villageCount = 1;
  input.settings.settlements.farmCount = 1;
  input.settings.settlements.villagePopulation = 12;
  input.settings.settlements.minSpacingM = 150;
  input.settings.roads.extraLinks = 0;
  return input;
}

it('turns an unexpected stage exception into a failure result naming the cause (#542)', () => {
  const result = generateBattlefield(small());
  expect(result).toMatchObject({
    ok: false,
    kind: 'infeasible',
    diagnostics: [
      {
        severity: 'error',
        stage: 'roads',
        code: 'GENERATION_INTERNAL_ERROR',
        message: 'RangeError: Height query (-3,2848) is outside [0,500] × [0,500]',
      },
    ],
  });
});

it('still throws for malformed input', () => {
  const input = small();
  expect(() => generateBattlefield({ ...input, seed: -1 })).toThrow(RangeError);
  expect(() => generateBattlefield({ ...input, limits: { unknown: 1 } } as never)).toThrow(
    TypeError,
  );
});
