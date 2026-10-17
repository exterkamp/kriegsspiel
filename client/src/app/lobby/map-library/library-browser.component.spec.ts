import { webcrypto } from 'node:crypto';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  assetIdentity,
  canonicalizeAsset,
  createReferenceAsset,
  type MapAsset,
} from '@kriegsspiel/maps';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BoardPreparation, CertifiedBoard } from '../../../shared/game-setup/contracts';
import type {
  LibraryMapSummary,
  MapLibraryPort,
} from '../../../shared/lobby-map-library/contracts';
import { MAP_LIBRARY_PREVIEW_FACTORY, type LibraryPreview } from './map-library.component';
import { LibraryBrowserComponent } from './library-browser.component';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
let fixture: ComponentFixture<LibraryBrowserComponent>;
let component: LibraryBrowserComponent;
let root: HTMLElement;
let board: CertifiedBoard;
let item: LibraryMapSummary;
let port: MapLibraryPort;
let preparations: BoardPreparation[];
let previews: LibraryPreview[];
let prepFactory: ReturnType<typeof vi.fn<() => BoardPreparation>>;
let previewFactory: ReturnType<typeof vi.fn<(canvas: HTMLCanvasElement) => LibraryPreview>>;
beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto);
  const asset = createReferenceAsset();
  const canonicalJson = canonicalizeAsset(asset);
  const identity = await assetIdentity(asset, 'asset');
  item = {
    ref: { kind: 'owned', id: '7da01aae-638e-4700-9a8d-5f39646c78d1' },
    name: 'Separate library name',
    widthM: 150,
    heightM: 150,
    assetIdentity: identity,
    status: 'needs-scenario',
    createdAtMs: 10,
  };
  board = {
    asset,
    canonicalJson,
    assetIdentity: identity,
    bounds: { minX: 0, minY: 0, maxX: 150, maxY: 150 },
    summary: {
      ref: { kind: 'generated', id: item.ref.id },
      name: asset.name,
      widthM: 150,
      heightM: 150,
    },
  };
  port = {
    list: vi.fn().mockResolvedValue({ items: [item] }),
    read: vi.fn().mockResolvedValue({ item, canonicalJson }),
    save: vi.fn(),
  };
  preparations = [];
  previews = [];
  prepFactory = vi.fn(() => {
    const preparation = {
      generate: vi.fn(),
      load: vi.fn().mockResolvedValue(board),
      dispose: vi.fn(),
    };
    preparations.push(preparation);
    return preparation;
  });
  previewFactory = vi.fn(() => {
    const preview = { loadAsset: vi.fn().mockReturnValue({ ok: true, asset }), dispose: vi.fn() };
    previews.push(preview);
    return preview;
  });
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      { provide: MAP_LIBRARY_PREVIEW_FACTORY, useValue: previewFactory },
    ],
  });
});
afterEach(() => {
  fixture?.destroy();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function render(source: 'owned' | 'included' = 'owned', initial?: LibraryMapSummary) {
  fixture = TestBed.createComponent(LibraryBrowserComponent);
  component = fixture.componentInstance;
  root = fixture.nativeElement;
  fixture.componentRef.setInput('library', port);
  fixture.componentRef.setInput('preparationFactory', prepFactory);
  fixture.componentRef.setInput('source', source);
  if (initial) fixture.componentRef.setInput('initialItem', initial);
  await fixture.whenStable();
}
function button(label: string): HTMLButtonElement {
  const found = [...root.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.textContent?.trim() === label,
  );
  if (!found) throw new Error(`Missing button ${label}`);
  return found;
}
async function inspect() {
  await component.inspect(item);
  await fixture.whenStable();
}

describe('read-only paginated geography library', () => {
  it('loads only one page, keeps row metadata detached, and uses explicit next/previous cursor reads without aggregation', async () => {
    const page = Array.from({ length: 20 }, (_, i) => ({
      ...item,
      ref: { ...item.ref, id: `7da01aae-638e-4700-9a8d-${String(i).padStart(12, '0')}` },
      name: `Map ${i}`,
    }));
    const second = { ...item, name: 'Next page only' };
    vi.mocked(port.list)
      .mockResolvedValueOnce({ items: page, nextCursor: 'cursor-1' })
      .mockResolvedValueOnce({ items: [second] })
      .mockResolvedValueOnce({ items: page, nextCursor: 'cursor-1' });
    await render();
    expect(port.list).toHaveBeenCalledExactlyOnceWith('owned', expect.any(AbortSignal), undefined);
    expect(root.querySelectorAll('.map-row')).toHaveLength(20);
    expect(button('Previous maps').disabled).toBe(true);
    expect(component.items()[0]).not.toBe(page[0]);
    button('Next maps').click();
    await fixture.whenStable();
    expect(vi.mocked(port.list).mock.calls[1]).toEqual([
      'owned',
      expect.any(AbortSignal),
      'cursor-1',
    ]);
    expect(root.querySelectorAll('.map-row')).toHaveLength(1);
    expect(root.textContent).toContain('Next page only');
    expect(root.textContent).not.toContain('Map 19');
    expect(button('Next maps').disabled).toBe(true);
    button('Previous maps').click();
    await fixture.whenStable();
    expect(vi.mocked(port.list).mock.calls[2]).toEqual([
      'owned',
      expect.any(AbortSignal),
      undefined,
    ]);
    expect(root.querySelectorAll('.map-row')).toHaveLength(20);
    expect(port.read).not.toHaveBeenCalled();
  });

  it.each([
    'oversized page',
    'foreign source',
    'ready status',
    'private field',
    'duplicate ID',
    'invalid cursor',
    'looping cursor',
  ])('rejects %s rather than presenting playable or silently truncated rows', async (invalid) => {
    let page: unknown = { items: [item] };
    if (invalid === 'oversized page') page = { items: Array(21).fill(item) };
    if (invalid === 'foreign source')
      page = { items: [{ ...item, ref: { kind: 'included', id: 'included-one' } }] };
    if (invalid === 'ready status') page = { items: [{ ...item, status: 'ready' }] };
    if (invalid === 'private field') page = { items: [{ ...item, ownerId: 'hidden' }] };
    if (invalid === 'duplicate ID') page = { items: [item, item] };
    if (invalid === 'invalid cursor') page = { items: [item], nextCursor: 'x'.repeat(513) };
    if (invalid === 'looping cursor') {
      vi.mocked(port.list).mockResolvedValueOnce({ items: [item], nextCursor: 'same' });
      page = { items: [item], nextCursor: 'same' };
    }
    vi.mocked(port.list).mockResolvedValue(page as Awaited<ReturnType<MapLibraryPort['list']>>);
    await render();
    if (invalid === 'looping cursor') {
      button('Next maps').click();
      await fixture.whenStable();
    }
    expect(root.textContent).toContain('maps could not be loaded');
    expect(root.querySelector('.map-row')).toBeNull();
    expect(prepFactory).not.toHaveBeenCalled();
    expect(button('Retry maps').disabled).toBe(false);
  });

  it('offers empty My maps Add and Back signals only, never saves or starts', async () => {
    vi.mocked(port.list).mockResolvedValue({ items: [] });
    await render();
    const add = vi.fn();
    const back = vi.fn();
    component.addRequested.subscribe(add);
    component.backRequested.subscribe(back);
    expect(root.textContent).toContain('No maps saved yet.');
    button('Add map').click();
    button('Back to scenario maps').click();
    expect(add).toHaveBeenCalledOnce();
    expect(back).toHaveBeenCalledOnce();
    expect(port.save).not.toHaveBeenCalled();
    expect([...root.querySelectorAll('button')].every((button) => button.type === 'button')).toBe(
      true,
    );
    expect(root.textContent).not.toContain('Use map');
    expect(root.textContent).not.toContain('Ready for');
  });

  it.each(['owned', 'included'] as const)(
    'reads and certifies exact %s geography through the explicit in-memory ref adapter',
    async (source) => {
      item = {
        ...item,
        ref: { kind: source, id: source === 'owned' ? item.ref.id : 'included-reference' },
      };
      board = {
        ...board,
        summary: {
          ...board.summary,
          ref: { kind: source === 'owned' ? 'generated' : 'premade', id: item.ref.id },
        },
      };
      vi.mocked(port.list).mockResolvedValue({ items: [item] });
      vi.mocked(port.read).mockResolvedValue({ item, canonicalJson: board.canonicalJson });
      await render(source);
      await inspect();
      expect(port.read).toHaveBeenCalledWith(item.ref, expect.any(AbortSignal));
      expect(preparations[0]!.load).toHaveBeenCalledWith(
        board.canonicalJson,
        { ref: board.summary.ref, name: item.name, widthM: 150, heightM: 150 },
        expect.any(AbortSignal),
      );
      expect(preparations[0]!.generate).not.toHaveBeenCalled();
      expect(previews[0]!.loadAsset).toHaveBeenCalledWith(board.asset);
      expect(root.textContent).toContain('Separate library name');
      expect(root.textContent).toContain('Needs a scenario');
      expect(root.textContent).not.toContain('Ready for');
      expect(component.board()?.asset).not.toBe(board.asset);
      fixture.destroy();
      expect(preparations[0]!.dispose).toHaveBeenCalledTimes(1);
      expect(previews[0]!.dispose).toHaveBeenCalledTimes(1);
    },
  );

  it('inspects a freshly saved item even if the first page does not contain it', async () => {
    vi.mocked(port.list).mockResolvedValue({ items: [] });
    await render('owned', item);
    await vi.waitFor(() => expect(component.board()).toBeDefined());
    await fixture.whenStable();
    expect(port.read).toHaveBeenCalledExactlyOnceWith(item.ref, expect.any(AbortSignal));
    expect(prepFactory).toHaveBeenCalledOnce();
    expect(root.querySelector('canvas')).not.toBeNull();
    expect(root.textContent).toContain('Separate library name');
  });

  it.each([
    'name',
    'dimensions',
    'full identity',
    'reference',
    'canonical bytes',
    'different asset',
  ])('rejects %s disagreement before certification or preview', async (mismatch) => {
    const bad = { item: structuredClone(item), canonicalJson: board.canonicalJson };
    if (mismatch === 'name') Object.assign(bad.item, { name: 'Other name' });
    if (mismatch === 'dimensions') Object.assign(bad.item, { widthM: 160 });
    if (mismatch === 'full identity')
      Object.assign(bad.item, {
        assetIdentity: await assetIdentity(board.asset as MapAsset, 'geometry'),
      });
    if (mismatch === 'reference')
      Object.assign(bad.item, {
        ref: { kind: 'owned', id: '7da01aae-638e-4700-9a8d-5f39646c78d2' },
      });
    if (mismatch === 'canonical bytes') bad.canonicalJson += ' ';
    if (mismatch === 'different asset') {
      const asset = createReferenceAsset();
      asset.name = 'Changed asset';
      bad.canonicalJson = canonicalizeAsset(asset);
    }
    vi.mocked(port.read).mockResolvedValue(bad);
    await render();
    await inspect();
    expect(component.board()).toBeUndefined();
    expect(root.textContent).toContain('map could not be checked');
    expect(prepFactory).not.toHaveBeenCalled();
    expect(previewFactory).not.toHaveBeenCalled();
    vi.mocked(port.read).mockResolvedValue({ item, canonicalJson: board.canonicalJson });
    await inspect();
    expect(component.board()).toBeDefined();
  });

  it.each(['canonical bytes', 'geometry identity', 'dimensions', 'wrong adapter'])(
    'rejects preparation %s disagreement and releases the failed preparation once',
    async (mismatch) => {
      const invalid = structuredClone(board);
      if (mismatch === 'canonical bytes')
        Object.assign(invalid, { canonicalJson: board.canonicalJson + ' ' });
      if (mismatch === 'geometry identity')
        Object.assign(invalid, {
          assetIdentity: await assetIdentity(board.asset as MapAsset, 'geometry'),
        });
      if (mismatch === 'dimensions')
        Object.assign(invalid, { bounds: { ...invalid.bounds, maxY: 170 } });
      if (mismatch === 'wrong adapter')
        Object.assign(invalid, {
          summary: { ...invalid.summary, ref: { kind: 'premade', id: item.ref.id } },
        });
      prepFactory.mockImplementationOnce(() => {
        const prep = {
          generate: vi.fn(),
          load: vi.fn().mockResolvedValue(invalid),
          dispose: vi.fn(),
        };
        preparations.push(prep);
        return prep;
      });
      await render();
      await inspect();
      expect(component.board()).toBeUndefined();
      expect(preparations[0]!.dispose).toHaveBeenCalledTimes(1);
      expect(previewFactory).not.toHaveBeenCalled();
      fixture.destroy();
      expect(preparations[0]!.dispose).toHaveBeenCalledTimes(1);
    },
  );

  it('clears source cursors and ignores a late foreign page after source replacement', async () => {
    const delayed = deferred<Awaited<ReturnType<MapLibraryPort['list']>>>();
    vi.mocked(port.list).mockReturnValueOnce(delayed.promise);
    await render();
    const signal = vi.mocked(port.list).mock.calls[0]![1];
    const included = { ...item, ref: { kind: 'included' as const, id: 'included-reference' } };
    vi.mocked(port.list).mockResolvedValue({ items: [included] });
    fixture.componentRef.setInput('source', 'included');
    await fixture.whenStable();
    expect(signal.aborted).toBe(true);
    expect(vi.mocked(port.list).mock.calls[1]).toEqual([
      'included',
      expect.any(AbortSignal),
      undefined,
    ]);
    delayed.resolve({ items: [item], nextCursor: 'old-owner-cursor' });
    await delayed.promise;
    await fixture.whenStable();
    expect(component.items()).toEqual([included]);
    expect(component.nextCursor()).toBeUndefined();
  });

  it.each(['read', 'certification'])(
    'aborts stale %s on source replacement without late preview publication',
    async (phase) => {
      const pendingRead = deferred<Awaited<ReturnType<MapLibraryPort['read']>>>();
      const pendingBoard = deferred<CertifiedBoard>();
      if (phase === 'read') vi.mocked(port.read).mockReturnValueOnce(pendingRead.promise);
      else
        prepFactory.mockImplementationOnce(() => {
          const prep = {
            generate: vi.fn(),
            load: vi.fn().mockReturnValue(pendingBoard.promise),
            dispose: vi.fn(),
          };
          preparations.push(prep);
          return prep;
        });
      await render();
      const operation = component.inspect(item);
      if (phase === 'certification')
        await vi.waitFor(() => expect(preparations[0]?.load).toHaveBeenCalledOnce());
      const signal = vi.mocked(port.read).mock.calls[0]![1];
      vi.mocked(port.list).mockResolvedValue({ items: [] });
      fixture.componentRef.setInput('source', 'included');
      await fixture.whenStable();
      pendingRead.resolve({ item, canonicalJson: board.canonicalJson });
      pendingBoard.resolve(board);
      await operation;
      await fixture.whenStable();
      expect(signal.aborted).toBe(true);
      expect(component.board()).toBeUndefined();
      expect(previewFactory).not.toHaveBeenCalled();
      if (phase === 'certification') expect(preparations[0]!.dispose).toHaveBeenCalledTimes(1);
    },
  );

  it('retires synchronously before rendering and rejects late completion after destruction', async () => {
    await render();
    const delayed = deferred<Awaited<ReturnType<MapLibraryPort['read']>>>();
    vi.mocked(port.read).mockReturnValueOnce(delayed.promise);
    const operation = component.inspect(item);
    component.retire();
    expect(vi.mocked(port.read).mock.calls[0]![1].aborted).toBe(true);
    fixture.destroy();
    delayed.resolve({ item, canonicalJson: board.canonicalJson });
    await operation;
    expect(prepFactory).not.toHaveBeenCalled();
    expect(previewFactory).not.toHaveBeenCalled();
  });

  it('uses a fresh preparation per inspection, supports preview retry, and releases prior handles once', async () => {
    await render();
    await inspect();
    await inspect();
    expect(prepFactory).toHaveBeenCalledTimes(2);
    expect(preparations[0]!.dispose).toHaveBeenCalledTimes(1);
    expect(previews[0]!.dispose).toHaveBeenCalledTimes(1);
    component.retryPreview();
    await fixture.whenStable();
    expect(previews[1]!.dispose).toHaveBeenCalledTimes(1);
    expect(previews).toHaveLength(3);
    fixture.destroy();
    for (const prep of preparations) expect(prep.dispose).toHaveBeenCalledTimes(1);
    for (const preview of previews) expect(preview.dispose).toHaveBeenCalledTimes(1);
  });
  it('blocks stale rendered row and paging actions immediately after retirement, before new bindings render', async () => {
    vi.mocked(port.list).mockResolvedValue({ items: [item], nextCursor: 'next-page' });
    await render();
    const row = root.querySelector<HTMLButtonElement>('.map-row')!;
    const next = button('Next maps');
    component.retire();
    row.click();
    next.click();
    await fixture.whenStable();
    expect(port.read).not.toHaveBeenCalled();
    expect(port.list).toHaveBeenCalledTimes(1);
    expect(prepFactory).not.toHaveBeenCalled();
  });
  it('clears owner-bound cursors and rejects an old read when the library changes with the same source', async () => {
    vi.mocked(port.list).mockResolvedValue({ items: [item], nextCursor: 'old-owner-page' });
    await render();
    const delayed = deferred<Awaited<ReturnType<MapLibraryPort['read']>>>();
    vi.mocked(port.read).mockReturnValueOnce(delayed.promise);
    const operation = component.inspect(item);
    const signal = vi.mocked(port.read).mock.calls[0]![1];
    const nextItem = { ...item, name: 'New owner geography' };
    const nextPort: MapLibraryPort = {
      list: vi.fn().mockResolvedValue({ items: [nextItem] }),
      read: vi.fn(),
      save: vi.fn(),
    };
    fixture.componentRef.setInput('library', nextPort);
    await fixture.whenStable();
    expect(signal.aborted).toBe(true);
    expect(nextPort.list).toHaveBeenCalledExactlyOnceWith(
      'owned',
      expect.any(AbortSignal),
      undefined,
    );
    delayed.resolve({ item, canonicalJson: board.canonicalJson });
    await operation;
    expect(component.items()).toEqual([nextItem]);
    expect(component.nextCursor()).toBeUndefined();
    expect(component.board()).toBeUndefined();
    expect(prepFactory).not.toHaveBeenCalled();
  });
  it('lets an expired later-page cursor retry explicitly or restart from the first page', async () => {
    vi.mocked(port.list)
      .mockResolvedValueOnce({ items: [item], nextCursor: 'expired-cursor' })
      .mockRejectedValueOnce(new Error('restart-list400'))
      .mockResolvedValueOnce({ items: [] });
    await render();
    button('Next maps').click();
    await fixture.whenStable();
    expect(root.textContent).toContain('maps could not be loaded');
    expect(vi.mocked(port.list).mock.calls[1]![2]).toBe('expired-cursor');
    button('Restart maps').click();
    await fixture.whenStable();
    expect(vi.mocked(port.list).mock.calls[2]![2]).toBeUndefined();
    expect(component.page()).toBe(0);
    expect(root.textContent).toContain('No maps saved yet.');
  });
  it.each([false, true])(
    'focuses the current saved inspection heading after render, including off-page=%s',
    async (offPage) => {
      if (offPage) vi.mocked(port.list).mockResolvedValue({ items: [] });
      await render('owned', item);
      const heading = root.querySelector<HTMLElement>(
        'section[aria-label="Geography inspection"] h3',
      )!;
      expect(heading.textContent).toBe(item.name);
      expect(heading.getAttribute('tabindex')).toBe('-1');
      expect(component.requestInspectionFocus(item.ref)).toBe(true);
      expect(document.activeElement).not.toBe(heading);
      await fixture.whenStable();
      expect(document.activeElement).toBe(heading);
      expect(port.save).not.toHaveBeenCalled();
    },
  );

  it.each(['page', 'source', 'owner', 'selection', 'retirement', 'destruction'])(
    'does not run an old saved-focus request after %s changes',
    async (change) => {
      vi.mocked(port.list).mockResolvedValue({ items: [item], nextCursor: 'next-page' });
      await render('owned', item);
      const outside = document.createElement('button');
      outside.textContent = 'Current focus owner';
      document.body.append(outside);
      outside.focus();
      try {
        expect(component.requestInspectionFocus(item.ref)).toBe(true);
        if (change === 'page') component.next();
        if (change === 'source') {
          vi.mocked(port.list).mockResolvedValue({ items: [] });
          fixture.componentRef.setInput('source', 'included');
        }
        if (change === 'owner')
          fixture.componentRef.setInput('library', {
            ...port,
            list: vi.fn().mockResolvedValue({ items: [] }),
          });
        if (change === 'selection')
          void component.inspect({
            ...item,
            ref: { kind: 'owned', id: '7da01aae-638e-4700-9a8d-5f39646c78d2' },
          });
        if (change === 'retirement') component.retire();
        if (change === 'destruction') fixture.destroy();
        await fixture.whenStable();
        expect(document.activeElement).toBe(outside);
      } finally {
        outside.remove();
      }
    },
  );

  it('rejects a foreign or retired inspection focus request rather than focusing by name or ID alone', async () => {
    await render('owned', item);
    expect(component.requestInspectionFocus({ kind: 'included', id: item.ref.id })).toBe(false);
    expect(
      component.requestInspectionFocus({
        kind: 'owned',
        id: '7da01aae-638e-4700-9a8d-5f39646c78d2',
      }),
    ).toBe(false);
    component.retire();
    expect(component.requestInspectionFocus(item.ref)).toBe(false);
  });
});
