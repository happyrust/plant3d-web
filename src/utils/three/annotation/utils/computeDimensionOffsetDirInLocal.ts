import * as THREE from 'three'
import { computeDimensionOffsetDir } from './computeDimensionOffsetDir'

/**
 * 计算“本地空间”的 offsetDir，但相机在世界空间。
 *
 * 适用场景：几何点位为后端原始坐标（local），通过 localToWorldMatrix 挂到场景（world），
 * 但希望 offsetDir 的“面向相机”逻辑在 world 空间成立，同时返回给标注几何的本地 direction。
 */
export function computeDimensionOffsetDirInLocal(
  startLocal: THREE.Vector3,
  endLocal: THREE.Vector3,
  cameraWorld: THREE.Camera | null,
  localToWorldMatrix: THREE.Matrix4
): THREE.Vector3 | null {
  const startW = startLocal.clone().applyMatrix4(localToWorldMatrix)
  const endW = endLocal.clone().applyMatrix4(localToWorldMatrix)

  const dirW = computeDimensionOffsetDir(startW, endW, cameraWorld)
  if (!dirW) return null

  // 将 world 方向变回 local 方向：localDir ∝ inv(M3) * worldDir
  const m3 = new THREE.Matrix3().setFromMatrix4(localToWorldMatrix)
  try {
    const inv = m3.clone().invert()
    const dirL = dirW.clone().applyMatrix3(inv)
    if (dirL.lengthSq() < 1e-12) return null
    return dirL.normalize()
  } catch {
    // 若矩阵不可逆（理论上不应发生），退化为直接使用 worldDir（在仅含 uniform scale 时依然成立）
    return dirW.clone().normalize()
  }
}

