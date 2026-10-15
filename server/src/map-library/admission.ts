/** One reservation covers ingress, validation, readback and awaited resource retirement. No waiting queue. */
export class LibraryBusyError extends Error {
  constructor() {
    super('map_library_busy');
  }
}
export class LibraryAdmission {
  private readonly owners = new Set<string>();
  private readonly leases = new Set<LibraryLease>();
  acquire(owner: string): LibraryLease {
    if (this.leases.size >= 2 || this.owners.has(owner)) throw new LibraryBusyError();
    const lease = new LibraryLease(() => {
      this.leases.delete(lease);
      this.owners.delete(owner);
    });
    this.owners.add(owner);
    this.leases.add(lease);
    return lease;
  }
  get active(): number {
    return this.leases.size;
  }
}
export class LibraryLease {
  private released = false;
  private retirement: Promise<unknown> = Promise.resolve();
  constructor(private readonly onRelease: () => void) {}
  assertActive(): void {
    if (this.released) throw new Error('Map operation retired');
  }
  track(retirement: Promise<unknown>): void {
    this.assertActive();
    this.retirement = Promise.allSettled([this.retirement, retirement]);
  }
  private releasing: Promise<void> | undefined;
  release(): Promise<void> {
    if (!this.releasing) {
      this.released = true;
      this.releasing = this.retirement.then(() => {
        this.onRelease();
      });
    }
    return this.releasing;
  }
}
