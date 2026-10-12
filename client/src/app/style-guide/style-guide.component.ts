import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { ModalComponent } from '../ui/modal.component';
import { isHighContrast, setHighContrast } from '../ui/contrast';
import { PageFrameComponent } from '../ui/page-frame.component';

interface Swatch {
  name: string;
  on: string;
}

/** Tokens shown as swatches: the name, and the token to write its label in so the label stays readable. */
const SWATCHES: Swatch[] = [
  { name: '--ks-ink', on: '--ks-paper' },
  { name: '--ks-ink-muted', on: '--ks-paper' },
  { name: '--ks-paper', on: '--ks-ink' },
  { name: '--ks-paper-raised', on: '--ks-ink' },
  { name: '--ks-paper-control', on: '--ks-ink' },
  { name: '--ks-paper-sunk', on: '--ks-ink' },
  { name: '--ks-rule', on: '--ks-paper' },
  { name: '--ks-brass', on: '--ks-ink' },
  { name: '--ks-brass-hi', on: '--ks-ink' },
  { name: '--ks-wax', on: '--ks-paper' },
  { name: '--ks-ok', on: '--ks-paper' },
  { name: '--ks-warn', on: '--ks-paper' },
  { name: '--ks-info', on: '--ks-paper' },
  { name: '--ks-table', on: '--ks-on-overlay' },
  { name: '--ks-night-panel', on: '--ks-on-overlay' },
];

/**
 * The living style guide (#327), at `/style-guide`: the tokens and every shared control in each state, so the look
 * can be reviewed in one place. Each section is an example of how to write the markup.
 */
@Component({
  selector: 'ks-style-guide',
  imports: [PageFrameComponent, ModalComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'ks-theme' },
  template: `
    <ks-page-frame heading="Style guide" [back]="true" (backClick)="home()">
      <p class="ks-muted">
        Tokens live in <code>src/styles/tokens.css</code>, shared controls in
        <code>src/styles/ui.css</code>. Controls apply under an element with the
        <code>ks-theme</code> class.
      </p>
      <p>
        <button type="button" [attr.aria-pressed]="high()" (click)="toggleContrast()">
          High contrast
        </button>
      </p>

      <section aria-labelledby="sg-colour">
        <h2 id="sg-colour">Colour tokens</h2>
        <ul class="swatches ks-stack">
          @for (s of swatches; track s.name) {
            <li
              class="swatch"
              [style.background]="'var(' + s.name + ')'"
              [style.color]="'var(' + s.on + ')'"
            >
              {{ s.name }}
            </li>
          }
        </ul>
      </section>

      <section aria-labelledby="sg-type">
        <h2 id="sg-type">Type, space and shape</h2>
        <h1>Title (--ks-text-title)</h1>
        <h2>Heading (--ks-text-lg)</h2>
        <p>Body text in the serif face (--ks-font, --ks-text-md).</p>
        <p class="ks-muted">Muted text (--ks-text-muted).</p>
        <p class="mono">Data and logs in the mono face (--ks-font-mono).</p>
        <p class="ks-muted">
          Space scale: --ks-space-1 to --ks-space-6 (4, 8, 12, 16, 24, 32px). Radius: --ks-radius.
          Motion: --ks-move, short and switched off under reduced motion.
        </p>
      </section>

      <section aria-labelledby="sg-buttons">
        <h2 id="sg-buttons">Buttons</h2>
        <div class="ks-cluster">
          <button type="button" class="ks-primary">Primary</button>
          <button type="button">Secondary</button>
          <button type="button" class="ks-quiet">Quiet</button>
          <button type="button" class="ks-danger">Danger</button>
          <button type="button" aria-pressed="true">Pressed</button>
          <button type="button" disabled>Disabled</button>
          <a href="/style-guide" class="ks-btn">Link as button</a>
        </div>
      </section>

      <section aria-labelledby="sg-fields">
        <h2 id="sg-fields">Form fields</h2>
        <label class="ks-field">
          Text input
          <input type="text" value="Hold the bridge" />
          <span class="ks-hint">A hint says what is expected.</span>
        </label>
        <label class="ks-field">
          Select
          <select>
            <option>1st Battalion</option>
            <option>2nd Battalion</option>
          </select>
        </label>
        <label class="ks-field">
          Textarea
          <textarea rows="2">Advance to the ford.</textarea>
        </label>
        <label class="ks-field">
          With an error
          <input type="text" aria-invalid="true" aria-describedby="sg-err" value="x" />
          <span id="sg-err" class="ks-error" role="alert">Say where the battalion should go.</span>
        </label>
        <fieldset>
          <legend>Radios and checks</legend>
          <label><input type="radio" name="sg" checked /> One</label>
          <label><input type="radio" name="sg" /> Two</label>
          <label><input type="checkbox" checked /> A check</label>
        </fieldset>
      </section>

      <section aria-labelledby="sg-surfaces">
        <h2 id="sg-surfaces">Panels, papers, rows and badges</h2>
        <div class="ks-panel">Panel: a bordered box on the page.</div>
        <br />
        <div class="ks-paper">Paper: a sheet on the desk, with a shadow.</div>
        <br />
        <div class="ks-overlay">Overlay: a dark strip over the table (clock, marks).</div>
        <br />
        <ul class="ks-stack">
          <li class="ks-row">
            <b>Hold the Bridge</b> <span>blue</span> <span class="ks-muted">played just now</span>
          </li>
          <li class="ks-row">
            <b>Second row</b> <span class="ks-badge">3</span>
            <span class="ks-badge ks-quiet-badge">quiet</span>
          </li>
        </ul>
      </section>

      <section aria-labelledby="sg-tabs">
        <h2 id="sg-tabs">Tabs</h2>
        <div class="ks-tabs" role="group" aria-label="Example tabs">
          @for (t of tabs; track t) {
            <button type="button" [attr.aria-pressed]="tab() === t" (click)="tab.set(t)">
              {{ t }}
            </button>
          }
        </div>
        <p>Showing {{ tab() }}.</p>
      </section>

      <section aria-labelledby="sg-status">
        <h2 id="sg-status">Status messages</h2>
        <p class="ks-status" role="status">Info: Looking for your games…</p>
        <p class="ks-status ks-ok" role="status">Done: Order signed and sent.</p>
        <p class="ks-status ks-warn" role="status">Warning: Connection lost, retrying…</p>
        <p class="ks-status ks-error" role="alert">Error: The game could not be started.</p>
      </section>

      <section aria-labelledby="sg-modal">
        <h2 id="sg-modal">Modal dialog</h2>
        <button type="button" (click)="modal.set(true)">Open the dialog</button>
        @if (modal()) {
          <ks-modal heading="Example dialog" labelId="sg-modal-h">
            <p>A dialog moves focus in and keeps Tab inside until it closes.</p>
            <button type="button" (click)="modal.set(false)">Close</button>
          </ks-modal>
        }
      </section>
    </ks-page-frame>
  `,
  styles: `
    .swatch {
      padding: var(--ks-space-2) var(--ks-space-3);
      border: 1px solid var(--ks-rule);
      font-family: var(--ks-font-mono);
      font-size: var(--ks-text-sm);
    }
    .mono {
      font-family: var(--ks-font-mono);
    }
    section {
      margin-top: var(--ks-space-5);
    }
    h1 {
      font-size: var(--ks-text-xl);
    }
  `,
})
export class StyleGuideComponent {
  protected readonly swatches = SWATCHES;
  protected readonly tabs = ['In-tray', 'Orders', 'Journal'];
  protected readonly tab = signal('In-tray');
  protected readonly modal = signal(false);
  protected readonly high = signal(isHighContrast());

  protected toggleContrast(): void {
    setHighContrast(!this.high());
    this.high.set(isHighContrast());
  }

  protected home(): void {
    location.assign('/');
  }
}
