import { describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { StyleGuideComponent } from './style-guide.component';

describe('StyleGuideComponent', () => {
  it('shows every shared control in its states', () => {
    const f = TestBed.createComponent(StyleGuideComponent);
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    for (const sel of [
      '.ks-primary',
      '.ks-quiet',
      '.ks-danger',
      'button[aria-pressed=true]',
      'button:disabled',
      '.ks-field input',
      '.ks-field select',
      '.ks-field textarea',
      '.ks-error',
      '.ks-panel',
      '.ks-paper',
      '.ks-overlay',
      '.ks-row',
      '.ks-badge',
      '.ks-tabs',
      '.ks-status.ks-ok',
      '.ks-status.ks-warn',
      '.ks-status.ks-error',
    ]) {
      expect(el.querySelector(sel), sel).not.toBeNull();
    }
  });

  it('opens the example dialog and closes it again', () => {
    const f = TestBed.createComponent(StyleGuideComponent);
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('[role=dialog]')).toBeNull();
    [...el.querySelectorAll('button')]
      .find((b) => b.textContent?.includes('Open the dialog'))!
      .click();
    f.detectChanges();
    expect(el.querySelector('[role=dialog]')).not.toBeNull();
    el.querySelector<HTMLButtonElement>('[role=dialog] button')!.click();
    f.detectChanges();
    expect(el.querySelector('[role=dialog]')).toBeNull();
  });
});
