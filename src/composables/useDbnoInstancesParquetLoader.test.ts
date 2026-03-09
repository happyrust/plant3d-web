import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/api/genModelTaskApi', () => ({
  getBaseUrl: () => 'http://127.0.0.1:3100',
}))

function createManifest(dbno: number) {
  return {
    version: 1,
    format: 'parquet' as const,
    generated_at: '2026-03-08T00:00:00.000Z',
    dbnum: dbno,
    root_refno: null,
    tables: {
      instances: { file: `instances_${dbno}.parquet` },
      geo_instances: { file: `geo_instances_${dbno}.parquet` },
      tubings: { file: `tubings_${dbno}.parquet` },
      transforms: { file: `transforms_${dbno}.parquet` },
      aabb: { file: `aabb_${dbno}.parquet` },
    },
    mesh_validation: {
      lod_tag: 'L1',
      report_file: 'missing-report.json',
      checked_geo_hashes: 10,
      missing_geo_hashes: 1,
      missing_owner_refnos: 2,
    },
  }
}

describe('useDbnoInstancesParquetLoader', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  it('后端提示 instances manifest 时不再请求 parquet manifest', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = String(init?.method || 'GET').toUpperCase()

      if (url.includes('/api/model/parquet-version/7997')) {
        return new Response(JSON.stringify({
          success: true,
          dbnum: 7997,
          revision: 1,
          updated_at: '2026-03-08T00:00:00.000Z',
          running: false,
          pending_count: 0,
          last_error: null,
          manifest_base_dir: 'instances',
          files_base_dir: 'instances',
        }), { status: 200 })
      }

      if (url.endsWith('/files/output/instances/manifest_7997.json')) {
        return new Response(JSON.stringify(createManifest(7997)), { status: 200 })
      }

      if (method === 'HEAD' && url.includes('/files/output/instances/')) {
        return new Response(null, { status: 200 })
      }

      throw new Error(`unexpected fetch: ${method} ${url}`)
    })

    vi.stubGlobal('fetch', fetchMock)

    const { useDbnoInstancesParquetLoader } = await import('./useDbnoInstancesParquetLoader')
    const loader = useDbnoInstancesParquetLoader()
    await expect(loader.isParquetAvailable(7997)).resolves.toBe(true)

    const urls = fetchMock.mock.calls.map(([input]) => String(input))
    expect(urls).toContain('/files/output/instances/manifest_7997.json')
    expect(urls).not.toContain('/files/output/parquet/manifest_7997.json')
  })

  it('mesh validation 报告沿 manifest 所在目录读取', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)

      if (url.includes('/api/model/parquet-version/7997')) {
        return new Response(JSON.stringify({
          success: true,
          dbnum: 7997,
          revision: 1,
          updated_at: '2026-03-08T00:00:00.000Z',
          running: false,
          pending_count: 0,
          last_error: null,
          manifest_base_dir: 'instances',
          files_base_dir: 'instances',
        }), { status: 200 })
      }

      if (url.endsWith('/files/output/instances/manifest_7997.json')) {
        return new Response(JSON.stringify(createManifest(7997)), { status: 200 })
      }

      if (url.endsWith('/files/output/instances/missing-report.json')) {
        return new Response(JSON.stringify({
          generated_at: '2026-03-08T00:00:00.000Z',
          missing_geo_hash_list: [
            { geo_hash: 'abc', row_count: 3, owner_refno_count: 1 },
          ],
        }), { status: 200 })
      }

      throw new Error(`unexpected fetch: ${url}`)
    })

    vi.stubGlobal('fetch', fetchMock)

    const { useDbnoInstancesParquetLoader } = await import('./useDbnoInstancesParquetLoader')
    const loader = useDbnoInstancesParquetLoader()
    const info = await loader.queryMeshValidationInfoByDbno(7997)

    expect(info?.reportFile).toBe('missing-report.json')
    expect(info?.topMissingGeoHashes).toEqual([
      { geoHash: 'abc', rowCount: 3, ownerRefnoCount: 1 },
    ])

    const urls = fetchMock.mock.calls.map(([input]) => String(input))
    expect(urls).toContain('/files/output/instances/missing-report.json')
    expect(urls).not.toContain('/files/output/parquet/missing-report.json')
  })
})
