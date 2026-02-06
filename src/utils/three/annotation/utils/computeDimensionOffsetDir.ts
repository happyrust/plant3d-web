import * as THREE from 'three'

/**
 * 计算尺寸标注的偏移方向（offsetDir）。
 *
 * 目标：
 * - 尽量与相机方向相关（更接近用户在屏幕空间的直觉）
 * - 同时保持与线段方向正交（避免沿线段滑动）
 *
 * 返回：
 * - 线段退化（start≈end）时返回 null
 */
export function computeDimensionOffsetDir(
  start: THREE.Vector3,
  end: THREE.Vector3,
  camera: THREE.Camera | null
): THREE.Vector3 | null {
  const seg = end.clone().sub(start)
  if (seg.lengthSq() < 1e-12) return null
  seg.normalize()

  // 相机方向（mid -> camera）
  const mid = start.clone().add(end).multiplyScalar(0.5)
  const camPos = (camera as any)?.position as THREE.Vector3 | undefined
  const camDir = camPos ? camPos.clone().sub(mid) : null

  // fallback: XY 平面内取垂线
  const fallback = () => {
    const perp = new THREE.Vector3(-seg.y, seg.x, 0)
    if (perp.lengthSq() < 1e-12) return new THREE.Vector3(1, 0, 0)
    return perp.normalize()
  }

  if (!camDir || camDir.lengthSq() < 1e-12) return fallback()
  camDir.normalize()

  // n = seg x camDir，perp = n x seg
  let n = seg.clone().cross(camDir)
  if (n.lengthSq() < 1e-12) {
    const up = (camera as any)?.up
      ? new THREE.Vector3().copy((camera as any).up)
      : new THREE.Vector3(0, 1, 0)
    n = seg.clone().cross(up.normalize())
  }
  if (n.lengthSq() < 1e-12) return fallback()

  const perp = n.cross(seg)
  if (perp.lengthSq() < 1e-12) return fallback()
  return perp.normalize()
}

