/**
 * 三维标注系统
 *
 * 提供专业的 CAD 风格三维标注功能：
 * - 线性尺寸标注
 * - 对齐尺寸标注
 * - 角度标注
 * - 半径/直径标注
 * - 引线标注
 * - 焊缝标注
 * - 坡度标注
 * - 支持 Line2 粗线条
 * - 支持缩放独立（标注在屏幕上保持恒定尺寸）
 * - CSS2D 文字标签
 * - 交互控制（点击、悬停、拖拽）
 */

// Core
export { AnnotationBase, type AnnotationOptions } from './core/AnnotationBase'
export { AnnotationMaterials, type AnnotationMaterialSet } from './core/AnnotationMaterials'

// Annotations
export { LinearDimension, type LinearDimensionParams } from './annotations/LinearDimension'
export { AlignedDimension, type AlignedDimensionParams } from './annotations/AlignedDimension'
export { AngleDimension, type AngleDimensionParams } from './annotations/AngleDimension'
export { RadiusDimension, type RadiusDimensionParams } from './annotations/RadiusDimension'
export { LeaderAnnotation, type LeaderAnnotationParams } from './annotations/LeaderAnnotation'
export { WeldAnnotation, type WeldAnnotationParams } from './annotations/WeldAnnotation'
export { SlopeAnnotation, type SlopeAnnotationParams } from './annotations/SlopeAnnotation'

// Interaction
export {
  AnnotationInteractionController,
  type AnnotationInteractionOptions,
  type AnnotationHitResult,
  type AnnotationInteractionEvent,
  type AnnotationInteractionCallback,
} from './interaction'
