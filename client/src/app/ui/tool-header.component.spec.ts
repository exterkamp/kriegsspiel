import { Component, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { ToolHeaderComponent } from './tool-header.component';

@Component({
  imports: [ToolHeaderComponent],
  template: `<ks-tool-header heading="Some tool"><p id="status">Ready</p></ks-tool-header>
    <ks-tool-header id="untitled" />`,
})
class HostComponent {}

describe('ks-tool-header (#308)', () => {
  it('links back to the main menu, names the section and the page, and projects the status', async () => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const [titled, untitled] = (fixture.nativeElement as HTMLElement).querySelectorAll(
      'ks-tool-header',
    ) as unknown as [HTMLElement, HTMLElement];
    const back = titled.querySelector('a')!;
    expect(back.getAttribute('href')).toBe('/');
    expect(back.className).toBe('ks-btn ks-quiet back');
    expect(back.textContent).toBe('← Main menu');
    expect(titled.querySelector('.eyebrow')!.textContent).toBe('Developer tools');
    expect(titled.querySelector('h1')!.textContent!.trim()).toBe('Some tool');
    expect(titled.querySelector('header > #status')!.textContent).toBe('Ready');
    expect(untitled.querySelector('h1')).toBeNull();
    expect(untitled.querySelector('a')!.getAttribute('href')).toBe('/');
  });
});
