/**
 * 选中历史栈：顶栏最左那两枚前进 / 后退箭头背后的账本（语义与 plant-ui `nav_history.rs` 一致）。
 *
 * 一条历史 = **选择集 + 相机位姿**。相机那一格存的是**离开那一刻**的位姿：选中 A 之后转了半圈、拉近看，
 * 再点 B——回到 A 时要的是走之前看到的那一幅，不是刚点中 A 时的。做法是每次入栈 / 后退 / 前进之前
 * 先把当前相机写回当前条目。
 *
 * 浏览器语义：站在栈中间做新操作，前向分支截断。纯转视角不入栈，相机只是条目的一个属性。
 * 上限满了丢最老的。这里只有纯逻辑，回放做什么由调用方拿着返回的条目去做。
 */

export type SelectionNavStep = 'back' | 'forward' | { jump: number };

export type SelectionNavEntry<C> = {
  refnos: string[];
  /** 主选中（属性面板跟它） */
  active: string;
  /** 离开这一条时的相机；刚入栈还没离开过时是入栈那一刻的。没有视口时为 `null`。 */
  camera: C | null;
};

export const SELECTION_HISTORY_CAP = 50;

function samePlace<C>(a: SelectionNavEntry<C>, b: SelectionNavEntry<C>): boolean {
  return a.active === b.active
    && a.refnos.length === b.refnos.length
    && a.refnos.every((refno, i) => refno === b.refnos[i]);
}

export function createSelectionHistory<C>(cap = SELECTION_HISTORY_CAP) {
  let entries: SelectionNavEntry<C>[] = [];
  let cursor: number | null = null;

  return {
    entries(): readonly SelectionNavEntry<C>[] {
      return entries;
    },

    cursor(): number | null {
      return cursor;
    },

    /**
     * 一次新的选中落地。`leavingCamera` 是此刻的相机，先写回当前条目再推新的。
     * 与当前条目同一处就不记（树上点两下同一行不该占两格）。返回是否真的入栈。
     */
    record(entry: SelectionNavEntry<C>, leavingCamera: C | null): boolean {
      const current = cursor === null ? undefined : entries[cursor];
      if (current) {
        if (samePlace(current, entry)) return false;
        if (leavingCamera !== null) current.camera = leavingCamera;
      }
      if (cursor !== null) entries = entries.slice(0, cursor + 1);
      entries.push({ ...entry, refnos: [...entry.refnos] });
      if (entries.length > cap) entries = entries.slice(entries.length - cap);
      cursor = entries.length - 1;
      return true;
    },

    /**
     * 走一步。先把此刻的相机写回当前条目（前进也要能回到刚才的画面），再移游标，交出目标条目的副本；
     * 走不动（栈空 / 到头 / 越界 / 原地）时 `null`。
     */
    step(step: SelectionNavStep, leavingCamera: C | null): SelectionNavEntry<C> | null {
      if (cursor === null) return null;
      const target = step === 'back' ? cursor - 1 : step === 'forward' ? cursor + 1 : step.jump;
      if (!Number.isInteger(target) || target < 0 || target === cursor || target >= entries.length) return null;
      if (leavingCamera !== null) entries[cursor]!.camera = leavingCamera;
      cursor = target;
      const hit = entries[target]!;
      return { ...hit, refnos: [...hit.refnos] };
    },

    clear(): void {
      entries = [];
      cursor = null;
    },
  };
}

export type SelectionHistory<C> = ReturnType<typeof createSelectionHistory<C>>;
