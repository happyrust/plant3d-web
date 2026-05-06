import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { clearReviewFlagOverrides } from '../flags';

import {
  __resetReviewSharedStores,
  getCommentsFromStore,
  getReviewCommentEventLog,
  getReviewCommentThreadStore,
  isReviewCommentThreadStoreActive,
} from './sharedStores';

function createLocalStorageMock(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => {
      store.set(k, String(v));
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size;
    },
  };
}

describe('sharedStores', () => {
  beforeEach(() => {
    (globalThis as unknown as { localStorage: Storage }).localStorage = createLocalStorageMock();
    clearReviewFlagOverrides();
    __resetReviewSharedStores();
  });

  afterEach(() => {
    clearReviewFlagOverrides();
    __resetReviewSharedStores();
  });

  it('returns the same instance on repeated calls (singleton)', () => {
    const a = getReviewCommentThreadStore();
    const b = getReviewCommentThreadStore();
    expect(a).toBe(b);

    const log1 = getReviewCommentEventLog();
    const log2 = getReviewCommentEventLog();
    expect(log1).toBe(log2);
  });

  it('returns a fresh instance after __resetReviewSharedStores', () => {
    const a = getReviewCommentThreadStore();
    __resetReviewSharedStores();
    const b = getReviewCommentThreadStore();
    expect(a).not.toBe(b);
  });

  it('isReviewCommentThreadStoreActive defaults to true (CUTOVER on)', () => {
    expect(isReviewCommentThreadStoreActive()).toBe(true);
  });

  it('isReviewCommentThreadStoreActive can be disabled via localStorage', () => {
    localStorage.setItem('review.flag.REVIEW_C_COMMENT_THREAD_STORE_CUTOVER', '0');
    expect(isReviewCommentThreadStoreActive()).toBe(false);
  });

  it('force_legacy beats CUTOVER flag', () => {
    localStorage.setItem('review.force_legacy', '1');
    localStorage.setItem('review.flag.REVIEW_C_COMMENT_THREAD_STORE_CUTOVER', '1');
    expect(isReviewCommentThreadStoreActive()).toBe(false);
  });

  it('getCommentsFromStore returns only comments matching the given formId bucket', () => {
    const store = getReviewCommentThreadStore();
    store.upsertComment({
      commentId: 'c-form-1',
      annotationId: 'a-1',
      annotationType: 'text',
      content: 'form-1',
      createdAt: 1,
      formId: 'FORM-1',
    });
    store.upsertComment({
      commentId: 'c-form-2',
      annotationId: 'a-1',
      annotationType: 'text',
      content: 'form-2',
      createdAt: 2,
      formId: 'FORM-2',
    });
    store.upsertComment({
      commentId: 'c-legacy',
      annotationId: 'a-1',
      annotationType: 'text',
      content: 'legacy',
      createdAt: 3,
    });

    expect(getCommentsFromStore('text', 'a-1', 'FORM-1').map((c) => c.id)).toEqual(['c-form-1']);
    expect(getCommentsFromStore('text', 'a-1', 'FORM-2').map((c) => c.id)).toEqual(['c-form-2']);
  });

  it('getCommentsFromStore without formId returns only legacy bucket comments', () => {
    const store = getReviewCommentThreadStore();
    store.upsertComment({
      commentId: 'c-form-1',
      annotationId: 'a-1',
      annotationType: 'text',
      content: 'form-1',
      createdAt: 1,
      formId: 'FORM-1',
    });
    store.upsertComment({
      commentId: 'c-legacy',
      annotationId: 'a-1',
      annotationType: 'text',
      content: 'legacy',
      createdAt: 2,
    });

    expect(getCommentsFromStore('text', 'a-1').map((c) => c.id)).toEqual(['c-legacy']);
  });

  it('getCommentsFromStore with formId does not fall back to the legacy bucket', () => {
    const store = getReviewCommentThreadStore();
    store.upsertComment({
      commentId: 'c-legacy',
      annotationId: 'a-1',
      annotationType: 'text',
      content: 'legacy',
      createdAt: 1,
    });

    expect(getCommentsFromStore('text', 'a-1', 'FORM-NEW')).toEqual([]);
  });

  it('getCommentsFromStore isolates comments by taskId inside the same form', () => {
    const store = getReviewCommentThreadStore();
    store.upsertComment({
      commentId: 'c-task-1',
      annotationId: 'a-1',
      annotationType: 'text',
      content: 'task-1',
      createdAt: 1,
      formId: 'FORM-1',
      taskId: 'task-1',
    });
    store.upsertComment({
      commentId: 'c-task-2',
      annotationId: 'a-1',
      annotationType: 'text',
      content: 'task-2',
      createdAt: 2,
      formId: 'FORM-1',
      taskId: 'task-2',
    });

    expect(getCommentsFromStore('text', 'a-1', 'FORM-1', 'task-1').map((c) => c.id)).toEqual(['c-task-1']);
    expect(getCommentsFromStore('text', 'a-1', 'FORM-1', 'task-2').map((c) => c.id)).toEqual(['c-task-2']);
  });
});
