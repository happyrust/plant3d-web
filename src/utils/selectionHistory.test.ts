import { describe, expect, it } from 'vitest';

import { createSelectionHistory, SELECTION_HISTORY_CAP, type SelectionNavEntry } from './selectionHistory';

function entry(refno: string): SelectionNavEntry<number> {
  return { refnos: [refno], active: refno, camera: null };
}

describe('createSelectionHistory', () => {
  it('后退之后做新操作截断前向分支', () => {
    const nav = createSelectionHistory<number>();
    for (const r of ['1', '2', '3']) nav.record(entry(r), null);
    expect(nav.step('back', null)?.active).toBe('2');
    expect(nav.step('back', null)?.active).toBe('1');
    expect(nav.step('back', null)).toBeNull();
    expect(nav.step('forward', null)?.active).toBe('2');

    nav.record(entry('9'), null);
    expect(nav.entries().map((e) => e.active)).toEqual(['1', '2', '9']);
    expect(nav.cursor()).toBe(2);
    expect(nav.step('forward', null)).toBeNull();
  });

  it('相机记的是离开那一刻', () => {
    const nav = createSelectionHistory<number>();
    nav.record({ ...entry('1'), camera: 0 }, 0);
    nav.record({ ...entry('2'), camera: 5 }, 5);
    expect(nav.entries()[0]!.camera).toBe(5);
    const back = nav.step('back', 7);
    expect(back?.camera).toBe(5);
    expect(nav.entries()[1]!.camera).toBe(7);
    expect(nav.step('forward', 5.5)?.camera).toBe(7);
  });

  it('同一处不重复入栈', () => {
    const nav = createSelectionHistory<number>();
    expect(nav.record(entry('1'), null)).toBe(true);
    expect(nav.record(entry('1'), null)).toBe(false);
    expect(nav.entries()).toHaveLength(1);
    nav.record({ refnos: ['1', '2'], active: '1', camera: null }, null);
    expect(nav.entries()).toHaveLength(2);
  });

  it('上限之上丢最老的，jump 越界或原地无操作', () => {
    const nav = createSelectionHistory<number>();
    for (let r = 1; r <= SELECTION_HISTORY_CAP + 5; r++) nav.record(entry(String(r)), null);
    expect(nav.entries()).toHaveLength(SELECTION_HISTORY_CAP);
    expect(nav.entries()[0]!.active).toBe('6');
    expect(nav.cursor()).toBe(SELECTION_HISTORY_CAP - 1);
    expect(nav.step({ jump: SELECTION_HISTORY_CAP }, null)).toBeNull();
    expect(nav.step({ jump: SELECTION_HISTORY_CAP - 1 }, null)).toBeNull();
    expect(nav.step({ jump: 0 }, null)?.active).toBe('6');
    nav.clear();
    expect(nav.step('forward', null)).toBeNull();
    expect(nav.cursor()).toBeNull();
  });
});
