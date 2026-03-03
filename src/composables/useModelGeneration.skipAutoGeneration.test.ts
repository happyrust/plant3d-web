import { describe, it, expect, beforeEach, afterEach } from 'vitest'

function setSearch(search: string) {
  const s = String(search || '')
  const next = s === '' ? '/' : s.startsWith('?') ? s : `?${s}`
  window.history.pushState({}, '', next)
}

describe('isSkipAutoGeneration', () => {
  const LS_KEY = 'skip_auto_gen'

  beforeEach(() => {
    // 兼容：部分模块使用全局 localStorage（非 window.localStorage）
    ;(globalThis as any).localStorage = window.localStorage
    try {
      window.localStorage.removeItem(LS_KEY)
    } catch {
      // ignore
    }
    setSearch('')
  })

  afterEach(() => {
    try {
      window.localStorage.removeItem(LS_KEY)
    } catch {
      // ignore
    }
    setSearch('')
  })

  it('defaults to false (auto generation enabled)', async () => {
    const { isSkipAutoGeneration } = await import('@/composables/useModelGeneration')
    expect(isSkipAutoGeneration()).toBe(false)
  })

  it('returns true when query skip_auto_gen=1', async () => {
    setSearch('?skip_auto_gen=1')
    const { isSkipAutoGeneration } = await import('@/composables/useModelGeneration')
    expect(isSkipAutoGeneration()).toBe(true)
  })

  it('returns true when localStorage skip_auto_gen=1', async () => {
    // happy-dom 在某些环境下 localStorage 可能不可写/不含 setItem；这里直接 stub 全局 localStorage。
    ;(globalThis as any).localStorage = {
      getItem: (k: string) => (k === LS_KEY ? '1' : null),
    }
    const { isSkipAutoGeneration } = await import('@/composables/useModelGeneration')
    expect(isSkipAutoGeneration()).toBe(true)
  })
})
