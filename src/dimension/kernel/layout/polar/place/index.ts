/**
 * 极坐标放置层（T3.4a）barrel。
 *
 * 本目录只放 `getBestPosAndOri` 依赖的辅助函数（`angles` / `dirAndCha` / `result`）与
 * 放置层类型契约；主流程 `place.ts` / `balance.ts` / `getdiseles` 属于 T3.4b。
 * `kernel/index.ts` 暂不导出本目录，由 T3.4b 收口。
 */

export {
  angleInAnyRange,
  directionAngle,
  getAngleRange,
  getNormalDirs,
  getUsedAngles,
  isVerticalAxis,
  NORMAL_ANGLE_TOLERANCE_DEG,
  normalAngleRange,
  normalizeAngle,
  NOT_BEST_PLUS_ANGLE_DEG,
  polarArcFrame,
  VERTICAL_ANGLE_TOLERANCE_DEG,
} from './angles';
export { DEFAULT_ANGLE_EPSILON_DEG, DEFAULT_MIN_GAP_DIVISOR, getDirAndCha, SHOWDIR_SAME_SIDE_FACTOR } from './dirAndCha';
export { angleDeg, bisect, offset, opposite, sameDirection } from './geometry';
export { angleOfDirection, getResult, getZDir } from './result';

export type { DirAndCha, DirAndChaOptions } from './dirAndCha';
export type { PolarPlacement } from './result';
export type {
  PolarCandidate,
  PolarNeeds,
  PolarPerDisBest,
  PolarPlaceDiagnostics,
  PolarPlaceOverrides,
  PolarPlaceParams,
  PolarPlaceResult,
  PolarTextOrientation,
} from './types';
