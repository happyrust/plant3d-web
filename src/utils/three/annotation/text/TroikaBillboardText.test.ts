import { describe, it, expect, beforeEach, vi } from 'vitest'
import * as THREE from 'three'

describe('TroikaBillboardText', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('should set text and highlight state', async () => {
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

    const mod = await import('./TroikaBillboardText')
    const label = new mod.TroikaBillboardText({
      text: 'A',
      fontUrl: '/fonts/test.ttf',
      fontSize: 1,
      color: 0xffffff,
      outlineColor: 0x000000,
      outlineWidth: 0.05,
    })

    expect(label.object3d).toBeInstanceOf(THREE.Object3D)

    label.setText('B')
    expect((label as any).textMesh.text).toBe('B')

    label.setHighlighted(true)
    expect((label as any).textMesh.outlineWidth).toBeGreaterThan(0)
  })
})

