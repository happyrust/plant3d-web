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

  it('自由表面模式下关闭表面点捕捉应回落 E3D；E3D 模式下手动开表面点捕捉保持 E3D', async () => {
    const { useXeokitMeasurementStyleStore } = await import('@/composables/useXeokitMeasurementStyleStore');
    const style = useXeokitMeasurementStyleStore();
    style.resetStyle();

    style.setMeasurementPickMode('free_surface');
    style.updateMeasurementPickSource('mesh_pick_point', { snap: false });
    expect(style.state.measurementPickMode).toBe('e3d');

    style.updateMeasurementPickSource('mesh_pick_point', { snap: true });
    expect(style.state.measurementPickMode).toBe('e3d');
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
});
