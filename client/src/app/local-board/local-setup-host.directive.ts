import { DestroyRef, Directive, Injector, inject, input, output, type OnInit } from '@angular/core';
import { SetupComponent } from './setup/setup.component';
import type { LocalSetupHandle, SessionOwner, SetupRegistration } from './session-owner';

@Directive({
  selector: 'ks-local-board-setup[localSetupHost]',
  standalone: true,
  exportAs: 'localSetupHost',
})
export class LocalSetupHostDirective implements OnInit {
  readonly localSetupHost = input.required<LocalSetupHandle>();
  readonly sessionOwner = input.required<SessionOwner>();
  readonly attached = output<LocalSetupHostDirective>();
  private readonly injector = inject(Injector);
  private native?: SetupComponent;
  private registration?: SetupRegistration;
  private stopped = false;
  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.stopped = true;
      const native = this.native ?? this.lookup();
      try {
        void native?.dispose().catch(() => {});
      } finally {
        this.registration?.destroyed();
      }
    });
  }
  private lookup(): SetupComponent | undefined {
    try {
      return this.injector.get(SetupComponent);
    } catch {
      return undefined;
    }
  }
  ngOnInit(): void {
    if (this.stopped) return;
    const native = this.injector.get(SetupComponent);
    this.native = native;
    this.registration = this.sessionOwner().attachSetup(this.localSetupHost(), native);
    this.attached.emit(this);
  }
  starting(): boolean {
    return !!this.native?.state.starting();
  }
  dispose(): Promise<void> {
    return this.native?.dispose() ?? Promise.resolve();
  }
}
