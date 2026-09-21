import { beforeEach, describe, expect, it, vi } from 'vitest';

function createLocalStorageMock() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  };
}

async function loadStore() {
  const mod = await import('./useRenderLookStore');
  return mod;
}

describe('useRenderLookStore', () => {
  beforeEach(() => {
    vi.resetModules();
    (globalThis as unknown as { localStorage: Storage }).localStorage =
      createLocalStorageMock() as unknown as Storage;
  });

  it('默认 web 标准（pbr）+ 出厂 E3D 3.1 预设，四个子开关在预设出厂位', async () => {
    const { useRenderLookStore } = await loadStore();
    const store = useRenderLookStore();
    expect(store.mode.value).toBe('pbr');
    expect(store.enabled.value).toBe(false);
    expect(store.preset.value).toBe('e3d31-factory');
    expect(store.hlr.value).toBe(true);
    expect(store.ao.value).toBe(true);
    expect(store.gradient.value).toBe(true);
    expect(store.aa.value).toBe(true);
    expect(store.isModifiedFromPreset.value).toBe(false);
  });

  it('沿用 ViewerPanel 的 dtx_look* 落盘键：老会话的选择原样读回', async () => {
    localStorage.setItem('dtx_look', 'sgl');
    localStorage.setItem('dtx_look_preset', 'machine');
    localStorage.setItem('dtx_look_hlr', '1');
    localStorage.setItem('dtx_look_aa', '0');
    const { useRenderLookStore } = await loadStore();
    const store = useRenderLookStore();
    expect(store.mode.value).toBe('sgl');
    expect(store.preset.value).toBe('sgl-machine');
    // machine 预设四项全关；hlr 被单独覆盖成开
    expect(store.hlr.value).toBe(true);
    expect(store.ao.value).toBe(false);
    expect(store.gradient.value).toBe(false);
    expect(store.aa.value).toBe(false);
    expect(store.isModifiedFromPreset.value).toBe(true);
  });

  it('setMode / setPreset / setEffect 立即落盘，切预设把四个子开关归到出厂位', async () => {
    const { useRenderLookStore, RENDER_LOOK_STORAGE_KEYS } = await loadStore();
    const store = useRenderLookStore();

    store.setMode('sgl');
    expect(store.enabled.value).toBe(true);
    expect(localStorage.getItem(RENDER_LOOK_STORAGE_KEYS.mode)).toBe('sgl');

    store.setEffect('hlr', false);
    expect(store.hlr.value).toBe(false);
    expect(localStorage.getItem(RENDER_LOOK_STORAGE_KEYS.hlr)).toBe('0');
    expect(store.isModifiedFromPreset.value).toBe(true);

    store.setPreset('sgl-machine');
    expect(store.preset.value).toBe('sgl-machine');
    expect(store.hlr.value).toBe(false);
    expect(store.ao.value).toBe(false);
    expect(store.gradient.value).toBe(false);
    expect(store.aa.value).toBe(false);
    expect(store.isModifiedFromPreset.value).toBe(false);
    expect(localStorage.getItem(RENDER_LOOK_STORAGE_KEYS.preset)).toBe('sgl-machine');
    expect(localStorage.getItem(RENDER_LOOK_STORAGE_KEYS.ao)).toBe('0');

    store.setEffect('ao', true);
    expect(store.isModifiedFromPreset.value).toBe(true);
    store.resetToPresetDefaults();
    expect(store.ao.value).toBe(false);
    expect(store.isModifiedFromPreset.value).toBe(false);

    store.setMode('pbr');
    expect(localStorage.getItem(RENDER_LOOK_STORAGE_KEYS.mode)).toBe('pbr');
  });

  it('URL 参数只覆盖本次、不落盘；dtx_look_preset 先归出厂位再被子开关参数覆盖', async () => {
    localStorage.setItem('dtx_look', 'pbr');
    const { useRenderLookStore, RENDER_LOOK_STORAGE_KEYS } = await loadStore();
    const store = useRenderLookStore();
    expect(store.mode.value).toBe('pbr');

    store.applyQueryOverrides(new URLSearchParams('dtx_look=sgl&dtx_look_preset=factory&dtx_look_hlr=0&dtx_look_aa=0'));
    expect(store.mode.value).toBe('sgl');
    expect(store.preset.value).toBe('e3d31-factory');
    expect(store.hlr.value).toBe(false);
    expect(store.ao.value).toBe(true);
    expect(store.gradient.value).toBe(true);
    expect(store.aa.value).toBe(false);
    // 没落盘
    expect(localStorage.getItem(RENDER_LOOK_STORAGE_KEYS.mode)).toBe('pbr');
    expect(localStorage.getItem(RENDER_LOOK_STORAGE_KEYS.hlr)).toBeNull();

    // 空参数 / 非法预设不动现状
    store.applyQueryOverrides(new URLSearchParams('dtx_look_preset=nonsense'));
    expect(store.preset.value).toBe('e3d31-factory');
    expect(store.hlr.value).toBe(false);
  });

  it('hydrateFromStorage 重读落盘值，会丢掉未落盘的 URL 覆盖', async () => {
    localStorage.setItem('dtx_look', 'sgl');
    const { useRenderLookStore } = await loadStore();
    const store = useRenderLookStore();
    store.applyQueryOverrides(new URLSearchParams('dtx_look=pbr'));
    expect(store.mode.value).toBe('pbr');
    store.hydrateFromStorage();
    expect(store.mode.value).toBe('sgl');
  });
});
