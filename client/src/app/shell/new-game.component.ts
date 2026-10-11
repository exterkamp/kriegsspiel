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
  OPPONENT_LABEL,
  allowedSides,
  chooseScenario,
  initialForm,
  lengthLine,
  rateExplanation,
  rateOf,
  toRequest,
  validate,
  type CreateRequest,
  type Form,
  type ScenarioOptions,
} from '@legacy/shell/newGame';
import { PAGE_CSS } from './page-styles';

/** Scenario, side and clock rate, then Start. The rules (defaults, validation, the request) are `shell/newGame.ts`. */
@Component({
  selector: 'ks-new-game',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <main>
        <h1>New game</h1>
        @if (loadError()) {
          <p role="alert" class="err">{{ loadError() }}</p>
        } @else if (!options() || !form() || !scenario()) {
          <p role="status" class="muted">Loading scenarios…</p>
        } @else {
          <form (submit)="start($event)" aria-label="New game">
            <fieldset>
              <legend>Scenario</legend>
              @for (s of options()!.scenarios; track s.id) {
                <label class="choice">
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
              <p class="muted">Sides: {{ sideNames() }}. {{ length() }}</p>
            </fieldset>

            <fieldset>
              <legend>Your side</legend>
              @for (s of sides(); track s.id) {
                <label class="choice">
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
              @if (opponentLabel()) {
                <p class="muted">{{ opponentLabel() }}</p>
              }
            </fieldset>

            <fieldset>
              <legend>Clock rate</legend>
              @for (r of presets; track r) {
                <label class="choice">
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
              <label class="choice">
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
              <p class="muted" role="status">{{ rateLine() }}</p>
            </fieldset>

            @if (error()) {
              <p role="alert" class="err">{{ error() }}</p>
            }
            @if (starting()) {
              <p class="muted" role="status">Starting the game…</p>
            }

            <div class="actions">
              <button type="submit" class="primary" [attr.aria-disabled]="starting()">
                {{ starting() ? 'Starting…' : 'Start' }}
              </button>
              <button type="button" (click)="back.emit()">Back</button>
            </div>
          </form>
        }
        @if (loadError()) {
          <div class="actions"><button type="button" (click)="back.emit()">Back</button></div>
        }
      </main>
    </div>
  `,
  styles: [
    PAGE_CSS,
    `
      h1 {
        font-size: 2rem;
      }
      fieldset {
        border: 1px solid #8a7a52;
        margin: 0 0 16px;
        padding: 8px 12px 12px;
      }
      legend {
        font-weight: bold;
      }
      .choice {
        display: block;
        padding: 6px 0;
      }
      input[type='text'] {
        display: block;
        font: inherit;
        padding: 6px;
        margin-top: 4px;
        width: 8em;
      }
      .actions {
        display: flex;
        gap: 12px;
      }
    `,
  ],
})
export class NewGameComponent implements OnInit {
  readonly load = input.required<() => Promise<ScenarioOptions>>();
  /** Makes the game; resolves to its id, or throws an Error whose message is shown. */
  readonly create = input.required<(req: CreateRequest) => Promise<string>>();
  readonly started = output<string>();
  readonly back = output();
  protected readonly presets = ['1', '4', '12'];
  protected readonly options = signal<ScenarioOptions | undefined>(undefined);
  protected readonly form = signal<Form | undefined>(undefined);
  protected readonly loadError = signal<string | undefined>(undefined);
  protected readonly error = signal<string | undefined>(undefined);
  protected readonly starting = signal(false);
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
    return s ? lengthLine(s.lengthMinutes, this.rate()) : '';
  });
  protected readonly opponentLabel = computed(() => {
    const o = this.options()?.opponent;
    return o ? OPPONENT_LABEL[o] : undefined;
  });
  protected readonly rateLine = computed(() => {
    const r = this.rate();
    return r !== undefined ? rateExplanation(r) : 'Enter a ratio such as 6 or 6:1.';
  });
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
    const next = chooseScenario(this.options()!, id);
    if (next) this.form.set(next);
  }

  protected patch(p: Partial<Form>): void {
    this.form.update((f) => (f ? { ...f, ...p } : f));
  }

  protected async start(e: Event): Promise<void> {
    e.preventDefault();
    const options = this.options();
    const form = this.form();
    if (this.busy || !options || !form) return;
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
