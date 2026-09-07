import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildExportConfig,
  clearModelDisplayConfigCache,
  loadModelDisplayConfig,
  resolveMaterialWithTheme,
  saveLocalMaterialConfig,
  type ModelDisplayConfig,
} from './materialConfig';

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

describe('materialConfig', () => {
  const config: ModelDisplayConfig = {
    defaultMaterial: {
      color: '#90a4ae',
      metalness: 0.1,
      roughness: 0.5,
      opacity: 1,
    },
    materialConfigs: {
      BRAN: {
        color: '#f5f3e1',
        metalness: 0.1,
        roughness: 0.4,
      },
    },
    themes: {
      design3d: {
        name: '三维设计',
        ownerOverrides: {
          BRAN: {
            color: '#315cf2',
            metalness: 0.25,
            roughness: 0.35,
            opacity: 1,
          },
        },
        ownerSpecOverrides: {
          BRAN: {
            PIPE: {
              color: '#315cf2',
              metalness: 0.25,
              roughness: 0.35,
              opacity: 1,
            },
            HVAC: {
              color: '#a7c84a',
              metalness: 0.25,
              roughness: 0.35,
              opacity: 1,
            },
            UNKNOWN: {
              color: '#315cf2',
              metalness: 0.25,
              roughness: 0.35,
              opacity: 1,
            },
          },
        },
      },
    },
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    clearModelDisplayConfigCache()
    ;(globalThis as unknown as { localStorage: Storage }).localStorage =
      createLocalStorageMock() as unknown as Storage;
  });

  it('design3d + BRAN + PIPE 返回蓝色覆盖', () => {
    const resolved = resolveMaterialWithTheme(config, 'R1', 'PIPE', 'BRAN', 'design3d', 1);

    expect(resolved.color.getHexString()).toBe('315cf2');
    expect(resolved.metalness).toBe(0.25);
    expect(resolved.roughness).toBe(0.35);
  });

  it('design3d + BRAN + HVAC 返回黄绿色覆盖', () => {
    const resolved = resolveMaterialWithTheme(config, 'R2', 'DUCT', 'BRAN', 'design3d', 4);

    expect(resolved.color.getHexString()).toBe('a7c84a');
  });

  it('design3d + BRAN + UNKNOWN/null 回退到 PIPE 蓝色', () => {
    const resolvedUnknown = resolveMaterialWithTheme(config, 'R3', 'PIPE', 'BRAN', 'design3d', 0);
    const resolvedNull = resolveMaterialWithTheme(config, 'R4', 'PIPE', 'BRAN', 'design3d', null);

    expect(resolvedUnknown.color.getHexString()).toBe('315cf2');
    expect(resolvedNull.color.getHexString()).toBe('315cf2');
  });

  it('default 主题不触发 ownerSpecOverrides', () => {
    const resolved = resolveMaterialWithTheme(config, 'R5', 'BRAN', 'BRAN', 'default', 4);

    expect(resolved.color.getHexString()).toBe('f5f3e1');
    expect(resolved.metalness).toBe(0.1);
    expect(resolved.roughness).toBe(0.4);
  });

  describe('e3d 主题', () => {
    const e3dConfig: ModelDisplayConfig = {
      defaultMaterial: { color: '#90a4ae', metalness: 0.1, roughness: 0.5, opacity: 1 },
      materialConfigs: {
        TUBI: { color: '#4682b4', metalness: 0.18, roughness: 0.55 },
        EQUI: { color: '#c8b27a', metalness: 0.15, roughness: 0.5 },
      },
      instanceConfigs: {
        R_INST_OVERRIDE: { color: '#ff00ff' },
      },
      disciplineOverrides: {
        '4': '#7cb342',
      },
      themes: {
        e3d: {
          name: 'E3D',
          disciplineMaterials: {
            '1': { color: '#4682b4', metalness: 0.18, roughness: 0.55 },
            '4': { color: '#7cb342', metalness: 0.12, roughness: 0.55 },
          },
          nounAccents: {
            VALV: { color: '#f0c24a', metalness: 0.45, roughness: 0.35 },
          },
        },
      },
    };

    it('管路元素按 spec_value 专业着色（HVAC 绿）', () => {
      const resolved = resolveMaterialWithTheme(e3dConfig, 'R10', 'TUBI', 'BRAN', 'e3d', 4);

      expect(resolved.color.getHexString()).toBe('7cb342');
      expect(resolved.metalness).toBe(0.12);
    });

    it('阀门强调色优先于专业色', () => {
      const resolved = resolveMaterialWithTheme(e3dConfig, 'R11', 'VALV', 'BRAN', 'e3d', 4);

      expect(resolved.color.getHexString()).toBe('f0c24a');
    });

    it('EQUI 非管路元素不受专业色污染，保持类型基色', () => {
      const resolved = resolveMaterialWithTheme(e3dConfig, 'R12', 'EQUI', '', 'e3d', 4);

      expect(resolved.color.getHexString()).toBe('c8b27a');
    });

    it('spec_value=0 时回退类型基色', () => {
      const resolved = resolveMaterialWithTheme(e3dConfig, 'R13', 'TUBI', 'BRAN', 'e3d', 0);

      expect(resolved.color.getHexString()).toBe('4682b4');
    });

    it('instanceConfigs 覆盖优先于主题规则', () => {
      const resolved = resolveMaterialWithTheme(e3dConfig, 'R_INST_OVERRIDE', 'VALV', 'BRAN', 'e3d', 4);

      expect(resolved.color.getHexString()).toBe('ff00ff');
    });

    it('default 主题下管路元素仍按 disciplineOverrides 着色', () => {
      const resolved = resolveMaterialWithTheme(e3dConfig, 'R14', 'TUBI', 'BRAN', 'default', 4);

      expect(resolved.color.getHexString()).toBe('7cb342');
    });

    it('default 主题下 EQUI 不套用 disciplineOverrides', () => {
      const resolved = resolveMaterialWithTheme(e3dConfig, 'R15', 'EQUI', '', 'default', 4);

      expect(resolved.color.getHexString()).toBe('c8b27a');
    });
  });

  it('buildExportConfig 会保留 ownerSpecOverrides', () => {
    const exported = buildExportConfig(config);

    expect(exported.themes?.design3d?.ownerSpecOverrides?.BRAN?.HVAC?.color).toBe('#a7c84a');
    expect(exported.themes?.design3d?.ownerSpecOverrides?.BRAN?.PIPE?.color).toBe('#315cf2');
  });

  it('loadModelDisplayConfig 合并本地 themes 时保留 ownerSpecOverrides', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          themes: {
            design3d: {
              name: '三维设计',
              ownerOverrides: {
                BRAN: {
                  color: '#315cf2',
                },
              },
            },
          },
        }),
      }))
    );

    saveLocalMaterialConfig({
      nounConfigs: {},
      themes: {
        design3d: {
          ownerSpecOverrides: {
            BRAN: {
              HVAC: {
                color: '#a7c84a',
                metalness: 0.25,
                roughness: 0.35,
                opacity: 1,
              },
            },
          },
        },
      },
    });

    const loaded = await loadModelDisplayConfig({ force: true });

    expect(loaded.themes?.design3d?.ownerSpecOverrides?.BRAN?.HVAC?.color).toBe('#a7c84a');
  });
});
