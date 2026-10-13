import { describe, expect, it } from 'vitest';
import {
  allowedSides,
  chooseScenario,
  createErrorMessage,
  initialForm,
  lengthLine,
  DIAL_CHOICES,
  PERSONA_CHOICES,
  rateExplanation,
  rateOf,
  toRequest,
  validate,
  type ScenarioOptions,
} from './newGame.js';

const o: ScenarioOptions = {
  opponent: 'scripted',
  scenarios: [
    {
      id: 'a',
      name: 'A',
      briefing: '',
      lengthMinutes: 240,
      sides: [
        { id: 'blue', name: 'Blue', controller: 'human' },
        { id: 'red', name: 'Red', controller: 'scripted' },
      ],
      defaults: { side: 'blue', rate: 12 },
    },
    {
      id: 'b',
      name: 'B',
      briefing: '',
      lengthMinutes: 60,
      sides: [
        { id: 'x', name: 'X', controller: 'human' },
        { id: 'y', name: 'Y', controller: 'human' },
      ],
      defaults: { side: 'y', rate: 7 },
    },
  ],
};

describe('new game form', () => {
  it('defaults to the first scenario, Blue and 12:1', () => {
    expect(initialForm(o)).toEqual({
      scenario: 'a',
      side: 'blue',
      rate: '12',
      customRate: '',
      dial: 'standard',
      persona: 'dry',
    });
    expect(initialForm({ scenarios: [], opponent: undefined })).toBeUndefined();
  });
  it('switching scenario takes its defaults, a non-preset rate becoming custom', () => {
    expect(chooseScenario(o, 'b')).toEqual({
      scenario: 'b',
      side: 'y',
      rate: 'custom',
      customRate: '7',
      dial: 'standard',
      persona: 'dry',
    });
    expect(chooseScenario(o, 'nope')).toBeUndefined();
  });
  it('offers only human sides against a computer opponent, all sides otherwise', () => {
    expect(allowedSides(o.scenarios[0]!, 'scripted').map((s) => s.id)).toEqual(['blue']);
    expect(allowedSides(o.scenarios[0]!, undefined).map((s) => s.id)).toEqual(['blue', 'red']);
  });
  it('reads presets and custom rates', () => {
    const f = initialForm(o)!;
    expect(rateOf(f)).toBe(12);
    expect(rateOf({ ...f, rate: 'custom', customRate: '6:1' })).toBe(6);
    expect(rateOf({ ...f, rate: 'custom', customRate: 'abc' })).toBeUndefined();
    expect(rateOf({ ...f, rate: 'custom', customRate: '0' })).toBeUndefined();
  });
  it('validates scenario, side and rate', () => {
    const f = initialForm(o)!;
    expect(validate(f, o)).toBeUndefined();
    expect(validate({ ...f, scenario: 'z' }, o)).toMatch(/scenario/);
    expect(validate({ ...f, side: 'red' }, o)).toMatch(/side/);
    expect(validate({ ...f, rate: 'custom', customRate: '' }, o)).toMatch(/Clock rate/);
  });
  it('builds the create request', () => {
    expect(toRequest(initialForm(o)!, o)).toEqual({
      scenario: 'a',
      side: 'blue',
      rate: 12,
      dial: 'standard',
      persona: 'dry',
      sessionType: 'co_op_vs_ai',
    });
    expect(toRequest(initialForm(o)!, { ...o, opponent: undefined })).not.toHaveProperty(
      'sessionType',
    );
  });
  it('sends the chosen dial and persona, and keeps them when the scenario changes', () => {
    const f = { ...initialForm(o)!, dial: 'free' as const, persona: 'dramatic' as const };
    expect(toRequest(f, o)).toMatchObject({ dial: 'free', persona: 'dramatic' });
    expect(chooseScenario(o, 'a', f)).toMatchObject({ dial: 'free', persona: 'dramatic' });
    expect(chooseScenario(o, 'a')).toMatchObject({ dial: 'standard', persona: 'dry' });
  });
  it('describes every dial and persona in plain language', () => {
    expect(DIAL_CHOICES.map((d) => d.id)).toEqual(['rigid', 'standard', 'free']);
    expect(PERSONA_CHOICES.map((p) => p.id)).toEqual(['dry', 'pedantic', 'dramatic']);
    for (const c of [...DIAL_CHOICES, ...PERSONA_CHOICES]) {
      expect(c.label.length).toBeGreaterThan(0);
      expect(c.description.length).toBeGreaterThan(30);
    }
  });
  it('explains rates in plain language', () => {
    expect(rateExplanation(12)).toBe('12:1 means one hour of battle passes in five minutes.');
    expect(rateExplanation(4)).toBe('4:1 means one hour of battle passes in 15 minutes.');
    expect(rateExplanation(1)).toMatch(/real time/);
    expect(rateExplanation(120)).toContain('30 seconds');
    expect(rateExplanation(86400)).toBe('86400:1 means one hour of battle passes in one second.');
    expect(rateExplanation(0.5)).toContain('2 hours');
    expect(lengthLine(240, 12)).toBe('About 4 hours of battle, 20 minutes at this rate.');
    expect(lengthLine(0, 12)).toBe('');
  });
  it('turns server errors into readable messages', () => {
    expect(createErrorMessage(401, 'not_signed_in')).toMatch(/signed out/);
    expect(createErrorMessage(400, 'bad_request')).toMatch(/clock rate/i);
    expect(createErrorMessage(429, 'x')).toMatch(/limit/);
    expect(createErrorMessage(409, 'game_limit')).toMatch(/limit/);
    expect(createErrorMessage(500, '')).toContain('500');
  });
});
