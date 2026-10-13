import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import type { DraftSnapshot } from '@kriegsspiel/protocol';
import {
  DraftSession,
  authoredSpans,
  draftRows,
  draftTitle,
  historyLines,
  moveIndex,
  threadsOf,
  unreadCount,
} from '@legacy/desk/drafts';
import { GameService } from '../game/game.service';

/** Server error codes that belong to the drafting desk. */
const DRAFT_ERRORS = new Set([
  'draft_unknown',
  'draft_exists',
  'draft_closed',
  'draft_full',
  'too_many_drafts',
  'bad_op',
  'bad_rev',
  'bad_comment',
  'not_a_fork',
]);
/** Errors that mean the edit in flight was not taken and the unsaved text cannot be sent as it is. */
const EDIT_ERRORS = new Set(['bad_op', 'bad_rev', 'draft_closed', 'draft_full']);
/** How long after the last keystroke the typed text is sent. */
const SEND_AFTER_MS = 250;
/** Underline styles that tell authors apart without relying on colour alone. */
const AUTHOR_STYLES = ['a0', 'a1', 'a2', 'a3'] as const;

/**
 * The shared drafting desk (story 6.4): the side's order drafts, edited together. Text goes through the
 * server's operational transform (`DraftSession`), so two players typing at once both keep their words. Beside
 * the text it shows comments, who wrote what, the change history, who has read it, who is looking at it now, and
 * the forks.
 */
@Component({
  selector: 'ks-drafts-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './drafts-panel.component.html',
  styleUrl: './drafts-panel.component.css',
})
export class DraftsPanelComponent {
  /** The player chose to put a draft's wording into the order form. */
  readonly useDraft = output<string>();

  private readonly game = inject(GameService);
  protected readonly state = this.game.state;
  private readonly editor = viewChild<ElementRef<HTMLTextAreaElement>>('editor');

  protected readonly drafts = computed(() => this.state().drafts);
  protected readonly rows = computed(() => draftRows(this.drafts()));
  /** The draft the player chose, or the one they just made and the server has not yet confirmed. */
  private readonly chosen = signal<string | undefined>(undefined);
  protected readonly selected = computed<DraftSnapshot | undefined>(() => {
    const id = this.chosen();
    const list = this.drafts();
    return list.find((d) => d.id === id) ?? (id === undefined ? list[0] : undefined);
  });
  private readonly selectedId = computed(() => this.selected()?.id ?? null);
  protected readonly me = computed(() => this.state().draftPresence?.you);
  protected readonly online = computed(
    () => this.state().link === 'open' && this.me() !== undefined,
  );
  protected readonly parentTitle = computed(() => {
    const parent = this.selected()?.forkOf?.draft;
    const i = this.drafts().findIndex((d) => d.id === parent);
    return i < 0 ? undefined : draftTitle(this.drafts()[i]!, i);
  });
  protected readonly readOnly = computed(() => {
    const d = this.selected();
    return d === undefined || d.mergedInto !== undefined || !this.online();
  });

  /** What the player sees in the editor: the server's text plus their unsent typing. */
  protected readonly text = signal('');
  protected readonly saved = signal(true);
  protected readonly mode = signal<'edit' | 'tracked'>('edit');
  protected readonly commentBody = signal('');
  protected readonly replyTo = signal<string | undefined>(undefined);
  protected readonly replyBody = signal('');
  protected readonly confirmMerge = signal(false);
  protected readonly announcement = signal('');
  protected readonly problem = signal('');
  private readonly dismissed = signal<unknown>(undefined);

  protected readonly name = (id: string): string =>
    id === this.me() ? 'You' : (this.state().draftLabels[id] ?? 'Another player');

  protected readonly spans = computed(() => {
    const d = this.selected();
    return d ? authoredSpans(d) : [];
  });
  /** The authors in the text, each with the mark that sets their words apart. */
  protected readonly legend = computed(() => {
    const ids = new Map<string, string>();
    for (const s of this.spans()) {
      if (s.author && !ids.has(s.author))
        ids.set(s.author, AUTHOR_STYLES[ids.size % AUTHOR_STYLES.length]!);
    }
    return [...ids].map(([id, style]) => ({ id, style, name: this.name(id) }));
  });
  protected styleOf(author: string): string {
    return this.legend().find((l) => l.id === author)?.style ?? 'a0';
  }
  protected readonly history = computed(() => {
    const d = this.selected();
    return d ? historyLines(d, this.name).reverse() : [];
  });
  protected readonly threads = computed(() => {
    const d = this.selected();
    return d ? threadsOf(d.comments) : [];
  });
  /** Who else is here, and who has the selected draft open. */
  protected readonly presence = computed(() => {
    const p = this.state().draftPresence;
    const d = this.selected();
    if (!p) return { here: [] as string[], elsewhere: [] as string[] };
    const others = p.people.filter((x) => x.id !== p.you);
    return {
      here: others.filter((x) => d && x.drafts.includes(d.id)).map((x) => x.label),
      elsewhere: others.filter((x) => !d || !x.drafts.includes(d.id)).map((x) => x.label),
    };
  });
  /** Each other player and how far through the selected draft they have read. */
  protected readonly readers = computed(() => {
    const d = this.selected();
    const p = this.state().draftPresence;
    if (!d || !p) return [];
    const ids = new Set([...p.people.map((x) => x.id), ...Object.keys(d.receipts)]);
    ids.delete(p.you);
    return [...ids].map((id) => {
      const seen = d.receipts[id] ?? 0;
      const behind = d.rev - seen;
      return {
        id,
        name: this.name(id),
        status:
          behind <= 0
            ? 'has read all of it'
            : seen === 0
              ? 'has not read it'
              : `is ${behind} step${behind === 1 ? '' : 's'} behind`,
      };
    });
  });
  protected readonly serverProblem = computed(() => {
    const n = this.state().notices.at(-1);
    return n && DRAFT_ERRORS.has(n.code) && n !== this.dismissed() ? n.message : '';
  });

  private session: DraftSession | undefined;
  private sessionKey = '';
  private sendTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly readSent = new Map<string, number>();
  private readonly seenEntries = new Map<string, number>();
  private seq = 0;
  private lastNotice: unknown;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      clearTimeout(this.sendTimer);
      this.game.draftPresence(null);
    });
    // Follow the server's copy of the chosen draft.
    effect(() => {
      const d = this.selected();
      const me = this.me();
      untracked(() => this.follow(d, me));
    });
    // Tell the side which draft is open, and send an unsent edit again when the link comes back.
    effect(() => {
      const id = this.selectedId();
      const open = this.online();
      untracked(() => {
        if (!open) return;
        this.game.draftPresence(id);
        const again = this.session?.resend();
        if (again && id) this.game.draftEdit(id, again);
      });
    });
    // Say the draft has been read, as far as it has got.
    effect(() => {
      const d = this.selected();
      const me = this.me();
      if (!d || !me) return;
      untracked(() => {
        if (unreadCount(d, me) === 0 || (this.readSent.get(d.id) ?? 0) >= d.rev) return;
        this.readSent.set(d.id, d.rev);
        this.game.readDraft(d.id, d.rev);
      });
    });
    // Tell assistive technology what the others did.
    effect(() => {
      const d = this.selected();
      untracked(() => this.announce(d));
    });
    // An edit the server refused cannot be sent as it is: show the server's text again.
    effect(() => {
      const n = this.state().notices.at(-1);
      untracked(() => {
        if (!n || n === this.lastNotice) return;
        this.lastNotice = n;
        if (EDIT_ERRORS.has(n.code) && this.session) {
          this.session.discard();
          this.show(this.session.text);
          this.saved.set(true);
        }
      });
    });
  }

  private follow(d: DraftSnapshot | undefined, me: string | undefined): void {
    if (!d || !me) {
      this.session = undefined;
      this.sessionKey = '';
      return;
    }
    const key = `${me}\0${d.id}`;
    if (!this.session || this.sessionKey !== key) {
      clearTimeout(this.sendTimer);
      // Random as well as numbered: two tabs of one player must not mint the same id, or the server would drop one edit.
      const tab = Math.random().toString(36).slice(2, 8);
      this.session = new DraftSession(me, d, (n) => `e${tab}${n}`);
      this.sessionKey = key;
      this.text.set(d.text);
      this.saved.set(true);
      this.confirmMerge.set(false);
      return;
    }
    const before = this.editor()?.nativeElement;
    const start = before?.selectionStart ?? 0;
    const end = before?.selectionEnd ?? 0;
    const ops = this.session.sync(d);
    if (ops.length > 0 || this.session.text !== this.text()) {
      this.show(this.session.text, moveIndex(start, ops), moveIndex(end, ops));
    }
    this.pump();
  }

  /** Put `value` in the editor, keeping the caret where `start`/`end` say. */
  private show(value: string, start?: number, end?: number): void {
    this.text.set(value);
    const ta = this.editor()?.nativeElement;
    if (!ta) return;
    ta.value = value;
    if (start !== undefined && end !== undefined && document.activeElement === ta)
      ta.setSelectionRange(Math.min(start, value.length), Math.min(end, value.length));
  }

  protected onInput(value: string): void {
    const session = this.session;
    if (!session || this.readOnly()) return;
    session.input(value);
    this.text.set(value);
    this.saved.set(false);
    clearTimeout(this.sendTimer);
    this.sendTimer = setTimeout(() => this.pump(), SEND_AFTER_MS);
  }

  /** Send the typed text if nothing is in flight. */
  protected pump(): void {
    const session = this.session;
    const id = this.selected()?.id;
    if (!session || !id) return;
    clearTimeout(this.sendTimer);
    const e = session.flush();
    // With the link down the edit stays in flight and goes again when it returns.
    if (e) this.game.draftEdit(id, e);
    this.saved.set(session.saved);
  }

  private announce(d: DraftSnapshot | undefined): void {
    if (!d) return;
    const seen = this.seenEntries.get(d.id);
    this.seenEntries.set(d.id, d.history.length);
    if (seen === undefined) return;
    const me = this.me();
    const fresh = d.history.slice(seen).filter((e) => {
      const by = e.kind === 'comment' ? e.comment.author : e.author;
      return by !== me;
    });
    const last = fresh.at(-1);
    if (!last) return;
    const by = this.name(last.kind === 'comment' ? last.comment.author : last.author);
    this.announcement.set(
      last.kind === 'comment' ? `${by} commented.` : `${by} changed the draft.`,
    );
  }

  protected choose(id: string): void {
    this.pump();
    this.chosen.set(id);
    this.mode.set('edit');
  }

  protected newDraft(): void {
    const id = this.newId('d');
    if (!this.game.createDraft(id, { title: `Draft ${this.drafts().length + 1}` })) {
      this.problem.set('Not connected. Try again when the link is back.');
      return;
    }
    this.problem.set('');
    this.chosen.set(id);
  }

  protected fork(): void {
    const d = this.selected();
    if (!d) return;
    this.pump();
    const id = this.newId('d');
    if (!this.game.forkDraft(d.id, id)) {
      this.problem.set('Not connected. Try again when the link is back.');
      return;
    }
    this.problem.set('');
    this.chosen.set(id);
  }

  protected merge(): void {
    const d = this.selected();
    if (!d) return;
    if (!this.confirmMerge()) {
      this.confirmMerge.set(true);
      return;
    }
    this.confirmMerge.set(false);
    this.pump();
    if (!this.game.mergeDraft(d.id))
      this.problem.set('Not connected. Try again when the link is back.');
    else this.problem.set('');
  }

  protected use(): void {
    const d = this.selected();
    if (d) this.useDraft.emit(this.session?.text ?? d.text);
  }

  protected addComment(): void {
    const d = this.selected();
    const ta = this.editor()?.nativeElement;
    const body = this.commentBody().trim();
    if (!d || !ta || body === '' || !this.session?.saved) return;
    const from = Math.min(ta.selectionStart, ta.selectionEnd);
    const to = Math.max(ta.selectionStart, ta.selectionEnd);
    if (!this.game.draftComment(d.id, this.session.rev, { id: this.newId('c'), from, to, body })) {
      this.problem.set('Not connected. Try again when the link is back.');
      return;
    }
    this.problem.set('');
    this.commentBody.set('');
  }

  protected sendReply(rootId: string): void {
    const d = this.selected();
    const body = this.replyBody().trim();
    if (!d || body === '' || !this.session) return;
    const root = d.comments.find((c) => c.id === rootId);
    if (!root) return;
    const ok = this.game.draftComment(d.id, this.session.rev, {
      id: this.newId('c'),
      from: root.from,
      to: root.to,
      body,
      replyTo: rootId,
    });
    if (!ok) {
      this.problem.set('Not connected. Try again when the link is back.');
      return;
    }
    this.problem.set('');
    this.replyBody.set('');
    this.replyTo.set(undefined);
  }

  protected resolve(commentId: string, resolved: boolean): void {
    const d = this.selected();
    if (d) this.game.resolveComment(d.id, commentId, resolved);
  }

  /** Select the stretch of text a comment is about. */
  protected showInText(from: number, to: number): void {
    this.mode.set('edit');
    const find = (): void => {
      const ta = this.editor()?.nativeElement;
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(Math.min(from, ta.value.length), Math.min(to, ta.value.length));
    };
    // The editor is not in the page while the tracked view shows.
    if (this.editor()) find();
    else queueMicrotask(() => setTimeout(find));
  }

  protected excerpt(from: number, to: number): string {
    const t = this.selected()?.text ?? '';
    if (from === to) return 'a point in the text';
    const s = t.slice(from, to);
    return `“${s.length > 60 ? `${s.slice(0, 60)}…` : s}”`;
  }

  protected title(d: DraftSnapshot): string {
    return draftTitle(d, this.drafts().indexOf(d));
  }

  protected unread(d: DraftSnapshot): number {
    const me = this.me();
    return me ? unreadCount(d, me) : 0;
  }

  protected viewers(d: DraftSnapshot): string[] {
    const p = this.state().draftPresence;
    return p
      ? p.people.filter((x) => x.id !== p.you && x.drafts.includes(d.id)).map((x) => x.label)
      : [];
  }

  protected time(at: number): string {
    return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  protected dismiss(): void {
    this.dismissed.set(this.state().notices.at(-1));
    this.problem.set('');
  }

  protected readonly length = computed(() => this.text().length);

  private newId(prefix: string): string {
    return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}${(++this.seq).toString(36)}`;
  }
}
