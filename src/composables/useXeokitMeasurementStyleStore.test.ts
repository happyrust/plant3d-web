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
    // 先写一次持久化，取得实际的 scoped V9 key，从而推导同 scope 的 V5 key。
    {
      const { useXeokitMeasurementStyleStore } = await import('@/composables/useXeokitMeasurementStyleStore');
      useXeokitMeasurementStyleStore().updateStyle({ distanceShowMarkers: false });
      await nextTick();
    }
    const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)!);
    const v9Key = keys.find((key) => key.includes('measurement-style-v9'))!;
    expect(v9Key).toBeTruthy();
    const v5Key = v9Key.replace('measurement-style-v9', 'measurement-style-v5');

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

      // 用户关掉后写入 V9，重载后不再被强开。
      style.updateStyle({ distanceShowAxisBreakdown: false });
      await nextTick();
    }

    vi.resetModules();
    const { useXeokitMeasurementStyleStore } = await import('@/composables/useXeokitMeasurementStyleStore');
    expect(useXeokitMeasurementStyleStore().state.distanceShowAxisBreakdown).toBe(false);
  });

  it('V6 老配置升级到 V9 后默认保留标注，用户显式关闭后可持久化', async () => {
    // 推导同 scope 的 V6 key，模拟 V6 老用户（无旧 persistDimension 字段）。
    {
      const { useXeokitMeasurementStyleStore } = await import('@/composables/useXeokitMeasurementStyleStore');
      useXeokitMeasurementStyleStore().updateStyle({ distanceShowMarkers: false });
      await nextTick();
    }
    const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)!);
    const v9Key = keys.find((key) => key.includes('measurement-style-v9'))!;
    const v6Key = v9Key.replace('measurement-style-v9', 'measurement-style-v6');

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

  it('Perpendicular to 默认关闭；开启后持久化到 V9 并在重载后恢复，脏值不会误开', async () => {
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
    const v9Key = keys.find((key) => key.includes('measurement-style-v9'))!;
    localStorage.setItem(v9Key, JSON.stringify({ perpendicularTo: 'yes' }));
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
    const v9Key = keys.find((key) => key.includes('measurement-style-v9'))!;
    const v7Key = v9Key.replace('measurement-style-v9', 'measurement-style-v7');

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

  it('V8 老配置升级到 V9：拾取层按 E3D 缺省起步（Any × Snap，Significant Snaps 开），其余字段原样保留', async () => {
    {
      const { useXeokitMeasurementStyleStore } = await import('@/composables/useXeokitMeasurementStyleStore');
      useXeokitMeasurementStyleStore().updateStyle({ distanceShowMarkers: false });
      await nextTick();
    }
    const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)!);
    const v9Key = keys.find((key) => key.includes('measurement-style-v9'))!;
    const v8Key = v9Key.replace('measurement-style-v9', 'measurement-style-v8');

    localStorage.clear();
    localStorage.setItem(v8Key, JSON.stringify({
      distanceShowMarkers: false,
      perpendicularTo: true,
      keepMeasurementAnnotation: false,
    }));

    vi.resetModules();
    const { useXeokitMeasurementStyleStore } = await import('@/composables/useXeokitMeasurementStyleStore');
    const style = useXeokitMeasurementStyleStore();
    expect(style.state.distanceShowMarkers).toBe(false);
    expect(style.state.perpendicularTo).toBe(true);
    expect(style.state.keepMeasurementAnnotation).toBe(false);
    expect(style.state.measurementPickLayer).toEqual({
      filter: 'any',
      pickType: 'snap',
      values: { distanceMm: 0, fraction: 2, proportion: 0.5 },
      significantSnaps: true,
      plineCut: false,
      significantSnapPoints: { fitting: false, joint: false, node: false },
    });
  });

  it('拾取层：改过滤器 / 拾取类型 / 取值后持久化到 V9 并在重载后恢复；不可用项与脏值回 E3D 缺省', async () => {
    {
      const { useXeokitMeasurementStyleStore } = await import('@/composables/useXeokitMeasurementStyleStore');
      const style = useXeokitMeasurementStyleStore();
      style.updateMeasurementPickLayer({ filter: 'ppoint', pickType: 'fraction', values: { fraction: 3 } });
      style.updateMeasurementPickLayer({ significantSnaps: false });
      // Pick Settings（Sections & Walls）：Pline 端点取 Cut，三档按字段合并。
      style.updateMeasurementPickLayer({ plineCut: true, significantSnapPoints: { node: true } });
      style.updateMeasurementPickLayer({ significantSnapPoints: { joint: true } });
      await nextTick();
      expect(style.state.measurementPickLayer.filter).toBe('ppoint');
      expect(style.state.measurementPickLayer.pickType).toBe('fraction');
      expect(style.state.measurementPickLayer.values).toEqual({ distanceMm: 0, fraction: 3, proportion: 0.5 });
      expect(style.state.measurementPickLayer.significantSnaps).toBe(false);
      expect(style.state.measurementPickLayer.plineCut).toBe(true);
      expect(style.state.measurementPickLayer.significantSnapPoints).toEqual({ fitting: false, joint: true, node: true });
    }

    vi.resetModules();
    {
      const { useXeokitMeasurementStyleStore } = await import('@/composables/useXeokitMeasurementStyleStore');
      const layer = useXeokitMeasurementStyleStore().state.measurementPickLayer;
      expect(layer.filter).toBe('ppoint');
      expect(layer.pickType).toBe('fraction');
      expect(layer.values.fraction).toBe(3);
      expect(layer.significantSnaps).toBe(false);
      expect(layer.plineCut).toBe(true);
      expect(layer.significantSnapPoints).toEqual({ fitting: false, joint: true, node: true });
    }

    // 不可用的过滤器（Aid）/ 未知类型与非法取值：读回时回 E3D 缺省，Fraction 取整且 ≥ 1。
    const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)!);
    const v9Key = keys.find((key) => key.includes('measurement-style-v9'))!;
    localStorage.setItem(v9Key, JSON.stringify({
      measurementPickLayer: {
        filter: 'aid',
        pickType: 'bogus',
        values: { distanceMm: 'abc', fraction: 0.4, proportion: 0.25 },
        significantSnaps: 'yes',
        plineCut: 'cut',
        significantSnapPoints: { fitting: 1, node: true },
      },
    }));
    vi.resetModules();
    const { useXeokitMeasurementStyleStore } = await import('@/composables/useXeokitMeasurementStyleStore');
    expect(useXeokitMeasurementStyleStore().state.measurementPickLayer).toEqual({
      filter: 'any',
      pickType: 'snap',
      values: { distanceMm: 0, fraction: 1, proportion: 0.25 },
      significantSnaps: true,
      plineCut: false,
      significantSnapPoints: { fitting: false, joint: false, node: true },
    });
  });

  it('Units：缺省停在 Default 档；Display Unit 的上次选择记得住并持久化到 V9', async () => {
    {
      const { useXeokitMeasurementStyleStore } = await import('@/composables/useXeokitMeasurementStyleStore');
      const style = useXeokitMeasurementStyleStore();
      expect(style.state.measurementUnits).toEqual({ unitSystem: 'default', metricUnit: 'MM' });

      style.updateMeasurementUnits({ unitSystem: 'metric' });
      style.updateMeasurementUnits({ displayUnit: 'METRE' });
      style.updateMeasurementUnits({ unitSystem: 'default' });
      // 切回公制应回到上次选的那一档（E3D lastMetricSelection）。
      style.updateMeasurementUnits({ unitSystem: 'metric' });
      await nextTick();
      expect(style.state.measurementUnits).toEqual({ unitSystem: 'metric', metricUnit: 'METRE' });
    }

    vi.resetModules();
    {
      const { useXeokitMeasurementStyleStore } = await import('@/composables/useXeokitMeasurementStyleStore');
      expect(useXeokitMeasurementStyleStore().state.measurementUnits)
        .toEqual({ unitSystem: 'metric', metricUnit: 'METRE' });
    }

    // V9 里这一格是脏值 / 是撤掉的英制档：回 E3D 缺省（Default 档 = 随全局单位设置）。
    const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)!);
    const v9Key = keys.find((key) => key.includes('measurement-style-v9'))!;
    localStorage.setItem(v9Key, JSON.stringify({
      measurementUnits: { unitSystem: 'imperial', metricUnit: 'KM', imperialUnit: 'FT' },
    }));
    vi.resetModules();
    const { useXeokitMeasurementStyleStore } = await import('@/composables/useXeokitMeasurementStyleStore');
    expect(useXeokitMeasurementStyleStore().state.measurementUnits)
      .toEqual({ unitSystem: 'default', metricUnit: 'MM' });
  });

  it('角度 Units：缺省 Default / 2 位；Decimal Places 越界或非数字打回 2；持久化到 V9', async () => {
    {
      const { useXeokitMeasurementStyleStore } = await import('@/composables/useXeokitMeasurementStyleStore');
      const style = useXeokitMeasurementStyleStore();
      expect(style.state.measurementAngleUnits).toEqual({ unit: 'default', decimalPlaces: 2 });

      style.updateMeasurementAngleUnits({ unit: 'radians', decimalPlaces: 4 });
      await nextTick();
      expect(style.state.measurementAngleUnits).toEqual({ unit: 'radians', decimalPlaces: 4 });

      // E3D：0–8 之外的值被打回 2（窗体同时弹 Value must be between 0 and 8）。
      style.updateMeasurementAngleUnits({ decimalPlaces: 9 });
      expect(style.state.measurementAngleUnits.decimalPlaces).toBe(2);
      style.updateMeasurementAngleUnits({ decimalPlaces: 8 });
      expect(style.state.measurementAngleUnits.decimalPlaces).toBe(8);
      style.updateMeasurementAngleUnits({ decimalPlaces: Number.NaN });
      expect(style.state.measurementAngleUnits.decimalPlaces).toBe(2);
      // 单位不受小数位那一下影响。
      expect(style.state.measurementAngleUnits.unit).toBe('radians');
      await nextTick();
    }

    vi.resetModules();
    {
      const { useXeokitMeasurementStyleStore } = await import('@/composables/useXeokitMeasurementStyleStore');
      expect(useXeokitMeasurementStyleStore().state.measurementAngleUnits)
        .toEqual({ unit: 'radians', decimalPlaces: 2 });
    }

    const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)!);
    const v9Key = keys.find((key) => key.includes('measurement-style-v9'))!;
    localStorage.setItem(v9Key, JSON.stringify({
      measurementAngleUnits: { unit: 'turns', decimalPlaces: 12 },
    }));
    vi.resetModules();
    const { useXeokitMeasurementStyleStore } = await import('@/composables/useXeokitMeasurementStyleStore');
    expect(useXeokitMeasurementStyleStore().state.measurementAngleUnits)
      .toEqual({ unit: 'default', decimalPlaces: 2 });
  });
});
