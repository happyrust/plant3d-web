import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { clearReviewFlagOverrides } from '../flags';

import {
  __resetReviewSharedStores,
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

  it('isReviewCommentThreadStoreActive defaults to true (DUAL_READ on)', () => {
    expect(isReviewCommentThreadStoreActive()).toBe(true);
  });

  it('isReviewCommentThreadStoreActive can be disabled via localStorage', () => {
    localStorage.setItem('review.flag.REVIEW_C_COMMENT_THREAD_STORE_DUAL_READ', '0');
    expect(isReviewCommentThreadStoreActive()).toBe(false);
  });

  it('isReviewCommentThreadStoreActive activates on CUTOVER flag', () => {
    localStorage.setItem('review.flag.REVIEW_C_COMMENT_THREAD_STORE_CUTOVER', '1');
    expect(isReviewCommentThreadStoreActive()).toBe(true);
  });

  it('force_legacy beats both flags', () => {
    localStorage.setItem('review.force_legacy', '1');
    localStorage.setItem('review.flag.REVIEW_C_COMMENT_THREAD_STORE_CUTOVER', '1');
    expect(isReviewCommentThreadStoreActive()).toBe(false);
  });
});
