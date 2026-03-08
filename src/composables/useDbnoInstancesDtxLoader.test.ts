import { describe, expect, it, vi } from 'vitest'

vi.mock('@/composables/useDbnoInstancesParquetLoader', () => ({
  useDbnoInstancesParquetLoader: () => ({
    isParquetAvailable: vi.fn(async () => true),
    queryInstanceEntriesByRefnos: vi.fn(async () => new Map()),
  }),
}))

vi.mock('@/api/genModelRealtimeApi', () => ({
  realtimeInstancesByRefnos: vi.fn(async () => ({
    items: [],
    missing_refnos: [],
  })),
}))

vi.mock('@/utils/parseGlbGeometry', () => ({
  parseGlbGeometry: vi.fn(() => null),
}))

vi.mock('@/composables/useDisplayThemeStore', () => ({
  useDisplayThemeStore: () => ({
    currentTheme: { value: 'design3d' },
  }),
}))

describe('useDbnoInstancesDtxLoader', () => {
  it('模块可被导入并导出加载函数', async () => {
    const mod = await import('./useDbnoInstancesDtxLoader')

    expect(typeof mod.loadDbnoInstancesForVisibleRefnosDtx).toBe('function')
    expect(typeof mod.hasDtxDbnoCache).toBe('function')
  })
})
