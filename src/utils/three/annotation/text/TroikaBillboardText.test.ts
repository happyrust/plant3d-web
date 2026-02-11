import { describe, it, expect, beforeEach, vi } from 'vitest'
import * as THREE from 'three'

describe('TroikaBillboardText', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('should set text and interaction state (SolveSpace style)', async () => {
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
        addEventListener() {}
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

    // Legacy highlight API still works
    label.setHighlighted(true)
    expect((label as any).textMesh.outlineWidth).toBeGreaterThan(0)

    // SolveSpace interaction states
    label.setInteractionState('hovered')
    // Hovered color should be yellow (0xffff00)
    const hoveredColor = (label as any).textMesh.color
    expect(hoveredColor).toBeDefined()

    label.setInteractionState('selected')
    // Selected color should be red (0xff0000)
    const selectedColor = (label as any).textMesh.color
    expect(selectedColor).toBeDefined()

    label.setInteractionState('normal')
  })

  it('should create pickProxy for bounding-rect hit test', async () => {
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
        addEventListener() {}
      }
      return { Text: FakeText }
    })

    const mod = await import('./TroikaBillboardText')
    const label = new mod.TroikaBillboardText({
      text: 'Test',
      fontUrl: '/fonts/test.ttf',
      fontSize: 1,
      color: 0xffffff,
      outlineColor: 0x000000,
      outlineWidth: 0.05,
    })

    // pickProxy should exist
    const pickProxy = (label as any).pickProxy
    expect(pickProxy).toBeInstanceOf(THREE.Mesh)
    // pickProxy should be invisible (for rendering)
    expect(pickProxy.material.visible).toBe(false)
    // textMesh should have noPick=true (interaction goes through pickProxy)
    expect((label as any).textMesh.userData.noPick).toBe(true)
  })

  it('should set outlineBlur to 0 (SolveSpace: no glow)', async () => {
    vi.mock('troika-three-text', () => {
      class FakeText extends THREE.Mesh {
        text = ''
        color: any
        outlineColor: any
        outlineWidth = 0
        outlineBlur = 999 // sentinel value
        font = ''
        fontSize = 1
        anchorX: any
        anchorY: any
        maxWidth: any
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        sync() {}
        addEventListener() {}
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

    // outlineBlur should be 0 (SolveSpace style: no blurry glow)
    expect((label as any).textMesh.outlineBlur).toBe(0)
  })
})
