import type { MbdDimKind } from "@/api/mbdPipeApi";
import type {
  AnnotationMaterialSet,
  AnnotationMaterials,
} from "@/utils/three/annotation";

export type MbdDimensionMode = "classic" | "rebarviz";

export type MbdDimensionModeConfig = {
  depthTest: boolean;
  arrowStyle: "filled" | "open" | "tick";
  arrowSizePx: number;
  arrowAngleDeg: number;
  lineWidthPx: number;
  extensionOvershootPx: number;
  labelRenderStyle: "solvespace" | "rebarviz";
};

const MODE_CONFIG: Record<MbdDimensionMode, MbdDimensionModeConfig> = {
  classic: {
    depthTest: true,
    arrowStyle: "filled",
    arrowSizePx: 10,
    arrowAngleDeg: 20,
    lineWidthPx: 1.5,
    extensionOvershootPx: 10,
    labelRenderStyle: "solvespace",
  },
  rebarviz: {
    depthTest: false,
    arrowStyle: "open",
    // 对标 RebarViz：更明显的开口箭头 + 更粗线宽
    arrowSizePx: 16,
    arrowAngleDeg: 18,
    lineWidthPx: 2.2,
    extensionOvershootPx: 12,
    labelRenderStyle: "rebarviz",
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
  if (mode === "rebarviz") {
    if (kind === "overall") return materials.blue;
    if (kind === "chain") return materials.orange;
    if (kind === "port") return materials.black;
    return materials.ssDimensionDefault;
  }

  if (kind === "segment") return materials.green;
  if (kind === "chain") return materials.yellow;
  if (kind === "overall") return materials.white;
  return materials.blue;
}
