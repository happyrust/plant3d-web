import { describe, expect, it, vi } from 'vitest';

import { useToolStore } from './useToolStore';

describe('useToolStore.startBoxPickRefno', () => {
  it('设置 toolMode=pick_refno_box + 大写 nounFilter + 重置 pickedRefnos', () => {
    const store = useToolStore();
    store.addPickedRefno('STALE-1');

    const cb = vi.fn();
    store.startBoxPickRefno(['bran'], cb);

    expect(store.toolMode.value).toBe('pick_refno_box');
    expect(store.pickRefnoFilter.value).toEqual(['BRAN']);
    expect(store.pickedRefnos.value).toEqual([]);
    expect(store.pickRefnoCallback.value).toBe(cb);
  });

  it('addPickedRefno 累加后 confirmPickRefno 回调收到所有 refnos 并把 toolMode 回 none', () => {
    const store = useToolStore();
    const cb = vi.fn();
    store.startBoxPickRefno(['BRAN'], cb);

    store.addPickedRefno('BRAN/1');
    store.addPickedRefno('BRAN/2');
    store.addPickedRefno('BRAN/1');

    expect(store.pickedRefnos.value).toEqual(['BRAN/1', 'BRAN/2']);

    store.confirmPickRefno();

    expect(cb).toHaveBeenCalledWith(['BRAN/1', 'BRAN/2']);
    expect(store.toolMode.value).toBe('none');
    expect(store.pickRefnoFilter.value).toEqual([]);
  });

  it('cancelPickRefno 清空 pickedRefnos，触发取消回调且不触发确认回调', () => {
    const store = useToolStore();
    const cb = vi.fn();
    const onCancel = vi.fn();
    store.startBoxPickRefno(['BRAN'], cb, onCancel);
    store.addPickedRefno('BRAN/9');

    store.cancelPickRefno();

    expect(cb).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledOnce();
    expect(store.toolMode.value).toBe('none');
    expect(store.pickedRefnos.value).toEqual([]);
  });

  it('从 pick_refno_box 切到非拾取模式时 filter / callback 被清理', () => {
    const store = useToolStore();
    const cb = vi.fn();
    store.startBoxPickRefno(['BRAN'], cb);

    store.setToolMode('none');

    expect(store.pickRefnoFilter.value).toEqual([]);
    expect(store.pickRefnoCallback.value).toBeNull();
  });

  it('从 pick_refno 切到 pick_refno_box 时 filter / callback 不被清理', () => {
    const store = useToolStore();
    const cb = vi.fn();
    store.startPickRefno(['BRAN'], cb);
    expect(store.toolMode.value).toBe('pick_refno');

    store.setToolMode('pick_refno_box');

    expect(store.toolMode.value).toBe('pick_refno_box');
    expect(store.pickRefnoFilter.value).toEqual(['BRAN']);
    expect(store.pickRefnoCallback.value).toBe(cb);
  });
});
