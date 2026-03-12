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
export { AnnotationBase, type AnnotationOptions, type AnnotationInteractionState } from './core/AnnotationBase';
export { AnnotationMaterials, type AnnotationMaterialSet } from './core/AnnotationMaterials';

// Annotations
export { LinearDimension, type LinearDimensionParams } from './annotations/LinearDimension';
export { LinearDimension3D, type LinearDimension3DParams } from './annotations/LinearDimension3D';
export { AlignedDimension, type AlignedDimensionParams } from './annotations/AlignedDimension';
export { AngleDimension, type AngleDimensionParams } from './annotations/AngleDimension';
export { AngleDimension3D, type AngleDimension3DParams } from './annotations/AngleDimension3D';
export { RadiusDimension, type RadiusDimensionParams } from './annotations/RadiusDimension';
export { LeaderAnnotation, type LeaderAnnotationParams } from './annotations/LeaderAnnotation';
export { WeldAnnotation, type WeldAnnotationParams } from './annotations/WeldAnnotation';
export { WeldAnnotation3D, type WeldAnnotation3DParams } from './annotations/WeldAnnotation3D';
export { SlopeAnnotation, type SlopeAnnotationParams } from './annotations/SlopeAnnotation';
export { SlopeAnnotation3D, type SlopeAnnotation3DParams } from './annotations/SlopeAnnotation3D';

// Interaction
export {
  AnnotationInteractionController,
  type AnnotationInteractionOptions,
  type AnnotationHitResult,
  type AnnotationInteractionEvent,
  type AnnotationInteractionCallback,
} from './interaction';
