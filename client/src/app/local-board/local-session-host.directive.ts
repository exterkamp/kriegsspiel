import {
  DestroyRef,
  Directive,
  ElementRef,
  Injector,
  inject,
  input,
  output,
  type OnInit,
} from '@angular/core';
import {
  BOARD_SURFACE_FACTORY,
  BoardHostComponent,
  type BoardSurfaceFactory,
} from './board-host.component';
import type { HostRegistration, LocalSessionHandle, SessionOwner } from './session-owner';

/** A borrowed native host. The provider never resolves BoardHost during its construction. */
@Directive({
  selector: 'ks-local-board-host[localSessionHost]',
  standalone: true,
  exportAs: 'localSessionHost',
  providers: [
    {
      provide: BOARD_SURFACE_FACTORY,
      useFactory: (): BoardSurfaceFactory => {
        const bridge = inject(LocalSessionHostDirective);
        return (...args) => bridge.acquire(...args);
      },
    },
  ],
  host: { '(keydown)': 'key($event)' },
})
export class LocalSessionHostDirective implements OnInit {
  readonly localSessionHost = input.required<LocalSessionHandle>();
  readonly sessionOwner = input.required<SessionOwner>();
  readonly attached = output<LocalSessionHostDirective>();
  readonly exposedKey = output<{
    readonly origin: LocalSessionHostDirective;
    readonly event: KeyboardEvent;
  }>();
  private readonly injector = inject(Injector);
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private native?: BoardHostComponent;
  private registration?: HostRegistration;
  private readonly subscriptions: { unsubscribe(): void }[] = [];
  private stopped = false;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.stopped = true;
      for (const subscription of this.subscriptions.splice(0)) subscription.unsubscribe();
      // Lookup is safe even when Angular destroys a view before its OnInit hook ran.
      const native = this.native ?? this.lookup();
      try {
        // OutputRef destruction may precede this directive's hook. Let all synchronous
        // native hooks run before the independent resource call publishes availability.
        void Promise.resolve()
          .then(() => native?.teardown())
          .catch(() => {});
      } finally {
        this.registration?.destroyed();
      }
    });
  }
  private lookup(): BoardHostComponent | undefined {
    try {
      return this.injector.get(BoardHostComponent);
    } catch {
      return undefined;
    }
  }
  ngOnInit(): void {
    if (this.stopped) return;
    const native = this.injector.get(BoardHostComponent);
    this.native = native;
    const registration = this.sessionOwner().attachHost(this.localSessionHost(), () =>
      Promise.resolve().then(() => native.teardown()),
    );
    this.registration = registration;
    this.subscriptions.push(
      native.initialized.subscribe((result) => registration.initialized(result)),
      native.availability.subscribe((result) => registration.availability(result)),
      native.pointed.subscribe((result) => registration.pointed(result)),
    );
    this.attached.emit(this);
  }
  private acquire(...args: Parameters<BoardSurfaceFactory>): ReturnType<BoardSurfaceFactory> {
    if (this.stopped || !this.registration?.isCurrent()) throw new Error('Local host has retired.');
    return this.registration.factory(...args);
  }
  isCurrent(): boolean {
    return !this.stopped && !!this.registration?.isCurrent();
  }
  resize(): void {
    if (this.isCurrent()) this.native?.resize();
  }
  key(event: KeyboardEvent): void {
    if (!this.isCurrent() || event.composedPath()[0] instanceof HTMLCanvasElement === false) return;
    if (!this.element.nativeElement.contains(event.target as Node)) return;
    this.exposedKey.emit({ origin: this, event });
  }
}
