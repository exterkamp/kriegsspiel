import { expect, it, vi } from 'vitest';
import { createFormationFocus } from './sessionActions';
import { makePorts, ok } from './shell/fakes';
import { createHqNavigation } from './shell/navigation';
import type { Result } from './contracts';

it.each(['view', 'selection'])(
  'cancels pending formation focus when %s changes, even if the port completes late',
  async (change) => {
    const ports = makePorts();
    Object.assign(ports.snapshot, {
      roster: [
        {
          unitId: 'one',
          name: 'One',
          position: { kind: 'snapshot', value: { x: 350, y: 250 }, atGame: 10 },
        },
      ],
    });
    const nav = createHqNavigation({
      surface: ports.surface,
      reducedMotion: () => true,
      focus: () => {},
    });
    let complete!: (value: Result<void>) => void;
    let signal: AbortSignal | undefined;
    vi.mocked(ports.surface.focusAt).mockImplementation(async (_point, op) => {
      signal = op.signal;
      return await new Promise((resolve) => {
        complete = resolve;
      });
    });
    const pending = createFormationFocus(new AbortController().signal)(
      {
        state: nav.getState(),
        sourceState: { connection: 'ready', snapshot: ports.snapshot, stale: false, error: null },
        navigation: nav,
        surface: ports.surface,
        capabilities: ports.source.capabilities,
      },
      'one',
    );
    await vi.waitFor(() => expect(signal).toBeDefined());
    if (change === 'view')
      await nav.navigate('orders', null, { signal: new AbortController().signal });
    else nav.select({ kind: 'none' });
    expect(signal!.aborted).toBe(true);
    complete(ok(undefined));
    expect(await pending).toMatchObject({ ok: false, error: { code: 'aborted' } });
    nav.dispose();
  },
);
