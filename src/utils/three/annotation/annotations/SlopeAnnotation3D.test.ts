import { describe, it, expect, beforeEach, vi } from 'vitest'
import * as THREE from 'three'

describe('SlopeAnnotation3D', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('should construct and toggle label visibility', async () => {
    const { AnnotationMaterials } = await import('../core/AnnotationMaterials')
    const { SlopeAnnotation3D } = await import('./SlopeAnnotation3D')

    const materials = new AnnotationMaterials()
    const ann = new SlopeAnnotation3D(materials, {
      start: new THREE.Vector3(0, 0, 0),
      end: new THREE.Vector3(10, 0, 0),
      text: '1:100',
      slope: 0.01,
    })

    expect(ann.getParams().text).toBe('1:100')
    ann.setLabelVisible(false)

    // SolveSpaceBillboardVectorText.object3d is a Group (LineSegments + pickProxy)
    const textGroup = ann.children.find((c: any) => c.isGroup && c.children?.some((cc: any) => cc.isLineSegments)) as any
    expect(textGroup).toBeTruthy()
    expect(textGroup.visible).toBe(false)

    ann.dispose()
    materials.dispose()
  })
})

