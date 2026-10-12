import { afterEach, describe, expect, it } from 'vitest';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { isHighContrast, setHighContrast } from './contrast';
import { ModalComponent } from './modal.component';
import { PageFrameComponent } from './page-frame.component';

@Component({
  imports: [PageFrameComponent],
  template: `<ks-page-frame heading="Title" [back]="back()" (backClick)="clicks.set(clicks() + 1)">
    <p id="body">Body</p>
  </ks-page-frame>`,
})
class FrameHost {
  readonly back = signal(false);
  readonly clicks = signal(0);
}

@Component({
  imports: [ModalComponent],
  template: `<ks-modal heading="Sure?" labelId="m-h">
    <button id="a" type="button">A</button><button id="b" type="button">B</button>
  </ks-modal>`,
})
class ModalHost {}

describe('PageFrameComponent', () => {
  it('shows the title and content, and a way back only when asked', () => {
    const f = TestBed.createComponent(FrameHost);
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('h1')?.textContent).toBe('Title');
    expect(el.querySelector('#body')?.textContent).toBe('Body');
    expect(el.querySelector('.back')).toBeNull();
    f.componentInstance.back.set(true);
    f.detectChanges();
    el.querySelector<HTMLButtonElement>('.back button')!.click();
    expect(f.componentInstance.clicks()).toBe(1);
  });
});

describe('ModalComponent', () => {
  it('is a labelled modal dialog and moves focus to its first control', async () => {
    const f = TestBed.createComponent(ModalHost);
    f.detectChanges();
    await f.whenStable();
    const el = f.nativeElement as HTMLElement;
    const dialog = el.querySelector('[role=dialog]')!;
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(el.querySelector(`#${dialog.getAttribute('aria-labelledby')}`)?.textContent).toBe(
      'Sure?',
    );
  });

  it('keeps Tab inside the dialog', () => {
    const f = TestBed.createComponent(ModalHost);
    document.body.append(f.nativeElement);
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    const b = el.querySelector<HTMLButtonElement>('#b')!;
    b.focus();
    const ev = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    b.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(el.querySelector('#a'));
    el.remove();
  });
});

describe('contrast setting', () => {
  afterEach(() => setHighContrast(false));

  it('sets and clears the page attribute', () => {
    expect(isHighContrast()).toBe(false);
    setHighContrast(true);
    expect(isHighContrast()).toBe(true);
    expect(document.documentElement.dataset['contrast']).toBe('high');
    setHighContrast(false);
    expect(isHighContrast()).toBe(false);
  });

  it('turning it off sets "normal" so it overrides an OS prefers-contrast setting', () => {
    setHighContrast(true);
    setHighContrast(false);
    expect(document.documentElement.dataset['contrast']).toBe('normal');
  });
});
