import type { MbdDimKind } from '@/api/mbdPipeApi';
import type {
  AnnotationMaterialSet,
  AnnotationMaterials,
} from '@/utils/three/annotation';

export type MbdDimensionMode = 'classic' | 'rebarviz';

export type MbdDimensionModeConfig = {
  depthTest: boolean;
  arrowStyle: 'filled' | 'open' | 'tick';
  arrowSizePx: number;
  arrowAngleDeg: number;
  lineWidthPx: number;
  extensionOvershootPx: number;
  labelRenderStyle: 'solvespace' | 'rebarviz';
};

const MODE_CONFIG: Record<MbdDimensionMode, MbdDimensionModeConfig> = {
  classic: {
    depthTest: true,
    arrowStyle: 'filled',
    arrowSizePx: 10,
    arrowAngleDeg: 20,
    lineWidthPx: 3,
    extensionOvershootPx: 10,
    labelRenderStyle: 'solvespace',
  },
  rebarviz: {
    depthTest: false,
    arrowStyle: 'open',
    // 对标 RebarViz：更明显的开口箭头 + 更粗线宽
    arrowSizePx: 22,
    arrowAngleDeg: 18,
    lineWidthPx: 3.0,
    extensionOvershootPx: 12,
    labelRenderStyle: 'rebarviz',
  },
};

export function getMbdDimensionModeConfig(
  mode: MbdDimensionMode,
): MbdDimensionModeConfig {
  return MODE_CONFIG[mode] ?? MODE_CONFIG.classic;
}

export function resolveMbdDimensionMaterialSet(
  materials: AnnotationMaterials,
  kind: MbdDimKind,
  mode: MbdDimensionMode,
): AnnotationMaterialSet {
  if (mode === 'rebarviz') {
    if (kind === 'overall') return materials.ssDimensionDefault;
    if (kind === 'chain') return materials.ssDimensionDefault;
    if (kind === 'port') return materials.black;
    return materials.ssDimensionDefault;
  }

  return materials.ssDimensionDefault;
}
