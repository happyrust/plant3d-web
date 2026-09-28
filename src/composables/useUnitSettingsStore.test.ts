import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';

describe('useUnitSettingsStore · V2 迁移（E3D 默认 mm + 0 位小数）', () => {
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

  it('全新用户默认显示单位 mm、精度 0', async () => {
    const { useUnitSettingsStore } = await import('@/composables/useUnitSettingsStore');
    const store = useUnitSettingsStore();
    expect(store.displayUnit.value).toBe('mm');
    expect(store.precision.value).toBe(0);
  });

  it('V1 老用户迁移：显示单位一次性切 mm + 0，其余设置保留', async () => {
    localStorage.setItem('plant3d-web-unit-settings-v1', JSON.stringify({
      version: 1,
      modelUnit: 'm',
      displayUnit: 'cm',
      precision: 3,
      recenter: false,
      clip: true,
      autoFitOnLoad: false,
      ptsetDisplayPolicy: 'follow_backend',
    }));

    const { useUnitSettingsStore } = await import('@/composables/useUnitSettingsStore');
    const store = useUnitSettingsStore();
    expect(store.displayUnit.value).toBe('mm');
    expect(store.precision.value).toBe(0);
    expect(store.modelUnit.value).toBe('m');
    expect(store.recenter.value).toBe(false);
    expect(store.autoFitOnLoad.value).toBe(false);
    expect(store.ptsetDisplayPolicy.value).toBe('follow_backend');
  });

  it('迁移后用户改回 m + 2 会持久化到 V2，重载不再被强制切换', async () => {
    localStorage.setItem('plant3d-web-unit-settings-v1', JSON.stringify({
      version: 1,
      modelUnit: 'mm',
      displayUnit: 'm',
      precision: 2,
      recenter: true,
      clip: true,
      autoFitOnLoad: true,
      ptsetDisplayPolicy: 'use_display_unit',
    }));

    {
      const { useUnitSettingsStore } = await import('@/composables/useUnitSettingsStore');
      const store = useUnitSettingsStore();
      expect(store.displayUnit.value).toBe('mm');
      store.setDisplayUnit('m');
      store.setPrecision(2);
      await nextTick();
    }

    vi.resetModules();
    const { useUnitSettingsStore } = await import('@/composables/useUnitSettingsStore');
    const store = useUnitSettingsStore();
    expect(store.displayUnit.value).toBe('m');
    expect(store.precision.value).toBe(2);
  });
});
