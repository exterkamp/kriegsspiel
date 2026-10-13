import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, type DraftEntry, type DraftSnapshot } from '@kriegsspiel/protocol';
import { applyServerMessage, type ClientState } from '@legacy/net/state';
import { fakeGame } from './fake-game';
import { DraftsPanelComponent } from './drafts-panel.component';

const v = PROTOCOL_VERSION;

const draft = (over: Partial<DraftSnapshot> = {}): DraftSnapshot => ({
  id: 'd1',
  title: 'Order 1',
  createdBy: 'me',
  rev: 0,
  text: 'Hold the bridge',
  authors: [{ author: 'me', len: 15 }],
  comments: [],
  receipts: {},
  history: [],
  ...over,
});

async function open(drafts: DraftSnapshot[] = [draft()], extra: Partial<ClientState> = {}) {
  const g = fakeGame({
    link: 'open',
    drafts,
    draftPresence: {
      you: 'me',
      people: [
        { id: 'me', label: 'Commander', drafts: [] },
        { id: 'cos', label: 'Chief of staff', drafts: ['d1'] },
      ],
    },
    draftLabels: { me: 'Commander', cos: 'Chief of staff' },
    ...extra,
  });
  TestBed.configureTestingModule({
    providers: [provideZonelessChangeDetection(), { provide: g.provide, useValue: g.fake }],
  });
  const fixture = TestBed.createComponent(DraftsPanelComponent);
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  const q = <T extends HTMLElement>(s: string): T => el.querySelector<T>(s)!;
  /** Deliver a server message as the connection would. */
  const serve = async (m: Parameters<typeof applyServerMessage>[1]) => {
    g.fake.set(applyServerMessage(g.fake.state(), m, 0));
    await fixture.whenStable();
  };
  const type = async (value: string) => {
    const ta = q<HTMLTextAreaElement>('#draft-text');
    ta.value = value;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    await fixture.whenStable();
  };
  const entry = (e: DraftEntry) => serve({ v, kind: 'draftEntry', draft: 'd1', entry: e });
  return { g: g.fake, fixture, el, q, serve, type, entry, settle: () => fixture.whenStable() };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('DraftsPanelComponent', () => {
  it('shows the draft, who else is looking at it and tells the server this player has it open', async () => {
    const t = await open();
    expect(t.q<HTMLTextAreaElement>('#draft-text').value).toBe('Hold the bridge');
    expect(t.el.querySelector('.presence')!.textContent).toContain(
      'Also looking at this draft: Chief of staff',
    );
    expect(t.g.draftPresence).toHaveBeenCalledWith('d1');
  });

  it('sends typing as one edit after a pause, and not before', async () => {
    const t = await open();
    await t.type('Colonel: Hold the bridge');
    expect(t.g.draftEdit).not.toHaveBeenCalled();
    expect(t.q('#draft-status').textContent).toContain('Sending');
    await sleep(320);
    expect(t.g.draftEdit).toHaveBeenCalledOnce();
    const [id, e] = t.g.draftEdit.mock.calls[0] as unknown as [
      string,
      { baseRev: number; op: unknown },
    ];
    expect(id).toBe('d1');
    expect(e.baseRev).toBe(0);
    expect(e.op).toEqual(['Colonel: ', 15]);
  });

  it('keeps the text and the caret when another player edits at the same time', async () => {
    const t = await open();
    const ta = t.q<HTMLTextAreaElement>('#draft-text');
    ta.focus();
    await t.type('Hold the bridge now');
    ta.setSelectionRange(19, 19);
    // The chief of staff's edit lands before ours is sent.
    await t.entry({
      kind: 'edit',
      rev: 1,
      author: 'cos',
      at: 1000,
      op: ['Colonel: ', 15],
      opId: 'x',
    });
    expect(ta.value).toBe('Colonel: Hold the bridge now');
    expect(ta.selectionStart).toBe(28);
    // Then our edit goes out against the rev we had, and comes back.
    await sleep(320);
    const sent = t.g.draftEdit.mock.calls.at(-1) as unknown as [
      string,
      { baseRev: number; op: unknown; opId: string },
    ];
    expect(sent[1].baseRev).toBe(1);
    await t.entry({
      kind: 'edit',
      rev: 2,
      author: 'me',
      at: 2000,
      op: [24, ' now'],
      opId: sent[1].opId,
    });
    expect(ta.value).toBe('Colonel: Hold the bridge now');
    expect(t.q('#draft-status').textContent).toContain('Saved');
    expect(t.g.draftEdit).toHaveBeenCalledTimes(1);
  });

  it('announces what others did to assistive technology', async () => {
    const t = await open();
    await t.entry({ kind: 'edit', rev: 1, author: 'cos', at: 1000, op: ['Sir: ', 15], opId: 'x' });
    expect(t.q('[data-testid=drafts-announcer]').textContent).toContain(
      'Chief of staff changed the draft',
    );
  });

  it('shows who wrote what and the change history in the tracked view', async () => {
    const t = await open();
    await t.entry({ kind: 'edit', rev: 1, author: 'cos', at: 1000, op: ['Sir: ', 15], opId: 'x' });
    t.el.querySelectorAll<HTMLButtonElement>('.modes button')[1]!.click();
    await t.settle();
    const spans = [...t.el.querySelectorAll('.authored .by')].map((s) => s.textContent!.trim());
    expect(spans[0]).toContain('Chief of staff wrote: Sir:');
    expect(spans[1]).toContain('You wrote: Hold the bridge');
    expect(t.q('.history').textContent).toContain('Chief of staff added “Sir: ”');
    expect(t.el.querySelectorAll('.legend li')).toHaveLength(2);
  });

  it('adds a comment on the selected words and lists the thread', async () => {
    const t = await open();
    const ta = t.q<HTMLTextAreaElement>('#draft-text');
    ta.setSelectionRange(9, 15);
    const body = t.q<HTMLTextAreaElement>('#draft-comment');
    body.value = 'Which bridge?';
    body.dispatchEvent(new Event('input', { bubbles: true }));
    await t.settle();
    t.el.querySelector<HTMLButtonElement>('.editor-block > button')!.click();
    expect(t.g.draftComment).toHaveBeenCalledWith(
      'd1',
      0,
      expect.objectContaining({ from: 9, to: 15, body: 'Which bridge?' }),
    );
    const comment = {
      id: 'c1',
      author: 'cos',
      at: 5000,
      from: 9,
      to: 15,
      body: 'Which bridge?',
      resolved: false,
    };
    await t.entry({ kind: 'comment', rev: 1, at: 5000, comment });
    expect(t.q('.thread').textContent).toContain('Chief of staff');
    expect(t.q('.thread .quote').textContent).toContain('“bridge”');
    t.q<HTMLButtonElement>('.thread .row-actions button:nth-child(2)').click();
    expect(t.g.resolveComment).toHaveBeenCalledWith('d1', 'c1', true);
  });

  it('cannot comment while its own changes are still being sent', async () => {
    const t = await open();
    await t.type('Hold the bridge!');
    expect(t.q<HTMLButtonElement>('.editor-block > button').disabled).toBe(true);
    expect(t.q('#draft-comment-hint').textContent).toContain('still being sent');
  });

  it('lists forks under their draft with unread counts, and merges after confirmation', async () => {
    const fork = draft({
      id: 'f1',
      title: 'Plan B',
      rev: 2,
      forkOf: { draft: 'd1', rev: 0 },
      receipts: { me: 1 },
    });
    const t = await open([draft(), fork]);
    const rows = [...t.el.querySelectorAll('.list li')];
    expect(rows).toHaveLength(2);
    expect(rows[1]!.textContent).toContain('Plan B');
    expect(rows[1]!.textContent).toContain('1 new');
    rows[1]!.querySelector('button')!.click();
    await t.settle();
    expect(rows[1]!.querySelector('button')!.getAttribute('aria-current')).toBe('true');
    // Reading it sends a receipt.
    expect(t.g.readDraft).toHaveBeenCalledWith('f1', 2);
    const merge = [...t.el.querySelectorAll<HTMLButtonElement>('.actions button')].find((b) =>
      b.textContent!.includes('Merge'),
    )!;
    merge.click();
    await t.settle();
    expect(t.g.mergeDraft).not.toHaveBeenCalled();
    expect(merge.textContent).toContain('Confirm');
    merge.click();
    expect(t.g.mergeDraft).toHaveBeenCalledWith('f1');
  });

  it('makes a new draft and a fork', async () => {
    const t = await open();
    [...t.el.querySelectorAll<HTMLButtonElement>('button')]
      .find((b) => b.textContent!.trim() === 'New draft')!
      .click();
    expect(t.g.createDraft).toHaveBeenCalledWith(expect.any(String), { title: 'Draft 2' });
  });

  it('makes a fork of the open draft', async () => {
    const t = await open();
    [...t.el.querySelectorAll<HTMLButtonElement>('.actions button')]
      .find((b) => b.textContent!.includes('Fork'))!
      .click();
    expect(t.g.forkDraft).toHaveBeenCalledWith('d1', expect.any(String));
  });

  it('shows who has read the draft', async () => {
    const t = await open([draft({ rev: 3, receipts: { cos: 1, me: 3 } })]);
    expect(t.q('.readers').textContent).toContain('Chief of staff is 2 steps behind');
  });

  it('is read-only once a fork is merged, and when the link is down', async () => {
    const t = await open([draft({ mergedInto: 'x' })]);
    expect(t.q<HTMLTextAreaElement>('#draft-text').readOnly).toBe(true);
    expect(t.q('#draft-status').textContent).toContain('merged');
  });

  it('is read-only while the link is down', async () => {
    const t = await open([draft()], { link: 'closed' });
    expect(t.q<HTMLTextAreaElement>('#draft-text').readOnly).toBe(true);
  });

  it('hands the wording to the order form', async () => {
    const t = await open();
    const used: string[] = [];
    t.fixture.componentInstance.useDraft.subscribe((s) => used.push(s));
    await t.type('Hold the bridge at all costs');
    [...t.el.querySelectorAll<HTMLButtonElement>('.actions button')]
      .find((b) => b.textContent!.includes('Use in order'))!
      .click();
    expect(used).toEqual(['Hold the bridge at all costs']);
  });

  it('takes the server text back when an edit is refused', async () => {
    const t = await open();
    await t.type('Hold the bridge!!');
    await t.serve({ v, kind: 'error', code: 'bad_op', message: 'the edit does not fit' });
    expect(t.q<HTMLTextAreaElement>('#draft-text').value).toBe('Hold the bridge');
    expect(t.el.querySelector('[role=alert]')!.textContent).toContain('does not fit');
  });
});
