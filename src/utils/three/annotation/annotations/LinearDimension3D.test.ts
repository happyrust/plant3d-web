import { describe, it, expect, beforeEach, vi } from 'vitest'
import * as THREE from 'three'

describe('LinearDimension3D', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('should construct and expose params', async () => {
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
    const { LinearDimension3D } = await import('./LinearDimension3D')

    const materials = new AnnotationMaterials()
    const start = new THREE.Vector3(0, 0, 0)
    const end = new THREE.Vector3(1, 0, 0)

    const dim = new LinearDimension3D(materials, { start, end, offset: 1 })
    expect(dim.getParams().offset).toBe(1)
    expect(dim.getParams().start.x).toBe(0)
    expect(dim).toBeInstanceOf(THREE.Object3D)
    expect(dim.getDistance()).toBeCloseTo(1, 8)
    expect(dim.getDisplayText()).toBe('1.0')
  })
})
