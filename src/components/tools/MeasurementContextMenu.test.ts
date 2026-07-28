import { describe, expect, it, vi } from 'vitest';
import { createApp, nextTick } from 'vue';

import MeasurementContextMenu from './MeasurementContextMenu.vue';

import type { XeokitMeasurementRecord } from '@/composables/useToolStore';

const distanceRecord: XeokitMeasurementRecord = {
  id: 'x1',
  kind: 'distance',
  origin: { entityId: 'a', worldPos: [0, 0, 0], designWorldPos: [0, 0, 0] },
  target: { entityId: 'b', worldPos: [1, 0, 0], designWorldPos: [1.52, 0, 0] },
  visible: true,
  approximate: false,
  createdAt: 1,
};

const angleRecord: XeokitMeasurementRecord = {
  id: 'a1',
  kind: 'angle',
  origin: { entityId: 'a', worldPos: [1, 0, 0] },
  corner: { entityId: 'b', worldPos: [0, 0, 0] },
  target: { entityId: 'c', worldPos: [0, 1, 0] },
  visible: true,
  approximate: false,
  createdAt: 1,
};

function mountMenu(record: XeokitMeasurementRecord, listeners: Record<string, unknown> = {}) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const app = createApp(MeasurementContextMenu, {
    x: 12,
    y: 24,
    record,
    axisBreakdownEnabled: false,
    displayUnit: 'm',
    ...listeners,
  });
  app.mount(host);
  return { app, host };
}

describe('MeasurementContextMenu', () => {
  it('距离测量显示全部 8 项菜单能力，并派发对应动作', async () => {
    const onToggleAxis = vi.fn();
    const onChangeUnit = vi.fn();
    const onCopyComponents = vi.fn();
    const onRepeat = vi.fn();
    const { app, host } = mountMenu(distanceRecord, {
      onToggleAxis,
      onChangeUnit,
      onCopyComponents,
      onRepeat,
    });
    await nextTick();

    expect(host.querySelector('[data-testid="measurement-menu-display-axis"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="measurement-menu-change-unit"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="measurement-menu-copy-value"]')?.textContent).toContain('复制距离值');
    expect(host.querySelector('[data-testid="measurement-menu-copy-components"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="measurement-menu-repeat"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="measurement-menu-locate"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="measurement-menu-toggle-visible"]')?.textContent).toContain('隐藏当前测量');
    expect(host.querySelector('[data-testid="measurement-menu-remove"]')).toBeTruthy();

    (host.querySelector('[data-testid="measurement-menu-display-axis"]') as HTMLButtonElement).click();
    expect(onToggleAxis).toHaveBeenCalledTimes(1);

    (host.querySelector('[data-testid="measurement-menu-unit-mm"]') as HTMLButtonElement).click();
    expect(onChangeUnit).toHaveBeenCalledWith('mm');

    (host.querySelector('[data-testid="measurement-menu-copy-components"]') as HTMLButtonElement).click();
    expect(onCopyComponents).toHaveBeenCalledTimes(1);

    (host.querySelector('[data-testid="measurement-menu-repeat"]') as HTMLButtonElement).click();
    expect(onRepeat).toHaveBeenCalledTimes(1);

    app.unmount();
    host.remove();
  });

  it('角度测量按类型收敛菜单项：无轴向/单位/分量/Repeat', async () => {
    const { app, host } = mountMenu(angleRecord);
    await nextTick();

    expect(host.querySelector('[data-testid="measurement-menu-display-axis"]')).toBeNull();
    expect(host.querySelector('[data-testid="measurement-menu-change-unit"]')).toBeNull();
    expect(host.querySelector('[data-testid="measurement-menu-copy-components"]')).toBeNull();
    expect(host.querySelector('[data-testid="measurement-menu-repeat"]')).toBeNull();
    expect(host.querySelector('[data-testid="measurement-menu-copy-value"]')?.textContent).toContain('复制角度值');
    expect(host.querySelector('[data-testid="measurement-menu-locate"]')).toBeTruthy();

    app.unmount();
    host.remove();
  });

  it('点击遮罩或按 Esc 关闭菜单', async () => {
    const onClose = vi.fn();
    const { app, host } = mountMenu(distanceRecord, { onClose });
    await nextTick();

    const backdrop = host.querySelector('[data-testid="measurement-context-menu-backdrop"]') as HTMLElement;
    backdrop.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(onClose).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onClose).toHaveBeenCalledTimes(2);

    app.unmount();
    host.remove();
  });
});
