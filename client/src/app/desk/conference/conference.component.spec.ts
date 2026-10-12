import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { initialState } from '@legacy/net/state';
import { fixtureView } from '@legacy/table/fixture';
import { DeskStore } from '../desk.store';
import { CONFERENCE_SENDER } from '../../game/ports';
import { stubGame } from '../testing';
import { ConferenceComponent } from './conference.component';

async function open(link: 'offline' | 'open', sender = vi.fn(() => true)) {
  const game = stubGame({ ...initialState, link, view: fixtureView });
  TestBed.overrideProvider(CONFERENCE_SENDER, { useValue: sender });
  const desk = TestBed.inject(DeskStore);
  const f = TestBed.createComponent(ConferenceComponent);
  await f.whenStable();
  const el = f.nativeElement as HTMLElement;
  const ask = async (text: string) => {
    const ta = el.querySelector('textarea')!;
    ta.value = text;
    ta.dispatchEvent(new Event('input'));
    el.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await f.whenStable();
    await Promise.resolve();
    await f.whenStable();
  };
  return { f, el, desk, ask, sender, game };
}

describe('ConferenceComponent', () => {
  it('takes the answer time from the server’s charge, and fails a refused question', async () => {
    const { desk, ask, game, f, sender } = await open('open');
    await ask('How do we stand?');
    const [id] = sender.mock.calls[0] as unknown as [string];
    expect(desk.conferenceLog()[0]!.answerAtGame).toBe(Infinity);
    game.update((s) => ({
      ...s,
      staffCharges: { [id]: { askedAtGame: 1_000, answerAtGame: 601_000, costMs: 600_000 } },
    }));
    await f.whenStable();
    expect(desk.conferenceLog()[0]!.answerAtGame).toBe(601_000);
    expect(desk.conferenceLog()[0]!.askedAtGame).toBe(1_000);

    // The first officer is busy, so ask the other one.
    sender.mockClear();
    const tabs = (f.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>(
      '.tabs button',
    );
    tabs[1]!.click();
    await f.whenStable();
    await ask('Any word on supply?');
    const [id2] = sender.mock.calls[0] as unknown as [string];
    expect(desk.conferenceLog()).toHaveLength(2);
    game.update((s) => ({ ...s, staffCharges: { ...s.staffCharges, [id2]: 'refused' } }));
    await f.whenStable();
    expect(desk.conferenceLog()[1]!.failed).toBe(true);
  });

  it('shows the umpire’s answer, and answers a text-less reply from the newest view', async () => {
    const { desk, ask, game, f, sender } = await open('open');
    await ask('Where is the enemy?');
    const [id] = sender.mock.calls[0] as unknown as [string];
    expect(desk.conferenceLog()[0]!.answer).toBeUndefined();
    game.update((s) => ({
      ...s,
      staffAnswers: {
        [id]: {
          text: 'A battalion at the bridge.',
          basedOnGame: 5_000,
          officer: { name: 'Major Dessau', traits: [] },
        },
      },
    }));
    await f.whenStable();
    expect(desk.conferenceLog()[0]!.answer).toEqual({
      text: 'Major Dessau: A battalion at the bridge.',
      basedOnGame: 5_000,
    });
    // The umpire's officer replaces the fixture's name on the tab it answered.
    expect((f.nativeElement as HTMLElement).querySelector('.who')?.textContent).toContain(
      'Major Dessau',
    );

    sender.mockClear();
    (f.nativeElement as HTMLElement)
      .querySelectorAll<HTMLButtonElement>('.tabs button')[1]!
      .click();
    await f.whenStable();
    await ask('And now?');
    const [id2] = sender.mock.calls[0] as unknown as [string];
    game.update((s) => ({
      ...s,
      view: { ...fixtureView, atGame: 999_000 },
      staffAnswers: {
        ...s.staffAnswers,
        [id2]: { basedOnGame: 1, officer: { name: 'Major Dessau', traits: [] } },
      },
    }));
    await f.whenStable();
    expect(desk.conferenceLog()[1]!.answer?.basedOnGame).toBe(999_000);
  });

  it('shows the officer traits and cost, and holds an answer until game time reaches it', async () => {
    const { el, desk, ask, sender } = await open('offline');
    expect(el.textContent).toContain('Traits: meticulous, cautious');
    expect(el.textContent).toContain('10 min');
    await ask('How do we stand?');
    // No clock runs, so game time is the view's: the answer is due 10 minutes later and is not shown yet.
    expect(el.textContent).toContain('consulting the papers');
    expect(desk.conferenceLog()[0]!.answer).toBeDefined();
    expect(sender).not.toHaveBeenCalled();
    // A second question to the same officer is refused while they are busy.
    await ask('And now?');
    expect(el.querySelector('[role=alert]')?.textContent).toMatch(/still answering/);
    expect(desk.conferenceLog()).toHaveLength(1);
  });

  it('sends the question to the server when linked, and waits for its reply', async () => {
    const { desk, ask, sender } = await open('open');
    await ask('How do we stand?');
    expect(sender).toHaveBeenCalledWith(
      expect.stringMatching(/^q-/),
      'chiefOfStaff',
      'How do we stand?',
    );
    expect(desk.conferenceLog()[0]!.answerAtGame).toBe(Infinity);
  });

  it('says so when the link is down and logs nothing', async () => {
    const { el, desk, ask } = await open(
      'open',
      vi.fn(() => false),
    );
    await ask('How do we stand?');
    expect(el.querySelector('[role=alert]')?.textContent).toContain('Not connected');
    expect(desk.conferenceLog()).toHaveLength(0);
  });

  it('switches officer and keeps each officer’s log apart', async () => {
    const { el, f, ask } = await open('offline');
    await ask('How do we stand?');
    const tabs = el.querySelectorAll<HTMLButtonElement>('.tabs button');
    tabs[1]!.click();
    await f.whenStable();
    expect(tabs[1]!.getAttribute('aria-pressed')).toBe('true');
    expect(el.textContent).toContain('No questions yet.');
  });

  it('re-reads game time on a timer, so a due answer appears', async () => {
    vi.useFakeTimers();
    try {
      stubGame({ ...initialState, link: 'offline', view: fixtureView });
      const f = TestBed.createComponent(ConferenceComponent);
      f.detectChanges();
      const el = f.nativeElement as HTMLElement;
      const ta = el.querySelector('textarea')!;
      ta.value = 'How do we stand?';
      ta.dispatchEvent(new Event('input'));
      el.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
      await Promise.resolve();
      f.detectChanges();
      expect(el.textContent).toContain('consulting the papers');
      // With no clock, game time runs 1:1 from the view; the answer is due in 10 minutes.
      vi.advanceTimersByTime(11 * 60_000);
      f.detectChanges();
      expect(el.textContent).not.toContain('consulting the papers');
    } finally {
      vi.useRealTimers();
    }
  });
});
