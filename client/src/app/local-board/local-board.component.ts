import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  Directive,
  DOCUMENT,
  ElementRef,
  EmbeddedViewRef,
  InjectionToken,
  Injector,
  afterNextRender,
  type AfterRenderRef,
  TemplateRef,
  ViewContainerRef,
  afterRenderEffect,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
  type OnInit,
  type Signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import type { CertifiedBoard } from '../../shared/game-setup/contracts';
import { BoardHostComponent } from './board-host.component';
import { freezeBoardSnapshot } from './board-binding';
import type { LocalPresentation } from './contracts';
import { LocalSessionHostDirective } from './local-session-host.directive';
import { LocalSetupHostDirective } from './local-setup-host.directive';
import { NotebookComponent } from './notebook.component';
import { PersonalToolsComponent } from './personal-tools.component';
import { SetupComponent } from './setup/setup.component';
import {
  claimRouteOwner,
  type LocalSessionHandle,
  type LocalSetupHandle,
  type RouteOwnerClaim,
  type SessionOwner,
  type SessionOwnerPorts,
} from './session-owner';

const routeSlot = Object.freeze({});
export const LOCAL_BOARD_ROUTE_SLOT = new InjectionToken<object>('local board route slot', {
  factory: () => routeSlot,
});
export const LOCAL_BOARD_OWNER_PORTS = new InjectionToken<Partial<SessionOwnerPorts>>(
  'local board owner ports',
  { factory: () => ({}) },
);
export const LOCAL_BOARD_WINDOW = new InjectionToken<Window>('local board owning window', {
  factory: () => {
    const window = inject(DOCUMENT).defaultView;
    if (!window) throw new Error('Local board requires a browser window.');
    return window;
  },
});
interface OutletRow {
  readonly owner: SessionOwner;
  readonly session?: LocalSessionHandle;
  readonly setup?: LocalSetupHandle;
  control?: LocalSetupHostDirective;
  host?: LocalSessionHostDirective;
  cancelCallback?: () => void;
  startCallback?: (board: CertifiedBoard) => Promise<void>;
}
interface OutletContext {
  $implicit: OutletRow;
}
interface OutletRecord {
  readonly kind: 'board' | 'setup';
  readonly container: ViewContainerRef;
  readonly template: TemplateRef<OutletContext>;
  retired: boolean;
  row: OutletRow | null;
  view: EmbeddedViewRef<OutletContext> | null;
}

/** Capture precedes target handlers, including readonly notebook search and synthetic events. */
@Directive({ selector: '[localBackgroundGate]', standalone: true })
export class LocalBackgroundGateDirective {
  readonly localBackgroundGate = input.required<NativeLocalBoardComponent>();
  constructor() {
    const listeners = new AbortController();
    inject(DestroyRef).onDestroy(() => listeners.abort());
    const element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    for (const name of [
      'input',
      'change',
      'click',
      'dblclick',
      'keydown',
      'keyup',
      'pointerdown',
      'pointermove',
      'pointerup',
      'pointercancel',
      'wheel',
      'contextmenu',
    ]) {
      element.addEventListener(name, (event) => this.localBackgroundGate().capture(event), {
        capture: true,
        signal: listeners.signal,
        passive: false,
      });
    }
  }
}

/** Public Angular anchors; old records become retirement-only on parent metadata HMR. */
@Directive({ selector: 'ng-template[localBoardOutlet]', standalone: true })
export class LocalBoardOutletDirective implements OnInit {
  readonly localBoardOutlet = input.required<'board' | 'setup'>();
  readonly outletController = input.required<NativeLocalBoardComponent>();
  private readonly container = inject(ViewContainerRef);
  private readonly template = inject<TemplateRef<OutletContext>>(TemplateRef);
  private record?: OutletRecord;
  private controller?: NativeLocalBoardComponent;
  constructor() {
    inject(DestroyRef).onDestroy(() => {
      if (this.record) this.controller?.retireOutlet(this.record);
    });
  }
  ngOnInit(): void {
    const record: OutletRecord = {
      kind: this.localBoardOutlet(),
      container: this.container,
      template: this.template,
      retired: false,
      row: null,
      view: null,
    };
    this.record = record;
    this.controller = this.outletController();
    this.controller.registerOutlet(record);
  }
}

@Component({
  selector: 'ks-native-local-board',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    BoardHostComponent,
    SetupComponent,
    PersonalToolsComponent,
    NotebookComponent,
    LocalSessionHostDirective,
    LocalSetupHostDirective,
    LocalBoardOutletDirective,
    LocalBackgroundGateDirective,
  ],
  templateUrl: './local-board.component.html',
  styleUrl: './local-board.component.css',
})
export class NativeLocalBoardComponent {
  private readonly injector = inject(Injector);
  private readonly window = inject(LOCAL_BOARD_WINDOW);
  private readonly ports = inject(LOCAL_BOARD_OWNER_PORTS);
  private readonly slot = inject(LOCAL_BOARD_ROUTE_SLOT);
  private readonly claim = signal<RouteOwnerClaim | null>(null);
  readonly owner = computed(() => this.claim()?.owner ?? null);
  readonly state = computed(() => this.owner()?.state() ?? null);
  readonly view = signal<'table' | 'notebook'>('table');
  readonly modal = signal<'none' | 'settings' | 'setup'>('none');
  readonly uiError = signal('');
  readonly cancelling = signal(false);
  readonly suspended = signal(false);
  readonly blocked = computed(
    () =>
      this.modal() !== 'none' ||
      this.cancelling() ||
      this.suspended() ||
      ['preparing', 'retiring', 'mounting', 'disposed', 'suspended'].includes(
        this.state()?.phase ?? 'preparing',
      ),
  );
  readonly setupDialog = viewChild<ElementRef<HTMLDialogElement>>('setupDialog');
  readonly settingsDialog = viewChild<ElementRef<HTMLDialogElement>>('settingsDialog');
  private readonly settingsTrigger = viewChild<ElementRef<HTMLButtonElement>>('settingsTrigger');
  private readonly listeners = new AbortController();
  private readonly outlets = new Set<OutletRecord>();
  private readonly presentations = new WeakMap<LocalSessionHandle, Signal<LocalPresentation>>();
  private generation = 0;
  private destroyed = false;
  private restart?: Promise<void>;
  private retirement: Promise<void> = Promise.resolve();
  private setupRetirement: Promise<void> = Promise.resolve();
  private trigger?: HTMLElement;
  private focusRequest?: AfterRenderRef;

  constructor() {
    // Install terminal cleanup and page listeners before claiming or starting any owner.
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      ++this.generation;
      this.listeners.abort();
      this.focusRequest?.destroy();
      this.retire('departure');
      for (const outlet of [...this.outlets]) this.retireOutlet(outlet);
    });
    this.window.addEventListener('pagehide', () => this.hide(), { signal: this.listeners.signal });
    this.window.addEventListener(
      'pageshow',
      (event) => {
        if (event.persisted) this.show();
      },
      { signal: this.listeners.signal },
    );
    this.installClaim();
    effect(() => {
      const owner = this.owner();
      const state = this.state();
      const modal = this.modal();
      const cancelling = this.cancelling();
      const table = this.view() === 'table';
      const suspended = this.suspended();
      const camera = state?.session?.personal.cameraEnabled() ?? false;
      untracked(() => {
        owner?.setInteractionState({
          personal: !suspended && modal === 'none' && !cancelling,
          board: !suspended && modal === 'none' && !cancelling && table,
          camera,
        });
        const failure =
          modal === 'setup' &&
          (!cancelling || !this.uiError()) &&
          state?.phase === 'failed' &&
          !state.setup
            ? (state.error ?? 'Local board initialization failed. Return to the menu.')
            : null;
        if (owner && failure) {
          this.cancelling.set(true);
          this.closeGates();
          this.uiError.set(failure);
        }
        for (const outlet of this.outlets) this.renderOutlet(outlet);
        if (owner && failure)
          void this.finishCancellation(owner, owner.cancelSetup(), this.generation, failure);
      });
    });
    afterRenderEffect(() => {
      const modal = this.modal();
      const settings = this.settingsDialog()?.nativeElement;
      const setup = this.setupDialog()?.nativeElement;
      const suspended = this.suspended();
      const table = this.view() === 'table';
      const ready = this.state()?.available;
      untracked(() => {
        if (this.destroyed || suspended) return;
        if (table && ready) for (const outlet of this.outlets) outlet.row?.host?.resize();
        this.syncDialog(settings, modal === 'settings');
        this.syncDialog(setup, modal === 'setup');
      });
    });
  }
  private current(claim: RouteOwnerClaim, generation: number): boolean {
    return (
      !this.destroyed &&
      !this.suspended() &&
      this.claim() === claim &&
      this.generation === generation
    );
  }
  private installClaim(): void {
    if (this.destroyed) return;
    const generation = ++this.generation;
    const claim = claimRouteOwner(this.window, this.slot, this.ports);
    this.claim.set(claim);
    void claim.predecessorRetired
      .then(() => {
        if (this.current(claim, generation)) return claim.owner.startDefault();
      })
      .catch(() => {
        if (this.current(claim, generation))
          this.uiError.set('Local board startup failed. Return to the menu and try again.');
      });
  }
  private observeRetirement(promise: Promise<void>): void {
    // Retain the rejected fence, but consume notifications to avoid an unhandled rejection.
    void promise.catch(() => {});
  }
  private retire(reason: 'departure' | 'pagehide'): void {
    this.suspended.set(true);
    this.modal.set('none');
    this.cancelling.set(false);
    const claim = this.claim();
    claim?.owner.setInteractionState({ personal: false, board: false, camera: false });
    const fence = claim?.release(reason) ?? Promise.resolve();
    this.retirement = Promise.all([this.retirement, fence]).then(() => undefined);
    this.observeRetirement(this.retirement);
    // Angular clear destroys embedded native hosts synchronously, independently of rendering.
    for (const outlet of this.outlets) this.clearOutlet(outlet);
  }
  private hide(): void {
    if (this.destroyed) return;
    ++this.generation;
    this.restart = undefined;
    this.retire('pagehide');
  }
  private show(): void {
    if (this.destroyed || !this.suspended() || this.restart) return;
    const generation = ++this.generation;
    const fence = this.retirement;
    const task = fence
      .then(() => {
        if (this.destroyed || this.generation !== generation) return;
        this.view.set('table');
        this.uiError.set('');
        this.suspended.set(false);
        this.installClaim();
      })
      .catch(() => {
        if (!this.destroyed && this.generation === generation)
          this.uiError.set('Previous local board could not retire. Return to the menu.');
      })
      .finally(() => {
        if (this.restart === task) this.restart = undefined;
      });
    this.restart = task;
  }
  registerOutlet(outlet: OutletRecord): void {
    if (this.destroyed) {
      outlet.retired = true;
      return;
    }
    this.outlets.add(outlet);
    this.renderOutlet(outlet);
  }
  retireOutlet(outlet: OutletRecord): void {
    if (outlet.retired) return;
    const row = outlet.row;
    outlet.retired = true;
    this.outlets.delete(outlet);
    if (outlet.kind === 'setup' && row?.setup) {
      // Destroy the captured native child before asking for its complete owner fence.
      // Starting alone cannot distinguish precommit origin loss from a detached commit.
      const current = this.owner() === row.owner && !this.suspended() && !this.destroyed;
      if (current) {
        this.cancelling.set(true);
        this.closeGates();
      }
      this.clearOutlet(outlet);
      const cancel = row.owner.cancelSetup();
      const dispose = row.control?.dispose() ?? Promise.resolve();
      this.setupRetirement = Promise.all([this.setupRetirement, cancel, dispose]).then(
        () => undefined,
      );
      this.observeRetirement(this.setupRetirement);
      if (current) void this.finishCancellation(row.owner, this.setupRetirement, this.generation);
    } else this.clearOutlet(outlet);
  }
  private clearOutlet(outlet: OutletRecord): void {
    const view = outlet.view;
    outlet.row = null;
    outlet.view = null;
    try {
      outlet.container.clear();
    } finally {
      if (view && !view.destroyed) view.destroy();
    }
  }
  private createRow(outlet: OutletRecord, row: OutletRow): void {
    if (outlet.retired || this.destroyed || this.suspended()) return;
    outlet.row = row;
    const view = outlet.container.createEmbeddedView(outlet.template, { $implicit: row });
    outlet.view = view;
    view.onDestroy(() => {
      if (outlet.view === view) {
        // Angular may destroy the embedded child before its anchor's DestroyRef.
        // Keep the captured origin for full-fence cancellation; this old anchor is
        // now retirement-only. Controller clears already unset view before hooks.
        outlet.view = null;
        this.retireOutlet(outlet);
      }
    });
    // Native bridge OnInit registers before any host after-render acquisition.
    view.detectChanges();
  }
  private renderOutlet(outlet: OutletRecord): void {
    if (outlet.retired || this.destroyed || this.suspended()) return;
    const owner = this.owner();
    const state = this.state();
    if (!owner || !state) return;
    if (outlet.kind === 'board') {
      if (outlet.row?.session === state.session) return;
      this.clearOutlet(outlet);
      if (state.session) this.createRow(outlet, { owner, session: state.session });
    } else {
      if (outlet.row?.setup === state.setup) return;
      this.clearOutlet(outlet);
      const setup = state.setup;
      if (!setup || this.modal() !== 'setup') return;
      const generation = this.generation;
      void this.setupRetirement
        .then(() => {
          if (
            !outlet.retired &&
            !outlet.row &&
            !this.destroyed &&
            !this.suspended() &&
            generation === this.generation &&
            owner === this.owner() &&
            setup === owner.state().setup &&
            this.modal() === 'setup'
          )
            this.createRow(outlet, { owner, setup });
        })
        .catch(() => {
          if (generation === this.generation && !this.destroyed)
            this.uiError.set('Map setup could not retire. Return to the menu.');
        });
    }
  }
  hostAttached(row: OutletRow, host: LocalSessionHostDirective): void {
    row.host = host;
  }
  setupStartCallback(row: OutletRow): (board: CertifiedBoard) => Promise<void> {
    return (row.startCallback ??= async (board) => {
      await row.setup!.props.onStart(board);
      if (
        this.owner() === row.owner &&
        !row.owner.state().setup &&
        !this.destroyed &&
        !this.suspended()
      ) {
        this.cancelling.set(true);
        this.closeGates();
        await this.finishCancellation(row.owner, row.owner.cancelSetup(), this.generation);
      }
    });
  }
  setupCancelCallback(row: OutletRow): () => void {
    return (row.cancelCallback ??= () => {
      if (this.destroyed || this.suspended() || this.owner() !== row.owner) return;
      // This callback must remain void: native cancel is awaiting it. The owner's
      // full fence also awaits native cancel, so returning that fence would cycle.
      this.cancelling.set(true);
      this.closeGates();
      const barrier = row.owner.cancelSetup();
      const outlet = [...this.outlets].find((record) => record.row === row);
      if (outlet) this.clearOutlet(outlet);
      void this.finishCancellation(row.owner, barrier, this.generation);
    });
  }
  private async finishCancellation(
    owner: SessionOwner,
    barrier: Promise<void>,
    generation: number,
    retiringFailure?: string,
  ): Promise<void> {
    try {
      await barrier;
      if (
        this.destroyed ||
        this.suspended() ||
        this.owner() !== owner ||
        this.generation !== generation
      )
        return;
      if (retiringFailure && this.uiError() === retiringFailure) this.uiError.set('');
      this.modal.set('none');
      this.cancelling.set(false);
      this.restoreFocus(generation);
    } catch {
      if (
        !this.destroyed &&
        !this.suspended() &&
        this.owner() === owner &&
        this.generation === generation
      )
        this.uiError.set('Map setup could not retire. Return to the menu.');
    }
  }
  setupAttached(row: OutletRow, control: LocalSetupHostDirective): void {
    row.control = control;
  }
  presentation(session: LocalSessionHandle): LocalPresentation {
    let presentation = this.presentations.get(session);
    if (!presentation) {
      presentation = computed(() =>
        freezeBoardSnapshot({
          binding: session.binding,
          marks: session.personal.sceneMarks(),
          gameMs: 0 as const,
          rate: 0 as const,
          pieces: [] as const,
          roster: [] as const,
          papers: [] as const,
        }),
      );
      this.presentations.set(session, presentation);
    }
    return presentation();
  }
  boardInput(session: LocalSessionHandle): boolean {
    return (
      this.state()?.session === session &&
      !!this.state()?.available &&
      !this.blocked() &&
      this.view() === 'table'
    );
  }
  canvasKeys(
    session: LocalSessionHandle,
    event: { origin: LocalSessionHostDirective; event: KeyboardEvent },
  ): void {
    if (
      !event.origin.isCurrent() ||
      !this.boardInput(session) ||
      !session.personal.interactionEnabled()
    )
      return;
    const key = event.event;
    if (
      key.defaultPrevented ||
      key.isComposing ||
      key.altKey ||
      key.ctrlKey ||
      key.metaKey ||
      key.shiftKey
    )
      return;
    if (
      key
        .composedPath()
        .some(
          (target) =>
            target instanceof Element &&
            (target.matches('input, textarea, select') ||
              target.closest('[contenteditable]:not([contenteditable="false"])')),
        )
    )
      return;
    let handled = false;
    if (key.key === 'Escape' && session.personal.drawingActive()) {
      session.personal.stopDrawing();
      handled = true;
    } else if (key.key === 'Delete') {
      const id = session.personal.markForm().editingId;
      if (id) handled = session.personal.removeMark(id).ok;
    }
    if (handled) {
      key.preventDefault();
      key.stopPropagation();
    }
  }
  capture(event: Event): void {
    if (
      this.modal() === 'none' &&
      event.target instanceof Element &&
      event.target.closest('[data-local-exit]')
    )
      return;
    if (this.blocked()) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }
  private closeGates(): void {
    this.owner()?.setInteractionState({ personal: false, board: false, camera: false });
  }
  openSettings(trigger: HTMLElement): void {
    if (this.blocked() || !this.state()?.session) return;
    this.closeGates();
    this.trigger = trigger;
    this.modal.set('settings');
  }
  closeSettings(): void {
    if (this.modal() !== 'settings') return;
    this.modal.set('none');
    this.restoreFocus(this.generation);
  }
  newGame(): void {
    if (this.modal() !== 'settings' || !this.owner()) return;
    this.closeGates();
    try {
      this.owner()!.openSetup();
      this.modal.set('setup');
    } catch {
      this.uiError.set('Map setup is unavailable. Close Settings and try again.');
    }
  }
  async cancelSetup(event?: Event): Promise<void> {
    event?.preventDefault();
    if (this.modal() !== 'setup') return;
    const owner = this.owner();
    const generation = this.generation;
    if (!owner) return;
    const active = [...this.outlets].find(
      (outlet) => outlet.kind === 'setup' && outlet.row?.owner === owner,
    );
    if (active?.row?.control?.starting()) return;
    this.closeGates();
    this.cancelling.set(true);
    const barrier = owner.cancelSetup();
    // Clear synchronously even if rendering is withheld. The actual destruction
    // hook acknowledges the captured native control to the owner fence.
    if (active) this.clearOutlet(active);
    await this.finishCancellation(owner, barrier, generation);
  }
  dialogCancel(event: Event, kind: 'settings' | 'setup'): void {
    event.preventDefault();
    if (kind === 'settings') this.closeSettings();
    else void this.cancelSetup(event);
  }
  dialogClosed(kind: 'settings' | 'setup'): void {
    if (this.modal() === kind) {
      if (kind === 'settings') this.closeSettings();
      else void this.cancelSetup();
    }
  }
  private syncDialog(dialog: HTMLDialogElement | undefined, open: boolean): void {
    if (!dialog?.isConnected) return;
    try {
      if (open && !dialog.open) dialog.showModal();
      else if (!open && dialog.open) dialog.close();
    } catch {
      this.uiError.set('The local dialog could not open. Close it and try again.');
      if (this.modal() === 'setup') void this.cancelSetup();
      else this.modal.set('none');
    }
  }
  private restoreFocus(generation: number): void {
    this.focusRequest?.destroy();
    this.focusRequest = afterNextRender(
      () => {
        if (
          this.destroyed ||
          this.suspended() ||
          this.generation !== generation ||
          this.modal() !== 'none'
        )
          return;
        const trigger = this.trigger?.isConnected
          ? this.trigger
          : this.settingsTrigger()?.nativeElement;
        if (trigger && !(trigger instanceof HTMLButtonElement && trigger.disabled)) trigger.focus();
      },
      { injector: this.injector },
    );
  }

  navigate(view: 'table' | 'notebook'): void {
    if (this.blocked()) return;
    this.view.set(view);
    if (view === 'table') for (const outlet of this.outlets) outlet.view?.detectChanges();
  }
  recover(kind: 'retry' | 'default'): void {
    if (this.modal() !== 'none' || this.suspended()) return;
    this.closeGates();
    const owner = this.owner(),
      generation = this.generation;
    if (!owner) return;
    void (kind === 'retry' ? owner.retry() : owner.returnToDefault()).catch(() => {
      if (!this.destroyed && this.generation === generation && this.owner() === owner)
        this.uiError.set('Local board recovery failed. Try again or return to the menu.');
    });
  }
}
