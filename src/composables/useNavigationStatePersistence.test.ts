import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nextTick, ref } from 'vue';

import { useNavigationStatePersistence } from './useNavigationStatePersistence';

type StorageValue = string | null;

function createStorageMock() {
  const store = new Map<string, string>();
  return {
    getItem(key: string): StorageValue {
      return store.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
    removeItem(key: string) {
      store.delete(key);
    },
    clear() {
      store.clear();
    },
  };
}

const storageMock = createStorageMock();

describe('useNavigationStatePersistence', () => {
  const storageKey = 'nav-persistence-test';
  const originalLocalStorage = globalThis.localStorage;

  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: storageMock,
    });
    storageMock.clear();
  });

  afterEach(() => {
    storageMock.clear();
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: originalLocalStorage,
    });
  });

  it('restores values written by a previous instance', async () => {
    const firstStatus = ref<'all' | 'submitted'>('all');
    const firstState = useNavigationStatePersistence(storageKey);
    firstState.bindRef('statusFilter', firstStatus, 'all');
    firstStatus.value = 'submitted';
    firstState.saveValue('scrollTop', 240);

    await Promise.resolve();
    await Promise.resolve();

    const secondStatus = ref<'all' | 'submitted'>('all');
    const secondState = useNavigationStatePersistence(storageKey);
    secondState.bindRef('statusFilter', secondStatus, 'all');

    expect(secondStatus.value).toBe('submitted');
    expect(secondState.getValue('scrollTop', 0)).toBe(240);
  });

  it('updates persisted values when bound refs change', async () => {
    const searchTerm = ref('');
    const state = useNavigationStatePersistence(storageKey);
    state.bindRef('searchTerm', searchTerm, '');

    searchTerm.value = 'returned task';
    await Promise.resolve();

    expect(JSON.parse(storageMock.getItem(storageKey) ?? '{}')).toMatchObject({
      searchTerm: 'returned task',
    });
  });

  it('keeps designer, returned, and reviewer surface keys isolated', async () => {
    const designerStatus = ref<'all' | 'submitted'>('all');
    const returnedSearch = ref('');
    const reviewerPriority = ref<'all' | 'high'>('all');

    const designerState = useNavigationStatePersistence('plant3d-web-nav-state-designer-tasks-v1');
    const returnedState = useNavigationStatePersistence('plant3d-web-nav-state-resubmission-tasks-v1');
    const reviewerState = useNavigationStatePersistence('plant3d-web-nav-state-reviewer-tasks-v1');

    designerState.bindRef('statusFilter', designerStatus, 'all');
    returnedState.bindRef('searchTerm', returnedSearch, '');
    reviewerState.bindRef('priorityFilter', reviewerPriority, 'all');

    designerStatus.value = 'submitted';
    returnedSearch.value = 'returned term';
    reviewerPriority.value = 'high';
    designerState.saveValue('scrollTop', 120);
    returnedState.saveValue('scrollTop', 340);
    reviewerState.saveValue('scrollTop', 560);

    await nextTick();
    await nextTick();

    expect(JSON.parse(storageMock.getItem('plant3d-web-nav-state-designer-tasks-v1') ?? '{}')).toEqual({
      statusFilter: 'submitted',
      scrollTop: 120,
    });
    expect(JSON.parse(storageMock.getItem('plant3d-web-nav-state-resubmission-tasks-v1') ?? '{}')).toEqual({
      searchTerm: 'returned term',
      scrollTop: 340,
    });
    expect(JSON.parse(storageMock.getItem('plant3d-web-nav-state-reviewer-tasks-v1') ?? '{}')).toEqual({
      priorityFilter: 'high',
      scrollTop: 560,
    });
  });
});
