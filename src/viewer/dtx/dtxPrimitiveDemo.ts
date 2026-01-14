import { BoxGeometry, Color, CylinderGeometry, Matrix4, SphereGeometry } from 'three'

import type { DTXLayer } from '@/utils/three/dtx'

export type DtxPrimitiveDemoOptions = {
  objectCount?: number
  spacing?: number
}

/**
 * DTX 基本体 Demo：模拟 xeokit-sdk 常见“基础体加载显示”的使用方式
 * - 仅使用 DTXLayer.addGeometry/addObject/compile
 * - 支持快速生成 1000+ objects 做性能验证
 */
export function loadDtxPrimitiveDemo(dtxLayer: DTXLayer, options: DtxPrimitiveDemoOptions = {}): void {
  const objectCount = Math.max(1, Math.floor(options.objectCount ?? 1000))
  const spacingInput = options.spacing
  const spacing = typeof spacingInput === 'number' && Number.isFinite(spacingInput) ? Math.max(0.1, spacingInput) : 2.5

  const geoBox = new BoxGeometry(1, 1, 1)
  const geoSphere = new SphereGeometry(0.6, 18, 12)
  const geoCyl = new CylinderGeometry(0.5, 0.5, 1.2, 18, 1)

  dtxLayer.addGeometry('demo:box', geoBox)
  dtxLayer.addGeometry('demo:sphere', geoSphere)
  dtxLayer.addGeometry('demo:cylinder', geoCyl)

  const side = Math.max(1, Math.ceil(Math.sqrt(objectCount)))
  const half = (side - 1) * 0.5 * spacing

  const mat = new Matrix4()
  const color = new Color()

  for (let i = 0; i < objectCount; i++) {
    const ix = i % side
    const iy = Math.floor(i / side)

    const x = ix * spacing - half
    const y = iy * spacing - half
    const z = 0

    mat.identity()
    mat.setPosition(x, y, z)

    const geoHash = i % 3 === 0 ? 'demo:box' : i % 3 === 1 ? 'demo:sphere' : 'demo:cylinder'
    color.setHSL((i % 360) / 360, 0.65, 0.55)

    dtxLayer.addObject(`demo:${i}`, geoHash, mat, color, { metalness: 0.0, roughness: 1.0 })
  }

  dtxLayer.compile()
}
