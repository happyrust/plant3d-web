export * from './collision/resolveLabelCollisions';
export * from './format';
export * from './geometry/affine';
export * from './geometry/screenGeometry';
export * from './geometry/trimLineAgainstRect';
export * from './glyph/glyphTrace';
export * from './glyph/lffParser';
export * from './hit/hitIndex';
export * from './hit/hitTest';
export * from './layout/angular';
export * from './layout/context';
export * from './layout/explicit';
export * from './layout/layoutDimension';
export * from './layout/linear';
export * from './layout/projected';
export * from './layout/radial';
// 极坐标放置层（T3.4-T3.6）的公开面：具名导出，避免与内核其余部分撞名。
export { cameraReference, type CameraReferenceInput } from './layout/polar/reference/camera';
export type { PolarElement, PolarReference } from './layout/polar/reference/types';
export { polarPlace } from './layout/polar/place/place';
export type {
  PolarCandidate,
  PolarNeeds,
  PolarPlaceParams,
  PolarPlaceResult,
} from './layout/polar/place/types';
export {
  registerChosen as registerPolarChosen,
  screenGuard as screenGuardPolar,
} from './layout/polar/screenGuard';
export type {
  ScreenGuardInput as PolarScreenGuardInput,
  ScreenGuardResult as PolarScreenGuardResult,
} from './layout/polar/screenGuard';
export * from './projector';
export * from './theme';
export * from './types';
export * from './value';
export * from './vec';
export * from './viewport/layoutViewport';
