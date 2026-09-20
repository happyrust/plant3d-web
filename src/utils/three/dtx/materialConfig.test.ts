import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildExportConfig,
  clearModelDisplayConfigCache,
  DEFAULT_INVALID_TUBI_MATERIAL,
  loadModelDisplayConfig,
  resolveInvalidTubiMaterial,
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

  describe('e3dFactory 主题（出厂 E3D 3.1：autocolour 关，全部 Add element colour = lightgrey）', () => {
    const factoryConfig: ModelDisplayConfig = {
      defaultMaterial: { color: '#90a4ae', metalness: 0.1, roughness: 0.5, opacity: 1 },
      materialConfigs: {
        TUBI: { color: '#4682b4', metalness: 0.18, roughness: 0.55 },
        VALV: { color: '#f0c24a' },
      },
      instanceConfigs: { R_PIN: { color: 'pdms:yellow' } },
      disciplineOverrides: { '1': '#4682b4' },
      themes: {
        e3dFactory: {
          name: 'E3D 出厂',
          baseMaterial: { color: 'pdms:lightgrey', metalness: 0.1, roughness: 0.6, opacity: 1 },
        },
      },
    };

    it('管路 / 阀门 / 设备 / 未知类型全部解成 PDMS lightgrey #bdbdbd（不是 CSS 的 #d3d3d3）', () => {
      for (const [noun, owner, spec] of [['TUBI', 'BRAN', 1], ['VALV', 'BRAN', 1], ['EQUI', '', null], ['XXXX', 'ZONE', 6]] as const) {
        const resolved = resolveMaterialWithTheme(factoryConfig, `R_${noun}`, noun, owner, 'e3dFactory', spec);
        expect(resolved.color.getHexString()).toBe('bdbdbd');
        expect(resolved.metalness).toBe(0.1);
        expect(resolved.roughness).toBe(0.6);
        expect(resolved.hidden).toBe(false);
      }
    });

    it('instanceConfigs 的显式覆盖仍最高，且颜色可用 pdms: 颜色名', () => {
      const resolved = resolveMaterialWithTheme(factoryConfig, 'R_PIN', 'TUBI', 'BRAN', 'e3dFactory', 1);
      expect(resolved.color.getHexString()).toBe('ffff00');
    });

    it('baseMaterial 只在该主题下生效；e3d / default 主题照旧（类型基色 / 专业覆盖）', () => {
      expect(resolveMaterialWithTheme(factoryConfig, 'R1', 'TUBI', 'BRAN', 'default', 1).color.getHexString()).toBe('4682b4');
      // 没配 e3d 主题时走类型基色兜底：管路阀门吃 disciplineOverrides，设备保持类型基色 / 默认色
      expect(resolveMaterialWithTheme(factoryConfig, 'R2', 'VALV', 'BRAN', 'e3d', 1).color.getHexString()).toBe('4682b4');
      expect(resolveMaterialWithTheme(factoryConfig, 'R3', 'VALV', 'EQUI', 'e3d', 1).color.getHexString()).toBe('f0c24a');
      expect(resolveMaterialWithTheme(factoryConfig, 'R4', 'EQUI', '', 'e3d', null).color.getHexString()).toBe('90a4ae');
    });

    it('无效直管告警色不跟出厂主题走', () => {
      expect(resolveInvalidTubiMaterial(factoryConfig, 'R9').color.getHexString()).toBe('f59e0b');
    });

    it('pdms: 颜色引用：颜色号 / 名字都行，查不到落到兜底色而不是被 three 当 CSS 名解析', () => {
      const cfg: ModelDisplayConfig = {
        ...factoryConfig,
        materialConfigs: { A: { color: 'pdms:271' }, B: { color: 'PDMS:Light Grey' }, C: { color: 'pdms:nosuch' } },
      };
      expect(resolveMaterialWithTheme(cfg, 'RA', 'A', '', 'default').color.getHexString()).toBe('bdbdbd');
      expect(resolveMaterialWithTheme(cfg, 'RB', 'B', '', 'default').color.getHexString()).toBe('bdbdbd');
      expect(resolveMaterialWithTheme(cfg, 'RC', 'C', '', 'default').color.getHexString()).toBe('90a4ae');
    });

    it('buildExportConfig 保留 baseMaterial，pdms: 引用按语义写法导出', () => {
      const exported = buildExportConfig(factoryConfig);
      expect(exported.themes?.e3dFactory?.baseMaterial).toEqual({
        color: 'pdms:lightgrey',
        metalness: 0.1,
        roughness: 0.6,
        opacity: 1,
      });
      expect(exported.materialConfigs?.VALV?.color).toBe('#f0c24a');
    });

    it('loadModelDisplayConfig 合并本地 themes 时保留并可覆盖 baseMaterial', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({
          ok: true,
          json: async () => ({
            themes: { e3dFactory: { name: 'E3D 出厂', baseMaterial: { color: 'pdms:lightgrey', metalness: 0.1, roughness: 0.6 } } },
          }),
        }))
      );
      let loaded = await loadModelDisplayConfig({ force: true });
      expect(loaded.themes?.e3dFactory?.baseMaterial?.color).toBe('pdms:lightgrey');

      saveLocalMaterialConfig({ nounConfigs: {}, themes: { e3dFactory: { baseMaterial: { color: 'pdms:darkgrey' } } } });
      loaded = await loadModelDisplayConfig({ force: true });
      expect(loaded.themes?.e3dFactory?.baseMaterial).toEqual({ color: 'pdms:darkgrey', metalness: 0.1, roughness: 0.6 });
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

  it('无效直管告警材质：缺省琥珀色、不看主题；invalidTubiMaterial 可改；instanceConfigs 的显式覆盖仍最高', () => {
    const fallback = resolveInvalidTubiMaterial(config, '24381_145018');
    expect(fallback.color.getHexString()).toBe('f59e0b');
    expect(DEFAULT_INVALID_TUBI_MATERIAL.color).toBe('#f59e0b');
    expect(fallback).toMatchObject({ metalness: 0.1, roughness: 0.5, opacity: 1, hidden: false });
    // 同一段直管按主题解出来是别的颜色——告警材质不跟它走
    expect(resolveMaterialWithTheme(config, '24381_145018', 'TUBI', 'BRAN', 'default').color.getHexString()).not.toBe('f59e0b');

    const tuned = resolveInvalidTubiMaterial({ ...config, invalidTubiMaterial: { color: '#ff0000', opacity: 0.6 } });
    expect(tuned.color.getHexString()).toBe('ff0000');
    expect(tuned.opacity).toBe(0.6);

    const pinned = resolveInvalidTubiMaterial({ ...config, instanceConfigs: { '24381_145018': { color: '#00ff00' } } }, '24381/145018');
    expect(pinned.color.getHexString()).toBe('00ff00');
  });

  it('buildExportConfig 带上 invalidTubiMaterial（颜色归一成 #rrggbb），没配就不出现这一格', () => {
    expect(buildExportConfig(config)).not.toHaveProperty('invalidTubiMaterial');

    const exported = buildExportConfig({ ...config, invalidTubiMaterial: { color: 0xff0000, opacity: 0.6 } });
    expect(exported.invalidTubiMaterial).toEqual({ color: '#ff0000', opacity: 0.6 });
  });
});
