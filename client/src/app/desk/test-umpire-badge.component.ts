import { ChangeDetectionStrategy, Component, OnInit, signal } from '@angular/core';

/**
 * A small badge when the server's umpire is the test provider (canned responses, no model), so a
 * player is not misled by its short answers. The server says so in `GET /scenarios` (`umpire: 'test'`).
 */
@Component({
  selector: 'ks-test-umpire-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (test()) {
      <span class="test-umpire" data-testid="test-umpire-badge" role="status"
        >Test umpire (canned responses)</span
      >
    }
  `,
  styles: `
    .test-umpire {
      position: fixed;
      top: 48px;
      right: 8px;
      z-index: 5;
      white-space: nowrap;
      background: var(--ks-paper-control);
      color: var(--ks-ink-muted);
      border: 1px dashed var(--ks-rule);
      border-radius: var(--ks-radius);
      padding: 2px 8px;
      font-size: var(--ks-text-xs);
    }
    /* Narrow screens: the account bar wraps over the top corner, so sit above the desk buttons. */
    @media (max-width: 600px) {
      .test-umpire {
        top: auto;
        bottom: 128px;
        right: 50%;
        transform: translateX(50%);
      }
    }
  `,
})
export class TestUmpireBadgeComponent implements OnInit {
  protected readonly test = signal(false);

  async ngOnInit(): Promise<void> {
    try {
      const res = await fetch('/scenarios');
      if (!res.ok) return;
      const body = (await res.json()) as { umpire?: unknown };
      this.test.set(body.umpire === 'test');
    } catch {
      // No server (the fixture board) or an unreadable reply: no badge.
    }
  }
}
