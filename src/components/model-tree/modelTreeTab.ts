/**
 * 模型树面板的页签（PDMS 属主树 / 「房间」房间层级树，ADR 0068）与它的记忆（收口计划 P3-a，D4）：
 * 上次停在哪个页签记在 localStorage，刷新回来还在那一页。读写都吞异常（隐私模式 / 配额 / 无 window），坏值当 PDMS。
 */
export type ModelTreeTab = 'pdms' | 'room';

export const MODEL_TREE_TAB_STORAGE_KEY = 'plant3d.modelTree.activeTab';

type TabStorage = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStorage(): TabStorage | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function isModelTreeTab(value: unknown): value is ModelTreeTab {
  return value === 'pdms' || value === 'room';
}

/** 上次记住的页签；没记过 / 记的不是合法值 / 读不了存储 → `pdms`。 */
export function readModelTreeTab(storage: TabStorage | null = defaultStorage()): ModelTreeTab {
  try {
    const raw = storage?.getItem(MODEL_TREE_TAB_STORAGE_KEY);
    return isModelTreeTab(raw) ? raw : 'pdms';
  } catch {
    return 'pdms';
  }
}

/** 记住当前页签；写不了就算了（不影响切换本身）。 */
export function writeModelTreeTab(tab: ModelTreeTab, storage: TabStorage | null = defaultStorage()): void {
  try {
    storage?.setItem(MODEL_TREE_TAB_STORAGE_KEY, tab);
  } catch {
    // 配额满 / 隐私模式：记忆失败不阻断切页签
  }
}
