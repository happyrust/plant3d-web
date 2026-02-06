import * as THREE from 'three'

export type ClearanceResult = {
  /** 管道外表面上的最近点 */
  pipeSurfacePoint: THREE.Vector3
  /** 另一对象外表面上的最近点（墙面/柱子外表面） */
  otherSurfacePoint: THREE.Vector3
  /** 外表面到外表面的净距（>=0，穿透时会 clamp 为 0） */
  distance: number
  /** 从 otherSurfacePoint 指向 pipeSurfacePoint 的单位法向（退化时可能为 (0,0,0)） */
  normal: THREE.Vector3
}

export type PipeToWallClearanceParams = {
  /** 管道中心点（任意在轴线上的一点；若轴线平行墙面，则任意点皆可） */
  pipeCenter: THREE.Vector3
  /** 管外半径 */
  pipeRadius: number
  /** 墙面上的任意一点 */
  wallPoint: THREE.Vector3
  /** 墙面法向（不要求归一化） */
  wallNormal: THREE.Vector3
}

/**
 * 管道（圆柱）到墙（平面）的最小净距（外表面到外表面）。
 *
 * 约束/简化（面向工程常见场景）：
 * - 将管道视为“无限长圆柱”（不考虑端面）。
 * - 适用于“圆柱轴线与墙面平面近似平行”的场景（多数管道靠墙净距属于此类）。
 *
 * 语义：
 * - distance 始终 >= 0；若穿透则 clamp 为 0（用于“净距标注”场景，避免负值语义混乱）。
 */
export function computePipeToWallClearance(params: PipeToWallClearanceParams): ClearanceResult | null {
  const n = params.wallNormal.clone()
  if (n.lengthSq() < 1e-12) return null
  n.normalize()

  const signedDist = params.pipeCenter.clone().sub(params.wallPoint).dot(n)
  const absDist = Math.abs(signedDist)
  const raw = absDist - Math.max(0, params.pipeRadius)
  const distance = Math.max(0, raw)

  const side = signedDist >= 0 ? 1 : -1
  const normal = n.clone().multiplyScalar(side) // 从墙指向管

  // 墙面最近点：管心到平面的投影
  const otherSurfacePoint = params.pipeCenter.clone().addScaledVector(n, -signedDist)

  // 管外表面最近点：沿法向朝向墙面移动 r
  let pipeSurfacePoint = params.pipeCenter.clone().addScaledVector(n, -side * Math.max(0, params.pipeRadius))

  // 若穿透，净距为 0，此时不存在“同时落在两外表面”的同一点；为净距标注稳定性，返回同一点。
  if (distance <= 1e-9) {
    pipeSurfacePoint = otherSurfacePoint.clone()
  }

  return { pipeSurfacePoint, otherSurfacePoint, distance, normal }
}

export type PipeToColumnClearanceParams = {
  pipeCenter: THREE.Vector3
  pipeRadius: number
  columnCenter: THREE.Vector3
  columnRadius: number
  /** 两圆柱的公共轴方向（不要求归一化；默认 Y 轴） */
  axis?: THREE.Vector3
}

/**
 * 管道到柱子（平行圆柱）的最小净距（外表面到外表面）。
 *
 * 简化：
 * - 两圆柱轴线平行（由 axis 给出）。
 * - 将其视为“无限长圆柱”（不考虑端面）。
 */
export function computePipeToColumnClearance(params: PipeToColumnClearanceParams): ClearanceResult | null {
  const axis = (params.axis ?? new THREE.Vector3(0, 1, 0)).clone()
  if (axis.lengthSq() < 1e-12) return null
  axis.normalize()

  const delta = params.columnCenter.clone().sub(params.pipeCenter)
  const lateral = delta.clone().addScaledVector(axis, -delta.dot(axis)) // 投影到垂直 axis 的平面
  const lateralLen = lateral.length()
  if (lateralLen < 1e-9) return null

  const dir = lateral.multiplyScalar(1 / lateralLen) // 从 pipe 指向 column
  const r1 = Math.max(0, params.pipeRadius)
  const r2 = Math.max(0, params.columnRadius)

  const raw = lateralLen - (r1 + r2)
  const distance = Math.max(0, raw)
  const normal = dir.clone().negate() // 从柱指向管（other->pipe）

  const pipeSurfacePoint = params.pipeCenter.clone().addScaledVector(dir, r1)
  const columnSurfacePoint = params.columnCenter.clone().addScaledVector(dir, -r2)

  if (distance <= 1e-9) {
    const mid = pipeSurfacePoint.clone().lerp(columnSurfacePoint, 0.5)
    return { pipeSurfacePoint: mid.clone(), otherSurfacePoint: mid, distance: 0, normal }
  }

  return { pipeSurfacePoint, otherSurfacePoint: columnSurfacePoint, distance, normal }
}

