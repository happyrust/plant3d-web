import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { alignToPixelGrid, worldPerPixelAt, lineTrimmedAgainstBoxT } from './solvespaceLike'

describe('solvespaceLike', () => {
  describe('lineTrimmedAgainstBoxT', () => {
    it('trims a line crossing the label box into two segments', () => {
      const ref = new THREE.Vector3(0, 0, 0)
      const gr = new THREE.Vector3(1, 0, 0)
      const gu = new THREE.Vector3(0, 1, 0)
      const a = new THREE.Vector3(-5, 0, 0)
      const b = new THREE.Vector3(5, 0, 0)

      const r = lineTrimmedAgainstBoxT(ref, a, b, gr, gu, 2, 2, true)
      expect(r.within).toBe(0)
      expect(r.segmentsT).toHaveLength(2)
      expect(r.segmentsT[0]![0]).toBeCloseTo(0, 8)
      expect(r.segmentsT[0]![1]).toBeCloseTo(0.4, 8)
      expect(r.segmentsT[1]![0]).toBeCloseTo(0.6, 8)
      expect(r.segmentsT[1]![1]).toBeCloseTo(1, 8)
    })

    it('keeps the line when there is no intersection', () => {
      const ref = new THREE.Vector3(0, 0, 0)
      const gr = new THREE.Vector3(1, 0, 0)
      const gu = new THREE.Vector3(0, 1, 0)
      const a = new THREE.Vector3(-5, 3, 0)
      const b = new THREE.Vector3(5, 3, 0)

      const r = lineTrimmedAgainstBoxT(ref, a, b, gr, gu, 2, 2, true)
      expect(r.within).toBe(0)
      expect(r.segmentsT).toEqual([[0, 1]])
    })

    it('returns empty segments when the whole segment is within the box', () => {
      const ref = new THREE.Vector3(0, 0, 0)
      const gr = new THREE.Vector3(1, 0, 0)
      const gu = new THREE.Vector3(0, 1, 0)
      const a = new THREE.Vector3(-0.5, 0, 0)
      const b = new THREE.Vector3(0.5, 0, 0)

      const r = lineTrimmedAgainstBoxT(ref, a, b, gr, gu, 2, 2, true)
      expect(r.within).toBe(0)
      expect(r.segmentsT).toEqual([])
    })

    it('extends line to meet box when label is beyond endpoint (within=+1)', () => {
      // Label box at ref=(3,0,0), line from a=(0,0,0) to b=(1,0,0)
      // Box is entirely beyond b => tmax < 0 relative to a->b direction
      // Actually: label beyond b means tmin > 1
      const ref = new THREE.Vector3(3, 0, 0)
      const gr = new THREE.Vector3(1, 0, 0)
      const gu = new THREE.Vector3(0, 1, 0)
      const a = new THREE.Vector3(0, 0, 0)
      const b = new THREE.Vector3(1, 0, 0)

      const r = lineTrimmedAgainstBoxT(ref, a, b, gr, gu, 2, 2, true)
      // Label is past b => within = -1, line extends from 0 to tmin (>1)
      expect(r.within).toBe(-1)
      expect(r.segmentsT).toHaveLength(1)
      expect(r.segmentsT[0]![0]).toBeCloseTo(0, 8)
      expect(r.segmentsT[0]![1]).toBeGreaterThan(1) // extended past b
    })

    it('extends line to meet box when label is before start (within=+1)', () => {
      const ref = new THREE.Vector3(-3, 0, 0)
      const gr = new THREE.Vector3(1, 0, 0)
      const gu = new THREE.Vector3(0, 1, 0)
      const a = new THREE.Vector3(0, 0, 0)
      const b = new THREE.Vector3(1, 0, 0)

      const r = lineTrimmedAgainstBoxT(ref, a, b, gr, gu, 2, 2, true)
      // Label is before a => within = +1, line extends from tmax (<0) to 1
      expect(r.within).toBe(1)
      expect(r.segmentsT).toHaveLength(1)
      expect(r.segmentsT[0]![0]).toBeLessThan(0) // extended past a
      expect(r.segmentsT[0]![1]).toBeCloseTo(1, 8)
    })

    it('does not extend when extend=false', () => {
      const ref = new THREE.Vector3(3, 0, 0)
      const gr = new THREE.Vector3(1, 0, 0)
      const gu = new THREE.Vector3(0, 1, 0)
      const a = new THREE.Vector3(0, 0, 0)
      const b = new THREE.Vector3(1, 0, 0)

      const r = lineTrimmedAgainstBoxT(ref, a, b, gr, gu, 2, 2, false)
      expect(r.within).toBe(-1)
      expect(r.segmentsT).toHaveLength(1)
      // Without extend, segment stays [0, 1]
      expect(r.segmentsT[0]![1]).toBeCloseTo(1, 8)
    })
  })

  describe('alignToPixelGrid', () => {
    function makeCamera(w: number, h: number): THREE.PerspectiveCamera {
      const cam = new THREE.PerspectiveCamera(60, w / h, 0.1, 1000)
      cam.position.set(0, 0, 10)
      cam.lookAt(0, 0, 0)
      cam.updateProjectionMatrix()
      cam.updateMatrixWorld(true)
      return cam
    }

    it('round-trip preserves depth (z stays on same plane)', () => {
      const cam = makeCamera(800, 600)
      const p = new THREE.Vector3(1.23, 0.77, 0)
      const aligned = alignToPixelGrid(cam, p, 800, 600)
      // z should be very close to original (same depth plane)
      expect(aligned.z).toBeCloseTo(p.z, 1)
    })

    it('snapping is idempotent (aligning twice gives same result)', () => {
      const cam = makeCamera(800, 600)
      const p = new THREE.Vector3(0.567, -1.234, 0)
      const first = alignToPixelGrid(cam, p, 800, 600)
      const second = alignToPixelGrid(cam, first.clone(), 800, 600)
      expect(second.x).toBeCloseTo(first.x, 6)
      expect(second.y).toBeCloseTo(first.y, 6)
      expect(second.z).toBeCloseTo(first.z, 6)
    })

    it('displacement is less than 1 pixel in screen space', () => {
      const cam = makeCamera(800, 600)
      const p = new THREE.Vector3(2.0, 1.5, 0)
      const aligned = alignToPixelGrid(cam, p, 800, 600)

      // Project both to screen and check pixel distance < 1
      const ndcOrig = p.clone().project(cam)
      const ndcAligned = aligned.clone().project(cam)
      const dxPx = Math.abs((ndcAligned.x - ndcOrig.x) * 0.5 * 800)
      const dyPx = Math.abs((ndcAligned.y - ndcOrig.y) * 0.5 * 600)
      expect(dxPx).toBeLessThanOrEqual(0.5)
      expect(dyPx).toBeLessThanOrEqual(0.5)
    })
  })

  describe('worldPerPixelAt', () => {
    it('returns positive finite value for perspective camera', () => {
      const cam = new THREE.PerspectiveCamera(60, 800 / 600, 0.1, 1000)
      cam.position.set(0, 0, 10)
      cam.lookAt(0, 0, 0)
      cam.updateProjectionMatrix()
      cam.updateMatrixWorld(true)

      const wpp = worldPerPixelAt(cam, new THREE.Vector3(0, 0, 0), 800, 600)
      expect(wpp).toBeGreaterThan(0)
      expect(Number.isFinite(wpp)).toBe(true)
    })

    it('increases with distance from camera', () => {
      const cam = new THREE.PerspectiveCamera(60, 800 / 600, 0.1, 1000)
      cam.position.set(0, 0, 10)
      cam.lookAt(0, 0, 0)
      cam.updateProjectionMatrix()
      cam.updateMatrixWorld(true)

      const near = worldPerPixelAt(cam, new THREE.Vector3(0, 0, 5), 800, 600)
      const far = worldPerPixelAt(cam, new THREE.Vector3(0, 0, -10), 800, 600)
      expect(far).toBeGreaterThan(near)
    })

    it('returns consistent value for orthographic camera', () => {
      const cam = new THREE.OrthographicCamera(-5, 5, 5, -5, 0.1, 100)
      cam.position.set(0, 0, 10)
      cam.lookAt(0, 0, 0)
      cam.updateProjectionMatrix()
      cam.updateMatrixWorld(true)

      const wpp = worldPerPixelAt(cam, new THREE.Vector3(0, 0, 0), 800, 600)
      expect(wpp).toBeGreaterThan(0)
      // Ortho: wpp should be roughly 10 (frustum width) / 800 (pixels) ≈ 0.0125
      expect(wpp).toBeCloseTo(10 / 800, 1)
    })
  })
})

