import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';

describe('useXeokitMeasurementStyleStore · measurementPickMode', () => {
  beforeEach(() => {
    const storage = new Map<string, string>();
    (globalThis as any).localStorage = {
      getItem: (key: string) => (storage.has(key) ? storage.get(key)! : null),
      setItem: (key: string, value: string) => {
        storage.set(key, String(value));
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
      clear: () => {
        storage.clear();
      },
      key: (index: number) => Array.from(storage.keys())[index] ?? null,
      get length() {
        return storage.size;
      },
    };
    localStorage.clear();
    vi.resetModules();
  });

  it('默认 E3D 模式；切换自由表面时开启表面点捕捉，切回时恢复 E3D snap 契约', async () => {
    const { useXeokitMeasurementStyleStore } = await import('@/composables/useXeokitMeasurementStyleStore');
    const style = useXeokitMeasurementStyleStore();
    style.resetStyle();

    expect(style.state.measurementPickMode).toBe('e3d');
    expect(style.state.measurementPickSources.mesh_pick_point.snap).toBe(false);

    style.setMeasurementPickMode('free_surface');
    expect(style.state.measurementPickMode).toBe('free_surface');
    expect(style.state.measurementPickSources.mesh_pick_point.show).toBe(true);
    expect(style.state.measurementPickSources.mesh_pick_point.snap).toBe(true);

    style.updateMeasurementPickSource('ptset', { snap: false });
    style.setMeasurementPickMode('e3d');
    expect(style.state.measurementPickMode).toBe('e3d');
    expect(style.state.measurementPickSources.ptset.snap).toBe(true);
    expect(style.state.measurementPickSources.position.snap).toBe(true);
    expect(style.state.measurementPickSources.mesh_pick_point.snap).toBe(false);
  });

  it('自由表面模式下关闭表面点捕捉不再静默回落，模式与 snap 可自由组合', async () => {
    const { useXeokitMeasurementStyleStore } = await import('@/composables/useXeokitMeasurementStyleStore');
    const style = useXeokitMeasurementStyleStore();
    style.resetStyle();

    style.setMeasurementPickMode('free_surface');
    style.updateMeasurementPickSource('mesh_pick_point', { snap: false });
    // 不再隐式切模式（r3 评审 §1 #3）：由浮动条提示角标告知。
    expect(style.state.measurementPickMode).toBe('free_surface');
    expect(style.state.measurementPickSources.mesh_pick_point.snap).toBe(false);

    style.updateMeasurementPickSource('mesh_pick_point', { snap: true });
    expect(style.state.measurementPickMode).toBe('free_surface');
    expect(style.state.measurementPickSources.mesh_pick_point.snap).toBe(true);
  });

  it('每个模式记住用户上次的 snap 配置，切回时恢复；首次进入才用模式默认值', async () => {
    const { useXeokitMeasurementStyleStore } = await import('@/composables/useXeokitMeasurementStyleStore');
    const style = useXeokitMeasurementStyleStore();
    style.resetStyle();

    // E3D 下用户关掉 P-Point 捕捉，只用 Item 原点。
    style.updateMeasurementPickSource('ptset', { snap: false });

    // 首次进入自由表面：应用模式默认（表面点捕捉开启），其余 snap 保留。
    style.setMeasurementPickMode('free_surface');
    expect(style.state.measurementPickSources.mesh_pick_point.snap).toBe(true);
    expect(style.state.measurementPickSources.ptset.snap).toBe(false);

    // 自由表面下用户关掉 Item 原点捕捉。
    style.updateMeasurementPickSource('position', { snap: false });

    // 切回 E3D：恢复用户在 E3D 的偏好（P-Point 仍是关），不被契约强开。
    style.setMeasurementPickMode('e3d');
    expect(style.state.measurementPickSources.ptset.snap).toBe(false);
    expect(style.state.measurementPickSources.position.snap).toBe(true);
    expect(style.state.measurementPickSources.mesh_pick_point.snap).toBe(false);

    // 再切自由表面：恢复该模式记忆（Item 原点关、表面点开）。
    style.setMeasurementPickMode('free_surface');
    expect(style.state.measurementPickSources.position.snap).toBe(false);
    expect(style.state.measurementPickSources.mesh_pick_point.snap).toBe(true);
  });

  it('模式选择应持久化并在重新加载后恢复', async () => {
    {
      const { useXeokitMeasurementStyleStore } = await import('@/composables/useXeokitMeasurementStyleStore');
      const style = useXeokitMeasurementStyleStore();
      style.resetStyle();
      style.setMeasurementPickMode('free_surface');
      await nextTick();
    }

    vi.resetModules();
    const { useXeokitMeasurementStyleStore } = await import('@/composables/useXeokitMeasurementStyleStore');
    const style = useXeokitMeasurementStyleStore();
    expect(style.state.measurementPickMode).toBe('free_surface');
    expect(style.state.measurementPickSources.mesh_pick_point.snap).toBe(true);
  });

  it('V5 老用户迁移到 V6 时一次性强开轴向分量，其余用户值保留', async () => {
    // 先写一次持久化，取得实际的 scoped V6 key，从而推导同 scope 的 V5 key。
    {
      const { useXeokitMeasurementStyleStore } = await import('@/composables/useXeokitMeasurementStyleStore');
      useXeokitMeasurementStyleStore().updateStyle({ distanceShowMarkers: false });
      await nextTick();
    }
    const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)!);
    const v6Key = keys.find((key) => key.includes('measurement-style-v6'))!;
    expect(v6Key).toBeTruthy();
    const v5Key = v6Key.replace('measurement-style-v6', 'measurement-style-v5');

    localStorage.clear();
    localStorage.setItem(v5Key, JSON.stringify({
      distanceShowAxisBreakdown: false,
      distanceShowMarkers: false,
    }));

    vi.resetModules();
    {
      const { useXeokitMeasurementStyleStore } = await import('@/composables/useXeokitMeasurementStyleStore');
      const style = useXeokitMeasurementStyleStore();
      expect(style.state.distanceShowAxisBreakdown).toBe(true);
      expect(style.state.distanceShowMarkers).toBe(false);

      // 用户关掉后写入 V6，重载后不再被强开。
      style.updateStyle({ distanceShowAxisBreakdown: false });
      await nextTick();
    }

    vi.resetModules();
    const { useXeokitMeasurementStyleStore } = await import('@/composables/useXeokitMeasurementStyleStore');
    expect(useXeokitMeasurementStyleStore().state.distanceShowAxisBreakdown).toBe(false);
  });
});
