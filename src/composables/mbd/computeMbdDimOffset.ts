function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

/**
 * MBD 管道尺寸标注偏移（后端坐标空间单位）。
 *
 * 说明：
 * - 当前 MBD dims 点位为后端“原始坐标”（通常 mm），在渲染侧通过 globalModelMatrix 统一缩放/平移到场景。
 * - offset 也应在同一坐标空间下给出，这样随模型缩放同步变化更自然。
 */
export function computeMbdDimOffset(distance: number): number {
  if (!Number.isFinite(distance) || distance <= 0) return 100
  // 经验值：SolveSpace 风格，随长度线性增长，避免短段遮挡/长段贴线难读
  return clamp(distance * 0.15, 50, 500)
}

