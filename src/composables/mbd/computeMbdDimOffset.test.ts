import { describe, it, expect } from 'vitest'
import { computeMbdDimOffset } from './computeMbdDimOffset'

describe('computeMbdDimOffset', () => {
  it('scales with distance and clamps to bounds', () => {
    expect(computeMbdDimOffset(1000)).toBe(150) // 0.15 * 1000
    expect(computeMbdDimOffset(100)).toBe(50)   // clamp min
    expect(computeMbdDimOffset(10000)).toBe(500) // clamp max
  })

  it('falls back for non-finite distance', () => {
    expect(computeMbdDimOffset(Number.NaN)).toBe(100)
    expect(computeMbdDimOffset(Number.POSITIVE_INFINITY)).toBe(100)
  })
})

