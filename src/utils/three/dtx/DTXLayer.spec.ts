import { describe, expect, it } from 'vitest'
import { BufferAttribute, BufferGeometry, Matrix4, Vector3 } from 'three'

import { DTXLayer } from './DTXLayer'

function createTriangleGeometry(): BufferGeometry {
  const geometry = new BufferGeometry()
  geometry.setAttribute(
    'position',
    new BufferAttribute(new Float32Array([
      0, 0, 0,
      1, 0, 0,
      0, 1, 0,
    ]), 3),
  )
  geometry.setIndex([0, 1, 2])
  return geometry
}

describe('DTXLayer.raycastObject', () => {
  it('应用 globalModelMatrix 后仍能命中对象三角形', () => {
    const layer = new DTXLayer({
      maxVertices: 16,
      maxIndices: 16,
      maxObjects: 4,
    })

    layer.addGeometry('tri', createTriangleGeometry())
    layer.addObject('o:100_1:0', 'tri', new Matrix4())
    layer.setGlobalModelMatrix(new Matrix4().makeTranslation(10, 20, 30))

    const hit = layer.raycastObject(
      'o:100_1:0',
      new Vector3(10.2, 20.2, 31),
      new Vector3(0, 0, -1),
    )

    expect(hit).not.toBeNull()
    expect(hit?.point.x).toBeCloseTo(10.2, 6)
    expect(hit?.point.y).toBeCloseTo(20.2, 6)
    expect(hit?.point.z).toBeCloseTo(30, 6)
  })
})
