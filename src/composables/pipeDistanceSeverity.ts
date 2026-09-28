import type {
  AnnotationMaterials,
  AnnotationMaterialSet,
} from '@/utils/three/annotation';

export type PipeDistanceSeverity = 'critical' | 'warning' | 'safe';

const CRITICAL_DISTANCE_MM = 100;
const SAFE_DISTANCE_MM = 300;

export function resolvePipeDistanceSeverity(distanceMm: number): PipeDistanceSeverity {
  if (Number.isNaN(distanceMm)) return 'critical';
  if (distanceMm < CRITICAL_DISTANCE_MM) return 'critical';
  if (distanceMm < SAFE_DISTANCE_MM) return 'warning';
  return 'safe';
}

export type PipeDistanceSeverityVisuals = {
  materialSet: AnnotationMaterialSet;
  backgroundColor: number;
};

export function resolvePipeDistanceSeverityVisuals(
  severity: PipeDistanceSeverity,
  materials: AnnotationMaterials,
): PipeDistanceSeverityVisuals {
  switch (severity) {
    case 'critical':
      return { materialSet: materials.ssDimensionDefault, backgroundColor: 0xff3d00 };
    case 'warning':
      return { materialSet: materials.orange, backgroundColor: 0xff6b00 };
    case 'safe':
      return { materialSet: materials.yellow, backgroundColor: 0xffb74d };
  }
}
