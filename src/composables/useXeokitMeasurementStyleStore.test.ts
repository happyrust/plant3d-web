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

  it('V5 老用户迁移时一次性强开轴向分量，其余用户值保留', async () => {
    // 先写一次持久化，取得实际的 scoped V8 key，从而推导同 scope 的 V5 key。
    {
      const { useXeokitMeasurementStyleStore } = await import('@/composables/useXeokitMeasurementStyleStore');
      useXeokitMeasurementStyleStore().updateStyle({ distanceShowMarkers: false });
      await nextTick();
    }
    const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)!);
    const v8Key = keys.find((key) => key.includes('measurement-style-v8'))!;
    expect(v8Key).toBeTruthy();
    const v5Key = v8Key.replace('measurement-style-v8', 'measurement-style-v5');

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

      // 用户关掉后写入 V8，重载后不再被强开。
      style.updateStyle({ distanceShowAxisBreakdown: false });
      await nextTick();
    }

    vi.resetModules();
    const { useXeokitMeasurementStyleStore } = await import('@/composables/useXeokitMeasurementStyleStore');
    expect(useXeokitMeasurementStyleStore().state.distanceShowAxisBreakdown).toBe(false);
  });

  it('V6 老配置升级到 V8 后默认保留标注，用户显式关闭后可持久化', async () => {
    // 推导同 scope 的 V6 key，模拟 V6 老用户（无旧 persistDimension 字段）。
    {
      const { useXeokitMeasurementStyleStore } = await import('@/composables/useXeokitMeasurementStyleStore');
      useXeokitMeasurementStyleStore().updateStyle({ distanceShowMarkers: false });
      await nextTick();
    }
    const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)!);
    const v8Key = keys.find((key) => key.includes('measurement-style-v8'))!;
    const v6Key = v8Key.replace('measurement-style-v8', 'measurement-style-v6');

    localStorage.clear();
    localStorage.setItem(v6Key, JSON.stringify({
      distanceShowMarkers: false,
      // V6 时代不存在 persistDimension；即使残留同名脏字段也不应改变默认迁移。
      persistDimension: false,
    }));

    vi.resetModules();
    {
      const { useXeokitMeasurementStyleStore } = await import('@/composables/useXeokitMeasurementStyleStore');
      const style = useXeokitMeasurementStyleStore();
      expect(style.state.keepMeasurementAnnotation).toBe(true);
      expect(style.state.showDirectLinearDimension).toBe(true);
      expect(style.state.distanceShowMarkers).toBe(false);

      style.updateStyle({
        keepMeasurementAnnotation: false,
        showDirectLinearDimension: false,
      });
      await nextTick();
    }

    vi.resetModules();
    const { useXeokitMeasurementStyleStore } = await import('@/composables/useXeokitMeasurementStyleStore');
    const style = useXeokitMeasurementStyleStore();
    expect(style.state.keepMeasurementAnnotation).toBe(false);
    expect(style.state.showDirectLinearDimension).toBe(false);
  });

  it('Perpendicular to 默认关闭；开启后持久化到 V8 并在重载后恢复，脏值不会误开', async () => {
    {
      const { useXeokitMeasurementStyleStore } = await import('@/composables/useXeokitMeasurementStyleStore');
      const style = useXeokitMeasurementStyleStore();
      expect(style.state.perpendicularTo).toBe(false);
      style.updateStyle({ perpendicularTo: true });
      await nextTick();
    }

    vi.resetModules();
    {
      const { useXeokitMeasurementStyleStore } = await import('@/composables/useXeokitMeasurementStyleStore');
      expect(useXeokitMeasurementStyleStore().state.perpendicularTo).toBe(true);
    }

    const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)!);
    const v8Key = keys.find((key) => key.includes('measurement-style-v8'))!;
    localStorage.setItem(v8Key, JSON.stringify({ perpendicularTo: 'yes' }));
    vi.resetModules();
    const { useXeokitMeasurementStyleStore } = await import('@/composables/useXeokitMeasurementStyleStore');
    expect(useXeokitMeasurementStyleStore().state.perpendicularTo).toBe(false);
  });

  it('V7 persistDimension 仅迁移为 Web 标注保留开关，不再冒充 Show linear dimension', async () => {
    {
      const { useXeokitMeasurementStyleStore } = await import('@/composables/useXeokitMeasurementStyleStore');
      useXeokitMeasurementStyleStore().updateStyle({ distanceShowMarkers: false });
      await nextTick();
    }
    const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)!);
    const v8Key = keys.find((key) => key.includes('measurement-style-v8'))!;
    const v7Key = v8Key.replace('measurement-style-v8', 'measurement-style-v7');

    localStorage.clear();
    localStorage.setItem(v7Key, JSON.stringify({
      persistDimension: false,
      distanceShowMarkers: false,
    }));

    vi.resetModules();
    const { useXeokitMeasurementStyleStore } = await import('@/composables/useXeokitMeasurementStyleStore');
    const style = useXeokitMeasurementStyleStore();
    expect(style.state.keepMeasurementAnnotation).toBe(false);
    expect(style.state.showDirectLinearDimension).toBe(true);
    expect(style.state.distanceShowMarkers).toBe(false);
  });
});
