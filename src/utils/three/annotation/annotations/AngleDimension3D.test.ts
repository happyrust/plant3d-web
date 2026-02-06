import { describe, it, expect, beforeEach, vi } from 'vitest'
import * as THREE from 'three'

describe('AngleDimension3D', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('should compute angle text by default', async () => {
    vi.mock('troika-three-text', () => {
      class FakeText extends THREE.Mesh {
        text = ''
        color: any
        outlineColor: any
        outlineWidth = 0
        font = ''
        fontSize = 1
        anchorX: any
        anchorY: any
        maxWidth: any
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        sync() {}
      }
      return { Text: FakeText }
    })

    const { AnnotationMaterials } = await import('../core/AnnotationMaterials')
    const { AngleDimension3D } = await import('./AngleDimension3D')

    const materials = new AnnotationMaterials()
    const v = new THREE.Vector3(0, 0, 0)
    const p1 = new THREE.Vector3(1, 0, 0)
    const p2 = new THREE.Vector3(0, 1, 0)

    const dim = new AngleDimension3D(materials, { vertex: v, point1: p1, point2: p2, arcRadius: 1, decimals: 0 })
    const angle = dim.getAngleDegrees()
    expect(angle).toBeCloseTo(90, 5)
    expect(dim.getDisplayText()).toBe('90°')
  })
})
