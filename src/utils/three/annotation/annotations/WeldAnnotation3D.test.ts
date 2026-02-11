import { describe, it, expect, beforeEach, vi } from 'vitest'
import * as THREE from 'three'

describe('WeldAnnotation3D', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('should construct and toggle label visibility', async () => {
    const { AnnotationMaterials } = await import('../core/AnnotationMaterials')
    const { WeldAnnotation3D } = await import('./WeldAnnotation3D')

    const materials = new AnnotationMaterials()
    const ann = new WeldAnnotation3D(materials, {
      position: new THREE.Vector3(1, 2, 3),
      label: 'W1',
      isShop: true,
      crossSize: 10,
    })

    expect(ann.getParams().label).toBe('W1')
    ann.setLabelVisible(false)

    // SolveSpaceBillboardVectorText.object3d is a Group (LineSegments + pickProxy)
    const textGroup = ann.children.find((c: any) => c.isGroup && c.children?.some((cc: any) => cc.isLineSegments)) as any
    expect(textGroup).toBeTruthy()
    expect(textGroup.visible).toBe(false)

    ann.dispose()
    materials.dispose()
  })
})

