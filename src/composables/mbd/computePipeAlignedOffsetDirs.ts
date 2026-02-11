import { Vector3 } from 'three'
import type { MbdPipeSegmentDto, Vec3 } from '@/api/mbdPipeApi'

const EPS = 1e-6

/**
 * 基于管道几何拓扑，为每个管段预计算标注偏移方向（offsetDir）。
 *
 * 优先级：
 * 1. 弯头平面：相邻管段叉积得到法线，offsetDir = normal × segDir
 * 2. 重力对齐：近似水平管段向上偏移
 * 3. 主轴垂直：选择与管段方向最不平行的坐标轴
 *
 * 最后做一致性修正，避免相邻管段标注"翻面"。
 */
export function computePipeAlignedOffsetDirs(
  segments: MbdPipeSegmentDto[],
): Vector3[] {
  // 过滤出有效管段（arrive/leave 都存在）
  const valid: { index: number; arrive: Vector3; leave: Vector3; dir: Vector3 }[] = []
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i]!
    if (!s.arrive || !s.leave) continue
    const arrive = new Vector3(s.arrive[0], s.arrive[1], s.arrive[2])
    const leave = new Vector3(s.leave[0], s.leave[1], s.leave[2])
    const dir = leave.clone().sub(arrive)
    if (dir.lengthSq() < EPS) continue
    dir.normalize()
    valid.push({ index: i, arrive, leave, dir })
  }

  if (valid.length === 0) return []

  // 第一步：计算弯头法线
  const bendNormals: (Vector3 | null)[] = new Array(valid.length - 1).fill(null)
  for (let i = 0; i < valid.length - 1; i++) {
    const cross = valid[i]!.dir.clone().cross(valid[i + 1]!.dir)
    if (cross.lengthSq() > EPS) {
      bendNormals[i] = cross.normalize()
    }
  }

  // 第二步：为每个管段分配 offsetDir
  const result: Vector3[] = new Array(segments.length)
  // 先填充 null
  for (let i = 0; i < segments.length; i++) {
    result[i] = new Vector3(1, 0, 0) // 默认值，后续会覆盖
  }

  for (let vi = 0; vi < valid.length; vi++) {
    const { index, dir } = valid[vi]!
    let offsetDir: Vector3 | null = null

    // 优先级 1：弯头传播
    const normalBefore = vi > 0 ? bendNormals[vi - 1] : null
    const normalAfter = vi < bendNormals.length ? bendNormals[vi] : null
    const bendNormal = normalBefore ?? normalAfter
    if (bendNormal) {
      offsetDir = bendNormal.clone().cross(dir)
      if (offsetDir.lengthSq() < EPS) offsetDir = null
      else offsetDir.normalize()
    }

    // 优先级 2：重力对齐（近似水平管段）
    if (!offsetDir && Math.abs(dir.y) < 0.5) {
      const up = new Vector3(0, 1, 0)
      offsetDir = up.cross(dir)
      if (offsetDir.lengthSq() < EPS) offsetDir = null
      else offsetDir.normalize()
    }

    // 优先级 3：主轴垂直
    if (!offsetDir) {
      offsetDir = leastAlignedAxisCross(dir)
    }

    result[index] = offsetDir ?? new Vector3(1, 0, 0)
  }

  // 第三步：一致性修正（避免相邻管段翻面）
  for (let vi = 1; vi < valid.length; vi++) {
    const prevIdx = valid[vi - 1]!.index
    const currIdx = valid[vi]!.index
    if (result[prevIdx]!.dot(result[currIdx]!) < 0) {
      result[currIdx]!.negate()
    }
  }

  return result
}

/** 选择与 dir 最不平行的坐标轴，取叉积 */
function leastAlignedAxisCross(dir: Vector3): Vector3 {
  const ax = Math.abs(dir.x)
  const ay = Math.abs(dir.y)
  const az = Math.abs(dir.z)

  let axis: Vector3
  if (ax <= ay && ax <= az) {
    axis = new Vector3(1, 0, 0)
  } else if (ay <= ax && ay <= az) {
    axis = new Vector3(0, 1, 0)
  } else {
    axis = new Vector3(0, 0, 1)
  }

  const result = axis.cross(dir)
  if (result.lengthSq() < EPS) return new Vector3(1, 0, 0)
  return result.normalize()
}

/**
 * 根据 dim 的 start/end 匹配对应管段的预计算 offsetDir。
 *
 * 匹配策略：
 * - 精确匹配：dim.start ≈ seg.arrive && dim.end ≈ seg.leave
 * - 包含匹配（overall/port）：dim.start 在某段 arrive 上 → 用该段的 offsetDir
 * - 未匹配：返回 null（调用方 fallback 到相机逻辑）
 */
export function findSegmentOffsetDir(
  segments: MbdPipeSegmentDto[],
  dimStart: Vec3,
  dimEnd: Vec3,
  precomputed: Vector3[],
): Vector3 | null {
  const ds = new Vector3(dimStart[0], dimStart[1], dimStart[2])
  const de = new Vector3(dimEnd[0], dimEnd[1], dimEnd[2])
  const MATCH_EPS = 0.1 // mm 级精度

  // 精确匹配
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i]!
    if (!s.arrive || !s.leave) continue
    const sa = new Vector3(s.arrive[0], s.arrive[1], s.arrive[2])
    const sl = new Vector3(s.leave[0], s.leave[1], s.leave[2])
    if (sa.distanceTo(ds) < MATCH_EPS && sl.distanceTo(de) < MATCH_EPS) {
      return precomputed[i] ?? null
    }
  }

  // 包含匹配：dim.start 在某段 arrive 上
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i]!
    if (!s.arrive) continue
    const sa = new Vector3(s.arrive[0], s.arrive[1], s.arrive[2])
    if (sa.distanceTo(ds) < MATCH_EPS) {
      return precomputed[i] ?? null
    }
  }

  return null
}
