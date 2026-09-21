import { describe, expect, it, vi } from 'vitest';

import { Color } from 'three';

import { SelectionManager } from './SelectionManager';

const hexOf = (c: Color | null): string | null => (c ? c.getHexString() : null);

function setup(options: ConstructorParameters<typeof SelectionManager>[0] = {}) {
  const manager = new SelectionManager(options);
  const colours = new Map<string, string | null>();
  const cb = vi.fn((id: string, c: Color | null) => {
    colours.set(id, hexOf(c));
  });
  manager.setColorUpdateCallback(cb);
  return { manager, colours, cb };
}

describe('SelectionManager', () => {
  it('默认口径：不设 primarySelectionColor 时所有选中都用 selectionColor', () => {
    const { manager, colours } = setup({ selectionColor: 0xff4fd8 });
    manager.select('a');
    manager.select('b', true);
    expect(colours.get('a')).toBe('ff4fd8');
    expect(colours.get('b')).toBe('ff4fd8');
    expect(manager.getPrimarySelected()).toEqual([]);
    expect(manager.getPrimarySelectionColor()).toBeNull();
  });

  it('E3D 口径：最近一批选进来的是 CE（yellow），更早追加选中的退成 highlight（white）', () => {
    const { manager, colours } = setup({ selectionColor: 0xffffff, primarySelectionColor: 0xffff00 });
    // 一个 refno 多个 objectId 一起选 → 整批都是 CE
    manager.select(['a1', 'a2']);
    expect(colours.get('a1')).toBe('ffff00');
    expect(colours.get('a2')).toBe('ffff00');
    expect(manager.getPrimarySelected().sort()).toEqual(['a1', 'a2']);

    // Ctrl 追加：新的一批成 CE，旧的退成 white
    manager.select('b', true);
    expect(colours.get('b')).toBe('ffff00');
    expect(colours.get('a1')).toBe('ffffff');
    expect(colours.get('a2')).toBe('ffffff');
    expect(manager.getSelected().sort()).toEqual(['a1', 'a2', 'b']);
    expect(manager.getPrimarySelected()).toEqual(['b']);

    // 再点回已选中的 a1（追加）：a1 变 CE，b 退成 white
    manager.select('a1', true);
    expect(colours.get('a1')).toBe('ffff00');
    expect(colours.get('b')).toBe('ffffff');

    // 取消 CE：颜色还原，CE 集合清空
    manager.deselect('a1');
    expect(colours.get('a1')).toBeNull();
    expect(manager.getPrimarySelected()).toEqual([]);

    // 非追加重选：其它全部还原
    manager.select('c');
    expect(colours.get('c')).toBe('ffff00');
    expect(colours.get('a2')).toBeNull();
    expect(colours.get('b')).toBeNull();

    manager.clearSelection();
    expect(colours.get('c')).toBeNull();
    expect(manager.getPrimarySelected()).toEqual([]);
  });

  it('运行时切换口径：setPrimarySelectionColor 立即刷已选中对象；null 回到单色', () => {
    const { manager, colours } = setup({ selectionColor: 0xff4fd8 });
    manager.select('a');
    manager.select('b', true);

    manager.setPrimarySelectionColor(0xffff00);
    manager.setSelectionColor(0xffffff);
    // 最近一批（b）是 CE
    expect(colours.get('b')).toBe('ffff00');
    expect(colours.get('a')).toBe('ffffff');
    expect(hexOf(manager.getPrimarySelectionColor())).toBe('ffff00');

    manager.setPrimarySelectionColor(null);
    manager.setSelectionColor(0xff4fd8);
    expect(colours.get('a')).toBe('ff4fd8');
    expect(colours.get('b')).toBe('ff4fd8');
    expect(manager.getPrimarySelected()).toEqual([]);
  });

  it('悬停高亮：未选中对象用 highlightColor，选中对象不被悬停色覆盖', () => {
    const { manager, colours } = setup({ selectionColor: 0xffffff, primarySelectionColor: 0xffff00, highlightColor: 0xffffff });
    manager.select('a');
    manager.highlight('a');
    expect(colours.get('a')).toBe('ffff00');
    manager.highlight('h');
    expect(colours.get('h')).toBe('ffffff');
    manager.clearHighlight();
    expect(colours.get('h')).toBeNull();
    manager.setHighlightColor(0xffaa44);
    manager.highlight('h');
    expect(colours.get('h')).toBe('ffaa44');
  });
});
