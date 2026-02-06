import { describe, it, expect, beforeEach, vi } from 'vitest'
import * as THREE from 'three'

describe('SlopeAnnotation3D', () => {
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

    const textChild = ann.children.find((c: any) => typeof (c as any)?.text === 'string') as any
    expect(textChild).toBeTruthy()
    expect(textChild.visible).toBe(false)

    ann.dispose()
    materials.dispose()
  })
})

