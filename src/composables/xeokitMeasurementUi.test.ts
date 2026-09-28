import { describe, expect, it } from 'vitest';

describe('xeokitMeasurementUi', () => {
  it('应在 hover 丢失时回退显示 pointer lens 提示', async () => {
    const { formatXeokitHoverHint } = await import('./xeokitMeasurementUi');

    expect(
      formatXeokitHoverHint({
        hover: {
          visible: false,
          snapped: false,
          entityId: null,
          objectId: null,
          worldPos: null,
          canvasPos: { x: 10, y: 10 },
        },
        lens: {
          visible: true,
          snapped: false,
          title: '等待拐点',
          subtitle: '当前未命中可拾取面',
          canvasPos: { x: 10, y: 10 },
        },
      }),
    ).toBe('等待拐点：当前未命中可拾取面');
  });

  it('应为不同角色返回不同的 snapped 调色板', async () => {
    const { getXeokitOverlayPalette } = await import('./xeokitMeasurementUi');

    const cornerPalette = getXeokitOverlayPalette('corner', true);
    const targetPalette = getXeokitOverlayPalette('target', true);
    const blankPalette = getXeokitOverlayPalette('hover', false);

    expect(cornerPalette.markerBorder).toBe('#60a5fa');
    expect(targetPalette.markerBorder).toBe('#34d399');
    expect(blankPalette.markerBorder).toBe('#f59e0b');
  });
});
