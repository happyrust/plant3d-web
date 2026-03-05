import { describe, it, expect, beforeEach, vi } from 'vitest'
import * as THREE from 'three'

describe('LinearDimension3D', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('should construct and expose params', async () => {
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

  it('should use dashed materials for reference dimensions', async () => {
    const { AnnotationMaterials } = await import('../core/AnnotationMaterials')
    const { LinearDimension3D } = await import('./LinearDimension3D')

    const materials = new AnnotationMaterials()
    materials.setResolution(800, 600)

    const dim = new LinearDimension3D(materials, {
      start: new THREE.Vector3(0, 0, 0),
      end: new THREE.Vector3(1, 0, 0),
      offset: 0.5,
      isReference: true,
    })

    const lineA = (dim as any).dimensionLineA
    const ext1 = (dim as any).extensionLine1
    const arrow1 = (dim as any).arrow1

    const spy = vi.spyOn(lineA, 'computeLineDistances')

    const camera = new THREE.PerspectiveCamera(60, 800 / 600, 0.1, 100)
    camera.position.set(0, 0, 5)
    camera.lookAt(0, 0, 0)
    camera.updateProjectionMatrix()
    camera.updateMatrixWorld(true)

    dim.update(camera)

    expect(lineA.material).toBeInstanceOf(THREE.LineDashedMaterial)
    expect(ext1.material).toBeInstanceOf(THREE.LineDashedMaterial)
    expect(arrow1.material).not.toBeInstanceOf(THREE.LineDashedMaterial)
    expect(spy).toHaveBeenCalled()
  })

  it('should forward setBackgroundColor to textLabel', async () => {
    const { AnnotationMaterials } = await import('../core/AnnotationMaterials')
    const { LinearDimension3D } = await import('./LinearDimension3D')

    const materials = new AnnotationMaterials()
    const dim = new LinearDimension3D(materials, {
      start: new THREE.Vector3(0, 0, 0),
      end: new THREE.Vector3(1, 0, 0),
      offset: 0.5,
    })

    const textLabel = (dim as any).textLabel
    const spy = vi.spyOn(textLabel, 'setBackgroundColor')

    dim.setBackgroundColor(0xff0000)
    expect(spy).toHaveBeenCalledWith(0xff0000)
  })

  it('should have extension lines that overshoot by 10px worth of world units', async () => {
    const { AnnotationMaterials } = await import('../core/AnnotationMaterials')
    const { LinearDimension3D } = await import('./LinearDimension3D')

    const materials = new AnnotationMaterials()
    const dim = new LinearDimension3D(materials, {
      start: new THREE.Vector3(0, 0, 0),
      end: new THREE.Vector3(5, 0, 0),
      offset: 2,
      direction: new THREE.Vector3(0, 1, 0),
    })

    const camera = new THREE.PerspectiveCamera(60, 800 / 600, 0.1, 100)
    camera.position.set(2.5, 1, 10)
    camera.lookAt(2.5, 1, 0)
    camera.updateProjectionMatrix()
    camera.updateMatrixWorld(true)

    dim.update(camera)

    // Extension line geometry should have 2 points
    const ext1Geom = (dim as any).ext1Geometry as THREE.BufferGeometry
    const pos = ext1Geom.getAttribute('position')
    expect(pos).toBeTruthy()
    expect(pos.count).toBe(2)

    // The extension line should extend beyond the dim endpoint (overshoot)
    // Start point is near (0,0,0), end point should be beyond (0,2,0)
    const endY = pos.getY(1)
    // In local coords, dimStart.y = 2 (offset=2, direction=(0,1,0))
    // Extension should overshoot past 2
    expect(endY).toBeGreaterThan(2)
  })
})
