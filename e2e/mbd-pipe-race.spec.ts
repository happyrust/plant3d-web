import { test, expect } from '@playwright/test'

type MbdPipeResponse = {
  success: boolean
  error_message?: string
  data?: {
    input_refno: string
    branch_refno: string
    branch_name: string
    branch_attrs: Record<string, unknown>
    segments: Array<Record<string, unknown>>
    dims: Array<Record<string, unknown>>
    welds: Array<Record<string, unknown>>
    slopes: Array<Record<string, unknown>>
    bends: Array<Record<string, unknown>>
    stats: {
      segments_count: number
      dims_count: number
      welds_count: number
      slopes_count: number
      bends_count: number
    }
  }
}

function buildMbdResponse(refno: string): MbdPipeResponse {
  return {
    success: true,
    data: {
      input_refno: refno,
      branch_refno: refno,
      branch_name: `BR-${refno}`,
      branch_attrs: {},
      segments: [
        {
          id: `seg-${refno}`,
          refno: `S-${refno}`,
          noun: 'STRA',
          arrive: [0, 0, 0],
          leave: [1000, 0, 0],
          length: 1000,
          straight_length: 1000,
        },
      ],
      dims: [
        {
          id: `dim-${refno}`,
          kind: 'segment',
          start: [0, 0, 0],
          end: [1000, 0, 0],
          length: 1000,
          text: '1000',
        },
      ],
      welds: [],
      slopes: [],
      bends: [],
      stats: {
        segments_count: 1,
        dims_count: 1,
        welds_count: 0,
        slopes_count: 0,
        bends_count: 0,
      },
    },
  }
}

test('mbd pipe race: should keep latest request result', async ({ page }) => {
  const firstRefno = '24381_145018'
  const secondRefno = '24381_145019'

  let firstHit = 0
  let secondHit = 0
  const malformedQueryUrls: string[] = []

  await page.route('**/api/mbd/pipe/**', async (route) => {
    const url = new URL(route.request().url())
    const refno = decodeURIComponent(url.pathname.split('/').pop() || '')
    const includeBends = url.searchParams.get('include_bends')
    const bendMode = url.searchParams.get('bend_mode')

    if (includeBends !== 'true' || bendMode !== 'facecenter') {
      malformedQueryUrls.push(url.toString())
    }

    if (refno === firstRefno) {
      firstHit += 1
      await new Promise<void>((resolve) => setTimeout(resolve, 600))
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(buildMbdResponse(firstRefno)),
      })
      return
    }

    if (refno === secondRefno) {
      secondHit += 1
      await new Promise<void>((resolve) => setTimeout(resolve, 80))
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(buildMbdResponse(secondRefno)),
      })
      return
    }

    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ success: false, error_message: `unexpected refno: ${refno}` }),
    })
  })

  await page.goto('/?dtx_demo=primitives&dtx_demo_count=20', { waitUntil: 'domcontentloaded' })

  await page.waitForFunction(() => !!(window as any).__xeokitViewer?.scene, null, { timeout: 60_000 })

  await page.evaluate(async ({ first }) => {
    const storeMod = await import('/src/composables/useToolStore.ts')
    const store = storeMod.useToolStore()
    store.requestMbdPipeAnnotation(first)
  }, { first: firstRefno })

  await expect
    .poll(() => firstHit, { timeout: 10_000, message: '等待首个请求发出' })
    .toBeGreaterThan(0)

  await page.evaluate(async ({ second }) => {
    const storeMod = await import('/src/composables/useToolStore.ts')
    const store = storeMod.useToolStore()
    store.requestMbdPipeAnnotation(second)
  }, { second: secondRefno })

  await expect
    .poll(
      async () =>
        await page.evaluate(async () => {
          const ctxMod = await import('/src/composables/useViewerContext.ts')
          const ctx = ctxMod.useViewerContext()
          return ctx.mbdPipeVis.value?.currentData.value?.branch_refno ?? null
        }),
      { timeout: 15_000, message: '等待最新请求渲染完成' },
    )
    .toBe(secondRefno)

  expect(firstHit).toBeGreaterThan(0)
  expect(secondHit).toBeGreaterThan(0)
  expect(malformedQueryUrls).toEqual([])
})
