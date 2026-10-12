import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { formatGameTime, gameNowMs } from '@legacy/net/state';
import {
  CONFERENCE_ROLES,
  MAX_QUESTION_LENGTH,
  busy,
  formatCost,
  isPending,
  newExchange,
  officerFor,
  nextExchangeId,
  applyServerAnswers,
  settleTextless,
  questionProblem,
  reconcileExchanges,
  staffFor,
  type ConferenceRole,
} from '@legacy/desk/conference';
import { GameService } from '../../game/game.service';
import { CONFERENCE_SENDER } from '../../game/ports';
import { DeskStore } from '../desk.store';

/** The staff conference (port of `desk/Conference.svelte`). Rules and fixture answers stay in `desk/conference.ts`. */
@Component({
  selector: 'ks-conference',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './conference.component.html',
  styleUrl: './conference.component.css',
})
export class ConferenceComponent {
  private readonly game = inject(GameService);
  private readonly desk = inject(DeskStore);
  private readonly sender = inject(CONFERENCE_SENDER);

  protected readonly roles = CONFERENCE_ROLES;
  protected readonly maxLength = MAX_QUESTION_LENGTH;
  protected readonly role = signal<ConferenceRole>('chiefOfStaff');
  protected readonly question = signal('');
  protected readonly error = signal<string | undefined>(undefined);
  protected readonly staffFor = staffFor;
  protected readonly formatCost = formatCost;
  protected readonly formatGameTime = formatGameTime;
  protected readonly isPending = isPending;

  // Answers arrive in game time, so the log re-reads the clock now and then.
  private readonly opened = Date.now();
  private readonly wall = signal(this.opened);
  // With no server clock (the offline fixture) game time runs 1:1 from the view's time.
  protected readonly nowGame = computed(() => {
    const s = this.game.state();
    return s.clock
      ? gameNowMs(s.clock, this.wall())
      : (s.view?.atGame ?? 0) + (this.wall() - this.opened);
  });
  protected readonly officer = computed(() => officerFor(this.desk.conferenceLog(), this.role()));
  protected readonly log = computed(() =>
    this.desk.conferenceLog().filter((e) => e.role === this.role()),
  );

  constructor() {
    const t = setInterval(() => this.wall.set(Date.now()), 1000);
    inject(DestroyRef).onDestroy(() => clearInterval(t));

    // Take the cost from the server's reply: it decides when the officer answers, not this page.
    // The exchange carries its own question id, so this works across remounts of the view.
    effect(() => {
      const { staffCharges: charges, link, staffFaultAtWall: faultAtWall } = this.game.state();
      const nowWall = this.wall();
      untracked(() =>
        this.desk.conferenceLog.update((l) =>
          reconcileExchanges(l, { charges, link, faultAtWall, nowWall }),
        ),
      );
    });

    // The umpire writes the answer; it is shown once game time reaches the exchange's answer time.
    effect(() => {
      const { staffAnswers: answers } = this.game.state();
      untracked(() => this.desk.conferenceLog.update((l) => applyServerAnswers(l, answers)));
    });

    // A reply with no text is answered from the newest view when the answer falls due.
    effect(() => {
      const nowGame = this.nowGame();
      const { view } = this.game.state();
      untracked(() => this.desk.conferenceLog.update((l) => settleTextless(l, nowGame, view)));
    });
  }

  protected busy(r: ConferenceRole): boolean {
    return busy(this.desk.conferenceLog(), r, this.nowGame());
  }

  protected choose(r: ConferenceRole): void {
    this.role.set(r);
    this.error.set(undefined);
  }

  protected ask(e: Event): void {
    e.preventDefault();
    const role = this.role();
    const nowGame = this.nowGame();
    const problem = questionProblem(this.question(), role, this.desk.conferenceLog(), nowGame);
    this.error.set(problem);
    if (problem) return;
    const state = this.game.state();
    const req = { role, question: this.question().trim(), askedAtGame: nowGame };
    const ex = newExchange(nextExchangeId(this.desk.conferenceLog()), req);
    // Offline (the fixture board) there is no server to charge the cost, so the fixture does.
    if (state.link !== 'offline') {
      // The server charges the cost; the exchange waits for its reply (see the reconcile effect).
      const questionId = `q-${Date.now()}-${ex.id}`;
      if (!this.sender(questionId, role, req.question)) {
        this.error.set('Not connected. Try again when the link is back.');
        return;
      }
      ex.answerAtGame = Infinity;
      ex.questionId = questionId;
      ex.sentAtWall = Date.now();
    }
    this.desk.conferenceLog.update((l) => [...l, ex]);
    this.question.set('');
    // Online, the umpire answers (see the staffAnswer effect above); only the offline board answers itself.
    if (ex.questionId !== undefined) return;
    this.desk
      .conferenceClient()
      .ask(req, state.view)
      .then(
        (answer) =>
          this.desk.conferenceLog.update((l) =>
            l.map((x) => (x.id === ex.id ? { ...x, answer } : x)),
          ),
        () =>
          this.desk.conferenceLog.update((l) =>
            l.map((x) => (x.id === ex.id ? { ...x, failed: true } : x)),
          ),
      );
  }
}
