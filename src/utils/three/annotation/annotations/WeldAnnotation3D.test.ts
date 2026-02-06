import { describe, it, expect, beforeEach, vi } from 'vitest'
import * as THREE from 'three'

describe('WeldAnnotation3D', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('should construct and toggle label visibility', async () => {
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
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        sync() {}
      }
      return { Text: FakeText }
    })

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

    const textChild = ann.children.find((c: any) => typeof (c as any)?.text === 'string') as any
    expect(textChild).toBeTruthy()
    expect(textChild.visible).toBe(false)

    ann.dispose()
    materials.dispose()
  })
})

