import { describe, expect, it } from 'vitest';

import { DEFAULT_DROPDOWN_PLACEMENT, measureNaturalHeight, resolveDropdownPlacement } from './dropdownPlacement';

// 容器 83→499（416 px，与 #81 真机一致），菜单 7 项自然高 216 px
const container = { containerTop: 83, containerBottom: 499 };

describe('resolveDropdownPlacement', () => {
  it('下方放得下就向下开、不限高（按钮靠上）', () => {
    expect(resolveDropdownPlacement({ ...container, anchorTop: 100, anchorBottom: 136, menuHeight: 216 }))
      .toEqual({ up: false, maxHeight: null });
  });

  it('下方放不下、上方放得下就向上翻（#81 真机：按钮顶 342，342 + 216 > 499 - 8）', () => {
    expect(resolveDropdownPlacement({ ...container, anchorTop: 342, anchorBottom: 378, menuHeight: 216 }))
      .toEqual({ up: true, maxHeight: null });
  });

  it('正好卡在留白边上：差 1 px 就翻', () => {
    // 容器底 499 - 留白 8 = 491；按钮顶 275 + 216 = 491 放得下，276 就放不下
    expect(resolveDropdownPlacement({ ...container, anchorTop: 275, anchorBottom: 311, menuHeight: 216 }).up).toBe(false);
    expect(resolveDropdownPlacement({ ...container, anchorTop: 276, anchorBottom: 312, menuHeight: 216 }).up).toBe(true);
  });

  it('两头都放不下：选空间大的一侧并限高到那一侧', () => {
    // 容器只有 200 px 高（100→300），按钮 150→186：下方 300-8-150 = 142，上方 186-8-100 = 78
    const below = resolveDropdownPlacement({ containerTop: 100, containerBottom: 300, anchorTop: 150, anchorBottom: 186, menuHeight: 216 });
    expect(below).toEqual({ up: false, maxHeight: 142 });
    // 按钮 240→276：下方 300-8-240 = 52，上方 276-8-100 = 168 → 向上限高 168
    const above = resolveDropdownPlacement({ containerTop: 100, containerBottom: 300, anchorTop: 240, anchorBottom: 276, menuHeight: 216 });
    expect(above).toEqual({ up: true, maxHeight: 168 });
  });

  it('margin 可调；负空间钳到 0 不会给出负限高', () => {
    expect(resolveDropdownPlacement({ ...container, anchorTop: 480, anchorBottom: 516, menuHeight: 216, margin: 0 }))
      .toEqual({ up: true, maxHeight: null });
    // 锚点整个跑到容器下面：下方空间是负数、钳到 0，上方 236-8-100 = 128 → 向上限高 128
    expect(resolveDropdownPlacement({ containerTop: 100, containerBottom: 110, anchorTop: 200, anchorBottom: 236, menuHeight: 216 }))
      .toEqual({ up: true, maxHeight: 128 });
  });

  it('缺省落位是向下、不限高', () => {
    expect(DEFAULT_DROPDOWN_PLACEMENT).toEqual({ up: false, maxHeight: null });
  });
});

describe('measureNaturalHeight（#83：开着缩窗重算时要量不限高的高度）', () => {
  it('量的时候把内联 max-height / overflow-y 清掉，量完原样恢复', () => {
    const el = document.createElement('div');
    el.style.maxHeight = '476px';
    el.style.overflowY = 'auto';
    const seen: { maxHeight: string; overflowY: string }[] = [];
    el.getBoundingClientRect = () => {
      seen.push({ maxHeight: el.style.maxHeight, overflowY: el.style.overflowY });
      // 没限高时的自然高度
      return { height: 648, width: 288, top: 0, left: 0, right: 288, bottom: 648, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    };

    expect(measureNaturalHeight(el)).toBe(648);
    expect(seen).toEqual([{ maxHeight: '', overflowY: '' }]);
    expect(el.style.maxHeight).toBe('476px');
    expect(el.style.overflowY).toBe('auto');
  });

  it('本来没限高的元素量完也不会多出内联样式', () => {
    const el = document.createElement('div');
    el.getBoundingClientRect = () => ({ height: 217 } as DOMRect);
    expect(measureNaturalHeight(el)).toBe(217);
    expect(el.style.maxHeight).toBe('');
    expect(el.style.overflowY).toBe('');
    expect(el.getAttribute('style') ?? '').not.toMatch(/max-height|overflow/);
  });
});
