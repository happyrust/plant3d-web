/**
 * Barrel for the polar numeric layer (T3.1 / T3.2).
 *
 * These are pure functions ported from the PML sources in `vendor/MBD`, kept
 * separate from the rest of the kernel so the polar placement layer (T3.4) can
 * depend on them without pulling in layout state. Nothing outside this directory
 * imports them yet; `kernel/index.ts` will export them when T3.4 wires the layer
 * in.
 */

export { angleInAngles, angleUnique, mergeAngles } from './angleRanges';
export { fallbackPlacement } from './fallbackPlacement';
export { getGoodCheight, suiDirDis } from './getGoodCheight';
export { goodRadiusFromBadRadii } from './goodRadius';
export { isoGetHandleDimDir } from './isoHandleDimDir';
export { isoGetBestDir, isoGetDimDir, orthogonal } from './isoDirections';
export {
  MBD_TEXT_LEN_FALLBACK,
  MBD_TEXT_LEN_PML_ENTRIES,
  MBD_TEXT_LEN_TABLE,
  mbdTextLen,
} from './mbdTextLen';
export { splitRange } from './splitRange';
export { weightedWeight } from './weightedWeight';

export type { AngleRange } from './angleRanges';
export type { IsoUsedDir } from './isoHandleDimDir';
export type { RadiusBand } from './goodRadius';
export type { Range } from './fallbackPlacement';
export type { WeightedWeightSystem } from './weightedWeight';
