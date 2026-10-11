import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GameService } from './game.service';
import { CONFERENCE_SENDER, ORDER_SENDER, PAUSE_ACTIONS } from './ports';

describe('injection tokens', () => {
  beforeEach(() => vi.stubGlobal('WebSocket', class {}));
  afterEach(() => vi.unstubAllGlobals());

  it('default to GameService and report a missing connection', () => {
    expect(
      TestBed.inject(ORDER_SENDER).send({
        text: 't',
        toName: 'n',
        courier: 'safe',
        eta: undefined,
      }),
    ).toMatch(/Not connected/);
    expect(TestBed.inject(CONFERENCE_SENDER)('q', 'chiefOfStaff', 'x')).toBe(false);
    expect(TestBed.inject(PAUSE_ACTIONS).vote('p', true)).toBe(false);
  });

  it('can be replaced', () => {
    const send = vi.fn(() => undefined);
    TestBed.configureTestingModule({ providers: [{ provide: ORDER_SENDER, useValue: { send } }] });
    TestBed.inject(ORDER_SENDER).send({ text: 't', toName: 'n', courier: 'fast', eta: 5 });
    expect(send).toHaveBeenCalledOnce();
    expect(TestBed.inject(GameService).state().pending).toHaveLength(0);
  });
});
