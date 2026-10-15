import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  AfterRenderRef,
  Component,
  ElementRef,
  Injector,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  computed,
  afterNextRender,
  input,
  inject,
  output,
  signal,
  viewChild,
} from '@angular/core';
import {
  decodeApprovedBattlefield,
  decodeBattlefieldCatalog,
  type ApprovedBattlefield,
  type BattlefieldCatalog,
  type ScenarioBattlefield,
} from '@kriegsspiel/protocol';
import { BattlefieldPreviewComponent } from './battlefield-preview.component';

const KINDS = new Set([
  'field',
  'wood',
  'marsh',
  'water',
  'road',
  'river',
  'stream',
  'bridge',
  'ford',
  'building',
]);
const TERRAIN_ID = /^engine-terrain-v1:sha256:[a-f0-9]{64}$/;
const SCENARIO_ID = /^engine-scenario-v1:sha256:[a-f0-9]{64}$/;
const HISTORY_KEY = '__ksBattlefield';
let nextOwner = 0;
type View = 'choose' | 'add' | 'view';
type Selection = { pairingId: string; revision: string };
type DisplayEntry = ScenarioBattlefield | ApprovedBattlefield;
type Entry = { owner: string; visit: number; view: View; depth: number };
type FocusReturn = {
  visit: number;
  opener: HTMLElement | null;
  url: string;
  scroll: { x: number; y: number };
};
const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const text = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;
const positive = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;
function selected(entry: DisplayEntry, value: unknown): boolean {
  const selection = record(value);
  const id = selection && Object.getOwnPropertyDescriptor(selection, 'pairingId');
  const revision = selection && Object.getOwnPropertyDescriptor(selection, 'revision');
  return (
    !!selection &&
    Object.keys(selection).length === 2 &&
    !!id &&
    'value' in id &&
    id.value === entry.pairing.id &&
    !!revision &&
    'value' in revision &&
    revision.value === entry.pairing.revision
  );
}

/** Check the public boundary before displaying readiness; never derive approval from terrain. */
function checked(value: unknown, name: unknown): ScenarioBattlefield | null {
  const data = record(value);
  const map = record(data?.['map']);
  const pairing = record(data?.['pairing']);
  const capability = record(data?.['capabilities']);
  if (
    !text(name) ||
    !map ||
    !pairing ||
    !capability ||
    typeof capability['addMaps'] !== 'boolean' ||
    !text(map['id']) ||
    !text(map['name']) ||
    map['source'] !== 'scenario-default' ||
    !text(map['terrainIdentity']) ||
    !TERRAIN_ID.test(map['terrainIdentity']) ||
    !positive(map['widthM']) ||
    !positive(map['heightM']) ||
    !Array.isArray(map['preview']) ||
    !text(pairing['scenarioId']) ||
    pairing['id'] !== map['id'] ||
    map['id'] !== `${pairing['scenarioId']}:default` ||
    pairing['terrainIdentity'] !== map['terrainIdentity'] ||
    !text(pairing['scenarioRevision']) ||
    !SCENARIO_ID.test(pairing['scenarioRevision']) ||
    pairing['revision'] !== pairing['scenarioRevision']
  )
    return null;

  const width = map['widthM'];
  const height = map['heightM'];
  const point = (value: unknown): boolean => {
    const p = record(value);
    return (
      !!p &&
      typeof p['x'] === 'number' &&
      Number.isFinite(p['x']) &&
      p['x'] >= 0 &&
      p['x'] <= width &&
      typeof p['y'] === 'number' &&
      Number.isFinite(p['y']) &&
      p['y'] >= 0 &&
      p['y'] <= height
    );
  };
  const ids = new Set<string>();
  for (const value of map['preview']) {
    const feature = record(value);
    const g = record(feature?.['geometry']);
    if (
      !feature ||
      !g ||
      !text(feature['id']) ||
      ids.has(feature['id']) ||
      typeof feature['kind'] !== 'string' ||
      !KINDS.has(feature['kind']) ||
      typeof feature['layer'] !== 'number' ||
      !Number.isSafeInteger(feature['layer']) ||
      (feature['name'] !== undefined && !text(feature['name']))
    )
      return null;
    ids.add(feature['id']);
    if (g['shape'] === 'point') {
      if (!point(g['at']) || !positive(g['radiusM'])) return null;
    } else if (g['shape'] === 'polygon' || g['shape'] === 'polyline') {
      if (!Array.isArray(g['points']) || g['points'].length < (g['shape'] === 'polygon' ? 3 : 2))
        return null;
      for (const p of g['points']) if (!point(p)) return null;
      if (g['shape'] === 'polyline' && !positive(g['widthM'])) return null;
    } else return null;
  }
  return value as ScenarioBattlefield;
}

/** Checked public map choices only. No requests, game mutations, library or master state. */
@Component({
  selector: 'ks-battlefield-map',
  standalone: true,
  imports: [BattlefieldPreviewComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './battlefield-map.component.html',
  styleUrl: './battlefield-map.component.css',
  host: { class: 'ks-theme' },
})
export class BattlefieldMapComponent implements OnChanges, OnDestroy {
  readonly battlefield = input.required<ScenarioBattlefield>();
  readonly scenarioName = input.required<string>();
  readonly scenarioId = input<string>();
  readonly catalog = input<BattlefieldCatalog>();
  readonly selection = input<Selection>();
  readonly canOpen = input<() => boolean>(() => true);
  readonly activeChange = output<boolean>();
  readonly selectionChange = output<ApprovedBattlefield>();
  protected readonly entryEnabled = computed(() => this.canOpen()());
  protected readonly modern = computed(
    () =>
      this.catalog() !== undefined ||
      this.scenarioId() !== undefined ||
      this.selection() !== undefined,
  );
  private readonly committed = signal<Selection | undefined>(undefined);
  private readonly candidateSelection = signal<Selection | undefined>(undefined);
  private readonly approvedCatalog = computed(() => {
    try {
      const parent = this.scenarioId();
      if (
        !text(this.scenarioName()) ||
        !text(parent) ||
        parent.length > 128 ||
        parent.trim() !== parent ||
        !/^[a-zA-Z0-9][a-zA-Z0-9:._-]*$/.test(parent)
      )
        return null;
      return decodeBattlefieldCatalog(this.catalog(), parent);
    } catch {
      return null;
    }
  });
  protected readonly data = computed(() => {
    // A malformed/older caller can omit even a required input at runtime.
    try {
      if (this.modern()) {
        const catalog = this.approvedCatalog();
        const selection = this.committed() ?? this.selection();
        return (
          catalog?.entries.find((entry) =>
            selection === undefined ? entry.isDefault : selected(entry, selection),
          ) ?? null
        );
      }
      return checked(this.battlefield(), this.scenarioName());
    } catch {
      return null;
    }
  });
  protected readonly choices = computed<readonly DisplayEntry[]>(() => {
    if (this.modern()) return this.approvedCatalog()?.entries ?? [];
    const entry = this.data();
    return entry ? [entry] : [];
  });
  protected readonly candidate = computed(
    () => this.choices().find((entry) => selected(entry, this.candidateSelection())) ?? null,
  );
  protected readonly displayed = computed(() => {
    const entry = this.view() === 'choose' ? this.candidate() : this.data();
    return entry ? [entry] : [];
  });
  protected readonly active = signal(false);
  protected readonly view = signal<View>('choose');
  protected readonly waiting = signal(false);
  protected readonly announcement = signal('');
  protected readonly modalError = signal('');
  protected readonly labelId = `ks-battlefield-${++nextOwner}`;
  protected readonly heading = computed(() =>
    this.view() === 'add'
      ? 'Add battlefield map'
      : this.view() === 'view'
        ? 'View battlefield map'
        : 'Choose battlefield map',
  );
  protected extent(entry: DisplayEntry): string {
    return `${entry.map.widthM / 1000} × ${entry.map.heightM / 1000} km`;
  }
  protected source(entry: DisplayEntry): string {
    return entry.map.source === 'scenario-default'
      ? 'Scenario default'
      : entry.map.source === 'included'
        ? 'Included map'
        : 'Your map';
  }
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly injector = inject(Injector);
  private readonly title = viewChild.required<ElementRef<HTMLElement>>('title');
  private readonly summaryTitle = viewChild.required<ElementRef<HTMLElement>>('summaryTitle');
  private readonly historyOwner = crypto.randomUUID();
  private opener: HTMLElement | null = null;
  private focusReturn: FocusReturn | undefined;
  private focusRequest: AfterRenderRef | undefined;
  private awaitingNativeClose = false;
  private readonly nativeCloseVisits: number[] = [];
  private openedUrl = '';
  private scroll = { x: 0, y: 0 };
  private visit = 0;
  private depth = 0;
  private closing = false;
  private pendingAnnouncement = '';
  private lastUse: Selection | undefined;
  private destroyed = false;
  private readonly onPop = (event: PopStateEvent): void => {
    const entry = this.ownEntry(event.state);
    if (this.destroyed) {
      // Settle a traversal already in flight during teardown without touching
      // destroyed Angular views or leaving an internal subview in history.
      if (entry) window.history.go(-entry.depth);
      else window.removeEventListener('popstate', this.onPop);
      return;
    }
    this.waiting.set(false);
    if (!this.active()) return;
    if (!entry) {
      this.finish(false);
      return;
    }
    this.depth = entry.depth;
    if (this.closing) {
      this.finish(true);
      return;
    }
    this.view.set(entry.view);
    this.focusTitle();
  };

  constructor() {
    window.addEventListener('popstate', this.onPop);
  }

  ngOnChanges(changes: SimpleChanges): void {
    const selectionChange = changes['selection'];
    const feedback =
      !!this.lastUse &&
      this.choices().some(
        (entry) => selected(entry, this.lastUse) && selected(entry, this.selection()),
      );
    // A parent acknowledging Use is not a new picker lifetime. In particular it
    // must not clear the pending announcement or start a second history unwind.
    if (selectionChange) this.committed.set(undefined);
    if (Object.keys(changes).every((key) => key === 'selection') && feedback) return;
    this.committed.set(undefined);
    this.lastUse = undefined;
    // A replacement invalidates the entire picker lifetime, even if IDs are reused.
    if (this.active()) this.finish(true);
    this.pendingAnnouncement = '';
    this.announcement.set('');
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.focusRequest?.destroy();
    this.focusReturn = undefined;
    if (this.active()) this.finish(true);
    if (!this.waiting()) window.removeEventListener('popstate', this.onPop);
  }

  protected open(view: View, event: Event): void {
    event.stopPropagation();
    if (
      this.destroyed ||
      this.active() ||
      this.waiting() ||
      !this.entryEnabled() ||
      (view === 'choose' && !this.choices().length) ||
      (view === 'view' && !this.data())
    )
      return;
    this.focusRequest?.destroy();
    this.focusReturn = undefined;
    this.awaitingNativeClose = false;
    this.opener = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    this.openedUrl = window.location.href;
    this.scroll = { x: window.scrollX, y: window.scrollY };
    this.visit++;
    this.depth = 1;
    this.closing = false;
    const initial =
      this.data() ?? this.choices().find((entry) => 'isDefault' in entry && entry.isDefault);
    this.candidateSelection.set(
      initial ? { pairingId: initial.pairing.id, revision: initial.pairing.revision } : undefined,
    );
    this.view.set(view);
    this.announcement.set('');
    this.pendingAnnouncement = '';
    this.modalError.set('');
    // The parent must gate even synthetic submissions before native modal focus moves.
    this.active.set(true);
    this.activeChange.emit(true);
    try {
      this.push(view, 1);
      this.dialog().nativeElement.showModal();
      this.focusTitle();
    } catch {
      this.modalError.set('The map could not be opened. Please try again.');
      this.finish(true);
    }
  }

  protected add(): void {
    if (!this.active() || this.waiting() || this.view() !== 'choose') return;
    this.push('add', this.depth + 1);
    this.depth++;
    this.view.set('add');
    this.focusTitle();
  }

  protected backToMaps(): void {
    if (!this.active() || this.waiting() || this.view() !== 'add') return;
    if (this.depth > 1) {
      this.waiting.set(true);
      window.history.back();
    } else {
      this.view.set('choose');
      this.replace('choose');
      this.focusTitle();
    }
  }

  protected use(): void {
    const candidate = this.candidate();
    if (
      !this.active() ||
      this.waiting() ||
      this.closing ||
      !this.entryEnabled() ||
      this.view() !== 'choose' ||
      !candidate
    )
      return;
    const entry = this.modern() ? decodeApprovedBattlefield(candidate, this.scenarioId()!) : null;
    if (entry) {
      this.lastUse = { pairingId: entry.pairing.id, revision: entry.pairing.revision };
      this.committed.set(this.lastUse);
    }
    this.pendingAnnouncement = `Map selected: ${candidate.map.name}.`;
    this.finish(true);
    if (entry) this.selectionChange.emit(entry);
  }

  protected choose(entry: DisplayEntry): void {
    if (
      !this.active() ||
      this.waiting() ||
      this.closing ||
      !this.entryEnabled() ||
      this.view() !== 'choose'
    )
      return;
    this.candidateSelection.set({ pairingId: entry.pairing.id, revision: entry.pairing.revision });
  }

  protected cancel(event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    if (this.active() && !this.waiting()) this.finish(true);
  }

  protected nativeClose(): void {
    const closedVisit = this.nativeCloseVisits.shift();
    if (
      this.destroyed ||
      this.dialog().nativeElement.open ||
      (closedVisit !== undefined && closedVisit !== this.visit)
    )
      return;
    this.awaitingNativeClose = false;
    if (this.active()) this.finish(true);
    else this.restoreFocusAfterRender();
  }

  protected key(event: KeyboardEvent): void {
    event.stopPropagation();
    if (event.key === 'Tab') {
      const panel = this.dialog().nativeElement;
      const items = [
        ...panel.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not([type="radio"]):not(:disabled), input[type="radio"]:checked:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], summary, [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((item) => !item.closest('[hidden], [inert]'));
      const first = items[0];
      const last = items[items.length - 1];
      const current = document.activeElement;
      // The initial heading is deliberately outside the normal Tab order. Native
      // dialog focus handling can escape to browser chrome from that position.
      if (!first || !last) {
        event.preventDefault();
        this.focusTitle();
      } else if (!items.some((item) => item === current)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus({ preventScroll: true });
      } else if ((event.shiftKey && current === first) || (!event.shiftKey && current === last)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus({ preventScroll: true });
      }
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.cancel();
    } else if (
      event.key === 'Enter' &&
      !(event.target instanceof Element && event.target.matches('button, summary'))
    ) {
      event.preventDefault();
    }
  }

  private focusTitle(): void {
    this.changeDetector.detectChanges();
    this.title().nativeElement.focus({ preventScroll: true });
  }

  private push(view: View, depth: number): void {
    window.history.pushState(this.historyState(view, depth), '', window.location.href);
  }

  private replace(view: View): void {
    window.history.replaceState(this.historyState(view, this.depth), '', window.location.href);
  }

  private historyState(view: View, depth: number): Record<string, unknown> {
    return {
      ...record(window.history.state),
      [HISTORY_KEY]: { owner: this.historyOwner, visit: this.visit, view, depth },
    };
  }

  private ownEntry(state: unknown): Entry | null {
    const entry = record(record(state)?.[HISTORY_KEY]);
    return entry?.['owner'] === this.historyOwner &&
      entry['visit'] === this.visit &&
      (entry['view'] === 'choose' || entry['view'] === 'add' || entry['view'] === 'view') &&
      typeof entry['depth'] === 'number' &&
      Number.isSafeInteger(entry['depth']) &&
      entry['depth'] > 0
      ? (entry as Entry)
      : null;
  }

  private finish(unwind: boolean): void {
    if (!this.active()) return;
    if (unwind && this.ownEntry(window.history.state)) {
      this.closing = true;
      if (!this.waiting()) {
        this.waiting.set(true);
        window.history.go(-this.depth);
      }
      // Keep the native modal and parent gate until traversal is acknowledged.
      // Destruction must still release native resources synchronously.
      if (!this.destroyed) return;
    }
    this.closing = false;
    this.active.set(false);
    const dialog = this.dialog().nativeElement;
    if (!this.destroyed) {
      this.focusReturn = {
        visit: this.visit,
        opener: this.opener,
        url: this.openedUrl,
        scroll: this.scroll,
      };
      // Clear waiting's disabled attributes before native close attempts its own
      // focus restoration. History has already acknowledged this transition.
      this.changeDetector.detectChanges();
    }
    this.opener = null;
    if (dialog.open) {
      this.awaitingNativeClose = true;
      this.nativeCloseVisits.push(this.visit);
      dialog.close();
    }
    // Announce only after the background live region is no longer inert.
    if (!this.destroyed) this.announcement.set(this.pendingAnnouncement);
    this.pendingAnnouncement = '';
    this.activeChange.emit(false);
    this.restoreFocusAfterRender();
  }

  private restoreFocusAfterRender(): void {
    const destination = this.focusReturn;
    if (!destination || this.destroyed || this.awaitingNativeClose) return;
    this.focusRequest?.destroy();
    this.focusRequest = afterNextRender(
      () => {
        this.focusRequest = undefined;
        if (this.focusReturn !== destination) return;
        this.focusReturn = undefined;
        if (
          this.destroyed ||
          this.active() ||
          this.waiting() ||
          this.visit !== destination.visit ||
          window.location.href !== destination.url ||
          !this.entryEnabled()
        )
          return;
        const target =
          destination.opener?.isConnected && !destination.opener.matches(':disabled')
            ? destination.opener
            : this.summaryTitle().nativeElement;
        target.focus({ preventScroll: true });
        if (window.scrollX !== destination.scroll.x || window.scrollY !== destination.scroll.y)
          window.scrollTo(destination.scroll.x, destination.scroll.y);
      },
      { injector: this.injector },
    );
  }
}
