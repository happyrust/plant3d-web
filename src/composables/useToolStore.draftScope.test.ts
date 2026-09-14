import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';

/**
 * U0：本机草稿容器按 scope 隔离（方案 2026-09-14 §3.6，d-565 / d-571）。
 * 本测试环境没有 localStorage / sessionStorage 全局；store 在 import 时就读容器，所以在 hoisted 块里先给内存实现。
 * happy-dom 下 URL 没有 project，旧作用域字串是 `project=__default__|db=__all__`。
 */
vi.hoisted(() => {
  const createMemoryStorage = (): Storage => {
    const map = new Map<string, string>();
    return {
      get length() { return map.size; },
      clear: () => map.clear(),
      getItem: (key: string) => map.get(key) ?? null,
      key: (index: number) => [...map.keys()][index] ?? null,
      removeItem: (key: string) => { map.delete(key); },
      setItem: (key: string, value: string) => { map.set(key, String(value)); },
    } as Storage;
  };
  vi.stubGlobal('localStorage', createMemoryStorage());
  vi.stubGlobal('sessionStorage', createMemoryStorage());
});

import { resetAnnotationUxFlagCache, setAnnotationUxFlag } from './useAnnotationUxFlags';
import { refreshToolStorePersistedScope, useToolStore, type AnnotationRecord } from './useToolStore';

import { annotationScopeKey, buildAnnotationScope } from '@/review/domain/annotationScope';

const V7 = 'plant3d-web-tools-v7';
const LEGACY_SCOPE = 'project=__default__|db=__all__';
const legacyKey = `${V7}:${LEGACY_SCOPE}`;

const scopeA = buildAnnotationScope({ projectId: 'p', taskId: 'task-A', reviewRound: 0, userId: 'JH' });
const scopeB = buildAnnotationScope({ projectId: 'p', taskId: 'task-B', reviewRound: 0, userId: 'JH' });
const keyA = `${V7}:${annotationScopeKey(scopeA)}`;
const keyB = `${V7}:${annotationScopeKey(scopeB)}`;

function textAnnotation(id: string): AnnotationRecord {
  return {
    id,
    entityId: `o:${id}`,
    worldPos: [0, 0, 0],
    visible: true,
    glyph: '!',
    title: id,
    description: '',
    createdAt: 1,
    refno: '=1/1',
  };
}

function readIds(key: string): string[] | null {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  const parsed = JSON.parse(raw) as { annotations?: { id: string }[] };
  return (parsed.annotations ?? []).map((a) => a.id);
}

async function flush(): Promise<void> {
  await nextTick();
  await nextTick();
}

describe('useToolStore · U0 草稿 scope 隔离', () => {
  const store = useToolStore();

  beforeEach(async () => {
    localStorage.clear();
    sessionStorage.clear();
    setAnnotationUxFlag('scopedDraftsV1', true);
    resetAnnotationUxFlagCache();
    store.setAnnotationDraftScope(null);
    store.clearAll();
    await flush();
    localStorage.clear();
  });

  afterEach(async () => {
    store.setAnnotationDraftScope(null);
    store.clearAll();
    await flush();
    localStorage.clear();
    resetAnnotationUxFlagCache();
  });

  it('没有 scope 时照旧写进 project|db 容器', async () => {
    store.addAnnotation(textAnnotation('legacy-1'));
    await flush();
    expect(readIds(legacyKey)).toEqual(['legacy-1']);
    expect(store.getAnnotationDraftScope()).toBeNull();
    expect(store.getUnattributedDraftSummary()).toBeNull();
  });

  it('进入任务 A：容器切到 scope key，旧容器原样留着并被数成「未归属草稿」', async () => {
    store.addAnnotation(textAnnotation('legacy-1'));
    await flush();

    expect(store.setAnnotationDraftScope(scopeA)).toBe(true);
    // A 的容器是空的
    expect(store.annotations.value).toEqual([]);
    store.addAnnotation(textAnnotation('a-1'));
    await flush();

    expect(readIds(keyA)).toEqual(['a-1']);
    expect(readIds(legacyKey)).toEqual(['legacy-1']);
    expect(store.getUnattributedDraftSummary()).toEqual({
      storageScope: LEGACY_SCOPE,
      label: '未归属草稿',
      counts: { text: 1, cloud: 0, rect: 0, obb: 0 },
      total: 1,
    });
    // 同一 scope 幂等
    expect(store.setAnnotationDraftScope(buildAnnotationScope({ projectId: ' p ', taskId: 'task-A', userId: 'JH' }))).toBe(false);
  });

  it('A → B：切换前同一 tick 的最后一笔编辑刷进 A 的 key，不会跟进 B 的容器；切回 A 原样恢复', async () => {
    store.setAnnotationDraftScope(scopeA);
    store.addAnnotation(textAnnotation('a-1'));
    await flush();
    // 同一 tick 里再编辑一笔、不等 watch 刷盘就切任务
    store.addAnnotation(textAnnotation('a-2'));
    store.setAnnotationDraftScope(scopeB);

    expect(readIds(keyA)).toEqual(['a-1', 'a-2']);
    expect(store.annotations.value).toEqual([]);
    store.addAnnotation(textAnnotation('b-1'));
    await flush();
    expect(readIds(keyB)).toEqual(['b-1']);
    expect(readIds(keyA)).toEqual(['a-1', 'a-2']);

    store.setAnnotationDraftScope(scopeA);
    expect(store.annotations.value.map((a) => a.id)).toEqual(['a-1', 'a-2']);
    await flush();
    expect(readIds(keyB)).toEqual(['b-1']);
  });

  it('离开任务（null）回到旧作用域并载回旧容器内容', async () => {
    store.addAnnotation(textAnnotation('legacy-1'));
    await flush();
    store.setAnnotationDraftScope(scopeA);
    store.addAnnotation(textAnnotation('a-1'));
    await flush();

    expect(store.setAnnotationDraftScope(null)).toBe(true);
    expect(store.annotations.value.map((a) => a.id)).toEqual(['legacy-1']);
    expect(store.getUnattributedDraftSummary()).toBeNull();
    await flush();
    expect(readIds(keyA)).toEqual(['a-1']);
    expect(readIds(legacyKey)).toEqual(['legacy-1']);
  });

  it('旧容器没有批注（只有测量）→ 不出「未归属草稿」', async () => {
    localStorage.setItem(legacyKey, JSON.stringify({
      version: 7, measurements: [{ id: 'm' }], legacyMeasurements: [], annotations: [], obbAnnotations: [], cloudAnnotations: [], rectAnnotations: [],
    }));
    store.setAnnotationDraftScope(scopeA);
    expect(store.getUnattributedDraftSummary()).toBeNull();
  });

  it('旧容器是坏 JSON → 不出提示、不抛', () => {
    localStorage.setItem(legacyKey, '{not json');
    store.setAnnotationDraftScope(scopeA);
    expect(store.getUnattributedDraftSummary()).toBeNull();
  });

  it('开关 scopedDraftsV1 关着：scope 只记不生效，key 仍是旧作用域；开回来 refresh 一次就接上', async () => {
    setAnnotationUxFlag('scopedDraftsV1', false);
    resetAnnotationUxFlagCache();
    store.addAnnotation(textAnnotation('legacy-1'));
    await flush();

    expect(store.setAnnotationDraftScope(scopeA)).toBe(true);
    expect(store.getAnnotationDraftScope()).toEqual(scopeA);
    // 没切容器：内存里还是旧容器的东西，写也写回旧 key
    expect(store.annotations.value.map((a) => a.id)).toEqual(['legacy-1']);
    store.addAnnotation(textAnnotation('legacy-2'));
    await flush();
    expect(readIds(legacyKey)).toEqual(['legacy-1', 'legacy-2']);
    expect(readIds(keyA)).toBeNull();
    expect(store.getUnattributedDraftSummary()).toBeNull();

    setAnnotationUxFlag('scopedDraftsV1', true);
    resetAnnotationUxFlagCache();
    refreshToolStorePersistedScope();
    expect(store.annotations.value).toEqual([]);
    expect(store.getUnattributedDraftSummary()?.counts.text).toBe(2);
  });
});
