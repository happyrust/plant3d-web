import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  buildExportConfig,
  clearModelDisplayConfigCache,
  loadModelDisplayConfig,
  resolveMaterialWithTheme,
  saveLocalMaterialConfig,
  type ModelDisplayConfig,
} from './materialConfig'

function createLocalStorageMock() {
  const store = new Map<string, string>()
  return {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, String(value))
    },
    removeItem: (key: string) => {
      store.delete(key)
    },
    clear: () => {
      store.clear()
    },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size
    },
  }
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
  }

  beforeEach(() => {
    vi.restoreAllMocks()
    clearModelDisplayConfigCache()
    ;(globalThis as unknown as { localStorage: Storage }).localStorage =
      createLocalStorageMock() as unknown as Storage
  })

  it('design3d + BRAN + PIPE 返回蓝色覆盖', () => {
    const resolved = resolveMaterialWithTheme(config, 'R1', 'PIPE', 'BRAN', 'design3d', 1)

    expect(resolved.color.getHexString()).toBe('315cf2')
    expect(resolved.metalness).toBe(0.25)
    expect(resolved.roughness).toBe(0.35)
  })

  it('design3d + BRAN + HVAC 返回黄绿色覆盖', () => {
    const resolved = resolveMaterialWithTheme(config, 'R2', 'DUCT', 'BRAN', 'design3d', 4)

    expect(resolved.color.getHexString()).toBe('a7c84a')
  })

  it('design3d + BRAN + UNKNOWN/null 回退到 PIPE 蓝色', () => {
    const resolvedUnknown = resolveMaterialWithTheme(config, 'R3', 'PIPE', 'BRAN', 'design3d', 0)
    const resolvedNull = resolveMaterialWithTheme(config, 'R4', 'PIPE', 'BRAN', 'design3d', null)

    expect(resolvedUnknown.color.getHexString()).toBe('315cf2')
    expect(resolvedNull.color.getHexString()).toBe('315cf2')
  })

  it('default 主题不触发 ownerSpecOverrides', () => {
    const resolved = resolveMaterialWithTheme(config, 'R5', 'BRAN', 'BRAN', 'default', 4)

    expect(resolved.color.getHexString()).toBe('f5f3e1')
    expect(resolved.metalness).toBe(0.1)
    expect(resolved.roughness).toBe(0.4)
  })

  it('buildExportConfig 会保留 ownerSpecOverrides', () => {
    const exported = buildExportConfig(config)

    expect(exported.themes?.design3d?.ownerSpecOverrides?.BRAN?.HVAC?.color).toBe('#a7c84a')
    expect(exported.themes?.design3d?.ownerSpecOverrides?.BRAN?.PIPE?.color).toBe('#315cf2')
  })

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
    )

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
    })

    const loaded = await loadModelDisplayConfig({ force: true })

    expect(loaded.themes?.design3d?.ownerSpecOverrides?.BRAN?.HVAC?.color).toBe('#a7c84a')
  })
})
