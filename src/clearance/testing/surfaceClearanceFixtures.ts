import type { SurfaceClearanceResponse } from '@/api/genModelV1Api';

/**
 * 2026-09-17 live 真值（gen-model `a0e307588` 的 `live_component_to_wall_timing`）：
 * ELBO `24384/22582` × 弧墙 WALL 1 `17496/105912` = 64.43 mm，命中外侧（geometric），垂距 64.50。
 * 点坐标是编的（live 打印没带），量级按 E3D 世界 mm。
 */
export function elboToCurvedWallResponse(overrides: Partial<SurfaceClearanceResponse> = {}): SurfaceClearanceResponse {
  return {
    success: true,
    unit: 'mm',
    method: 'surface_to_surface',
    accuracy_class: 'exact-surface',
    error_bound_mm: 0.5,
    target_kind: 'wall',
    source: { refno: '24384/22582', noun: 'ELBO', leaf_count: 1, triangle_count: 12 },
    target: { refno: '17496/105912', noun: 'WALL', leaf_count: 2, triangle_count: 312 },
    result: {
      distance_mm: 64.43,
      intersects: false,
      source_point: { x: 120_000, y: 45_000, z: 3_200 },
      target_point: { x: 120_064.4, y: 44_998.9, z: 3_200 },
      vector: { dx: 64.4, dy: -1.1, dz: 0 },
      source_leaf_refno: '24384/22582',
      target_leaf_refno: '17496/105912',
      target_leaf_noun: 'WALL',
      target_face: { kind: 'outer', normal: { x: -0.9998, y: 0.0171, z: 0 }, confidence: 'geometric' },
      perpendicular: {
        distance_mm: 64.5,
        from: { x: 120_000, y: 45_000, z: 3_200 },
        to: { x: 120_064.49, y: 44_998.9, z: 3_200 },
      },
      witness: 'closest-points',
    },
    model: { source_sesno: 586, target_sesno: 729 },
    timing_ms: { load: 3, query: 1, total: 10 },
    warnings: [],
    ...overrides,
  };
}

/** live D：BOX `24384/24830` × 直墙 STWALL 1 `17496/105812` = 885.26 mm，角上，垂距落空。 */
export function boxToStraightWallResponse(): SurfaceClearanceResponse {
  return elboToCurvedWallResponse({
    source: { refno: '24384/24830', noun: 'BOX', leaf_count: 1, triangle_count: 12 },
    target: { refno: '17496/105812', noun: 'STWALL', leaf_count: 1, triangle_count: 12 },
    result: {
      distance_mm: 885.26,
      intersects: false,
      source_point: { x: 100_781.4, y: 40_000, z: 2_680 },
      target_point: { x: 100_000, y: 40_265.8, z: 3_000 },
      vector: { dx: -781.4, dy: 265.8, dz: 320 },
      source_leaf_refno: '24384/24830',
      target_leaf_refno: '17496/105812',
      target_leaf_noun: 'STWALL',
      target_face: { kind: 'side', normal: { x: 1, y: 0, z: 0 }, confidence: 'pca' },
      perpendicular: null,
      witness: 'closest-points',
    },
    warnings: ['perpendicular_ray_missed: 源侧最近点沿墙面法向的射线没有落回墙面，最近点在墙的棱 / 角上，垂距置空'],
  });
}

/**
 * 构件在洞里（合成 G6，gen-model `eabd16d5c` 的 `g6_component_in_wall_hole_measures_to_hole_wall_not_zero`）：
 * 穿孔的管离 y 小侧洞壁 50 mm，命中面 `opening`（洞壁，主面），垂距 = 距离。
 */
export function pipeInWallOpeningResponse(): SurfaceClearanceResponse {
  return elboToCurvedWallResponse({
    source: { refno: '24384/30001', noun: 'FTUB', leaf_count: 1, triangle_count: 12 },
    target: { refno: '17496/105812', noun: 'STWALL', leaf_count: 1, triangle_count: 32 },
    result: {
      distance_mm: 50,
      intersects: false,
      source_point: { x: 100_100, y: 42_050, z: 1_200 },
      target_point: { x: 100_100, y: 42_000, z: 1_200 },
      vector: { dx: 0, dy: -50, dz: 0 },
      source_leaf_refno: '24384/30001',
      target_leaf_refno: '17496/105812',
      target_leaf_noun: 'STWALL',
      target_face: { kind: 'opening', normal: { x: 0, y: 1, z: 0 }, confidence: 'geometric' },
      perpendicular: {
        distance_mm: 50,
        from: { x: 100_100, y: 42_050, z: 1_200 },
        to: { x: 100_100, y: 42_000, z: 1_200 },
      },
      witness: 'closest-points',
    },
  });
}

/** 穿墙：`Intersecting`，两点是 AABB 交集中心。 */
export function intersectingResponse(): SurfaceClearanceResponse {
  return elboToCurvedWallResponse({
    result: {
      distance_mm: 0,
      intersects: true,
      source_point: { x: 100_050, y: 40_100, z: 2_700 },
      target_point: { x: 100_050, y: 40_100, z: 2_700 },
      vector: { dx: 0, dy: 0, dz: 0 },
      source_leaf_refno: '24384/22582',
      target_leaf_refno: '17496/105912',
      target_leaf_noun: 'WALL',
      target_face: null,
      perpendicular: null,
      witness: 'aabb-overlap-center',
    },
  });
}

/** 超 `max_distance_mm`：`result: null` + warning。 */
export function beyondMaxDistanceResponse(): SurfaceClearanceResponse {
  return elboToCurvedWallResponse({
    result: null,
    warnings: ['beyond_max_distance: 1000 mm 内两侧网格没有靠近到一起'],
  });
}
