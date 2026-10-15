import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import {
  DIAL_CHOICES,
  MODE_CHOICES,
  OPPONENT_LABEL,
  PERSONA_CHOICES,
  allowedSides,
  chooseScenario,
  initialForm,
  lengthLine,
  rateExplanation,
  rateOf,
  toRequest,
  TURN_DIAL_INFO,
  turnMinutesOf,
  turnsLine,
  validate,
  type CreateRequest,
  type Form,
  type ScenarioOptions,
} from '@legacy/shell/newGame';
import { GameListComponent } from '../lobby/game-list.component';
import { PageFrameComponent } from '../ui/page-frame.component';
import { BattlefieldMapComponent } from '../lobby/battlefield-map/battlefield-map.component';

/** Scenario-first live setup; map inspection is separately gated from the existing creation request. */
@Component({
  selector: 'ks-new-game',
  imports: [PageFrameComponent, GameListComponent, BattlefieldMapComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ks-page-frame heading="New game" [back]="true" (backClick)="goBack()">
      @if (loadError()) {
        <p role="alert" class="ks-status ks-error">{{ loadError() }}</p>
      } @else if (!options() || !form() || !scenario()) {
        <p role="status" class="ks-muted">Loading scenarios…</p>
      } @else {
        <form (submit)="start($event)" aria-label="New game">
          <fieldset [disabled]="starting()">
            <legend>Scenario</legend>
            @for (s of options()!.scenarios; track s.id) {
              <label class="ks-choice">
                <input
                  type="radio"
                  name="scenario"
                  [value]="s.id"
                  [checked]="form()!.scenario === s.id"
                  (change)="pick(s.id)"
                />
                <b>{{ s.name }}</b>
              </label>
            }
            <p>{{ scenario()!.briefing }}</p>
            <p class="ks-muted">Sides: {{ sideNames() }}. {{ length() }}</p>
          </fieldset>

          @if (scenario()!.battlefield; as battlefield) {
            <ks-battlefield-map
              [battlefield]="battlefield"
              [scenarioName]="scenario()!.name"
              [canOpen]="canInspectMap"
              (activeChange)="mapDialogOpen.set($event)"
            />
          } @else {
            <fieldset [disabled]="starting()">
              <legend>Battlefield map</legend>
              <p>The scenario's default battlefield will be used.</p>
              <p class="ks-muted">Map previews are not available on this server.</p>
            </fieldset>
          }

          <fieldset [disabled]="starting()">
            <legend>Your side</legend>
            @if (sides().length === 1) {
              <p class="side-only">{{ sides()[0]!.name }}</p>
            } @else {
              @for (s of sides(); track s.id) {
                <label class="ks-choice">
                  <input
                    type="radio"
                    name="side"
                    [value]="s.id"
                    [checked]="form()!.side === s.id"
                    (change)="patch({ side: s.id })"
                  />
                  {{ s.name }}
                </label>
              }
            }
            @if (opponentLabel()) {
              <p class="ks-muted">{{ opponentLabel() }}</p>
            }
          </fieldset>

          <fieldset [disabled]="starting()">
            <legend>How the game is played</legend>
            @for (m of modes; track m.id) {
              <label class="ks-choice">
                <input
                  type="radio"
                  name="mode"
                  [value]="m.id"
                  [checked]="form()!.mode === m.id"
                  (change)="patch({ mode: m.id })"
                />
                <b>{{ m.label }}</b>
              </label>
            }
            <p class="ks-muted" role="status">{{ modeLine() }}</p>
          </fieldset>

          @if (form()!.mode === 'turns') {
            <fieldset [disabled]="starting()">
              <legend>Turns</legend>
              <label class="ks-field">
                Game minutes per turn
                <input
                  type="number"
                  id="turn-minutes"
                  inputmode="numeric"
                  min="5"
                  max="60"
                  step="5"
                  [value]="form()!.turnMinutes"
                  (input)="patch({ turnMinutes: $any($event.target).value })"
                />
              </label>
              <label class="ks-field">
                Orders due within (hours, optional)
                <input
                  type="text"
                  id="turn-deadline"
                  inputmode="decimal"
                  placeholder="no deadline"
                  aria-describedby="turn-deadline-hint"
                  [value]="form()!.deadlineHours"
                  (input)="patch({ deadlineHours: $any($event.target).value })"
                />
              </label>
              <p class="ks-muted" id="turn-deadline-hint">
                With no deadline a turn waits until every side has sent its orders. With one, the
                turn is decided when it passes, and a side that has not sent keeps its units on
                their last orders.
              </p>
            </fieldset>
          } @else {
            <fieldset [disabled]="starting()">
              <legend>Clock rate</legend>
              @for (r of presets; track r) {
                <label class="ks-choice">
                  <input
                    type="radio"
                    name="rate"
                    [value]="r"
                    [checked]="form()!.rate === r"
                    (change)="patch({ rate: r })"
                  />
                  {{ r }}:1
                </label>
              }
              <label class="ks-choice">
                <input
                  type="radio"
                  name="rate"
                  value="custom"
                  [checked]="form()!.rate === 'custom'"
                  (change)="patch({ rate: 'custom' })"
                />
                Custom
              </label>
              @if (form()!.rate === 'custom') {
                <label>
                  Battle hours per real hour
                  <input
                    type="text"
                    inputmode="decimal"
                    aria-label="Custom clock rate"
                    [value]="form()!.customRate"
                    (input)="patch({ customRate: $any($event.target).value })"
                  />
                </label>
              }
              <p class="ks-muted" role="status">{{ rateLine() }}</p>
            </fieldset>
          }

          <fieldset [disabled]="starting()">
            <legend>
              {{
                form()!.mode === 'turns'
                  ? 'Who decides each turn'
                  : 'How strictly the umpire follows the rules'
              }}
            </legend>
            @for (d of dials; track d.id) {
              <label class="ks-choice">
                <input
                  type="radio"
                  name="dial"
                  [value]="d.id"
                  [checked]="form()!.dial === d.id"
                  (change)="patch({ dial: d.id })"
                />
                <b>{{ d.label }}</b>
              </label>
            }
            <p class="ks-muted" role="status">{{ dialLine() }}</p>
          </fieldset>

          <fieldset [disabled]="starting()">
            <legend>Umpire's manner</legend>
            @for (p of personas; track p.id) {
              <label class="ks-choice">
                <input
                  type="radio"
                  name="persona"
                  [value]="p.id"
                  [checked]="form()!.persona === p.id"
                  (change)="patch({ persona: p.id })"
                />
                <b>{{ p.label }}</b>
              </label>
            }
            <p class="ks-muted" role="status">{{ personaLine() }}</p>
            <p class="ks-muted">
              The manner changes only how the umpire writes, never what happens.
            </p>
          </fieldset>

          @if (error()) {
            <p role="alert" class="ks-status ks-error">{{ error() }}</p>
          }
          @if (starting()) {
            <p class="ks-muted" role="status">Starting the game…</p>
          }

          <div class="ks-actions actions">
            <button
              type="submit"
              class="ks-primary"
              [attr.aria-disabled]="starting() || mapDialogOpen()"
            >
              {{ starting() ? 'Starting game…' : 'Start game' }}
            </button>
            <button type="button" (click)="goBack()">Back</button>
          </div>
        </form>
      }
      <ks-game-list class="ks-panel games" />
      @if (loadError()) {
        <div class="ks-actions"><button type="button" (click)="goBack()">Back</button></div>
      }
    </ks-page-frame>
  `,
  styles: `
    :host {
      display: block;
    }
    .games {
      margin-top: var(--ks-space-5);
    }
    input[type='text'],
    input[type='number'] {
      display: block;
      margin-top: 4px;
      width: 8em;
    }
    /* Start stays in view while the form is longer than the window (#323). */
    form .actions {
      margin-top: var(--ks-space-3);
      position: sticky;
      bottom: 0;
      padding: 10px 0;
      background: var(--ks-paper-page-lo);
      border-top: 1px solid var(--ks-rule);
    }
  `,
})
export class NewGameComponent implements OnInit {
  readonly load = input.required<() => Promise<ScenarioOptions>>();
  /** Makes the game; resolves to its id, or throws an Error whose message is shown. */
  readonly create = input.required<(req: CreateRequest) => Promise<string>>();
  readonly started = output<string>();
  readonly back = output();
  protected readonly presets = ['1', '4', '12'];
  protected readonly dials = DIAL_CHOICES;
  protected readonly modes = MODE_CHOICES;
  protected readonly personas = PERSONA_CHOICES;
  protected readonly options = signal<ScenarioOptions | undefined>(undefined);
  protected readonly form = signal<Form | undefined>(undefined);
  protected readonly loadError = signal<string | undefined>(undefined);
  protected readonly error = signal<string | undefined>(undefined);
  protected readonly starting = signal(false);
  protected readonly mapDialogOpen = signal(false);
  protected readonly canInspectMap = () => !this.starting();
  protected readonly scenario = computed(() =>
    this.options()?.scenarios.find((s) => s.id === this.form()?.scenario),
  );
  private readonly rate = computed(() => {
    const f = this.form();
    return f ? rateOf(f) : undefined;
  });
  protected readonly sides = computed(() => {
    const s = this.scenario();
    const o = this.options();
    return s && o ? allowedSides(s, o.opponent) : [];
  });
  protected readonly sideNames = computed(() =>
    this.scenario()
      ?.sides.map((s) => s.name)
      .join(' and '),
  );
  protected readonly length = computed(() => {
    const s = this.scenario();
    const f = this.form();
    if (!s) return '';
    return f?.mode === 'turns'
      ? turnsLine(s.lengthMinutes, turnMinutesOf(f))
      : lengthLine(s.lengthMinutes, this.rate());
  });
  protected readonly modeLine = computed(
    () => MODE_CHOICES.find((m) => m.id === this.form()?.mode)?.description ?? '',
  );
  protected readonly opponentLabel = computed(() => {
    const o = this.options()?.opponent;
    return o ? OPPONENT_LABEL[o] : undefined;
  });
  protected readonly rateLine = computed(() => {
    const r = this.rate();
    return r !== undefined ? rateExplanation(r) : 'Enter a ratio such as 6 or 6:1.';
  });
  protected readonly dialLine = computed(() => {
    const f = this.form();
    if (!f) return '';
    if (f.mode === 'turns') return TURN_DIAL_INFO[f.dial];
    return DIAL_CHOICES.find((d) => d.id === f.dial)?.description ?? '';
  });
  protected readonly personaLine = computed(
    () => PERSONA_CHOICES.find((p) => p.id === this.form()?.persona)?.description ?? '',
  );
  private busy = false;

  ngOnInit(): void {
    this.load()().then(
      (o) => {
        this.options.set(o);
        const f = initialForm(o);
        this.form.set(f);
        if (!f) this.loadError.set('This server has no scenarios.');
      },
      (e: unknown) => this.loadError.set(e instanceof Error ? e.message : String(e)),
    );
  }

  protected pick(id: string): void {
    if (this.mapDialogOpen() || this.busy) return;
    const next = chooseScenario(this.options()!, id, this.form());
    if (next) this.form.set(next);
  }

  protected patch(p: Partial<Form>): void {
    if (this.mapDialogOpen() || this.busy) return;
    this.form.update((f) => (f ? { ...f, ...p } : f));
  }

  protected goBack(): void {
    if (!this.mapDialogOpen() && !this.busy) this.back.emit();
  }

  protected async start(e: Event): Promise<void> {
    e.preventDefault();
    const options = this.options();
    const form = this.form();
    if (this.busy || this.mapDialogOpen() || !options || !form) return;
    const problem = validate(form, options);
    if (problem) {
      this.error.set(problem);
      return;
    }
    this.busy = true;
    this.starting.set(true);
    this.error.set(undefined);
    try {
      this.started.emit(await this.create()(toRequest(form, options)));
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : String(err));
      this.busy = false;
      this.starting.set(false);
    }
  }
}
