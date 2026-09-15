import { describe, expect, it, vi } from 'vitest';

import { applyAnnotationReceiptByRoute, attachAnnotationScreenshotByRoute } from './annotationReceiptRoute';

import type { AnnotationType } from '@/composables/useToolStore';
import type { AnnotationScreenshot } from '@/types/auth';

const SCOPE_A = 'v1|project=p|task=task-A|round=0|user=JH';

type PatchInScope = (scope: string, type: AnnotationType, id: string, patch: Record<string, unknown>) => boolean;
type SetScreenshot = (type: AnnotationType, id: string, screenshot: AnnotationScreenshot) => boolean;

describe('applyAnnotationReceiptByRoute（U0 数据类回执按落点写）', () => {
  it('current / unscoped：只走内存 API，不碰别的容器', () => {
    const patchPersistedAnnotationInScope = vi.fn<PatchInScope>(() => true);
    const applyInMemory = vi.fn(() => true);
    const store = { patchPersistedAnnotationInScope };

    expect(applyAnnotationReceiptByRoute(store, { kind: 'current' }, 'text', 'a-1', { severity: 'general' }, applyInMemory)).toBe(true);
    expect(applyAnnotationReceiptByRoute(store, { kind: 'unscoped' }, 'text', 'a-1', { severity: 'general' }, applyInMemory)).toBe(true);
    expect(applyInMemory).toHaveBeenCalledTimes(2);
    expect(patchPersistedAnnotationInScope).not.toHaveBeenCalled();
  });

  it('other-scope：写进出发时那个 scope 的容器，内存 API 一次都不调；容器里找不到就 false', () => {
    const patchPersistedAnnotationInScope = vi.fn<PatchInScope>(() => true);
    const applyInMemory = vi.fn(() => true);
    const store = { patchPersistedAnnotationInScope };
    const route = { kind: 'other-scope', scopeKey: SCOPE_A } as const;

    expect(applyAnnotationReceiptByRoute(store, route, 'cloud', 'c-1', { title: 't' }, applyInMemory)).toBe(true);
    expect(patchPersistedAnnotationInScope).toHaveBeenCalledWith(SCOPE_A, 'cloud', 'c-1', { title: 't' });
    expect(applyInMemory).not.toHaveBeenCalled();

    patchPersistedAnnotationInScope.mockReturnValueOnce(false);
    expect(applyAnnotationReceiptByRoute(store, route, 'cloud', 'gone', { title: 't' }, applyInMemory)).toBe(false);
  });

  it('store 没有 patchPersistedAnnotationInScope（旧替身）：other-scope 算没落上，不抛', () => {
    const applyInMemory = vi.fn(() => true);
    expect(applyAnnotationReceiptByRoute({}, { kind: 'other-scope', scopeKey: SCOPE_A }, 'rect', 'r-1', {}, applyInMemory)).toBe(false);
    expect(applyInMemory).not.toHaveBeenCalled();
  });
});

describe('attachAnnotationScreenshotByRoute（截图回执）', () => {
  const screenshot = { url: 'blob:shot', attachmentId: 'att-1', name: 'shot.png', capturedAt: 5 };

  it('current：走 setAnnotationScreenshot，归一后的截图原样带过去', () => {
    const setAnnotationScreenshot = vi.fn<SetScreenshot>(() => true);
    const patchPersistedAnnotationInScope = vi.fn<PatchInScope>(() => true);
    const store = { setAnnotationScreenshot, patchPersistedAnnotationInScope };

    expect(attachAnnotationScreenshotByRoute(store, { kind: 'current' }, 'text', 'a-1', screenshot)).toBe(true);
    expect(setAnnotationScreenshot).toHaveBeenCalledTimes(1);
    expect(setAnnotationScreenshot.mock.calls[0]?.slice(0, 2)).toEqual(['text', 'a-1']);
    expect(setAnnotationScreenshot.mock.calls[0]?.[2]).toMatchObject({ attachmentId: 'att-1', name: 'shot.png', capturedAt: 5 });
    expect(patchPersistedAnnotationInScope).not.toHaveBeenCalled();
  });

  it('other-scope：截图以 { screenshot } patch 写进出发时那个 scope 的容器，不碰内存', () => {
    const setAnnotationScreenshot = vi.fn<SetScreenshot>(() => true);
    const patchPersistedAnnotationInScope = vi.fn<PatchInScope>(() => true);
    const store = { setAnnotationScreenshot, patchPersistedAnnotationInScope };

    expect(attachAnnotationScreenshotByRoute(store, { kind: 'other-scope', scopeKey: SCOPE_A }, 'cloud', 'c-1', screenshot)).toBe(true);
    expect(setAnnotationScreenshot).not.toHaveBeenCalled();
    expect(patchPersistedAnnotationInScope).toHaveBeenCalledTimes(1);
    const call = patchPersistedAnnotationInScope.mock.calls[0];
    expect(call?.slice(0, 3)).toEqual([SCOPE_A, 'cloud', 'c-1']);
    expect((call?.[3] as { screenshot?: Record<string, unknown> } | undefined)?.screenshot).toMatchObject({ attachmentId: 'att-1', capturedAt: 5 });
  });

  it('截图没有 url（归一失败）：两条路都不写，返回 false', () => {
    const setAnnotationScreenshot = vi.fn<SetScreenshot>(() => true);
    const patchPersistedAnnotationInScope = vi.fn<PatchInScope>(() => true);
    const store = { setAnnotationScreenshot, patchPersistedAnnotationInScope };
    const invalid = { url: '' } as { url: string };

    expect(attachAnnotationScreenshotByRoute(store, { kind: 'current' }, 'text', 'a-1', invalid)).toBe(false);
    expect(attachAnnotationScreenshotByRoute(store, { kind: 'other-scope', scopeKey: SCOPE_A }, 'text', 'a-1', invalid)).toBe(false);
    expect(setAnnotationScreenshot).not.toHaveBeenCalled();
    expect(patchPersistedAnnotationInScope).not.toHaveBeenCalled();
  });
});
